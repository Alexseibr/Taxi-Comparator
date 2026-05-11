#!/usr/bin/env bash
# Перекладывает failed/-скрины с reason=vision_403 обратно в incoming/.
# Защита: не более 3 попыток (vision_retry_count в .meta.json), не старше суток.
# RACE: rwbtaxi-screens.service параллельно вычитывает incoming/ и может
# удалить файлы прямо во время работы скрипта — все mv/rm идут с проверками
# существования и игнорируют ENOENT (это норма, не ошибка).
set -uo pipefail

FAILED=/var/www/rwbtaxi/data/screens/failed
INCOMING=/var/www/rwbtaxi/data/screens/incoming
MAX_RETRIES=3
DAY_AGO=$(($(date +%s) - 86400))

moved=0
skipped_age=0
skipped_attempts=0
skipped_other=0
total=0

shopt -s nullglob
for ERR in "$FAILED"/*.error.json; do
  [ -f "$ERR" ] || continue                                # race: уже забрали
  grep -qE '"error":[[:space:]]*"vision_403"' "$ERR" 2>/dev/null || continue
  total=$((total + 1))

  BASE=$(basename "$ERR" .error.json)                      # screen-…-XXXX.png
  PNG="$FAILED/$BASE"
  META="$FAILED/${BASE}.meta.json"

  if [ ! -f "$PNG" ] || [ ! -f "$META" ]; then
    skipped_other=$((skipped_other + 1)); continue
  fi

  M=$(stat -c %Y "$ERR" 2>/dev/null || echo 0)
  if [ "$M" -lt "$DAY_AGO" ]; then
    skipped_age=$((skipped_age + 1)); continue
  fi

  # инкрементируем vision_retry_count в meta атомарно через python
  CNT=$(python3 - "$META" "$MAX_RETRIES" <<'PY' 2>/dev/null || echo "ERR"
import json, os, sys
from datetime import datetime, timezone
path, max_r = sys.argv[1], int(sys.argv[2])
try:
    with open(path, "r", encoding="utf-8") as f:
        d = json.load(f)
except Exception:
    print("ERR"); sys.exit(0)
n = int(d.get("vision_retry_count", 0) or 0)
if n >= max_r:
    print(f"MAX:{n}"); sys.exit(0)
d["vision_retry_count"] = n + 1
d["vision_retry_last_at"] = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
tmp = path + ".tmp"
try:
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(d, f, ensure_ascii=False, indent=2)
    os.replace(tmp, path)
except FileNotFoundError:
    print("RACE"); sys.exit(0)
print(f"OK:{n+1}")
PY
)

  case "$CNT" in
    OK:*)
      # двигаем — каждый шаг проверяем что файл ещё на месте (race-safe)
      [ -f "$PNG" ]  && mv -f "$PNG"  "$INCOMING/$BASE"               2>/dev/null || true
      [ -f "$META" ] && mv -f "$META" "$INCOMING/${BASE}.meta.json"   2>/dev/null || true
      [ -f "$ERR" ]  && rm  -f "$ERR"
      moved=$((moved + 1))
      ;;
    MAX:*)
      skipped_attempts=$((skipped_attempts + 1))
      ;;
    *)  # ERR / RACE / пусто
      skipped_other=$((skipped_other + 1))
      ;;
  esac
done

echo "[auto-retry-vision-403] $(date -Iseconds) total=$total moved=$moved skipped_age=$skipped_age skipped_attempts=$skipped_attempts skipped_other=$skipped_other"
