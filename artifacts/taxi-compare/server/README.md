# calib-receiver — приёмник калибровочных замеров на VPS

Минимальный Node-сервис без внешних зависимостей. Принимает POST с одним
замером от сотрудника (форма «Внести замер» во фронте) и пишет JSON-файл
в `/var/www/rwbtaxi/data/calib/`. Из этой папки `scripts/learn.mjs`
подхватывает данные при следующем обучении.

## Состав

- `calib-receiver.mjs` — http-сервер (127.0.0.1:3010).
- `rwbtaxi-calib.service` — systemd unit (запускает под www-data).
- `nginx-snippet.conf` — кусок конфига для проксирования `/api/calib/` → :3010.

## Эндпойнты (после nginx-проксирования)

| Метод | URL                           | Что делает                                |
|-------|-------------------------------|-------------------------------------------|
| GET   | `/api/calib/health`           | Жив ли сервис                             |
| GET   | `/api/calib/stats`            | Сколько всего замеров и сколько за сегодня |
| POST  | `/api/calib/submit`           | Принять и сохранить один замер            |

## Формат тела для `POST /submit`

```json
{
  "fromAddress": "Сухая 25",
  "toAddress":   "Лейтенанта Кижеватова 1",
  "fromLat": 53.9015, "fromLng": 27.5536,
  "toLat":   53.8412, "toLng":   27.5230,
  "factE": 17.5,
  "factC": 22.0,
  "etaMin": 5,
  "tripMin": 22,
  "km": 9.4,
  "demand": "yellow",
  "date": "2026-04-27",
  "hour": 7,
  "source": "rwb-form",
  "notes": "Сухая 25 → Лейтенанта Кижеватова 1 · Эконом ⚡17.5"
}
```

Минимум обязательно: `fromAddress`, `toAddress`, обе пары координат, `date`,
`hour`, `demand`, и хотя бы одна цена (`factE` или `factC`).

## Защита

- Размер тела ограничен 32 KB.
- Per-IP rate limit (по умолчанию 60 запросов в минуту).
- Опциональный токен: если в `/etc/rwbtaxi-calib.env` задан `CALIB_TOKEN=...`,
  фронт обязан слать заголовок `X-Calib-Token: <тот же токен>`.

## Деплой / обновление

```bash
cd artifacts/taxi-compare
bash scripts/deploy-server.sh
```

Скрипт:
1. Копирует `calib-receiver.mjs` в `/opt/rwbtaxi-calib/`.
2. Кладёт systemd unit в `/etc/systemd/system/rwbtaxi-calib.service`.
3. Создаёт `/var/www/rwbtaxi/data/calib/` (chown www-data).
4. Один раз патчит nginx-конфиг `rwbtaxi.by`, добавляя проксирование
   `/api/calib/`. При повторном запуске не дублирует.
5. `nginx -t && systemctl reload nginx`.
6. `systemctl daemon-reload && enable && restart rwbtaxi-calib`.
7. Smoke-тест: `curl https://rwbtaxi.by/api/calib/health`.

## Где смотреть логи на VPS

```bash
journalctl -u rwbtaxi-calib -f
ls -lt /var/www/rwbtaxi/data/calib | head
```
