#!/usr/bin/env bash
# Полный деплой taxi-compare на rwbtaxi.by (94.130.167.173).
# Восстанавливает SSH-ключ из секрета VPS_SSH_KEY (т.к. /tmp чистится между
# сессиями Replit), собирает фронт, заливает в /var/www/rwbtaxi/dist/public.
#
# Использование:  bash scripts/deploy.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ARTIFACT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
KEY_PATH="/tmp/ssh-rwbtaxi/id_ed25519"
VPS_USER="root"
VPS_HOST="94.130.167.173"
VPS_DEST="/var/www/rwbtaxi/dist/public"

# 1. Восстановить ключ из секрета, если ещё нет (или очистился /tmp).
# Replit Secrets иногда схлопывает многострочное значение в одну строку,
# заменяя \n на пробелы — поэтому вырезаем header/footer + любой whitespace
# и пересобираем PEM-формат с честными переносами по 70 символов.
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

# 2. Smoke-test ключа.
echo "→ Проверяю доступ к $VPS_HOST..."
ssh "${SSH_OPTS[@]}" "$VPS_USER@$VPS_HOST" 'echo OK' >/dev/null

# 3. Собрать фронт.
echo "→ Собираю фронт..."
cd "$ARTIFACT_DIR"
PORT=5000 BASE_PATH=/ pnpm run build >/dev/null

# 4. Залить в /var/www/rwbtaxi/dist/public с очисткой старого.
echo "→ Заливаю на VPS..."
ssh "${SSH_OPTS[@]}" "$VPS_USER@$VPS_HOST" "rm -rf $VPS_DEST/*"
tar -czf - -C dist/public . | \
  ssh "${SSH_OPTS[@]}" "$VPS_USER@$VPS_HOST" \
    "tar -xzf - -C $VPS_DEST && chown -R www-data:www-data /var/www/rwbtaxi"

# 5. Smoke-check, что главные эндпойнты отдают 200.
echo "→ Проверяю файлы..."
ssh "${SSH_OPTS[@]}" "$VPS_USER@$VPS_HOST" '
  for path in / /data/loo.json /data/observations.json; do
    code=$(curl -s -H "Host: rwbtaxi.by" -o /dev/null -w "%{http_code}" "http://localhost$path")
    printf "  %-30s %s\n" "$path" "$code"
  done
'

echo "✓ Деплой завершён: http://rwbtaxi.by/"
