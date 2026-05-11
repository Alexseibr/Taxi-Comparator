# Журнал обучения системы



## 2026-04-26 08:02 — обучение #1

**Dataset**: 19 заказов из 2 прогонов калибровки. С открытым ⚡N: 8.

**Тариф Cmf — изменения**:
  (без изменений — недостаточно данных)

**⚠ Предупреждения**:
  - Все имеющиеся заказы упёрлись в minimum. perKm/perMin/pickup НЕ откалиброваны — нужны заказы с километражом > 15км.

**Time-slot сёрдж (Cmf)**:
  - `sunday-morning`: n=18, mean=0.822, std=0.469

**Hidden Эконом-boost (overall)**: n=18, mean=×0.896

**Трафик**: ttMean=1.002, Пробок почти нет (ttMean ≈ 1.0). Корреляция surge↔traffic не значима. Нужны замеры в час пик.


## 2026-04-26 08:04 — обучение #2

**Dataset**: 19 заказов из 2 прогонов калибровки. С открытым ⚡N: 8.

**Тариф Cmf — изменения**:
  - minimum: 4 → **10**

**⚠ Предупреждения**:
  - Все имеющиеся заказы упёрлись в minimum. perKm/perMin/pickup НЕ откалиброваны — нужны заказы с километражом > 15км.

**Time-slot сёрдж (Cmf)**:
  - `sunday-morning`: n=18, sC mean=0.593, std=0.369 | yaOpen mean=0.962 (n=8)

**Hidden Эконом-boost (overall)**: n=18, mean=×0.896

**Трафик**: ttMean=1.002, Пробок почти нет (ttMean ≈ 1.0). Корреляция surge↔traffic не значима. Нужны замеры в час пик.


## 2026-04-26 08:06 — обучение #3

**Dataset**: 19 заказов из 2 прогонов калибровки. С открытым ⚡N: 8.

**Тариф Cmf — изменения**:
  - minimum: 4 → **10**

**⚠ Предупреждения**:
  - Все имеющиеся заказы упёрлись в minimum. perKm/perMin/pickup НЕ откалиброваны — нужны заказы с километражом > 15км.

**Time-slot сёрдж (Cmf)**:
  - `sunday-morning`: n=18, sC mean=0.593, std=0.369 | yaOpen mean=0.962 (n=8)

**Hidden Эконом-boost (overall)**: n=18, mean=×0.896

**Трафик**: ttMean=1.002, Пробок почти нет (ttMean ≈ 1.0). Корреляция surge↔traffic не значима. Нужны замеры в час пик.


## 2026-04-26 08:16 — обучение #4

**Dataset**: 22 заказов из 3 прогонов калибровки. С открытым ⚡N: 11.

**Тариф Cmf — изменения**:
  - minimum: 4 → **10**

**⚠ Предупреждения**:
  - Все имеющиеся заказы упёрлись в minimum. perKm/perMin/pickup НЕ откалиброваны — нужны заказы с километражом > 15км.

**Time-slot сёрдж (Cmf)**:
  - `sunday-morning`: n=18, sC mean=0.593, std=0.369 | yaOpen mean=0.962 (n=8)
  - `sunday-midday`: n=3, sC mean=0.5, std=0.088 | yaOpen mean=1.567 (n=3)

**Hidden Эконом-boost (overall)**: n=21, mean=×0.891

**Трафик**: ttMean=1.001, Пробок почти нет (ttMean ≈ 1.0). Корреляция surge↔traffic не значима. Нужны замеры в час пик.


## 2026-04-26 08:31 — обучение #5

**Dataset**: 27 заказов из 4 прогонов калибровки. С открытым ⚡N: 16.

**Тариф Cmf — изменения**:
  - minimum: 4 → **10**

**⚠ Предупреждения**:
  - Все имеющиеся заказы упёрлись в minimum. perKm/perMin/pickup НЕ откалиброваны — нужны заказы с километражом > 15км.

**Time-slot сёрдж (Cmf)**:
  - `sunday-morning`: n=18, sC mean=0.593, std=0.369 | yaOpen mean=0.962 (n=8)
  - `sunday-midday`: n=8, sC mean=0.731, std=0.375 | yaOpen mean=3.462 (n=8)

**Hidden Эконом-boost (overall)**: n=26, mean=×0.887

**Трафик**: ttMean=1.001, Пробок почти нет (ttMean ≈ 1.0). Корреляция surge↔traffic не значима. Нужны замеры в час пик.


## 2026-04-26 08:41 — обучение #6

**Dataset**: 27 заказов из 4 прогонов калибровки. С открытым ⚡N: 16.

**Тариф Cmf — изменения**:
  (без изменений — недостаточно данных)

**⚠ Предупреждения**:
  - Все имеющиеся заказы упёрлись в minimum. perKm/perMin/pickup НЕ откалиброваны — нужны заказы с километражом > 15км.

**Time-slot сёрдж (Cmf)**:
  - `sunday-morning`: n=18, sC mean=0.593, std=0.369 | yaOpen mean=0.962 (n=8)
  - `sunday-midday`: n=8, sC mean=0.731, std=0.375 | yaOpen mean=3.462 (n=8)

**Hidden Эконом-boost (overall)**: n=26, mean=×0.887

**Трафик**: ttMean=1.001, Пробок почти нет (ttMean ≈ 1.0). Корреляция surge↔traffic не значима. Нужны замеры в час пик.


## 2026-04-26 08:47 — обучение #7

**Dataset**: 27 заказов из 4 прогонов калибровки. С открытым ⚡N: 16.

**L1 SANITY (v3)**: ✅ v3 подтверждена: |perKm|=0.0038 < 0.05, |perMin|=0.0123 < 0.05. Baza Yandex плоская.
  - регрессия: pickup=9.632, perKm=-0.0038, perMin=0.0123 (MAE=0.124)


**L1 SURGE MODEL (v3)** ⚡N(km, min, slot):
  - `sunday-morning`: n=8, mean=0.962, std=0.498 | ⚡N ≈ 0.60 + 0.321·km + -0.154·min (MAE=0.264)
  - `sunday-midday`: n=8, mean=3.462, std=2.006 | ⚡N ≈ 0.84 + 0.073·km + 0.049·min (MAE=1.103)

**Time-slot сёрдж (Cmf, sC и yaOpen)**:
  - `sunday-morning`: n=18, sC mean=0.593, std=0.369 | yaOpen mean=0.962 (n=8)
  - `sunday-midday`: n=8, sC mean=0.731, std=0.375 | yaOpen mean=3.462 (n=8)

**Hidden Эконом-boost (overall)**: n=26, mean=×0.887

**Трафик**: ttMean=1.001, Пробок почти нет (ttMean ≈ 1.0). Корреляция surge↔traffic не значима. Нужны замеры в час пик.


## 2026-04-26 08:59 — обучение #8

**Dataset**: 27 заказов из 4 прогонов калибровки. С открытым ⚡N: 16.

