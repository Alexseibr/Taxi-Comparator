#!/usr/bin/env bash
# Деплой обновлённого rwbtaxi-screens на VPS.
#   1) копирует server/screen-receiver.mjs → /opt/rwbtaxi-screens/
#   2) копирует server/recommended-routes.json → /opt/rwbtaxi-screens/
#   3) systemctl restart rwbtaxi-screens
#   4) smoke-тест /api/screens/health и /api/screens/recommended
#
# Запуск:  bash scripts/deploy-screen-receiver.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ARTIFACT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
KEY_PATH="/tmp/ssh-rwbtaxi/id_ed25519"
VPS_USER="root"
VPS_HOST="94.130.167.173"

# 1. Восстановить SSH-ключ из секрета (та же логика, что в deploy.sh).
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

# 2. Проверим что директория существует (она у нас уже есть, но на всякий).
ssh_run 'mkdir -p /opt/rwbtaxi-screens && [ -f /opt/rwbtaxi-screens/screen-receiver.mjs ] || { echo "✗ /opt/rwbtaxi-screens/screen-receiver.mjs нет — сначала ручная установка"; exit 1; }'

# 3. Заливаем новые файлы (anchors-minsk.json — список якорных точек,
#    маршруты теперь генерируются автоматически).
echo "→ Копирую screen-receiver.mjs и anchors-minsk.json..."
scp "${SCP_OPTS[@]}" "$ARTIFACT_DIR/server/screen-receiver.mjs" "$VPS_USER@$VPS_HOST:/opt/rwbtaxi-screens/screen-receiver.mjs" >/dev/null
scp "${SCP_OPTS[@]}" "$ARTIFACT_DIR/server/anchors-minsk.json" "$VPS_USER@$VPS_HOST:/opt/rwbtaxi-screens/anchors-minsk.json" >/dev/null

# 4. Права + удаляем устаревший статический файл маршрутов, если остался.
ssh_run '
  chown root:www-data /opt/rwbtaxi-screens/screen-receiver.mjs /opt/rwbtaxi-screens/anchors-minsk.json
  chmod 644 /opt/rwbtaxi-screens/anchors-minsk.json
  chmod 755 /opt/rwbtaxi-screens/screen-receiver.mjs
  rm -f /opt/rwbtaxi-screens/recommended-routes.json
'

# 5. Перезапускаем сервис.
echo "→ Перезапускаю rwbtaxi-screens..."
ssh_run '
  systemctl restart rwbtaxi-screens
  sleep 1
  systemctl is-active rwbtaxi-screens
'

# 6. Smoke-тесты.
echo "→ Smoke /api/screens/health:"
curl -fsS "https://rwbtaxi.by/api/screens/health" | head -c 200
echo
echo "→ Smoke /api/screens/recommended (первые 300 байт):"
curl -fsS "https://rwbtaxi.by/api/screens/recommended" | head -c 300
echo
echo
echo "✓ Готово. Логи:  journalctl -u rwbtaxi-screens -n 30 --no-pager"
