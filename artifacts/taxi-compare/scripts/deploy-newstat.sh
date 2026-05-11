#!/usr/bin/env bash
# Деплой newstat-backend (workbench + ml + settings + server.mjs) на VPS,
# затем build + upload SPA.
#
# Использование:  bash scripts/deploy-newstat.sh [--backend-only | --frontend-only]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ARTIFACT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$ARTIFACT_DIR/../.." && pwd)"
SERVER_LOCAL="$REPO_ROOT/.local/newstat-server"

KEY_PATH="/tmp/ssh-rwbtaxi/id_ed25519"
VPS_USER="root"
VPS_HOST="94.130.167.173"
VPS_SERVER_DIR="/opt/rwbtaxi-newstat"
VPS_SPA_DIR="/var/www/rwbtaxi/dist/public"
SERVICE_NAME="rwbtaxi-newstat"

MODE="both"
if [[ "${1:-}" == "--backend-only" ]];  then MODE="backend"; fi
if [[ "${1:-}" == "--frontend-only" ]]; then MODE="frontend"; fi

# ── SSH key ───────────────────────────────────────────────────────────────────
if [ ! -f "$KEY_PATH" ]; then
  if [ -z "${VPS_SSH_KEY:-}" ]; then
    echo "✗ Нет ни $KEY_PATH, ни VPS_SSH_KEY в env." >&2; exit 1
  fi
  echo "→ Восстанавливаю SSH-ключ..."
  mkdir -p "$(dirname "$KEY_PATH")"
  body=$(printf '%s' "$VPS_SSH_KEY" | sed -E 's/-----[A-Z ]+-----//g' | tr -d '[:space:]')
  { echo "-----BEGIN OPENSSH PRIVATE KEY-----"
    printf '%s\n' "$body" | fold -w 70
    echo "-----END OPENSSH PRIVATE KEY-----"; } > "$KEY_PATH"
  chmod 600 "$KEY_PATH"
fi

SSH_OPTS=(-i "$KEY_PATH" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR)
SCP_OPTS=("${SSH_OPTS[@]}")

ssh_run() { ssh "${SSH_OPTS[@]}" "$VPS_USER@$VPS_HOST" "$@"; }

echo "→ Проверяю SSH к $VPS_HOST..."
ssh_run 'echo OK' >/dev/null

# ── Backend ───────────────────────────────────────────────────────────────────
if [[ "$MODE" == "both" || "$MODE" == "backend" ]]; then
  echo "→ Деплою backend файлы..."

  # Заливаем routes (все, чтобы не пропустить зависимости)
  for f in "$SERVER_LOCAL"/routes/*.mjs; do
    fname="$(basename "$f")"
    scp "${SCP_OPTS[@]}" "$f" "$VPS_USER@$VPS_HOST:$VPS_SERVER_DIR/routes/$fname" >/dev/null
    echo "  ✓ routes/$fname"
  done

  # lib/*.mjs
  for f in "$SERVER_LOCAL"/lib/*.mjs; do
    fname="$(basename "$f")"
    scp "${SCP_OPTS[@]}" "$f" "$VPS_USER@$VPS_HOST:$VPS_SERVER_DIR/lib/$fname" >/dev/null
    echo "  ✓ lib/$fname"
  done

  # server.mjs
  scp "${SCP_OPTS[@]}" "$SERVER_LOCAL/server.mjs" "$VPS_USER@$VPS_HOST:$VPS_SERVER_DIR/server.mjs" >/dev/null
  echo "  ✓ server.mjs"

  # Перезапуск
  echo "→ Перезапускаю $SERVICE_NAME..."
  ssh_run "systemctl restart $SERVICE_NAME && sleep 2 && systemctl is-active $SERVICE_NAME"

  # Smoke-check
  echo "→ Smoke-check backend..."
  ssh_run "
    token=\$(curl -s -X POST http://localhost:3012/auth/login \
      -H 'Content-Type: application/json' \
      -d '{\"login\":\"admin\",\"password\":\"PrziwH622ntzHVOzm3eRNg==\"}' \
      | python3 -c 'import sys,json; print(json.load(sys.stdin).get(\"token\",\"\"))' 2>/dev/null)
    if [ -z \"\$token\" ]; then echo '  ✗ auth fail' ; exit 1; fi
    for path in /workbench/kpi /workbench/cases /ml/labels-summary; do
      code=\$(curl -s -o /dev/null -w '%{http_code}' -H \"Authorization: Bearer \$token\" http://localhost:3012\$path)
      printf '  %-35s %s\n' \"\$path\" \"\$code\"
    done
  "
fi

# ── Frontend ──────────────────────────────────────────────────────────────────
if [[ "$MODE" == "both" || "$MODE" == "frontend" ]]; then
  echo "→ Собираю SPA..."
  cd "$ARTIFACT_DIR"
  PORT=5000 BASE_PATH=/ pnpm run build >/dev/null

  echo "→ Заливаю SPA на VPS..."
  ssh_run "rm -rf $VPS_SPA_DIR/*"
  tar -czf - -C dist/public . | \
    ssh_run "tar -xzf - -C $VPS_SPA_DIR && chown -R www-data:www-data /var/www/rwbtaxi"

  echo "→ Smoke-check SPA..."
  ssh_run "
    code=\$(curl -s -o /dev/null -w '%{http_code}' -H 'Host: rwbtaxi.by' http://localhost/)
    printf '  /   %s\n' \"\$code\"
    code=\$(curl -s -o /dev/null -w '%{http_code}' -H 'Host: rwbtaxi.by' http://localhost/newstat/)
    printf '  /newstat/   %s\n' \"\$code\"
  "
fi

echo "✓ Готово."