**L1 SANITY (v3)**: ✅ v3 подтверждена: |perKm|=0.0038 < 0.05, |perMin|=0.0123 < 0.05. Baza Yandex плоская.
  - регрессия: pickup=9.632, perKm=-0.0038, perMin=0.0123 (MAE=0.124)


**L1 SURGE MODEL (v3)** ⚡N(km, min, slot):
  - `sunday-morning`: n=8, mean=0.962, std=0.498 | ⚡N ≈ 0.60 + 0.321·km + -0.154·min (MAE=0.264)
  - `sunday-midday`: n=8, mean=3.462, std=2.006 | ⚡N ≈ 0.84 + 0.073·km + 0.049·min (MAE=1.103)

**Time-slot сёрдж (Cmf, sC и yaOpen)**:
  - `sunday-morning`: n=18, sC mean=0.593, std=0.369 | yaOpen mean=0.962 (n=8)
  - `sunday-midday`: n=8, sC mean=0.731, std=0.375 | yaOpen mean=3.462 (n=8)

**Hidden Эконом-boost (overall)**: n=26, mean=×0.887

**Трафик**: ttMean=1.001, Пробок почти нет (ttMean ≈ 1.0). Корреляция surge↔traffic не значима. Нужны замеры в час пик.


## 2026-04-26 09:20 — обучение #9

**Dataset**: 36 заказов из 5 прогонов калибровки. С открытым ⚡N: 16.

**L1 SANITY (v3)**: ✅ v3 подтверждена: |perKm|=0.0038 < 0.05, |perMin|=0.0123 < 0.05. Baza Yandex плоская.
  - регрессия: pickup=9.632, perKm=-0.0038, perMin=0.0123 (MAE=0.124)


**L1 SURGE MODEL (v3)** ⚡N(km, min, slot):
  - `sunday-morning`: n=8, mean=0.962, std=0.498 | ⚡N ≈ 0.60 + 0.321·km + -0.154·min (MAE=0.264)
  - `sunday-midday`: n=8, mean=3.462, std=2.006 | ⚡N ≈ 0.84 + 0.073·km + 0.049·min (MAE=1.103)

**Time-slot сёрдж (Cmf, sC и yaOpen)**:
  - `sunday-morning`: n=18, sC mean=0.593, std=0.369 | yaOpen mean=0.962 (n=8)
  - `sunday-midday`: n=17, sC mean=1.315, std=0.791 | yaOpen mean=3.462 (n=8)

**Hidden Эконом-boost (overall)**: n=35, mean=×0.913

**Трафик**: ttMean=1.002, Пробок почти нет (ttMean ≈ 1.0). Корреляция surge↔traffic не значима. Нужны замеры в час пик.


## 2026-04-26 10:38 — обучение #10

**Dataset**: 52 заказов из 6 прогонов калибровки. С открытым ⚡N: 16.

**L1 SANITY (v3)**: ✅ v3 подтверждена: |perKm|=0.0038 < 0.05, |perMin|=0.0123 < 0.05. Baza Yandex плоская.
  - регрессия: pickup=9.632, perKm=-0.0038, perMin=0.0123 (MAE=0.124)


**L1 SURGE MODEL (v3)** ⚡N(km, min, slot):
  - `sunday-morning`: n=8, mean=0.962, std=0.498 | ⚡N ≈ 0.60 + 0.321·km + -0.154·min (MAE=0.264)
  - `sunday-midday`: n=8, mean=3.462, std=2.006 | ⚡N ≈ 0.84 + 0.073·km + 0.049·min (MAE=1.103)

**Time-slot сёрдж (Cmf, sC и yaOpen)**:
  - `sunday-morning`: n=18, sC mean=0.593, std=0.369 | yaOpen mean=0.962 (n=8)
  - `sunday-midday`: n=33, sC mean=1.969, std=1.626 | yaOpen mean=3.462 (n=8)

**Hidden Эконом-boost (overall)**: n=51, mean=×0.924

**Трафик**: ttMean=1.017, Пробок почти нет (ttMean ≈ 1.0). Корреляция surge↔traffic не значима. Нужны замеры в час пик.


## 2026-04-26 10:58 — обучение #11

**Dataset**: 64 заказов из 7 прогонов калибровки. С открытым ⚡N: 16.

**L1 SANITY (v3)**: ✅ v3 подтверждена: |perKm|=0.0038 < 0.05, |perMin|=0.0123 < 0.05. Baza Yandex плоская.
  - регрессия: pickup=9.632, perKm=-0.0038, perMin=0.0123 (MAE=0.124)


**L1 SURGE MODEL (v3)** ⚡N(km, min, slot):
  - `sunday-morning`: n=8, mean=0.962, std=0.498 | ⚡N ≈ 0.60 + 0.321·km + -0.154·min (MAE=0.264)
  - `sunday-midday`: n=8, mean=3.462, std=2.006 | ⚡N ≈ 0.84 + 0.073·km + 0.049·min (MAE=1.103)

**Time-slot сёрдж (Cmf, sC и yaOpen)**:
  - `sunday-morning`: n=18, sC mean=0.593, std=0.369 | yaOpen mean=0.962 (n=8)
  - `sunday-midday`: n=45, sC mean=1.936, std=1.419 | yaOpen mean=3.462 (n=8)

**Hidden Эконом-boost (overall)**: n=63, mean=×0.930

**Трафик**: ttMean=1.019, Пробок почти нет (ttMean ≈ 1.0). Корреляция surge↔traffic не значима. Нужны замеры в час пик.


## 2026-04-26 12:09 — обучение #12

**Dataset**: 66 заказов из 8 прогонов калибровки. С открытым ⚡N: 16.

**L1 SANITY (v3)**: ✅ v3 подтверждена: |perKm|=0.0038 < 0.05, |perMin|=0.0123 < 0.05. Baza Yandex плоская.
  - регрессия: pickup=9.632, perKm=-0.0038, perMin=0.0123 (MAE=0.124)


**L1 SURGE MODEL (v3)** ⚡N(km, min, slot):
  - `sunday-morning`: n=8, mean=0.962, std=0.498 | ⚡N ≈ 0.60 + 0.321·km + -0.154·min (MAE=0.264)
  - `sunday-midday`: n=8, mean=3.462, std=2.006 | ⚡N ≈ 0.84 + 0.073·km + 0.049·min (MAE=1.103)

**Time-slot сёрдж (Cmf, sC и yaOpen)**:
  - `sunday-morning`: n=18, sC mean=0.593, std=0.369 | yaOpen mean=0.962 (n=8)
  - `sunday-midday`: n=47, sC mean=1.963, std=1.443 | yaOpen mean=3.462 (n=8)

**Hidden Эконом-boost (overall)**: n=65, mean=×0.929

**Трафик**: ttMean=1.018, Пробок почти нет (ttMean ≈ 1.0). Корреляция surge↔traffic не значима. Нужны замеры в час пик.


