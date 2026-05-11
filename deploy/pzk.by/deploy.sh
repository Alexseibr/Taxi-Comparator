#!/usr/bin/env bash
# Скрипт первой выкатки на чистый VPS под Ubuntu/Debian.
# Запускать на сервере под root (или через sudo).
set -euo pipefail

DOMAIN="pzk.by"
WEBROOT="/var/www/${DOMAIN}"
ARCHIVE="${1:-pzk-by.tar.gz}"

echo "==> 1/6  Установка nginx и certbot"
apt-get update -y
apt-get install -y nginx certbot python3-certbot-nginx

echo "==> 2/6  Папка для сайта"
mkdir -p "${WEBROOT}"
mkdir -p /var/www/letsencrypt

echo "==> 3/6  Распаковка архива в ${WEBROOT}"
if [[ ! -f "${ARCHIVE}" ]]; then
    echo "Файл ${ARCHIVE} не найден. Залейте архив рядом со скриптом и повторите."
    exit 1
fi
tar -xzf "${ARCHIVE}" -C "${WEBROOT}" --strip-components=1
chown -R www-data:www-data "${WEBROOT}"

echo "==> 4/6  Конфиг nginx"
cp nginx-${DOMAIN}.conf /etc/nginx/sites-available/${DOMAIN}
ln -sf /etc/nginx/sites-available/${DOMAIN} /etc/nginx/sites-enabled/${DOMAIN}
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

echo "==> 5/6  SSL-сертификат через Let's Encrypt"
echo "Перед этим шагом убедитесь что A-запись ${DOMAIN} -> IP сервера прописана в DNS."
read -r -p "Готово? (yes/no) " ok
if [[ "${ok}" == "yes" ]]; then
    certbot --nginx -d ${DOMAIN} -d www.${DOMAIN} --redirect --agree-tos -m admin@${DOMAIN} --non-interactive
else
    echo "Сертификат не выпущен. Запустите вручную: certbot --nginx -d ${DOMAIN} -d www.${DOMAIN}"
fi

echo "==> 6/6  Авто-обновление сертификата"
systemctl enable --now certbot.timer

echo
echo "Готово! Сайт доступен по адресу https://${DOMAIN}"
