# WB Taxi City Control Tower

Модуль `city-control-tower` добавлен как изолированный backend-блок под `/api/city-control-tower`.

## Что реализовано (MVP)
- Схемы Drizzle для зон, OD-маршрутов, рыночных наблюдений, baselines, market signals, экономики водителя, price corridor.
- Seed-заготовка Минска с зонами, маршрутами и генератором 150+ observation.
- Базовые deterministic services:
  - baseline stats (p25/p50/p75/avg + confidence)
  - market signal (surge/eta/attack)
  - driver min economics price
  - price corridor generation
- API endpoints MVP:
  - `GET/POST /api/city-control-tower/zones`
  - `GET /api/city-control-tower/routes`
  - `POST /api/city-control-tower/observations`
  - `POST /api/city-control-tower/baselines/recalculate`
  - `POST /api/city-control-tower/signals/recalculate`
  - `POST /api/city-control-tower/driver-profitability/calculate`
  - `POST /api/city-control-tower/pricing/corridor`

## Ограничения MVP
- CRUD persistence пока не подключен к DB в роутерах (только контракт/API + калькуляции).
- Weekly plan, dead zones, promo-supply, LLM-layer и UI будут следующими итерациями.