## 2026-04-26 12:50 — обучение #13

**Dataset**: 78 заказов из 9 прогонов калибровки. С открытым ⚡N: 28.

**L1 SANITY (v3)**: ✅ v3 подтверждена: |perKm|=0.0123 < 0.05, |perMin|=0.0049 < 0.05. Baza Yandex плоская.
  - регрессия: pickup=9.683, perKm=0.0123, perMin=-0.0049 (MAE=0.138)


**L1 SURGE MODEL (v3)** ⚡N(km, min, slot):
  - `sunday-morning`: n=8, mean=0.962, std=0.498 | ⚡N ≈ 0.60 + 0.321·km + -0.154·min (MAE=0.264)
  - `sunday-midday`: n=8, mean=3.462, std=2.006 | ⚡N ≈ 0.84 + 0.073·km + 0.049·min (MAE=1.103)
  - `sunday-evening`: n=12, mean=1.992, std=0.63 | ⚡N ≈ 1.55 + 0.119·km + -0.065·min (MAE=0.282)

**Time-slot сёрдж (Cmf, sC и yaOpen)**:
  - `sunday-morning`: n=18, sC mean=0.593, std=0.369 | yaOpen mean=0.962 (n=8)
  - `sunday-midday`: n=47, sC mean=1.963, std=1.443 | yaOpen mean=3.462 (n=8)
  - `sunday-evening`: n=12, sC mean=1.937, std=0.635 | yaOpen mean=1.992 (n=12)

**Hidden Эконом-boost (overall)**: n=77, mean=×0.934

**Трафик**: ttMean=1.02, Пробок почти нет (ttMean ≈ 1.0). Корреляция surge↔traffic не значима. Нужны замеры в час пик.


## 2026-04-26 12:55 — обучение #14

**Dataset**: 78 заказов из 9 прогонов калибровки. С открытым ⚡N: 28.

**L1 SANITY (v3)**: ✅ v3 подтверждена: |perKm|=0.0123 < 0.05, |perMin|=0.0049 < 0.05. Baza Yandex плоская.
  - регрессия: pickup=9.683, perKm=0.0123, perMin=-0.0049 (MAE=0.138)


**L1 SURGE MODEL (v3)** ⚡N(km, min, slot):
  - `sunday-morning`: n=8, mean=0.962, std=0.498 | ⚡N ≈ 0.60 + 0.321·km + -0.154·min (MAE=0.264)
  - `sunday-midday`: n=8, mean=3.462, std=2.006 | ⚡N ≈ 0.84 + 0.073·km + 0.049·min (MAE=1.103)
  - `sunday-evening`: n=12, mean=1.992, std=0.63 | ⚡N ≈ 1.55 + 0.119·km + -0.065·min (MAE=0.282)

**Time-slot сёрдж (Cmf, sC и yaOpen)**:
  - `sunday-morning`: n=18, sC mean=0.593, std=0.369 | yaOpen mean=0.962 (n=8)
  - `sunday-midday`: n=47, sC mean=1.963, std=1.443 | yaOpen mean=3.462 (n=8)
  - `sunday-evening`: n=12, sC mean=1.937, std=0.635 | yaOpen mean=1.992 (n=12)

**Hidden Эконом-boost (overall)**: n=77, mean=×0.934

**Трафик**: ttMean=1.02, Пробок почти нет (ttMean ≈ 1.0). Корреляция surge↔traffic не значима. Нужны замеры в час пик.


## 2026-04-26 13:18 — обучение #15

**Dataset**: 110 заказов из 10 прогонов калибровки. С открытым ⚡N: 60.

**L1 SANITY (v3)**: ✅ v3 подтверждена: |perKm|=0.0062 < 0.05, |perMin|=0.0103 < 0.05. Baza Yandex плоская.
  - регрессия: pickup=9.743, perKm=-0.0062, perMin=0.0103 (MAE=0.189)


**L1 SURGE MODEL (v3)** ⚡N(km, min, slot):
  - `sunday-morning`: n=8, mean=0.962, std=0.498 | ⚡N ≈ 0.60 + 0.321·km + -0.154·min (MAE=0.264)
  - `sunday-midday`: n=8, mean=3.462, std=2.006 | ⚡N ≈ 0.84 + 0.073·km + 0.049·min (MAE=1.103)
  - `sunday-evening`: n=44, mean=3.032, std=5.34 | ⚡N ≈ 1.40 + 0.515·km + -0.342·min (MAE=0.819)

**Time-slot сёрдж (Cmf, sC и yaOpen)**:
  - `sunday-morning`: n=18, sC mean=0.593, std=0.369 | yaOpen mean=0.962 (n=8)
  - `sunday-midday`: n=47, sC mean=1.963, std=1.443 | yaOpen mean=3.462 (n=8)
  - `sunday-evening`: n=44, sC mean=3.009, std=5.343 | yaOpen mean=3.032 (n=44)

**Hidden Эконом-boost (overall)**: n=109, mean=×0.948

**Трафик**: ttMean=1.022, Пробок почти нет (ttMean ≈ 1.0). Корреляция surge↔traffic не значима. Нужны замеры в час пик.


## 2026-04-26 13:33 — обучение #16

**Dataset**: 110 заказов из 10 прогонов калибровки. С открытым ⚡N: 60.

**L1 SANITY (v3)**: ✅ v3 подтверждена: |perKm|=0.0062 < 0.05, |perMin|=0.0103 < 0.05. Baza Yandex плоская.
  - регрессия: pickup=9.743, perKm=-0.0062, perMin=0.0103 (MAE=0.189)


**L1 SURGE MODEL (v3)** ⚡N(km, min, slot):
  - `sunday-morning`: n=8, mean=0.962, std=0.498 | ⚡N ≈ 0.60 + 0.321·km + -0.154·min (MAE=0.264)
  - `sunday-midday`: n=8, mean=3.462, std=2.006 | ⚡N ≈ 0.84 + 0.073·km + 0.049·min (MAE=1.103)
  - `sunday-evening`: n=44, mean=3.032, std=5.34 | ⚡N ≈ 1.40 + 0.515·km + -0.342·min (MAE=0.819)

**Time-slot сёрдж (Cmf, sC и yaOpen)**:
  - `sunday-morning`: n=18, sC mean=0.593, std=0.369 | yaOpen mean=0.962 (n=8)
  - `sunday-midday`: n=47, sC mean=1.963, std=1.443 | yaOpen mean=3.462 (n=8)
  - `sunday-evening`: n=44, sC mean=3.009, std=5.343 | yaOpen mean=3.032 (n=44)

**Hidden Эконом-boost (overall)**: n=109, mean=×0.948

**Трафик**: ttMean=1.022, Пробок почти нет (ttMean ≈ 1.0). Корреляция surge↔traffic не значима. Нужны замеры в час пик.


## 2026-04-26 13:42 — обучение #17

**Dataset**: 110 заказов из 10 прогонов калибровки. С открытым ⚡N: 60.

