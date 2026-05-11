# Обучаемая система тарификации

Накопительная система: каждый новый снимок Yandex Go улучшает методологию.

## Цикл обучения

```
   1.  скрин Yandex Go        →  scripts/orders/<date>.json   (вручную)
   2.  pnpm calib <file>      →  scripts/orders/*.results.json + TomTom-проверка
   3.  pnpm learn             →  scripts/learned/*  (рекомендации, метрики, журнал)
   4.  pnpm apply             →  diff в BASE_TARIFF (dry-run)
       pnpm apply --confirm   →  применить рекомендации в src/lib/zones.ts
   5.  перезапуск web         →  обновлённая heatmap
```

## Скрипты

| Команда         | Что делает |
|-----------------|------------|
| `pnpm calib <orders.json>` | Прогоняет каждый заказ через OSRM + TomTom Live, считает sC/sE/hidden_boost, при наличии `yaSurgeC` восстанавливает baza_Y. Пишет `<file>.results.json`. |
| `pnpm learn`    | Читает ВСЕ `*.results.json`, строит единый dataset, выдаёт 4 слоя рекомендаций. Append-only журнал в `learned/changelog.md`. |
| `pnpm apply`    | Dry-run: показывает diff между текущим `BASE_TARIFF` и рекомендованным. |
| `pnpm apply --confirm` | Реально патчит `src/lib/zones.ts`. |

## 4 слоя обучаемой модели

| Слой | Что обучается | Источник правды |
|------|---------------|-----------------|
| **L1 TARIFF** | `pickup`, `perKm`, `perMin`, `minimum` для Cmf | Линейная регрессия `baza_Y = factC / yaSurgeC` по заказам с открытым ⚡N. Если все короткие → `minimum = mean(baza_Y)`. |
| **L2 TIME-SLOT SURGE** | `sC[day][slot][cell]` — сёрдж по дню недели × слоту времени × ячейке города | sC из калибровки + открытый ⚡N (отдельно, для эталона). |
| **L3 HIDDEN ECONOM-BOOST** | `sE/sC` — насколько Эконом дешевле Cmf при «Высоком спросе» | `factE / rawE` ÷ `factC / rawC` по слотам. |
| **L4 TRAFFIC ADJUST** | Корреляция `surge ↔ ttMult` — как пробки сдвигают сёрдж | TomTom Live в 6 точках вдоль маршрута. |

## Поля в orders.json

```json
{
  "id": "9864",
  "from": "Немига 8", "to": "пр. Независимости 168",
  "factC": 12.8,        // обязательно — цена Cmf со скрина
  "factE": 10.3,        // обязательно — цена Эконом
  "yaSurgeC": 1.3,      // ⭐ ОПЦИОНАЛЬНО — открытый ⚡N со скрина (Cmf). КРИТИЧНО важно для калибровки тарифа.
  "yaMin": 16,          // опционально — время поездки по Yandex (для сравнения скоростей)
  "yaKm": 13.4,         // опционально — км по Yandex
  "hour": 10,           // используется для time-slot
  "notes": "..."
}
```

## День недели и слоты

`day` определяется автоматически из `date` в orders.json:
- `weekday` (пн–пт), `saturday`, `sunday`

`slot` — из `hour`:
- `night` 00–06 / `morning` 07–10 / `midday` 11–14 / `evening` 15–19 / `late` 20–23

## Что нужно для лучшего обучения

- Заказы из **разных слотов** (вечер пятницы, утро понедельника) — сейчас всё в `sunday-morning`.
- **Длинные** маршруты (>15 км) с открытым ⚡N — позволят откалибровать `perKm` и `perMin`, а не только `minimum`.
- **Час пик** (17–19 будни) — даст ttMult > 1, можно обучить L4.

## Артефакты обучения (`scripts/learned/`)

| Файл | Содержит |
|------|----------|
| `dataset.json` | Все заказы с timestamp, day, slot, координатами, sC/sE/yaSurgeC. |
| `tariff-suggested.json` | Diff `current` vs `suggested` тарифа + evidence (regression coefs, MAE). |
| `surge-map.json` | sC по `day × slot × cell` (наша модель) и yaOpen (эталон Yandex). |
| `hidden-boost.json` | mean(sE/sC) по слотам. |
| `traffic-effect.json` | Корреляция surge ↔ ttMult. |
| `metrics.json` | Сводная статистика. |
| `changelog.md` | Append-only журнал каждого `pnpm learn` с diff и предупреждениями. |

## Безопасность

- `pnpm apply` без `--confirm` — только показывает diff.
- `pnpm apply --confirm` — единственная команда, которая патчит код.
- `changelog.md` — никогда не перезаписывается, только добавляется.
- `dataset.json` — пересоздаётся каждый раз из `orders/*.results.json` (источник правды — orders).
