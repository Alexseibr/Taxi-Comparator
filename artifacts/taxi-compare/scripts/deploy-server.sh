#!/usr/bin/env bash
# Деплой/обновление calib-receiver на rwbtaxi.by.
# Идемпотентен: повторный запуск не сломает уже работающий сервис.
#
# Использование:  bash scripts/deploy-server.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ARTIFACT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
KEY_PATH="/tmp/ssh-rwbtaxi/id_ed25519"
VPS_USER="root"
VPS_HOST="94.130.167.173"

# 1. Восстановить SSH-ключ (та же логика, что в deploy.sh).
if [ ! -f "$KEY_PATH" ]; then
  if [ -z "${VPS_SSH_KEY:-}" ]; then
    echo "✗ Нет ни $KEY_PATH, ни VPS_SSH_KEY в env. Задеплоить нельзя." >&2
    exit 1
  fi
  echo "→ Восстанавливаю SSH-ключ из VPS_SSH_KEY..."
  mkdir -p "$(dirname "$KEY_PATH")"
  body=$(printf '%s' "$VPS_SSH_KEY" | sed -E 's/-----[A-Z ]+-----//g' | tr -d '[:space:]')
  if [ -z "$body" ]; then
    echo "✗ VPS_SSH_KEY есть, но тело ключа пустое после нормализации." >&2
    exit 1
  fi
  {
    echo "-----BEGIN OPENSSH PRIVATE KEY-----"
    printf '%s\n' "$body" | fold -w 70
    echo "-----END OPENSSH PRIVATE KEY-----"
  } > "$KEY_PATH"
  chmod 600 "$KEY_PATH"
fi

SSH_OPTS=(-i "$KEY_PATH" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR)
SCP_OPTS=("${SSH_OPTS[@]}")

ssh_run() { ssh "${SSH_OPTS[@]}" "$VPS_USER@$VPS_HOST" "$@"; }

echo "→ Проверяю SSH-доступ к $VPS_HOST..."
ssh_run 'echo OK' >/dev/null

# 2. Подготовить директории на VPS.
echo "→ Готовлю папки на VPS..."
ssh_run '
  mkdir -p /opt/rwbtaxi-calib
  mkdir -p /var/www/rwbtaxi/data/calib
  chown -R www-data:www-data /var/www/rwbtaxi/data/calib
  chmod 755 /var/www/rwbtaxi/data/calib
'

# 3. Залить файлы сервиса.
echo "→ Заливаю calib-receiver.mjs и systemd unit..."
scp "${SCP_OPTS[@]}" "$ARTIFACT_DIR/server/calib-receiver.mjs" "$VPS_USER@$VPS_HOST:/opt/rwbtaxi-calib/calib-receiver.mjs" >/dev/null
scp "${SCP_OPTS[@]}" "$ARTIFACT_DIR/server/rwbtaxi-calib.service" "$VPS_USER@$VPS_HOST:/etc/systemd/system/rwbtaxi-calib.service" >/dev/null

# 4. Создать /etc/rwbtaxi-calib.env (только если ещё нет — не трогаем существующий токен).
ssh_run '
  if [ ! -f /etc/rwbtaxi-calib.env ]; then
    cat > /etc/rwbtaxi-calib.env <<EOF
# Конфиг calib-receiver. Перезагрузить:  systemctl restart rwbtaxi-calib
PORT=3010
HOST=127.0.0.1
CALIB_DIR=/var/www/rwbtaxi/data/calib
CALIB_RATE_LIMIT=60
# Чтобы включить токен — раскомментируй и задай. На фронте задай VITE_CALIB_TOKEN то же значение.
# CALIB_TOKEN=
EOF
    chmod 640 /etc/rwbtaxi-calib.env
    chown root:www-data /etc/rwbtaxi-calib.env
    echo "  → создан /etc/rwbtaxi-calib.env (без токена, открытый endpoint)"
  else
    echo "  → /etc/rwbtaxi-calib.env уже есть, не трогаю"
  fi
'

# 5. Пропатчить nginx-конфиг — добавить /api/calib/ proxy, если ещё не добавлен.
#    Используем готовый файл server/nginx-snippet.conf (никаких bash/awk-эскейпов).
#    CONF задаётся ЛОКАЛЬНО, чтобы set -u не падал на '"$CONF"' внутри heredoc.
CONF="/etc/nginx/sites-enabled/rwbtaxi.by"
echo "→ Патчу $CONF (если ещё не пропатчен)..."
scp "${SCP_OPTS[@]}" "$ARTIFACT_DIR/server/nginx-snippet.conf" "$VPS_USER@$VPS_HOST:/tmp/rwbtaxi-calib-snippet.conf" >/dev/null
ssh_run '
  CONF=/etc/nginx/sites-enabled/rwbtaxi.by
  if grep -q "/api/calib/" "$CONF"; then
    echo "  → уже пропатчен"
  else
    cp "$CONF" "$CONF.bak.$(date +%s)"
    python3 - <<PY
src = open("'"$CONF"'", "r", encoding="utf-8").read()
snip = open("/tmp/rwbtaxi-calib-snippet.conf", "r", encoding="utf-8").read()
needle = "location / {"
i = src.find(needle)
if i < 0:
    raise SystemExit("location / { not found in nginx config — нечего патчить")
line_start = src.rfind("\n", 0, i) + 1
indent = src[line_start:i]  # обычно "    "
indented = "".join(((indent + l) if l.strip() else l) for l in snip.splitlines(keepends=True))
new = src[:line_start] + indented.rstrip() + "\n\n" + src[line_start:]
open("'"$CONF"'", "w", encoding="utf-8").write(new)
print("  → патч применён")
PY
  fi
  rm -f /tmp/rwbtaxi-calib-snippet.conf
  echo "→ nginx -t..."
  nginx -t
  systemctl reload nginx
'

# 6. Перезапустить systemd unit.
echo "→ Запускаю systemd unit..."
ssh_run '
  systemctl daemon-reload
  systemctl enable rwbtaxi-calib >/dev/null 2>&1 || true
  systemctl restart rwbtaxi-calib
  sleep 1
  systemctl is-active rwbtaxi-calib
'

# 7. Smoke-тест.
echo "→ Smoke-тест health/stats..."
ssh_run '
  for path in /api/calib/health /api/calib/stats; do
    code=$(curl -s -o /dev/null -w "%{http_code}" "https://rwbtaxi.by$path")
    body=$(curl -s "https://rwbtaxi.by$path" | head -c 200)
    printf "  %-25s %s  %s\n" "$path" "$code" "$body"
  done
'

echo "✓ calib-receiver деплой завершён."
echo "  Логи:        ssh root@$VPS_HOST 'journalctl -u rwbtaxi-calib -f'"
echo "  Замеры:      ssh root@$VPS_HOST 'ls -lt /var/www/rwbtaxi/data/calib | head'"