**L1 SANITY (v3)**: ✅ v3 подтверждена: |perKm|=0.0062 < 0.05, |perMin|=0.0103 < 0.05. Baza Yandex плоская.
  - регрессия: pickup=9.743, perKm=-0.0062, perMin=0.0103 (MAE=0.189)


**L1 SURGE MODEL (v3)** ⚡N(km, min, slot):
  - `sunday-morning`: n=8, mean=0.962, std=0.498 | ⚡N ≈ 0.60 + 0.321·km + -0.154·min (MAE=0.264)
  - `sunday-midday`: n=8, mean=3.462, std=2.006 | ⚡N ≈ 0.84 + 0.073·km + 0.049·min (MAE=1.103)
  - `sunday-evening`: n=44, mean=3.032, std=5.34 | ⚡N ≈ 1.40 + 0.515·km + -0.342·min (MAE=0.819)

**Time-slot сёрдж (Cmf, sC и yaOpen)**:
  - `sunday-morning`: n=18, sC mean=0.593, std=0.369 | yaOpen mean=0.962 (n=8)
  - `sunday-midday`: n=47, sC mean=1.963, std=1.443 | yaOpen mean=3.462 (n=8)
  - `sunday-evening`: n=44, sC mean=3.009, std=5.343 | yaOpen mean=3.032 (n=44)

**Hidden Эконом-boost (overall)**: n=109, mean=×0.948

**Трафик**: ttMean=1.022, Пробок почти нет (ttMean ≈ 1.0). Корреляция surge↔traffic не значима. Нужны замеры в час пик.


## 2026-04-26 14:00 — обучение #18

**Dataset**: 110 заказов из 10 прогонов калибровки. С открытым ⚡N: 60.

**L1 SANITY (v3)**: ✅ v3 подтверждена: |perKm|=0.0062 < 0.05, |perMin|=0.0103 < 0.05. Baza Yandex плоская.
  - регрессия: pickup=9.743, perKm=-0.0062, perMin=0.0103 (MAE=0.189)


**L1 SURGE MODEL (v3)** ⚡N(km, min, slot):
  - `sunday-morning`: n=8, mean=0.962, std=0.498 | ⚡N ≈ 0.60 + 0.321·km + -0.154·min (MAE=0.264)
  - `sunday-midday`: n=8, mean=3.462, std=2.006 | ⚡N ≈ 0.84 + 0.073·km + 0.049·min (MAE=1.103)
  - `sunday-evening`: n=44, mean=3.032, std=5.34 | ⚡N ≈ 1.40 + 0.515·km + -0.342·min (MAE=0.819)

**Time-slot сёрдж (Cmf, sC и yaOpen)**:
  - `sunday-morning`: n=18, sC mean=0.593, std=0.369 | yaOpen mean=0.962 (n=8)
  - `sunday-midday`: n=47, sC mean=1.963, std=1.443 | yaOpen mean=3.462 (n=8)
  - `sunday-evening`: n=44, sC mean=3.009, std=5.343 | yaOpen mean=3.032 (n=44)

**Hidden Эконом-boost (overall)**: n=109, mean=×0.948

**Трафик**: ttMean=1.022, Пробок почти нет (ttMean ≈ 1.0). Корреляция surge↔traffic не значима. Нужны замеры в час пик.


## 2026-04-26 14:02 — обучение #19

**Dataset**: 110 заказов из 10 прогонов калибровки. С открытым ⚡N: 60.

**L1 SANITY (v3)**: ✅ v3 подтверждена: |perKm|=0.0062 < 0.05, |perMin|=0.0103 < 0.05. Baza Yandex плоская.
  - регрессия: pickup=9.743, perKm=-0.0062, perMin=0.0103 (MAE=0.189)


**L1 SURGE MODEL (v3)** ⚡N(km, min, slot):
  - `sunday-morning`: n=8, mean=0.962, std=0.498 | ⚡N ≈ 0.60 + 0.321·km + -0.154·min (MAE=0.264)
  - `sunday-midday`: n=8, mean=3.462, std=2.006 | ⚡N ≈ 0.84 + 0.073·km + 0.049·min (MAE=1.103)
  - `sunday-evening`: n=44, mean=3.032, std=5.34 | ⚡N ≈ 1.40 + 0.515·km + -0.342·min (MAE=0.819)

**Time-slot сёрдж (Cmf, sC и yaOpen)**:
  - `sunday-morning`: n=18, sC mean=0.593, std=0.369 | yaOpen mean=0.962 (n=8)
  - `sunday-midday`: n=47, sC mean=1.963, std=1.443 | yaOpen mean=3.462 (n=8)
  - `sunday-evening`: n=44, sC mean=3.009, std=5.343 | yaOpen mean=3.032 (n=44)

**Hidden Эконом-boost (overall)**: n=109, mean=×0.948

**Трафик**: ttMean=1.022, Пробок почти нет (ttMean ≈ 1.0). Корреляция surge↔traffic не значима. Нужны замеры в час пик.


## 2026-04-26 14:04 — обучение #20

**Dataset**: 110 заказов из 10 прогонов калибровки. С открытым ⚡N: 60.

**L1 SANITY (v3)**: ✅ v3 подтверждена: |perKm|=0.0062 < 0.05, |perMin|=0.0103 < 0.05. Baza Yandex плоская.
  - регрессия: pickup=9.743, perKm=-0.0062, perMin=0.0103 (MAE=0.189)


**L1 SURGE MODEL (v3)** ⚡N(km, min, slot):
  - `sunday-morning`: n=8, mean=0.962, std=0.498 | ⚡N ≈ 0.60 + 0.321·km + -0.154·min (MAE=0.264)
  - `sunday-midday`: n=8, mean=3.462, std=2.006 | ⚡N ≈ 0.84 + 0.073·km + 0.049·min (MAE=1.103)
  - `sunday-evening`: n=44, mean=3.032, std=5.34 | ⚡N ≈ 1.40 + 0.515·km + -0.342·min (MAE=0.819)

**Time-slot сёрдж (Cmf, sC и yaOpen)**:
  - `sunday-morning`: n=18, sC mean=0.593, std=0.369 | yaOpen mean=0.962 (n=8)
  - `sunday-midday`: n=47, sC mean=1.963, std=1.443 | yaOpen mean=3.462 (n=8)
  - `sunday-evening`: n=44, sC mean=3.009, std=5.343 | yaOpen mean=3.032 (n=44)

**Hidden Эконом-boost (overall)**: n=109, mean=×0.948

**Трафик**: ttMean=1.022, Пробок почти нет (ttMean ≈ 1.0). Корреляция surge↔traffic не значима. Нужны замеры в час пик.


## 2026-04-26 14:05 — обучение #21

**Dataset**: 110 заказов из 10 прогонов калибровки. С открытым ⚡N: 60.

