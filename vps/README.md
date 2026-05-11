# VPS backend bundle для rwbtaxi.by

Снимок состояния VPS (`94.130.167.173`) на момент создания архива.
В **архиве переноса** распаковывается в `vps/backend/`.

## Что внутри

```
backend/
  newstat/         — Node-сервис фрод-финансов (порт :3012, /api/newstat/*)
  newstat-ml/      — Python/FastAPI ML-сервис (CatBoost, supervised.py)
  screens/         — Node-сервис приёма скринов Yandex Go (порт :3011, /api/screens/, /api/wb/)
  calib/           — Node-сервис калибровки (порт :3010, /api/calib/)
  learn/           — обучающий сервис (rwbtaxi-train.service)

systemd/           — unit-файлы из /etc/systemd/system/rwbtaxi-*.service
nginx/             — актуальный server-block из /etc/nginx/sites-available/rwbtaxi.by
env/               — *.env.example с СПИСКОМ ключей (значения замаскированы)
db/                — pg_dump --schema-only БД rwbtaxi_newstat (только структура)
```

## Восстановление в новом проекте

1. **Перелить файлы на VPS** (или новый VPS):
   ```bash
   for svc in newstat newstat-ml screens calib learn; do
     scp -r vps/backend/$svc/ root@<vps>:/opt/rwbtaxi-$svc/
     ssh root@<vps> "cd /opt/rwbtaxi-$svc && npm install"   # или pip install
   done
   sudo cp vps/systemd/*.service /etc/systemd/system/
   sudo cp vps/nginx/rwbtaxi.by.conf /etc/nginx/sites-available/rwbtaxi.by
   sudo ln -sf /etc/nginx/sites-available/rwbtaxi.by /etc/nginx/sites-enabled/
   sudo systemctl daemon-reload
   ```

2. **Создать env-файлы** на основе `env/*.env.example` —
   подставить реальные значения секретов:
   - `SESSION_SECRET` — случайный 32+ байта
   - `DATABASE_URL` — `postgres://newstat_user:<pwd>@localhost/rwbtaxi_newstat`
   - `GOOGLE_MAPS_KEY`, `VITE_TOMTOM_KEY` — из Google Cloud Console / TomTom
   - `ML_SHARED_SECRET` / `SHARED_SECRET` — общий секрет для newstat ↔ newstat-ml
   - `WB_ADMIN_PASSWORD` / `WB_VIEWER_PASSWORD` — bcrypt-hash из старой системы

3. **Восстановить БД**:
   ```bash
   sudo -u postgres createuser newstat_user --pwprompt
   sudo -u postgres createdb rwbtaxi_newstat -O newstat_user
   sudo -u postgres psql rwbtaxi_newstat < vps/db/rwbtaxi_newstat-schema.sql
   # bootstrap admin пользователя:
   cd /opt/rwbtaxi-newstat && node bootstrap-admin.mjs
   ```

4. **Запустить сервисы**:
   ```bash
   sudo systemctl enable --now rwbtaxi-{calib,screens,newstat,newstat-ml}.service
   sudo nginx -t && sudo systemctl reload nginx
   ```

## Что НЕ перенесено (нужно отдельно)

- **JSONL-данные** в `/var/www/rwbtaxi/data/{calib,screens,wb,recommendations}/`
  — десятки тысяч файлов (десятки ГБ скринов + JSON-метаданные).
  Если нужны для тестов — отдельный rsync. Для нового проекта обычно не нужно.

- **Bcrypt-хеши паролей** для wb-auth — лежат в `WB_ADMIN_PASSWORD` / `WB_VIEWER_PASSWORD`.
  В новом окружении проще выпустить новые: `node -e "console.log(require(bcryptjs).hashSync(PASSWORD, 10))"`

- **Данные newstat-БД** — экспорт делается `pg_dump rwbtaxi_newstat` (без флага --schema-only).
  Сейчас в архиве только схема — `pg_dump --schema-only`. Для миграции реальных данных
  выгрузить отдельно и положить в `vps/db/`.
