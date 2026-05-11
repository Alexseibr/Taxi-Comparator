#!/usr/bin/env bash
# Скрипт обновления сайта (новый билд после изменений).
# Залейте новый pzk-by.tar.gz рядом со скриптом и запустите.
set -euo pipefail

DOMAIN="pzk.by"
WEBROOT="/var/www/${DOMAIN}"
ARCHIVE="${1:-pzk-by.tar.gz}"

if [[ ! -f "${ARCHIVE}" ]]; then
    echo "Файл ${ARCHIVE} не найден."
    exit 1
fi

echo "==> Бэкап текущей версии"
ts=$(date +%Y%m%d-%H%M%S)
tar -czf "${WEBROOT}-backup-${ts}.tar.gz" -C "${WEBROOT}" .

echo "==> Чистим webroot"
rm -rf "${WEBROOT:?}"/*

echo "==> Распаковка нового билда"
tar -xzf "${ARCHIVE}" -C "${WEBROOT}" --strip-components=1
chown -R www-data:www-data "${WEBROOT}"

echo "==> Перезапуск nginx (без даунтайма)"
nginx -t && systemctl reload nginx

echo "Готово. Бэкап: ${WEBROOT}-backup-${ts}.tar.gz"