**L1 SANITY (v3)**: ✅ v3 подтверждена: |perKm|=0.0062 < 0.05, |perMin|=0.0103 < 0.05. Baza Yandex плоская.
  - регрессия: pickup=9.743, perKm=-0.0062, perMin=0.0103 (MAE=0.189)


**L1 SURGE MODEL (v3)** ⚡N(km, min, slot):
  - `sunday-morning`: n=8, mean=0.962, std=0.498 | ⚡N ≈ 0.60 + 0.321·km + -0.154·min (MAE=0.264)
  - `sunday-midday`: n=8, mean=3.462, std=2.006 | ⚡N ≈ 0.84 + 0.073·km + 0.049·min (MAE=1.103)
  - `sunday-evening`: n=44, mean=3.032, std=5.34 | ⚡N ≈ 1.40 + 0.515·km + -0.342·min (MAE=0.819)

**Time-slot сёрдж (Cmf, sC и yaOpen)**:
  - `sunday-morning`: n=18, sC mean=0.593, std=0.369 | yaOpen mean=0.962 (n=8)
  - `sunday-midday`: n=47, sC mean=1.963, std=1.443 | yaOpen mean=3.462 (n=8)
  - `sunday-evening`: n=44, sC mean=3.009, std=5.343 | yaOpen mean=3.032 (n=44)

**Hidden Эконом-boost (overall)**: n=109, mean=×0.948

**Трафик**: ttMean=1.022, Пробок почти нет (ttMean ≈ 1.0). Корреляция surge↔traffic не значима. Нужны замеры в час пик.


## 2026-04-26 14:07 — обучение #22

**Dataset**: 110 заказов из 10 прогонов калибровки. С открытым ⚡N: 60.

**L1 SANITY (v3)**: ✅ v3 подтверждена: |perKm|=0.0062 < 0.05, |perMin|=0.0103 < 0.05. Baza Yandex плоская.
  - регрессия: pickup=9.743, perKm=-0.0062, perMin=0.0103 (MAE=0.189)


**L1 SURGE MODEL (v3)** ⚡N(km, min, slot):
  - `sunday-morning`: n=8, mean=0.962, std=0.498 | ⚡N ≈ 0.60 + 0.321·km + -0.154·min (MAE=0.264)
  - `sunday-midday`: n=8, mean=3.462, std=2.006 | ⚡N ≈ 0.84 + 0.073·km + 0.049·min (MAE=1.103)
  - `sunday-evening`: n=44, mean=3.032, std=5.34 | ⚡N ≈ 1.40 + 0.515·km + -0.342·min (MAE=0.819)

**Time-slot сёрдж (Cmf, sC и yaOpen)**:
  - `sunday-morning`: n=18, sC mean=0.593, std=0.369 | yaOpen mean=0.962 (n=8)
  - `sunday-midday`: n=47, sC mean=1.963, std=1.443 | yaOpen mean=3.462 (n=8)
  - `sunday-evening`: n=44, sC mean=3.009, std=5.343 | yaOpen mean=3.032 (n=44)

**Hidden Эконом-boost (overall)**: n=109, mean=×0.948

**Трафик**: ttMean=1.022, Пробок почти нет (ttMean ≈ 1.0). Корреляция surge↔traffic не значима. Нужны замеры в час пик.


## 2026-04-26 14:09 — обучение #23

**Dataset**: 110 заказов из 10 прогонов калибровки. С открытым ⚡N: 60.

**L1 SANITY (v3)**: ✅ v3 подтверждена: |perKm|=0.0062 < 0.05, |perMin|=0.0103 < 0.05. Baza Yandex плоская.
  - регрессия: pickup=9.743, perKm=-0.0062, perMin=0.0103 (MAE=0.189)


**L1 SURGE MODEL (v3)** ⚡N(km, min, slot):
  - `sunday-morning`: n=8, mean=0.962, std=0.498 | ⚡N ≈ 0.60 + 0.321·km + -0.154·min (MAE=0.264)
  - `sunday-midday`: n=8, mean=3.462, std=2.006 | ⚡N ≈ 0.84 + 0.073·km + 0.049·min (MAE=1.103)
  - `sunday-evening`: n=44, mean=3.032, std=5.34 | ⚡N ≈ 1.40 + 0.515·km + -0.342·min (MAE=0.819)

**Time-slot сёрдж (Cmf, sC и yaOpen)**:
  - `sunday-morning`: n=18, sC mean=0.593, std=0.369 | yaOpen mean=0.962 (n=8)
  - `sunday-midday`: n=47, sC mean=1.963, std=1.443 | yaOpen mean=3.462 (n=8)
  - `sunday-evening`: n=44, sC mean=3.009, std=5.343 | yaOpen mean=3.032 (n=44)

**Hidden Эконом-boost (overall)**: n=109, mean=×0.948

**Трафик**: ttMean=1.022, Пробок почти нет (ttMean ≈ 1.0). Корреляция surge↔traffic не значима. Нужны замеры в час пик.


## 2026-04-26 14:12 — обучение #24

**Dataset**: 110 заказов из 10 прогонов калибровки. С открытым ⚡N: 60.

**L1 SANITY (v3)**: ✅ v3 подтверждена: |perKm|=0.0062 < 0.05, |perMin|=0.0103 < 0.05. Baza Yandex плоская.
  - регрессия: pickup=9.743, perKm=-0.0062, perMin=0.0103 (MAE=0.189)


**L1 SURGE MODEL (v3)** ⚡N(km, min, slot):
  - `sunday-morning`: n=8, mean=0.962, std=0.498 | ⚡N ≈ 0.60 + 0.321·km + -0.154·min (MAE=0.264)
  - `sunday-midday`: n=8, mean=3.462, std=2.006 | ⚡N ≈ 0.84 + 0.073·km + 0.049·min (MAE=1.103)
  - `sunday-evening`: n=44, mean=3.032, std=5.34 | ⚡N ≈ 1.40 + 0.515·km + -0.342·min (MAE=0.819)

**Time-slot сёрдж (Cmf, sC и yaOpen)**:
  - `sunday-morning`: n=18, sC mean=0.593, std=0.369 | yaOpen mean=0.962 (n=8)
  - `sunday-midday`: n=47, sC mean=1.963, std=1.443 | yaOpen mean=3.462 (n=8)
  - `sunday-evening`: n=44, sC mean=3.009, std=5.343 | yaOpen mean=3.032 (n=44)

**Hidden Эконом-boost (overall)**: n=109, mean=×0.948

**Трафик**: ttMean=1.022, Пробок почти нет (ttMean ≈ 1.0). Корреляция surge↔traffic не значима. Нужны замеры в час пик.


## 2026-04-26 14:29 — обучение #25

**Dataset**: 110 заказов из 10 прогонов калибровки. С открытым ⚡N: 60.

**L1 SANITY (v3)**: ✅ v3 подтверждена: |perKm|=0.0062 < 0.05, |perMin|=0.0103 < 0.05. Baza Yandex плоская.
  - регрессия: pickup=9.743, perKm=-0.0062, perMin=0.0103 (MAE=0.189)


