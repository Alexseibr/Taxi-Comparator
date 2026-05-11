#!/usr/bin/env bash
# Деплой обновлённого process-screens.mjs (cron-обработчик скриншотов) на VPS.
#   1) копирует server/process-screens.mjs → /opt/rwbtaxi-screens/
#   2) делает резервную копию старого файла рядом
#   3) проверяет, что node --check проходит на самом VPS
#   4) ничего не рестартует — скрипт запускается cron'ом каждые 5 минут
#      (/usr/local/bin/rwbtaxi-process-screens.sh + flock)
#   5) опционально: запускает скрипт вручную один раз и показывает 30 строк лога
#
# Запуск:  bash scripts/deploy-process-screens.sh        # без ручного прогона
#          bash scripts/deploy-process-screens.sh --run  # с ручным прогоном
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ARTIFACT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
KEY_PATH="/tmp/ssh-rwbtaxi/id_ed25519"
VPS_USER="root"
VPS_HOST="94.130.167.173"
RUN_NOW="${1:-}"

# 1. Восстановить SSH-ключ из секрета (та же логика, что в deploy-screen-receiver.sh).
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

# 2. Локально проверим синтаксис, чтобы не залить заведомо битый файл.
echo "→ Локальный node --check..."
node --check "$ARTIFACT_DIR/server/process-screens.mjs"

# 3. Резервная копия + заливка нового файла.
TS="$(date +%s)"
echo "→ Бэкаплю старый process-screens.mjs (.bak.$TS)..."
ssh_run "[ -f /opt/rwbtaxi-screens/process-screens.mjs ] && cp /opt/rwbtaxi-screens/process-screens.mjs /opt/rwbtaxi-screens/process-screens.mjs.bak.$TS || true"

echo "→ Копирую process-screens.mjs..."
scp "${SCP_OPTS[@]}" "$ARTIFACT_DIR/server/process-screens.mjs" "$VPS_USER@$VPS_HOST:/opt/rwbtaxi-screens/process-screens.mjs" >/dev/null

# 4. Права + проверка синтаксиса на VPS.
ssh_run '
  chown root:root /opt/rwbtaxi-screens/process-screens.mjs
  chmod 755 /opt/rwbtaxi-screens/process-screens.mjs
  node --check /opt/rwbtaxi-screens/process-screens.mjs && echo "VPS syntax OK"
'

# 5. Опционально — ручной прогон (полезно, чтобы посмотреть пайплайн в реальном
#    времени, а не ждать следующего тика cron).
if [ "$RUN_NOW" = "--run" ]; then
  echo "→ Запускаю process-screens.mjs вручную (через ту же flock-обёртку)..."
  ssh_run '
    /usr/local/bin/rwbtaxi-process-screens.sh 2>&1 | tail -n 60
  ' || echo "  (вышел с ненулевым кодом — это нормально, если incoming пуст)"
fi

# 6. Лог последних запусков cron.
echo
echo "→ Последние 30 строк /var/log/rwbtaxi-screens.log:"
ssh_run 'tail -n 30 /var/log/rwbtaxi-screens.log 2>/dev/null || echo "(лог пуст)"'

echo
echo "✓ Готово. Скрипт подхватится cron'ом в ближайшую кратную 5 минуту."
echo "  Ручной прогон:    bash scripts/deploy-process-screens.sh --run"
echo "  Логи в реалтайме: ssh root@$VPS_HOST 'tail -f /var/log/rwbtaxi-screens.log'"