**L1 SURGE MODEL (v3)** ⚡N(km, min, slot):
  - `sunday-morning`: n=8, mean=0.962, std=0.498 | ⚡N ≈ 0.60 + 0.321·km + -0.154·min (MAE=0.264)
  - `sunday-midday`: n=8, mean=3.462, std=2.006 | ⚡N ≈ 0.84 + 0.073·km + 0.049·min (MAE=1.103)
  - `sunday-evening`: n=44, mean=3.032, std=5.34 | ⚡N ≈ 1.40 + 0.515·km + -0.342·min (MAE=0.819)

**Time-slot сёрдж (Cmf, sC и yaOpen)**:
  - `sunday-morning`: n=18, sC mean=0.593, std=0.369 | yaOpen mean=0.962 (n=8)
  - `sunday-midday`: n=47, sC mean=1.963, std=1.443 | yaOpen mean=3.462 (n=8)
  - `sunday-evening`: n=44, sC mean=3.009, std=5.343 | yaOpen mean=3.032 (n=44)

**Hidden Эконом-boost (overall)**: n=109, mean=×0.948

**Трафик**: ttMean=1.022, Пробок почти нет (ttMean ≈ 1.0). Корреляция surge↔traffic не значима. Нужны замеры в час пик.


## 2026-04-26 14:29 — обучение #26

**Dataset**: 110 заказов из 10 прогонов калибровки. С открытым ⚡N: 60.

**L1 SANITY (v3)**: ✅ v3 подтверждена: |perKm|=0.0062 < 0.05, |perMin|=0.0103 < 0.05. Baza Yandex плоская.
  - регрессия: pickup=9.743, perKm=-0.0062, perMin=0.0103 (MAE=0.189)


**L1 SURGE MODEL (v3)** ⚡N(km, min, slot):
  - `sunday-morning`: n=8, mean=0.962, std=0.498 | ⚡N ≈ 0.60 + 0.321·km + -0.154·min (MAE=0.264)
  - `sunday-midday`: n=8, mean=3.462, std=2.006 | ⚡N ≈ 0.84 + 0.073·km + 0.049·min (MAE=1.103)
  - `sunday-evening`: n=44, mean=3.032, std=5.34 | ⚡N ≈ 1.40 + 0.515·km + -0.342·min (MAE=0.819)

**Time-slot сёрдж (Cmf, sC и yaOpen)**:
  - `sunday-morning`: n=18, sC mean=0.593, std=0.369 | yaOpen mean=0.962 (n=8)
  - `sunday-midday`: n=47, sC mean=1.963, std=1.443 | yaOpen mean=3.462 (n=8)
  - `sunday-evening`: n=44, sC mean=3.009, std=5.343 | yaOpen mean=3.032 (n=44)

**Hidden Эконом-boost (overall)**: n=109, mean=×0.948

**Трафик**: ttMean=1.022, Пробок почти нет (ttMean ≈ 1.0). Корреляция surge↔traffic не значима. Нужны замеры в час пик.


## 2026-04-26 14:32 — обучение #27

**Dataset**: 121 заказов из 11 прогонов калибровки. С открытым ⚡N: 67.

**L1 SANITY (v3)**: ✅ v3 подтверждена: |perKm|=0.0068 < 0.05, |perMin|=0.0113 < 0.05. Baza Yandex плоская.
  - регрессия: pickup=9.714, perKm=-0.0068, perMin=0.0113 (MAE=0.195)


**L1 SURGE MODEL (v3)** ⚡N(km, min, slot):
  - `sunday-morning`: n=8, mean=0.962, std=0.498 | ⚡N ≈ 0.60 + 0.321·km + -0.154·min (MAE=0.264)
  - `sunday-midday`: n=8, mean=3.462, std=2.006 | ⚡N ≈ 0.84 + 0.073·km + 0.049·min (MAE=1.103)
  - `sunday-evening`: n=51, mean=2.924, std=4.961 | ⚡N ≈ 1.25 + 0.471·km + -0.291·min (MAE=0.747)

**Time-slot сёрдж (Cmf, sC и yaOpen)**:
  - `sunday-morning`: n=18, sC mean=0.593, std=0.369 | yaOpen mean=0.962 (n=8)
  - `sunday-midday`: n=47, sC mean=1.963, std=1.443 | yaOpen mean=3.462 (n=8)
  - `sunday-evening`: n=55, sC mean=2.867, std=4.781 | yaOpen mean=2.924 (n=51)

**Hidden Эконом-boost (overall)**: n=120, mean=×0.954

**Трафик**: ttMean=1.022, Пробок почти нет (ttMean ≈ 1.0). Корреляция surge↔traffic не значима. Нужны замеры в час пик.


## 2026-04-26 14:35 — обучение #28

**Dataset**: 121 заказов из 11 прогонов калибровки. С открытым ⚡N: 67.

**L1 SANITY (v3)**: ✅ v3 подтверждена: |perKm|=0.0068 < 0.05, |perMin|=0.0113 < 0.05. Baza Yandex плоская.
  - регрессия: pickup=9.714, perKm=-0.0068, perMin=0.0113 (MAE=0.195)


**L1 SURGE MODEL (v3)** ⚡N(km, min, slot):
  - `sunday-morning`: n=8, mean=0.962, std=0.498 | ⚡N ≈ 0.60 + 0.321·km + -0.154·min (MAE=0.264)
  - `sunday-midday`: n=8, mean=3.462, std=2.006 | ⚡N ≈ 0.84 + 0.073·km + 0.049·min (MAE=1.103)
  - `sunday-evening`: n=51, mean=2.924, std=4.961 | ⚡N ≈ 1.25 + 0.471·km + -0.291·min (MAE=0.747)

**Time-slot сёрдж (Cmf, sC и yaOpen)**:
  - `sunday-morning`: n=18, sC mean=0.593, std=0.369 | yaOpen mean=0.962 (n=8)
  - `sunday-midday`: n=47, sC mean=1.963, std=1.443 | yaOpen mean=3.462 (n=8)
  - `sunday-evening`: n=55, sC mean=2.867, std=4.781 | yaOpen mean=2.924 (n=51)

**Hidden Эконом-boost (overall)**: n=120, mean=×0.954

**Трафик**: ttMean=1.022, Пробок почти нет (ttMean ≈ 1.0). Корреляция surge↔traffic не значима. Нужны замеры в час пик.


## 2026-04-26 14:40 — обучение #29

**Dataset**: 121 заказов из 11 прогонов калибровки. С открытым ⚡N: 67.

**L1 SANITY (v3)**: ✅ v3 подтверждена: |perKm|=0.0068 < 0.05, |perMin|=0.0113 < 0.05. Baza Yandex плоская.
  - регрессия: pickup=9.714, perKm=-0.0068, perMin=0.0113 (MAE=0.195)


**L1 SURGE MODEL (v3)** ⚡N(km, min, slot):
  - `sunday-morning`: n=8, mean=0.962, std=0.498 | ⚡N ≈ 0.60 + 0.321·km + -0.154·min (MAE=0.264)
  - `sunday-midday`: n=8, mean=3.462, std=2.006 | ⚡N ≈ 0.84 + 0.073·km + 0.049·min (MAE=1.103)
  - `sunday-evening`: n=51, mean=2.924, std=4.961 | ⚡N ≈ 1.25 + 0.471·km + -0.291·min (MAE=0.747)

**Time-slot сёрдж (Cmf, sC и yaOpen)**:
  - `sunday-morning`: n=18, sC mean=0.593, std=0.369 | yaOpen mean=0.962 (n=8)
  - `sunday-midday`: n=47, sC mean=1.963, std=1.443 | yaOpen mean=3.462 (n=8)
  - `sunday-evening`: n=55, sC mean=2.867, std=4.781 | yaOpen mean=2.924 (n=51)

**Hidden Эконом-boost (overall)**: n=120, mean=×0.954

**Трафик**: ttMean=1.022, Пробок почти нет (ttMean ≈ 1.0). Корреляция surge↔traffic не значима. Нужны замеры в час пик.


## 2026-04-26 14:41 — обучение #30

**Dataset**: 121 заказов из 11 прогонов калибровки. С открытым ⚡N: 67.

**L1 SANITY (v3)**: ✅ v3 подтверждена: |perKm|=0.0068 < 0.05, |perMin|=0.0113 < 0.05. Baza Yandex плоская.
  - регрессия: pickup=9.714, perKm=-0.0068, perMin=0.0113 (MAE=0.195)


**L1 SURGE MODEL (v3)** ⚡N(km, min, slot):
  - `sunday-morning`: n=8, mean=0.962, std=0.498 | ⚡N ≈ 0.60 + 0.321·km + -0.154·min (MAE=0.264)
  - `sunday-midday`: n=8, mean=3.462, std=2.006 | ⚡N ≈ 0.84 + 0.073·km + 0.049·min (MAE=1.103)
  - `sunday-evening`: n=51, mean=2.924, std=4.961 | ⚡N ≈ 1.25 + 0.471·km + -0.291·min (MAE=0.747)

**Time-slot сёрдж (Cmf, sC и yaOpen)**:
  - `sunday-morning`: n=18, sC mean=0.593, std=0.369 | yaOpen mean=0.962 (n=8)
  - `sunday-midday`: n=47, sC mean=1.963, std=1.443 | yaOpen mean=3.462 (n=8)
  - `sunday-evening`: n=55, sC mean=2.867, std=4.781 | yaOpen mean=2.924 (n=51)

**Hidden Эконом-boost (overall)**: n=120, mean=×0.954

**Трафик**: ttMean=1.022, Пробок почти нет (ttMean ≈ 1.0). Корреляция surge↔traffic не значима. Нужны замеры в час пик.


## 2026-04-26 14:58 — обучение #31

**Dataset**: 127 заказов из 12 прогонов калибровки. С открытым ⚡N: 73.

**L1 SANITY (v3)**: ✅ v3 подтверждена: |perKm|=0.0085 < 0.05, |perMin|=0.0135 < 0.05. Baza Yandex плоская.
  - регрессия: pickup=9.688, perKm=-0.0085, perMin=0.0135 (MAE=0.196)


**L1 SURGE MODEL (v3)** ⚡N(km, min, slot):
  - `sunday-morning`: n=8, mean=0.962, std=0.498 | ⚡N ≈ 0.60 + 0.321·km + -0.154·min (MAE=0.264)
  - `sunday-midday`: n=8, mean=3.462, std=2.006 | ⚡N ≈ 0.84 + 0.073·km + 0.049·min (MAE=1.103)
  - `sunday-evening`: n=57, mean=2.796, std=4.706 | ⚡N ≈ 1.19 + 0.462·km + -0.281·min (MAE=0.712)

**Time-slot сёрдж (Cmf, sC и yaOpen)**:
  - `sunday-morning`: n=18, sC mean=0.593, std=0.369 | yaOpen mean=0.962 (n=8)
  - `sunday-midday`: n=47, sC mean=1.963, std=1.443 | yaOpen mean=3.462 (n=8)
  - `sunday-evening`: n=61, sC mean=2.749, std=4.553 | yaOpen mean=2.796 (n=57)

**Hidden Эконом-boost (overall)**: n=126, mean=×0.952

**Трафик**: ttMean=1.022, Пробок почти нет (ttMean ≈ 1.0). Корреляция surge↔traffic не значима. Нужны замеры в час пик.


## 2026-04-26 15:49 — обучение #32

**Dataset**: 127 заказов из 12 прогонов калибровки. С открытым ⚡N: 73.

**L1 SANITY (v3)**: ✅ v3 подтверждена: |perKm|=0.0085 < 0.05, |perMin|=0.0135 < 0.05. Baza Yandex плоская.
  - регрессия: pickup=9.688, perKm=-0.0085, perMin=0.0135 (MAE=0.196)


**L1 SURGE MODEL (v3)** ⚡N(km, min, slot):
  - `sunday-morning`: n=8, mean=0.962, std=0.498 | ⚡N ≈ 0.60 + 0.321·km + -0.154·min (MAE=0.264)
  - `sunday-midday`: n=8, mean=3.462, std=2.006 | ⚡N ≈ 0.84 + 0.073·km + 0.049·min (MAE=1.103)
  - `sunday-evening`: n=57, mean=2.796, std=4.706 | ⚡N ≈ 1.19 + 0.462·km + -0.281·min (MAE=0.712)

**Time-slot сёрдж (Cmf, sC и yaOpen)**:
  - `sunday-morning`: n=18, sC mean=0.593, std=0.369 | yaOpen mean=0.962 (n=8)
  - `sunday-midday`: n=47, sC mean=1.963, std=1.443 | yaOpen mean=3.462 (n=8)
  - `sunday-evening`: n=61, sC mean=2.749, std=4.553 | yaOpen mean=2.796 (n=57)

**Hidden Эконом-boost (overall)**: n=126, mean=×0.952

**Трафик**: ttMean=1.022, Пробок почти нет (ttMean ≈ 1.0). Корреляция surge↔traffic не значима. Нужны замеры в час пик.


## 2026-04-26 16:03 — обучение #33

**Dataset**: 127 заказов из 12 прогонов калибровки. С открытым ⚡N: 73.

**L1 SANITY (v3)**: ✅ v3 подтверждена: |perKm|=0.0085 < 0.05, |perMin|=0.0135 < 0.05. Baza Yandex плоская.
  - регрессия: pickup=9.688, perKm=-0.0085, perMin=0.0135 (MAE=0.196)


**L1 SURGE MODEL (v3)** ⚡N(km, min, slot):
  - `sunday-morning`: n=8, mean=0.962, std=0.498 | ⚡N ≈ 0.60 + 0.321·km + -0.154·min (MAE=0.264)
  - `sunday-midday`: n=8, mean=3.462, std=2.006 | ⚡N ≈ 0.84 + 0.073·km + 0.049·min (MAE=1.103)
  - `sunday-evening`: n=57, mean=2.796, std=4.706 | ⚡N ≈ 1.19 + 0.462·km + -0.281·min (MAE=0.712)

**Time-slot сёрдж (Cmf, sC и yaOpen)**:
  - `sunday-morning`: n=18, sC mean=0.593, std=0.369 | yaOpen mean=0.962 (n=8)
  - `sunday-midday`: n=47, sC mean=1.963, std=1.443 | yaOpen mean=3.462 (n=8)
  - `sunday-evening`: n=61, sC mean=2.749, std=4.553 | yaOpen mean=2.796 (n=57)

**Hidden Эконом-boost (overall)**: n=126, mean=×0.952

**Трафик**: ttMean=1.022, Пробок почти нет (ttMean ≈ 1.0). Корреляция surge↔traffic не значима. Нужны замеры в час пик.


## 2026-04-26 16:11 — обучение #34

**Dataset**: 127 заказов из 12 прогонов калибровки. С открытым ⚡N: 73.

**L1 SANITY (v3)**: ✅ v3 подтверждена: |perKm|=0.0085 < 0.05, |perMin|=0.0135 < 0.05. Baza Yandex плоская.
  - регрессия: pickup=9.688, perKm=-0.0085, perMin=0.0135 (MAE=0.196)


**L1 SURGE MODEL (v3)** ⚡N(km, min, slot):
  - `sunday-morning`: n=8, mean=0.962, std=0.498 | ⚡N ≈ 0.60 + 0.321·km + -0.154·min (MAE=0.264)
  - `sunday-midday`: n=8, mean=3.462, std=2.006 | ⚡N ≈ 0.84 + 0.073·km + 0.049·min (MAE=1.103)
  - `sunday-evening`: n=57, mean=2.796, std=4.706 | ⚡N ≈ 1.19 + 0.462·km + -0.281·min (MAE=0.712)

**Time-slot сёрдж (Cmf, sC и yaOpen)**:
  - `sunday-morning`: n=18, sC mean=0.593, std=0.369 | yaOpen mean=0.962 (n=8)
  - `sunday-midday`: n=47, sC mean=1.963, std=1.443 | yaOpen mean=3.462 (n=8)
  - `sunday-evening`: n=61, sC mean=2.749, std=4.553 | yaOpen mean=2.796 (n=57)

**Hidden Эконом-boost (overall)**: n=126, mean=×0.952

**Трафик**: ttMean=1.022, Пробок почти нет (ttMean ≈ 1.0). Корреляция surge↔traffic не значима. Нужны замеры в час пик.


## 2026-04-26 16:14 — обучение #35

**Δ vs прошлый запуск** (что изменилось):
  - MAPE intra: 22.5% → 22.5% (+0pp → без изменений)
  - MAE intra : 3.7 → 3.7 br (+0 br)
  - ±10% попаданий: 20 → 20 (+0)
  - ±20% попаданий: 41 → 41 (+0)
  - Всего точек intra: 61 → 61 (+0)

**Dataset**: 127 заказов из 12 прогонов калибровки. С открытым ⚡N: 73.

**L1 SANITY (v3)**: ✅ v3 подтверждена: |perKm|=0.0085 < 0.05, |perMin|=0.0135 < 0.05. Baza Yandex плоская.
  - регрессия: pickup=9.688, perKm=-0.0085, perMin=0.0135 (MAE=0.196)


**L1 SURGE MODEL (v3)** ⚡N(km, min, slot):
  - `sunday-morning`: n=8, mean=0.962, std=0.498 | ⚡N ≈ 0.60 + 0.321·km + -0.154·min (MAE=0.264)
  - `sunday-midday`: n=8, mean=3.462, std=2.006 | ⚡N ≈ 0.84 + 0.073·km + 0.049·min (MAE=1.103)
  - `sunday-evening`: n=57, mean=2.796, std=4.706 | ⚡N ≈ 1.19 + 0.462·km + -0.281·min (MAE=0.712)

**Time-slot сёрдж (Cmf, sC и yaOpen)**:
  - `sunday-morning`: n=18, sC mean=0.593, std=0.369 | yaOpen mean=0.962 (n=8)
  - `sunday-midday`: n=47, sC mean=1.963, std=1.443 | yaOpen mean=3.462 (n=8)
  - `sunday-evening`: n=61, sC mean=2.749, std=4.553 | yaOpen mean=2.796 (n=57)

**Hidden Эконом-boost (overall)**: n=126, mean=×0.952

**Трафик**: ttMean=1.022, Пробок почти нет (ttMean ≈ 1.0). Корреляция surge↔traffic не значима. Нужны замеры в час пик.


## 2026-04-26 16:38 — обучение #36

**Δ vs прошлый запуск** (что изменилось):
  - MAPE intra: 22.5% → 20.4% (-2.1pp ↓ лучше)
  - MAE intra : 3.7 → 3.31 br (-0.39 br)
  - ±10% попаданий: 20 → 28 (+8)
  - ±20% попаданий: 41 → 51 (+10)
  - Всего точек intra: 61 → 72 (+11)

**Dataset**: 138 заказов из 13 прогонов калибровки. С открытым ⚡N: 84.

**L1 SANITY (v3)**: ✅ v3 подтверждена: |perKm|=0.0066 < 0.05, |perMin|=0.0113 < 0.05. Baza Yandex плоская.
  - регрессия: pickup=9.699, perKm=-0.0066, perMin=0.0113 (MAE=0.187)


**L1 SURGE MODEL (v3)** ⚡N(km, min, slot):
  - `sunday-morning`: n=8, mean=0.962, std=0.498 | ⚡N ≈ 0.60 + 0.321·km + -0.154·min (MAE=0.264)
  - `sunday-midday`: n=8, mean=3.462, std=2.006 | ⚡N ≈ 0.84 + 0.073·km + 0.049·min (MAE=1.103)
  - `sunday-evening`: n=68, mean=2.619, std=4.326 | ⚡N ≈ 1.18 + 0.442·km + -0.259·min (MAE=0.652)

**Time-slot сёрдж (Cmf, sC и yaOpen)**:
  - `sunday-morning`: n=18, sC mean=0.593, std=0.369 | yaOpen mean=0.962 (n=8)
  - `sunday-midday`: n=47, sC mean=1.963, std=1.443 | yaOpen mean=3.462 (n=8)
  - `sunday-evening`: n=72, sC mean=2.583, std=4.208 | yaOpen mean=2.619 (n=68)

**Hidden Эконом-boost (overall)**: n=137, mean=×0.955

**Трафик**: ttMean=1.021, Пробок почти нет (ttMean ≈ 1.0). Корреляция surge↔traffic не значима. Нужны замеры в час пик.
