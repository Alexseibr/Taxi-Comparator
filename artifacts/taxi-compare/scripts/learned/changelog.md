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


## 2026-04-26 18:01 — обучение #37

**Δ vs прошлый запуск** (что изменилось):
  - MAPE intra: 20.4% → 22.5% (+2.1pp ↑ хуже)
  - MAE intra : 3.31 → 3.86 br (+0.55 br)
  - ±10% попаданий: 28 → 28 (+0)
  - ±20% попаданий: 51 → 51 (+0)
  - Всего точек intra: 72 → 76 (+4)

**Dataset**: 167 заказов из 14 прогонов калибровки. С открытым ⚡N: 88.

**L1 SANITY (v3)**: ✅ v3 подтверждена: |perKm|=0.0316 < 0.05, |perMin|=0.0399 < 0.05. Baza Yandex плоская.
  - регрессия: pickup=10.644, perKm=0.0316, perMin=-0.0399 (MAE=1.122)


**L1 SURGE MODEL (v3)** ⚡N(km, min, slot):
  - `sunday-morning`: n=8, mean=0.962, std=0.498 | ⚡N ≈ 0.60 + 0.321·km + -0.154·min (MAE=0.264)
  - `sunday-midday`: n=8, mean=3.462, std=2.006 | ⚡N ≈ 0.84 + 0.073·km + 0.049·min (MAE=1.103)
  - `sunday-evening`: n=68, mean=2.619, std=4.326 | ⚡N ≈ 1.18 + 0.442·km + -0.259·min (MAE=0.652)
  - `sunday-late`: n=4, mean=1, std=0 | ⚡N ≈ 1.00 + 0.000·km + 0.000·min (MAE=0)

**Time-slot сёрдж (Cmf, sC и yaOpen)**:
  - `sunday-morning`: n=18, sC mean=0.593, std=0.369 | yaOpen mean=0.962 (n=8)
  - `sunday-midday`: n=47, sC mean=1.963, std=1.443 | yaOpen mean=3.462 (n=8)
  - `sunday-evening`: n=72, sC mean=2.583, std=4.208 | yaOpen mean=2.619 (n=68)
  - `sunday-late`: n=29, sC mean=3.254, std=3.25 | yaOpen mean=1 (n=4)

**Hidden Эконом-boost (overall)**: n=166, mean=×0.961

**Трафик**: ttMean=1.018, Пробок почти нет (ttMean ≈ 1.0). Корреляция surge↔traffic не значима. Нужны замеры в час пик.


## 2026-04-26 18:06 — обучение #38

**Δ vs прошлый запуск** (что изменилось):
  - MAPE intra: 22.5% → 20.4% (-2.1pp ↓ лучше)
  - MAE intra : 3.86 → 3.31 br (-0.55 br)
  - ±10% попаданий: 28 → 28 (+0)
  - ±20% попаданий: 51 → 51 (+0)
  - Всего точек intra: 76 → 72 (-4)

**Dataset**: 167 заказов из 14 прогонов калибровки. С открытым ⚡N: 84.

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
  - `sunday-late`: n=29, sC mean=3.254, std=3.25

**Hidden Эконом-boost (overall)**: n=166, mean=×0.961

**Трафик**: ttMean=1.018, Пробок почти нет (ttMean ≈ 1.0). Корреляция surge↔traffic не значима. Нужны замеры в час пик.


## 2026-04-26 18:13 — обучение #39

**Δ vs прошлый запуск** (что изменилось):
  - MAPE intra: 20.4% → 20.4% (+0pp → без изменений)
  - MAE intra : 3.31 → 3.31 br (+0 br)
  - ±10% попаданий: 28 → 28 (+0)
  - ±20% попаданий: 51 → 51 (+0)
  - Всего точек intra: 72 → 72 (+0)

**Dataset**: 167 заказов из 14 прогонов калибровки. С открытым ⚡N: 84.

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
  - `sunday-late`: n=29, sC mean=3.254, std=3.25

**Hidden Эконом-boost (overall)**: n=166, mean=×0.961

**Трафик**: ttMean=1.018, Пробок почти нет (ttMean ≈ 1.0). Корреляция surge↔traffic не значима. Нужны замеры в час пик.


## 2026-04-26 18:14 — обучение #40

**Δ vs прошлый запуск** (что изменилось):
  - MAPE intra: 20.4% → 20.4% (+0pp → без изменений)
  - MAE intra : 3.31 → 3.31 br (+0 br)
  - ±10% попаданий: 28 → 28 (+0)
  - ±20% попаданий: 51 → 51 (+0)
  - Всего точек intra: 72 → 72 (+0)

**Dataset**: 167 заказов из 14 прогонов калибровки. С открытым ⚡N: 84.

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
  - `sunday-late`: n=29, sC mean=3.254, std=3.25

**Hidden Эконом-boost (overall)**: n=166, mean=×0.961

**Трафик**: ttMean=1.018, Пробок почти нет (ttMean ≈ 1.0). Корреляция surge↔traffic не значима. Нужны замеры в час пик.


## 2026-04-26 18:22 — обучение #41

**Δ vs прошлый запуск** (что изменилось):
  - MAPE intra: 20.4% → 20.4% (+0pp → без изменений)
  - MAE intra : 3.31 → 3.31 br (+0 br)
  - ±10% попаданий: 28 → 28 (+0)
  - ±20% попаданий: 51 → 51 (+0)
  - Всего точек intra: 72 → 72 (+0)

**Dataset**: 167 заказов из 14 прогонов калибровки. С открытым ⚡N: 84.

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
  - `sunday-late`: n=29, sC mean=3.254, std=3.25

**Hidden Эконом-boost (overall)**: n=166, mean=×0.961

**Трафик**: ttMean=1.018, Пробок почти нет (ttMean ≈ 1.0). Корреляция surge↔traffic не значима. Нужны замеры в час пик.


## 2026-04-26 18:34 — обучение #42

**Δ vs прошлый запуск** (что изменилось):
  - MAPE intra: 20.4% → 20.6% (+0.2pp ↑ хуже)
  - MAE intra : 3.31 → 3.22 br (-0.09 br)
  - ±10% попаданий: 28 → 38 (+10)
  - ±20% попаданий: 51 → 46 (-5)
  - Всего точек intra: 72 → 72 (+0)

**Dataset**: 167 заказов из 14 прогонов калибровки. С открытым ⚡N: 84.

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
  - `sunday-late`: n=29, sC mean=3.254, std=3.25

**Hidden Эконом-boost (overall)**: n=166, mean=×0.961

**Трафик**: ttMean=1.018, Пробок почти нет (ttMean ≈ 1.0). Корреляция surge↔traffic не значима. Нужны замеры в час пик.


## 2026-04-26 18:35 — обучение #43

**Δ vs прошлый запуск** (что изменилось):
  - MAPE intra: 20.6% → 20.6% (+0pp → без изменений)
  - MAE intra : 3.22 → 3.22 br (+0 br)
  - ±10% попаданий: 38 → 38 (+0)
  - ±20% попаданий: 46 → 46 (+0)
  - Всего точек intra: 72 → 72 (+0)

**Dataset**: 167 заказов из 14 прогонов калибровки. С открытым ⚡N: 84.

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
  - `sunday-late`: n=29, sC mean=3.254, std=3.25

**Hidden Эконом-boost (overall)**: n=166, mean=×0.961

**Трафик**: ttMean=1.018, Пробок почти нет (ttMean ≈ 1.0). Корреляция surge↔traffic не значима. Нужны замеры в час пик.


## 2026-04-26 18:48 — обучение #44

**Δ vs прошлый запуск** (что изменилось):
  - MAPE intra: 20.6% → 20.6% (+0pp → без изменений)
  - MAE intra : 3.22 → 3.22 br (+0 br)
  - ±10% попаданий: 38 → 38 (+0)
  - ±20% попаданий: 46 → 46 (+0)
  - Всего точек intra: 72 → 72 (+0)

**Dataset**: 167 заказов из 14 прогонов калибровки. С открытым ⚡N: 84.

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
  - `sunday-late`: n=29, sC mean=3.254, std=3.25

**Hidden Эконом-boost (overall)**: n=166, mean=×0.961

**Трафик**: ttMean=1.018, Пробок почти нет (ttMean ≈ 1.0). Корреляция surge↔traffic не значима. Нужны замеры в час пик.


## 2026-04-26 18:49 — обучение #45

**Δ vs прошлый запуск** (что изменилось):
  - MAPE intra: 20.6% → 20.6% (+0pp → без изменений)
  - MAE intra : 3.22 → 3.22 br (+0 br)
  - ±10% попаданий: 38 → 38 (+0)
  - ±20% попаданий: 46 → 46 (+0)
  - Всего точек intra: 72 → 72 (+0)

**Dataset**: 167 заказов из 14 прогонов калибровки. С открытым ⚡N: 84.

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
  - `sunday-late`: n=29, sC mean=3.254, std=3.25

**Hidden Эконом-boost (overall)**: n=166, mean=×0.961

**Трафик**: ttMean=1.018, Пробок почти нет (ttMean ≈ 1.0). Корреляция surge↔traffic не значима. Нужны замеры в час пик.


## 2026-04-26 19:30 — обучение #46

**Δ vs прошлый запуск** (что изменилось):
  - MAPE intra: 20.6% → 20.1% (-0.5pp ↓ лучше)
  - MAE intra : 3.22 → 3.11 br (-0.11 br)
  - ±10% попаданий: 38 → 38 (+0)
  - ±20% попаданий: 46 → 46 (+0)
  - Всего точек intra: 72 → 72 (+0)

**Dataset**: 167 заказов из 14 прогонов калибровки. С открытым ⚡N: 84.

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
  - `sunday-late`: n=29, sC mean=3.254, std=3.25

**Hidden Эконом-boost (overall)**: n=166, mean=×0.961

**Трафик**: ttMean=1.018, Пробок почти нет (ttMean ≈ 1.0). Корреляция surge↔traffic не значима. Нужны замеры в час пик.


## 2026-04-26 19:35 — обучение #47

**Δ vs прошлый запуск** (что изменилось):
  - MAPE intra: 20.1% → 20.1% (+0pp → без изменений)
  - MAE intra : 3.11 → 3.11 br (+0 br)
  - ±10% попаданий: 38 → 38 (+0)
  - ±20% попаданий: 46 → 46 (+0)
  - Всего точек intra: 72 → 72 (+0)

**Dataset**: 167 заказов из 14 прогонов калибровки. С открытым ⚡N: 84.

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
  - `sunday-late`: n=29, sC mean=3.254, std=3.25

**Hidden Эконом-boost (overall)**: n=166, mean=×0.961

**Трафик**: ttMean=1.018, Пробок почти нет (ttMean ≈ 1.0). Корреляция surge↔traffic не значима. Нужны замеры в час пик.


## 2026-04-26 19:47 — обучение #48

**Δ vs прошлый запуск** (что изменилось):
  - MAPE intra: 20.1% → 20.1% (+0pp → без изменений)
  - MAE intra : 3.11 → 3.16 br (+0.05 br)
  - ±10% попаданий: 38 → 42 (+4)
  - ±20% попаданий: 46 → 59 (+13)
  - Всего точек intra: 72 → 86 (+14)

**Dataset**: 181 заказов из 15 прогонов калибровки. С открытым ⚡N: 98.

**L1 SANITY (v3)**: ✅ v3 подтверждена: |perKm|=0.0053 < 0.05, |perMin|=0.0097 < 0.05. Baza Yandex плоская.
  - регрессия: pickup=9.718, perKm=-0.0053, perMin=0.0097 (MAE=0.172)


**L1 SURGE MODEL (v3)** ⚡N(km, min, slot):
  - `sunday-morning`: n=8, mean=0.962, std=0.498 | ⚡N ≈ 0.60 + 0.321·km + -0.154·min (MAE=0.264)
  - `sunday-midday`: n=8, mean=3.462, std=2.006 | ⚡N ≈ 0.84 + 0.073·km + 0.049·min (MAE=1.103)
  - `sunday-evening`: n=68, mean=2.619, std=4.326 | ⚡N ≈ 1.18 + 0.442·km + -0.259·min (MAE=0.652)
  - `sunday-late`: n=14, mean=3.1, std=0.587 | ⚡N ≈ 2.51 + 0.432·km + -0.246·min (MAE=0.228)

**Time-slot сёрдж (Cmf, sC и yaOpen)**:
  - `sunday-morning`: n=18, sC mean=0.593, std=0.369 | yaOpen mean=0.962 (n=8)
  - `sunday-midday`: n=47, sC mean=1.963, std=1.443 | yaOpen mean=3.462 (n=8)
  - `sunday-evening`: n=72, sC mean=2.583, std=4.208 | yaOpen mean=2.619 (n=68)
  - `sunday-late`: n=43, sC mean=3.187, std=2.676 | yaOpen mean=3.1 (n=14)

**Hidden Эконом-boost (overall)**: n=180, mean=×0.957

**Трафик**: ttMean=1.016, Пробок почти нет (ttMean ≈ 1.0). Корреляция surge↔traffic не значима. Нужны замеры в час пик.


## 2026-04-26 19:58 — обучение #49

**Δ vs прошлый запуск** (что изменилось):
  - MAPE intra: 20.1% → 26.9% (+6.8pp ↑ хуже)
  - MAE intra : 3.16 → 4.1 br (+0.94 br)
  - ±10% попаданий: 42 → 36 (-6)
  - ±20% попаданий: 59 → 59 (+0)
  - Всего точек intra: 86 → 94 (+8)

**Dataset**: 191 заказов из 16 прогонов калибровки. С открытым ⚡N: 108.

**L1 SANITY (v3)**: ✅ v3 подтверждена: |perKm|=0.0117 < 0.05, |perMin|=0.0177 < 0.05. Baza Yandex плоская.
  - регрессия: pickup=9.651, perKm=-0.0117, perMin=0.0177 (MAE=0.182)


**L1 SURGE MODEL (v3)** ⚡N(km, min, slot):
  - `sunday-morning`: n=8, mean=0.962, std=0.498 | ⚡N ≈ 0.60 + 0.321·km + -0.154·min (MAE=0.264)
  - `sunday-midday`: n=8, mean=3.462, std=2.006 | ⚡N ≈ 0.84 + 0.073·km + 0.049·min (MAE=1.103)
  - `sunday-evening`: n=68, mean=2.619, std=4.326 | ⚡N ≈ 1.18 + 0.442·km + -0.259·min (MAE=0.652)
  - `sunday-late`: n=24, mean=2.45, std=0.958 | ⚡N ≈ 2.33 + 1.064·km + -0.713·min (MAE=0.539)

**Time-slot сёрдж (Cmf, sC и yaOpen)**:
  - `sunday-morning`: n=18, sC mean=0.593, std=0.369 | yaOpen mean=0.962 (n=8)
  - `sunday-midday`: n=47, sC mean=1.963, std=1.443 | yaOpen mean=3.462 (n=8)
  - `sunday-evening`: n=72, sC mean=2.583, std=4.208 | yaOpen mean=2.619 (n=68)
  - `sunday-late`: n=53, sC mean=2.865, std=2.507 | yaOpen mean=2.45 (n=24)

**Hidden Эконом-boost (overall)**: n=190, mean=×0.960

**Трафик**: ttMean=1.016, Пробок почти нет (ttMean ≈ 1.0). Корреляция surge↔traffic не значима. Нужны замеры в час пик.


## 2026-04-26 20:03 — обучение #50

**Δ vs прошлый запуск** (что изменилось):
  - MAPE intra: 26.9% → 26% (-0.9pp ↓ лучше)
  - MAE intra : 4.1 → 3.95 br (-0.15 br)
  - ±10% попаданий: 36 → 39 (+3)
  - ±20% попаданий: 59 → 57 (-2)
  - Всего точек intra: 94 → 94 (+0)

**Dataset**: 191 заказов из 16 прогонов калибровки. С открытым ⚡N: 108.

**L1 SANITY (v3)**: ✅ v3 подтверждена: |perKm|=0.0117 < 0.05, |perMin|=0.0177 < 0.05. Baza Yandex плоская.
  - регрессия: pickup=9.651, perKm=-0.0117, perMin=0.0177 (MAE=0.182)


**L1 SURGE MODEL (v3)** ⚡N(km, min, slot):
  - `sunday-morning`: n=8, mean=0.962, std=0.498 | ⚡N ≈ 0.60 + 0.321·km + -0.154·min (MAE=0.264)
  - `sunday-midday`: n=8, mean=3.462, std=2.006 | ⚡N ≈ 0.84 + 0.073·km + 0.049·min (MAE=1.103)
  - `sunday-evening`: n=68, mean=2.619, std=4.326 | ⚡N ≈ 1.18 + 0.442·km + -0.259·min (MAE=0.652)
  - `sunday-late`: n=24, mean=2.45, std=0.958 | ⚡N ≈ 2.33 + 1.064·km + -0.713·min (MAE=0.539)

**Time-slot сёрдж (Cmf, sC и yaOpen)**:
  - `sunday-morning`: n=18, sC mean=0.593, std=0.369 | yaOpen mean=0.962 (n=8)
  - `sunday-midday`: n=47, sC mean=1.963, std=1.443 | yaOpen mean=3.462 (n=8)
  - `sunday-evening`: n=72, sC mean=2.583, std=4.208 | yaOpen mean=2.619 (n=68)
  - `sunday-late`: n=53, sC mean=2.865, std=2.507 | yaOpen mean=2.45 (n=24)

**Hidden Эконом-boost (overall)**: n=190, mean=×0.960

**Трафик**: ttMean=1.016, Пробок почти нет (ttMean ≈ 1.0). Корреляция surge↔traffic не значима. Нужны замеры в час пик.


## 2026-04-26 20:50 — обучение #51

**Δ vs прошлый запуск** (что изменилось):
  - MAPE intra: 26% → 26% (+0pp → без изменений)
  - MAE intra : 3.95 → 3.95 br (+0 br)
  - ±10% попаданий: 39 → 39 (+0)
  - ±20% попаданий: 57 → 57 (+0)
  - Всего точек intra: 94 → 94 (+0)

**Dataset**: 191 заказов из 16 прогонов калибровки. С открытым ⚡N: 108.

**L1 SANITY (v3)**: ✅ v3 подтверждена: |perKm|=0.0117 < 0.05, |perMin|=0.0177 < 0.05. Baza Yandex плоская.
  - регрессия: pickup=9.651, perKm=-0.0117, perMin=0.0177 (MAE=0.182)


**L1 SURGE MODEL (v3)** ⚡N(km, min, slot):
  - `sunday-morning`: n=8, mean=0.962, std=0.498 | ⚡N ≈ 0.60 + 0.321·km + -0.154·min (MAE=0.264)
  - `sunday-midday`: n=8, mean=3.462, std=2.006 | ⚡N ≈ 0.84 + 0.073·km + 0.049·min (MAE=1.103)
  - `sunday-evening`: n=68, mean=2.619, std=4.326 | ⚡N ≈ 1.18 + 0.442·km + -0.259·min (MAE=0.652)
  - `sunday-late`: n=24, mean=2.45, std=0.958 | ⚡N ≈ 2.33 + 1.064·km + -0.713·min (MAE=0.539)

**Time-slot сёрдж (Cmf, sC и yaOpen)**:
  - `sunday-morning`: n=18, sC mean=0.593, std=0.369 | yaOpen mean=0.962 (n=8)
  - `sunday-midday`: n=47, sC mean=1.963, std=1.443 | yaOpen mean=3.462 (n=8)
  - `sunday-evening`: n=72, sC mean=2.583, std=4.208 | yaOpen mean=2.619 (n=68)
  - `sunday-late`: n=53, sC mean=2.865, std=2.507 | yaOpen mean=2.45 (n=24)

**Hidden Эконом-boost (overall)**: n=190, mean=×0.960

**Трафик**: ttMean=1.016, Пробок почти нет (ttMean ≈ 1.0). Корреляция surge↔traffic не значима. Нужны замеры в час пик.


## 2026-04-26 20:54 — обучение #52

**Δ vs прошлый запуск** (что изменилось):
  - MAPE intra: 26% → 26% (+0pp → без изменений)
  - MAE intra : 3.95 → 3.95 br (+0 br)
  - ±10% попаданий: 39 → 39 (+0)
  - ±20% попаданий: 57 → 57 (+0)
  - Всего точек intra: 94 → 94 (+0)

**Dataset**: 191 заказов из 16 прогонов калибровки. С открытым ⚡N: 108.

**L1 SANITY (v3)**: ✅ v3 подтверждена: |perKm|=0.0117 < 0.05, |perMin|=0.0177 < 0.05. Baza Yandex плоская.
  - регрессия: pickup=9.651, perKm=-0.0117, perMin=0.0177 (MAE=0.182)


**L1 SURGE MODEL (v3)** ⚡N(km, min, slot):
  - `sunday-morning`: n=8, mean=0.962, std=0.498 | ⚡N ≈ 0.60 + 0.321·km + -0.154·min (MAE=0.264)
  - `sunday-midday`: n=8, mean=3.462, std=2.006 | ⚡N ≈ 0.84 + 0.073·km + 0.049·min (MAE=1.103)
  - `sunday-evening`: n=68, mean=2.619, std=4.326 | ⚡N ≈ 1.18 + 0.442·km + -0.259·min (MAE=0.652)
  - `sunday-late`: n=24, mean=2.45, std=0.958 | ⚡N ≈ 2.33 + 1.064·km + -0.713·min (MAE=0.539)

**Time-slot сёрдж (Cmf, sC и yaOpen)**:
  - `sunday-morning`: n=18, sC mean=0.593, std=0.369 | yaOpen mean=0.962 (n=8)
  - `sunday-midday`: n=47, sC mean=1.963, std=1.443 | yaOpen mean=3.462 (n=8)
  - `sunday-evening`: n=72, sC mean=2.583, std=4.208 | yaOpen mean=2.619 (n=68)
  - `sunday-late`: n=53, sC mean=2.865, std=2.507 | yaOpen mean=2.45 (n=24)

**Hidden Эконом-boost (overall)**: n=190, mean=×0.960

**Трафик**: ttMean=1.016, Пробок почти нет (ttMean ≈ 1.0). Корреляция surge↔traffic не значима. Нужны замеры в час пик.


## 2026-04-27 04:36 — обучение #53

**Δ vs прошлый запуск** (что изменилось):
  - MAPE intra: 26% → 27.2% (+1.2pp ↑ хуже)
  - MAE intra : 3.95 → 4.47 br (+0.52 br)
  - ±10% попаданий: 39 → 42 (+3)
  - ±20% попаданий: 57 → 60 (+3)
  - Всего точек intra: 94 → 102 (+8)

**Dataset**: 199 заказов из 17 прогонов калибровки. С открытым ⚡N: 116.

**L1 SANITY (v3)**: ✅ v3 подтверждена: |perKm|=0.0259 < 0.05, |perMin|=0.0322 < 0.05. Baza Yandex плоская.
  - регрессия: pickup=9.685, perKm=-0.0259, perMin=0.0322 (MAE=0.275)


**L1 SURGE MODEL (v3)** ⚡N(km, min, slot):
  - `sunday-morning`: n=8, mean=0.962, std=0.498 | ⚡N ≈ 0.60 + 0.321·km + -0.154·min (MAE=0.264)
  - `sunday-midday`: n=8, mean=3.462, std=2.006 | ⚡N ≈ 0.84 + 0.073·km + 0.049·min (MAE=1.103)
  - `sunday-evening`: n=68, mean=2.619, std=4.326 | ⚡N ≈ 1.18 + 0.442·km + -0.259·min (MAE=0.652)
  - `sunday-late`: n=24, mean=2.45, std=0.958 | ⚡N ≈ 2.33 + 1.064·km + -0.713·min (MAE=0.539)
  - `weekday-morning`: n=8, mean=2.55, std=0.84 | ⚡N ≈ 1.88 + 0.074·km + -0.002·min (MAE=0.59)

**Time-slot сёрдж (Cmf, sC и yaOpen)**:
  - `sunday-morning`: n=18, sC mean=0.593, std=0.369 | yaOpen mean=0.962 (n=8)
  - `sunday-midday`: n=47, sC mean=1.963, std=1.443 | yaOpen mean=3.462 (n=8)
  - `sunday-evening`: n=72, sC mean=2.583, std=4.208 | yaOpen mean=2.619 (n=68)
  - `sunday-late`: n=53, sC mean=2.865, std=2.507 | yaOpen mean=2.45 (n=24)
  - `weekday-morning`: n=8, sC mean=2.639, std=0.609 | yaOpen mean=2.55 (n=8)

**Hidden Эконом-boost (overall)**: n=198, mean=×0.961

**Трафик**: ttMean=1.019, Пробок почти нет (ttMean ≈ 1.0). Корреляция surge↔traffic не значима. Нужны замеры в час пик.


## 2026-04-27 04:47 — обучение #54

**Δ vs прошлый запуск** (что изменилось):
  - MAPE intra: 27.2% → 23.3% (-3.9pp ↓ лучше)
  - MAE intra : 4.47 → 3.79 br (-0.68 br)
  - ±10% попаданий: 42 → 51 (+9)
  - ±20% попаданий: 60 → 78 (+18)
  - Всего точек intra: 102 → 119 (+17)

**Dataset**: 216 заказов из 18 прогонов калибровки. С открытым ⚡N: 133.

**L1 SANITY (v3)**: ✅ v3 подтверждена: |perKm|=0.0181 < 0.05, |perMin|=0.0235 < 0.05. Baza Yandex плоская.
  - регрессия: pickup=9.72, perKm=-0.0181, perMin=0.0235 (MAE=0.247)


**L1 SURGE MODEL (v3)** ⚡N(km, min, slot):
  - `sunday-morning`: n=8, mean=0.962, std=0.498 | ⚡N ≈ 0.60 + 0.321·km + -0.154·min (MAE=0.264)
  - `sunday-midday`: n=8, mean=3.462, std=2.006 | ⚡N ≈ 0.84 + 0.073·km + 0.049·min (MAE=1.103)
  - `sunday-evening`: n=68, mean=2.619, std=4.326 | ⚡N ≈ 1.18 + 0.442·km + -0.259·min (MAE=0.652)
  - `sunday-late`: n=24, mean=2.45, std=0.958 | ⚡N ≈ 2.33 + 1.064·km + -0.713·min (MAE=0.539)
  - `weekday-morning`: n=25, mean=2.736, std=0.719 | ⚡N ≈ 1.35 + 0.065·km + 0.045·min (MAE=0.32)

**Time-slot сёрдж (Cmf, sC и yaOpen)**:
  - `sunday-morning`: n=18, sC mean=0.593, std=0.369 | yaOpen mean=0.962 (n=8)
  - `sunday-midday`: n=47, sC mean=1.963, std=1.443 | yaOpen mean=3.462 (n=8)
  - `sunday-evening`: n=72, sC mean=2.583, std=4.208 | yaOpen mean=2.619 (n=68)
  - `sunday-late`: n=53, sC mean=2.865, std=2.507 | yaOpen mean=2.45 (n=24)
  - `weekday-morning`: n=25, sC mean=2.744, std=0.643 | yaOpen mean=2.736 (n=25)

**Hidden Эконом-boost (overall)**: n=215, mean=×0.962

**Трафик**: ttMean=1.034, Пробок почти нет (ttMean ≈ 1.0). Корреляция surge↔traffic не значима. Нужны замеры в час пик.


## 2026-04-27 05:00 — обучение #55

**Δ vs прошлый запуск** (что изменилось):
  - MAPE intra: 23.3% → 21.5% (-1.8pp ↓ лучше)
  - MAE intra : 3.79 → 3.58 br (-0.21 br)
  - ±10% попаданий: 51 → 63 (+12)
  - ±20% попаданий: 78 → 94 (+16)
  - Всего точек intra: 119 → 135 (+16)

**Dataset**: 232 заказов из 19 прогонов калибровки. С открытым ⚡N: 149.

**L1 SANITY (v3)**: ✅ v3 подтверждена: |perKm|=0.0115 < 0.05, |perMin|=0.0163 < 0.05. Baza Yandex плоская.
  - регрессия: pickup=9.739, perKm=-0.0115, perMin=0.0163 (MAE=0.233)


**L1 SURGE MODEL (v3)** ⚡N(km, min, slot):
  - `sunday-morning`: n=8, mean=0.962, std=0.498 | ⚡N ≈ 0.60 + 0.321·km + -0.154·min (MAE=0.264)
  - `sunday-midday`: n=8, mean=3.462, std=2.006 | ⚡N ≈ 0.84 + 0.073·km + 0.049·min (MAE=1.103)
  - `sunday-evening`: n=68, mean=2.619, std=4.326 | ⚡N ≈ 1.18 + 0.442·km + -0.259·min (MAE=0.652)
  - `sunday-late`: n=24, mean=2.45, std=0.958 | ⚡N ≈ 2.33 + 1.064·km + -0.713·min (MAE=0.539)
  - `weekday-morning`: n=41, mean=2.783, std=0.792 | ⚡N ≈ 1.27 + 0.052·km + 0.059·min (MAE=0.284)

**Time-slot сёрдж (Cmf, sC и yaOpen)**:
  - `sunday-morning`: n=18, sC mean=0.593, std=0.369 | yaOpen mean=0.962 (n=8)
  - `sunday-midday`: n=47, sC mean=1.963, std=1.443 | yaOpen mean=3.462 (n=8)
  - `sunday-evening`: n=72, sC mean=2.583, std=4.208 | yaOpen mean=2.619 (n=68)
  - `sunday-late`: n=53, sC mean=2.865, std=2.507 | yaOpen mean=2.45 (n=24)
  - `weekday-morning`: n=41, sC mean=2.764, std=0.751 | yaOpen mean=2.783 (n=41)

**Hidden Эконом-boost (overall)**: n=231, mean=×0.965

**Трафик**: ttMean=1.051, ttMean=1.05, корреляция surge↔traffic = 0.023.


## 2026-04-27 05:15 — обучение #56

**Δ vs прошлый запуск** (что изменилось):
  - MAPE intra: 21.5% → 21.5% (+0pp → без изменений)
  - MAE intra : 3.58 → 3.58 br (+0 br)
  - ±10% попаданий: 63 → 63 (+0)
  - ±20% попаданий: 94 → 94 (+0)
  - Всего точек intra: 135 → 135 (+0)

**Dataset**: 232 заказов из 19 прогонов калибровки. С открытым ⚡N: 149.

**L1 SANITY (v3)**: ✅ v3 подтверждена: |perKm|=0.0115 < 0.05, |perMin|=0.0163 < 0.05. Baza Yandex плоская.
  - регрессия: pickup=9.739, perKm=-0.0115, perMin=0.0163 (MAE=0.233)


**L1 SURGE MODEL (v3)** ⚡N(km, min, slot):
  - `sunday-morning`: n=8, mean=0.962, std=0.498 | ⚡N ≈ 0.71 + 0.353·km + -0.176·freeMin + -21.053·(ttMult-1) (MAE=0.208)
  - `sunday-midday`: n=8, mean=3.462, std=2.006
  - `sunday-evening`: n=68, mean=2.619, std=4.326 | ⚡N ≈ 1.29 + 0.495·km + -0.320·freeMin + 2.998·(ttMult-1) (MAE=0.653)
  - `sunday-late`: n=24, mean=2.45, std=0.958 | ⚡N ≈ 2.32 + 1.086·km + -0.728·freeMin + -1.678·(ttMult-1) (MAE=0.531)
  - `weekday-morning`: n=41, mean=2.783, std=0.792 | ⚡N ≈ 1.08 + 0.031·km + 0.095·freeMin + 0.381·(ttMult-1) (MAE=0.281)

**Time-slot сёрдж (Cmf, sC и yaOpen)**:
  - `sunday-morning`: n=18, sC mean=0.593, std=0.369 | yaOpen mean=0.962 (n=8)
  - `sunday-midday`: n=47, sC mean=1.963, std=1.443 | yaOpen mean=3.462 (n=8)
  - `sunday-evening`: n=72, sC mean=2.583, std=4.208 | yaOpen mean=2.619 (n=68)
  - `sunday-late`: n=53, sC mean=2.865, std=2.507 | yaOpen mean=2.45 (n=24)
  - `weekday-morning`: n=41, sC mean=2.764, std=0.751 | yaOpen mean=2.783 (n=41)

**Hidden Эконом-boost (overall)**: n=231, mean=×0.965

**Трафик**: ttMean=1.051, ttMean=1.05, корреляция surge↔traffic = 0.023.


## 2026-04-27 05:32 — обучение #57

**Δ vs прошлый запуск** (что изменилось):
  - MAPE intra: 21.5% → 19.7% (-1.8pp ↓ лучше)
  - MAE intra : 3.58 → 3.34 br (-0.24 br)
  - ±10% попаданий: 63 → 77 (+14)
  - ±20% попаданий: 94 → 108 (+14)
  - Всего точек intra: 135 → 152 (+17)

**Dataset**: 249 заказов из 20 прогонов калибровки. С открытым ⚡N: 166.

**L1 SANITY (v3)**: ✅ v3 подтверждена: |perKm|=0.0098 < 0.05, |perMin|=0.0143 < 0.05. Baza Yandex плоская.
  - регрессия: pickup=9.747, perKm=-0.0098, perMin=0.0143 (MAE=0.217)


**L1 SURGE MODEL (v3)** ⚡N(km, min, slot):
  - `sunday-morning`: n=8, mean=0.962, std=0.498 | ⚡N ≈ 0.71 + 0.353·km + -0.176·freeMin + -21.053·(ttMult-1) (MAE=0.208)
  - `sunday-midday`: n=8, mean=3.462, std=2.006
  - `sunday-evening`: n=68, mean=2.619, std=4.326 | ⚡N ≈ 1.29 + 0.495·km + -0.320·freeMin + 2.998·(ttMult-1) (MAE=0.653)
  - `sunday-late`: n=24, mean=2.45, std=0.958 | ⚡N ≈ 2.32 + 1.086·km + -0.728·freeMin + -1.678·(ttMult-1) (MAE=0.531)
  - `weekday-morning`: n=58, mean=2.634, std=0.739 | ⚡N ≈ 1.14 + 0.026·km + 0.100·freeMin + -0.124·(ttMult-1) (MAE=0.266)

**Time-slot сёрдж (Cmf, sC и yaOpen)**:
  - `sunday-morning`: n=18, sC mean=0.593, std=0.369 | yaOpen mean=0.962 (n=8)
  - `sunday-midday`: n=47, sC mean=1.963, std=1.443 | yaOpen mean=3.462 (n=8)
  - `sunday-evening`: n=72, sC mean=2.583, std=4.208 | yaOpen mean=2.619 (n=68)
  - `sunday-late`: n=53, sC mean=2.865, std=2.507 | yaOpen mean=2.45 (n=24)
  - `weekday-morning`: n=58, sC mean=2.612, std=0.709 | yaOpen mean=2.634 (n=58)

**Hidden Эконом-boost (overall)**: n=248, mean=×0.968

**Трафик**: ttMean=1.071, ttMean=1.07, корреляция surge↔traffic = 0.008.


## 2026-04-27 07:03 — обучение #58

**Δ vs прошлый запуск** (что изменилось):
  - MAPE intra: 19.7% → 22% (+2.3pp ↑ хуже)
  - MAE intra : 3.34 → 3.41 br (+0.07 br)
  - ±10% попаданий: 77 → 79 (+2)
  - ±20% попаданий: 108 → 116 (+8)
  - Всего точек intra: 152 → 168 (+16)

**Dataset**: 265 заказов из 21 прогонов калибровки. С открытым ⚡N: 182.

**L1 SANITY (v3)**: ✅ v3 подтверждена: |perKm|=0.0141 < 0.05, |perMin|=0.0199 < 0.05. Baza Yandex плоская.
  - регрессия: pickup=9.699, perKm=-0.0141, perMin=0.0199 (MAE=0.218)


**L1 SURGE MODEL (v3)** ⚡N(km, min, slot):
  - `sunday-morning`: n=8, mean=0.962, std=0.498 | ⚡N ≈ 0.71 + 0.353·km + -0.176·freeMin + -21.053·(ttMult-1) (MAE=0.208)
  - `sunday-midday`: n=8, mean=3.462, std=2.006
  - `sunday-evening`: n=68, mean=2.619, std=4.326 | ⚡N ≈ 1.29 + 0.495·km + -0.320·freeMin + 2.998·(ttMult-1) (MAE=0.653)
  - `sunday-late`: n=24, mean=2.45, std=0.958 | ⚡N ≈ 2.32 + 1.086·km + -0.728·freeMin + -1.678·(ttMult-1) (MAE=0.531)
  - `weekday-morning`: n=74, mean=2.281, std=0.952 | ⚡N ≈ 0.49 + 0.009·km + 0.138·freeMin + 0.876·(ttMult-1) (MAE=0.303)

**Time-slot сёрдж (Cmf, sC и yaOpen)**:
  - `sunday-morning`: n=18, sC mean=0.593, std=0.369 | yaOpen mean=0.962 (n=8)
  - `sunday-midday`: n=47, sC mean=1.963, std=1.443 | yaOpen mean=3.462 (n=8)
  - `sunday-evening`: n=72, sC mean=2.583, std=4.208 | yaOpen mean=2.619 (n=68)
  - `sunday-late`: n=53, sC mean=2.865, std=2.507 | yaOpen mean=2.45 (n=24)
  - `weekday-morning`: n=74, sC mean=2.257, std=0.937 | yaOpen mean=2.281 (n=74)

**Hidden Эконом-boost (overall)**: n=264, mean=×0.969

**Трафик**: ttMean=1.07, ttMean=1.07, корреляция surge↔traffic = 0.013.


## 2026-04-27 07:12 — обучение #59

**Δ vs прошлый запуск** (что изменилось):
  - MAPE intra: 22% → 22% (+0pp → без изменений)
  - MAE intra : 3.41 → 3.41 br (+0 br)
  - ±10% попаданий: 79 → 79 (+0)
  - ±20% попаданий: 116 → 116 (+0)
  - Всего точек intra: 168 → 168 (+0)

**Dataset**: 265 заказов из 21 прогонов калибровки. С открытым ⚡N: 182.

**L1 SANITY (v3)**: ✅ v3 подтверждена: |perKm|=0.0141 < 0.05, |perMin|=0.0199 < 0.05. Baza Yandex плоская.
  - регрессия: pickup=9.699, perKm=-0.0141, perMin=0.0199 (MAE=0.218)


**L1 SURGE MODEL (v3)** ⚡N(km, min, slot):
  - `sunday-morning`: n=8, mean=0.962, std=0.498 | ⚡N ≈ 0.11 + 0.035·km + 0.022·freeMin + -7.425·(ttMult-1) + 0.195·centDist (MAE=0.034)
  - `sunday-midday`: n=8, mean=3.462, std=2.006
  - `sunday-evening`: n=68, mean=2.619, std=4.326 | ⚡N ≈ 1.56 + 0.502·km + -0.329·freeMin + 2.143·(ttMult-1) + -0.060·centDist (MAE=0.693)
  - `sunday-late`: n=24, mean=2.45, std=0.958 | ⚡N ≈ 2.33 + 0.635·km + -0.316·freeMin + -2.797·(ttMult-1) + -0.409·centDist (MAE=0.415)
  - `weekday-morning`: n=74, mean=2.281, std=0.952 | ⚡N ≈ 0.43 + 0.014·km + 0.120·freeMin + 0.669·(ttMult-1) + 0.052·centDist (MAE=0.287)

**Time-slot сёрдж (Cmf, sC и yaOpen)**:
  - `sunday-morning`: n=18, sC mean=0.593, std=0.369 | yaOpen mean=0.962 (n=8)
  - `sunday-midday`: n=47, sC mean=1.963, std=1.443 | yaOpen mean=3.462 (n=8)
  - `sunday-evening`: n=72, sC mean=2.583, std=4.208 | yaOpen mean=2.619 (n=68)
  - `sunday-late`: n=53, sC mean=2.865, std=2.507 | yaOpen mean=2.45 (n=24)
  - `weekday-morning`: n=74, sC mean=2.257, std=0.937 | yaOpen mean=2.281 (n=74)

**Hidden Эконом-boost (overall)**: n=264, mean=×0.969

**Трафик**: ttMean=1.07, ttMean=1.07, корреляция surge↔traffic = 0.013.


## 2026-04-27 07:14 — обучение #60

**Δ vs прошлый запуск** (что изменилось):
  - MAPE intra: 22% → 22% (+0pp → без изменений)
  - MAE intra : 3.41 → 3.41 br (+0 br)
  - ±10% попаданий: 79 → 79 (+0)
  - ±20% попаданий: 116 → 116 (+0)
  - Всего точек intra: 168 → 168 (+0)

**Dataset**: 265 заказов из 21 прогонов калибровки. С открытым ⚡N: 182.

**L1 SANITY (v3)**: ✅ v3 подтверждена: |perKm|=0.0141 < 0.05, |perMin|=0.0199 < 0.05. Baza Yandex плоская.
  - регрессия: pickup=9.699, perKm=-0.0141, perMin=0.0199 (MAE=0.218)


**L1 SURGE MODEL (v3)** ⚡N(km, min, slot):
  - `sunday-morning`: n=8, mean=0.962, std=0.498
  - `sunday-midday`: n=8, mean=3.462, std=2.006
  - `sunday-evening`: n=68, mean=2.619, std=4.326 | ⚡N ≈ 1.08 + 0.561·km + -0.357·freeMin + 3.379·(ttMult-1) + 0.293·centDist + -0.0274·km·centDist (MAE=0.625)
  - `sunday-late`: n=24, mean=2.45, std=0.958 | ⚡N ≈ 3.82 + 0.537·km + -0.395·freeMin + -4.967·(ttMult-1) + -1.056·centDist + 0.0805·km·centDist (MAE=0.341)
  - `weekday-morning`: n=74, mean=2.281, std=0.952 | ⚡N ≈ 0.38 + 0.033·km + 0.113·freeMin + 0.640·(ttMult-1) + 0.066·centDist + -0.0019·km·centDist (MAE=0.286)

**Time-slot сёрдж (Cmf, sC и yaOpen)**:
  - `sunday-morning`: n=18, sC mean=0.593, std=0.369 | yaOpen mean=0.962 (n=8)
  - `sunday-midday`: n=47, sC mean=1.963, std=1.443 | yaOpen mean=3.462 (n=8)
  - `sunday-evening`: n=72, sC mean=2.583, std=4.208 | yaOpen mean=2.619 (n=68)
  - `sunday-late`: n=53, sC mean=2.865, std=2.507 | yaOpen mean=2.45 (n=24)
  - `weekday-morning`: n=74, sC mean=2.257, std=0.937 | yaOpen mean=2.281 (n=74)

**Hidden Эконом-boost (overall)**: n=264, mean=×0.969

**Трафик**: ttMean=1.07, ttMean=1.07, корреляция surge↔traffic = 0.013.


## 2026-04-27 07:22 — обучение #61

**Δ vs прошлый запуск** (что изменилось):
  - MAPE intra: 22% → 18.3% (-3.7pp ↓ лучше)
  - MAE intra : 3.41 → 3.02 br (-0.39 br)
  - ±10% попаданий: 79 → 80 (+1)
  - ±20% попаданий: 116 → 113 (-3)
  - Всего точек intra: 168 → 168 (+0)

**Dataset**: 265 заказов из 21 прогонов калибровки. С открытым ⚡N: 182.

**L1 SANITY (v3)**: ✅ v3 подтверждена: |perKm|=0.0141 < 0.05, |perMin|=0.0199 < 0.05. Baza Yandex плоская.
  - регрессия: pickup=9.699, perKm=-0.0141, perMin=0.0199 (MAE=0.218)


**L1 SURGE MODEL (v3)** ⚡N(km, min, slot):
  - `sunday-morning`: n=8, mean=0.962, std=0.498 | ⚡N ≈ 0.71 + 0.353·km + -0.176·freeMin + -21.053·(ttMult-1) (MAE=0.208)
  - `sunday-midday`: n=8, mean=3.462, std=2.006 | ⚡N ≈ 0.84 + 0.073·km + 0.049·min (MAE=1.103)
  - `sunday-evening`: n=68, mean=2.619, std=4.326 | ⚡N ≈ 1.08 + 0.561·km + -0.357·freeMin + 3.379·(ttMult-1) + 0.293·centDist + -0.0274·km·centDist (MAE=0.625)
  - `sunday-late`: n=24, mean=2.45, std=0.958 | ⚡N ≈ 3.82 + 0.537·km + -0.395·freeMin + -4.967·(ttMult-1) + -1.056·centDist + 0.0805·km·centDist (MAE=0.341)
  - `weekday-morning`: n=74, mean=2.281, std=0.952 | ⚡N ≈ 0.38 + 0.033·km + 0.113·freeMin + 0.640·(ttMult-1) + 0.066·centDist + -0.0019·km·centDist (MAE=0.286)

**Time-slot сёрдж (Cmf, sC и yaOpen)**:
  - `sunday-morning`: n=18, sC mean=0.593, std=0.369 | yaOpen mean=0.962 (n=8)
  - `sunday-midday`: n=47, sC mean=1.963, std=1.443 | yaOpen mean=3.462 (n=8)
  - `sunday-evening`: n=72, sC mean=2.583, std=4.208 | yaOpen mean=2.619 (n=68)
  - `sunday-late`: n=53, sC mean=2.865, std=2.507 | yaOpen mean=2.45 (n=24)
  - `weekday-morning`: n=74, sC mean=2.257, std=0.937 | yaOpen mean=2.281 (n=74)

**Hidden Эконом-boost (overall)**: n=264, mean=×0.969

**Трафик**: ttMean=1.07, ttMean=1.07, корреляция surge↔traffic = 0.013.


## 2026-04-27 07:36 — обучение #62

**Δ vs прошлый запуск** (что изменилось):
  - MAPE intra: 18.3% → 17.8% (-0.5pp ↓ лучше)
  - MAE intra : 3.02 → 2.96 br (-0.06 br)
  - ±10% попаданий: 80 → 82 (+2)
  - ±20% попаданий: 113 → 119 (+6)
  - Всего точек intra: 168 → 182 (+14)

**Dataset**: 279 заказов из 22 прогонов калибровки. С открытым ⚡N: 196.

**L1 SANITY (v3)**: ✅ v3 подтверждена: |perKm|=0.0175 < 0.05, |perMin|=0.0243 < 0.05. Baza Yandex плоская.
  - регрессия: pickup=9.651, perKm=-0.0175, perMin=0.0243 (MAE=0.223)


**L1 SURGE MODEL (v3)** ⚡N(km, min, slot):
  - `sunday-morning`: n=8, mean=0.962, std=0.498 | ⚡N ≈ 0.71 + 0.353·km + -0.176·freeMin + -21.053·(ttMult-1) (MAE=0.208)
  - `sunday-midday`: n=8, mean=3.462, std=2.006 | ⚡N ≈ 0.84 + 0.073·km + 0.049·min (MAE=1.103)
  - `sunday-evening`: n=68, mean=2.619, std=4.326 | ⚡N ≈ 1.08 + 0.561·km + -0.357·freeMin + 3.379·(ttMult-1) + 0.293·centDist + -0.0274·km·centDist (MAE=0.625)
  - `sunday-late`: n=24, mean=2.45, std=0.958 | ⚡N ≈ 3.82 + 0.537·km + -0.395·freeMin + -4.967·(ttMult-1) + -1.056·centDist + 0.0805·km·centDist (MAE=0.341)
  - `weekday-morning`: n=88, mean=2.123, std=0.956 | ⚡N ≈ 0.29 + 0.044·km + 0.104·freeMin + 1.490·(ttMult-1) + 0.032·centDist + -0.0012·km·centDist (MAE=0.314)

**Time-slot сёрдж (Cmf, sC и yaOpen)**:
  - `sunday-morning`: n=18, sC mean=0.593, std=0.369 | yaOpen mean=0.962 (n=8)
  - `sunday-midday`: n=47, sC mean=1.963, std=1.443 | yaOpen mean=3.462 (n=8)
  - `sunday-evening`: n=72, sC mean=2.583, std=4.208 | yaOpen mean=2.619 (n=68)
  - `sunday-late`: n=53, sC mean=2.865, std=2.507 | yaOpen mean=2.45 (n=24)
  - `weekday-morning`: n=88, sC mean=2.094, std=0.948 | yaOpen mean=2.123 (n=88)

**Hidden Эконом-boost (overall)**: n=278, mean=×0.966

**Трафик**: ttMean=1.067, ttMean=1.07, корреляция surge↔traffic = 0.02.


## 2026-04-27 07:55 — обучение #63

**Δ vs прошлый запуск** (что изменилось):
  - MAPE intra: 17.8% → 19.1% (+1.3pp ↑ хуже)
  - MAE intra : 2.96 → 3 br (+0.04 br)
  - ±10% попаданий: 82 → 90 (+8)
  - ±20% попаданий: 119 → 126 (+7)
  - Всего точек intra: 182 → 196 (+14)

**Dataset**: 295 заказов из 23 прогонов калибровки. С открытым ⚡N: 212.

**L1 SANITY (v3)**: ✅ v3 подтверждена: |perKm|=0.0197 < 0.05, |perMin|=0.0272 < 0.05. Baza Yandex плоская.
  - регрессия: pickup=9.619, perKm=-0.0197, perMin=0.0272 (MAE=0.229)


**L1 SURGE MODEL (v3)** ⚡N(km, min, slot):
  - `sunday-morning`: n=8, mean=0.962, std=0.498 | ⚡N ≈ 0.71 + 0.353·km + -0.176·freeMin + -21.053·(ttMult-1) (MAE=0.208)
  - `sunday-midday`: n=8, mean=3.462, std=2.006 | ⚡N ≈ 0.84 + 0.073·km + 0.049·min (MAE=1.103)
  - `sunday-evening`: n=68, mean=2.619, std=4.326 | ⚡N ≈ 1.08 + 0.561·km + -0.357·freeMin + 3.379·(ttMult-1) + 0.293·centDist + -0.0274·km·centDist (MAE=0.625)
  - `sunday-late`: n=24, mean=2.45, std=0.958 | ⚡N ≈ 3.82 + 0.537·km + -0.395·freeMin + -4.967·(ttMult-1) + -1.056·centDist + 0.0805·km·centDist (MAE=0.341)
  - `weekday-morning`: n=104, mean=1.979, std=0.948 | ⚡N ≈ 0.38 + 0.026·km + 0.099·freeMin + 1.571·(ttMult-1) + 0.025·centDist + 0.0014·km·centDist (MAE=0.295)

**Time-slot сёрдж (Cmf, sC и yaOpen)**:
  - `sunday-morning`: n=18, sC mean=0.593, std=0.369 | yaOpen mean=0.962 (n=8)
  - `sunday-midday`: n=47, sC mean=1.963, std=1.443 | yaOpen mean=3.462 (n=8)
  - `sunday-evening`: n=72, sC mean=2.583, std=4.208 | yaOpen mean=2.619 (n=68)
  - `sunday-late`: n=53, sC mean=2.865, std=2.507 | yaOpen mean=2.45 (n=24)
  - `weekday-morning`: n=104, sC mean=1.946, std=0.945 | yaOpen mean=1.979 (n=104)

**Hidden Эконом-boost (overall)**: n=294, mean=×0.967

**Трафик**: ttMean=1.065, ttMean=1.06, корреляция surge↔traffic = 0.03.


## 2026-04-27 08:05 — обучение #64

**Δ vs прошлый запуск** (что изменилось):
  - MAPE intra: 19.1% → 19% (-0.1pp ↓ лучше)
  - MAE intra : 3 → 2.95 br (-0.05 br)
  - ±10% попаданий: 90 → 88 (-2)
  - ±20% попаданий: 126 → 127 (+1)
  - Всего точек intra: 196 → 196 (+0)

**Dataset**: 295 заказов из 23 прогонов калибровки. С открытым ⚡N: 212.

**L1 SANITY (v3)**: ✅ v3 подтверждена: |perKm|=0.0197 < 0.05, |perMin|=0.0272 < 0.05. Baza Yandex плоская.
  - регрессия: pickup=9.619, perKm=-0.0197, perMin=0.0272 (MAE=0.229)


**L1 SURGE MODEL (v3)** ⚡N(km, min, slot):
  - `sunday-morning`: n=8, mean=0.962, std=0.498 | ⚡N ≈ 0.71 + 0.353·km + -0.176·freeMin + -21.053·(ttMult-1) (MAE=0.208)
  - `sunday-midday`: n=8, mean=3.462, std=2.006 | ⚡N ≈ 0.84 + 0.073·km + 0.049·min (MAE=1.103)
  - `sunday-evening`: n=68, mean=2.619, std=4.326 | ⚡N ≈ 0.98 + 0.355·km + -0.279·freeMin + 2.215·(ttMult-1) + 0.221·centDist + -0.0143·km·centDist + 0.144·destCentDist (MAE=0.67)
  - `sunday-late`: n=24, mean=2.45, std=0.958 | ⚡N ≈ 4.04 + 0.298·km + -0.358·freeMin + -6.087·(ttMult-1) + -1.167·centDist + 0.1093·km·centDist + 0.180·destCentDist (MAE=0.268)
  - `weekday-morning`: n=104, mean=1.979, std=0.948 | ⚡N ≈ 0.38 + 0.019·km + 0.101·freeMin + 1.576·(ttMult-1) + 0.022·centDist + 0.0019·km·centDist + 0.004·destCentDist (MAE=0.294)

**Time-slot сёрдж (Cmf, sC и yaOpen)**:
  - `sunday-morning`: n=18, sC mean=0.593, std=0.369 | yaOpen mean=0.962 (n=8)
  - `sunday-midday`: n=47, sC mean=1.963, std=1.443 | yaOpen mean=3.462 (n=8)
  - `sunday-evening`: n=72, sC mean=2.583, std=4.208 | yaOpen mean=2.619 (n=68)
  - `sunday-late`: n=53, sC mean=2.865, std=2.507 | yaOpen mean=2.45 (n=24)
  - `weekday-morning`: n=104, sC mean=1.946, std=0.945 | yaOpen mean=1.979 (n=104)

**Hidden Эконом-boost (overall)**: n=294, mean=×0.967

**Трафик**: ttMean=1.065, ttMean=1.06, корреляция surge↔traffic = 0.03.


## 2026-04-27 08:13 — обучение #65

**Δ vs прошлый запуск** (что изменилось):
  - MAPE intra: 19% → 19% (+0pp → без изменений)
  - MAE intra : 2.95 → 2.95 br (+0 br)
  - ±10% попаданий: 88 → 88 (+0)
  - ±20% попаданий: 127 → 127 (+0)
  - Всего точек intra: 196 → 196 (+0)

**Dataset**: 295 заказов из 23 прогонов калибровки. С открытым ⚡N: 212.

**L1 SANITY (v3)**: ✅ v3 подтверждена: |perKm|=0.0197 < 0.05, |perMin|=0.0272 < 0.05. Baza Yandex плоская.
  - регрессия: pickup=9.619, perKm=-0.0197, perMin=0.0272 (MAE=0.229)


**L1 SURGE MODEL (v3)** ⚡N(km, min, slot):
  - `sunday-morning`: n=8, mean=0.962, std=0.498 | ⚡N ≈ 0.71 + 0.353·km + -0.176·freeMin + -21.053·(ttMult-1) (MAE=0.208)
  - `sunday-midday`: n=8, mean=3.462, std=2.006 | ⚡N ≈ 0.84 + 0.073·km + 0.049·min (MAE=1.103)
  - `sunday-evening`: n=68, mean=2.619, std=4.326 | ⚡N ≈ 0.98 + 0.355·km + -0.279·freeMin + 2.215·(ttMult-1) + 0.365·centDist + -0.0143·km·centDist + 0.144·(destCentDist−pickupCentDist) (MAE=0.67)
  - `sunday-late`: n=24, mean=2.45, std=0.958 | ⚡N ≈ 4.04 + 0.298·km + -0.358·freeMin + -6.087·(ttMult-1) + -0.987·centDist + 0.1093·km·centDist + 0.180·(destCentDist−pickupCentDist) (MAE=0.268)
  - `weekday-morning`: n=104, mean=1.979, std=0.948 | ⚡N ≈ 0.38 + 0.019·km + 0.101·freeMin + 1.576·(ttMult-1) + 0.026·centDist + 0.0019·km·centDist + 0.004·(destCentDist−pickupCentDist) (MAE=0.294)

**Time-slot сёрдж (Cmf, sC и yaOpen)**:
  - `sunday-morning`: n=18, sC mean=0.593, std=0.369 | yaOpen mean=0.962 (n=8)
  - `sunday-midday`: n=47, sC mean=1.963, std=1.443 | yaOpen mean=3.462 (n=8)
  - `sunday-evening`: n=72, sC mean=2.583, std=4.208 | yaOpen mean=2.619 (n=68)
  - `sunday-late`: n=53, sC mean=2.865, std=2.507 | yaOpen mean=2.45 (n=24)
  - `weekday-morning`: n=104, sC mean=1.946, std=0.945 | yaOpen mean=1.979 (n=104)

**Hidden Эконом-boost (overall)**: n=294, mean=×0.967

**Трафик**: ttMean=1.065, ttMean=1.06, корреляция surge↔traffic = 0.03.


## 2026-04-27 08:17 — обучение #66

**Δ vs прошлый запуск** (что изменилось):
  - MAPE intra: 19% → 18.9% (-0.1pp ↓ лучше)
  - MAE intra : 2.95 → 2.97 br (+0.02 br)
  - ±10% попаданий: 88 → 92 (+4)
  - ±20% попаданий: 127 → 130 (+3)
  - Всего точек intra: 196 → 196 (+0)

**Dataset**: 295 заказов из 23 прогонов калибровки. С открытым ⚡N: 212.

**L1 SANITY (v3)**: ✅ v3 подтверждена: |perKm|=0.0197 < 0.05, |perMin|=0.0272 < 0.05. Baza Yandex плоская.
  - регрессия: pickup=9.619, perKm=-0.0197, perMin=0.0272 (MAE=0.229)


**L1 SURGE MODEL (v3)** ⚡N(km, min, slot):
  - `sunday-morning`: n=8, mean=0.962, std=0.498 | ⚡N ≈ 0.71 + 0.353·km + -0.176·freeMin + -21.053·(ttMult-1) (MAE=0.208)
  - `sunday-midday`: n=8, mean=3.462, std=2.006 | ⚡N ≈ 0.84 + 0.073·km + 0.049·min (MAE=1.103)
  - `sunday-evening`: n=68, mean=2.619, std=4.326 | ⚡N ≈ 1.31 + 0.217·km + -0.254·freeMin + 0.943·(ttMult-1) + 0.261·centDist + 0.0002·km·centDist + 0.259·max(0, destCentDist−pickupCentDist) (MAE=0.697)
  - `sunday-late`: n=24, mean=2.45, std=0.958 | ⚡N ≈ 4.01 + 0.230·km + -0.306·freeMin + -6.195·(ttMult-1) + -1.071·centDist + 0.1070·km·centDist + 0.238·max(0, destCentDist−pickupCentDist) (MAE=0.236)
  - `weekday-morning`: n=104, mean=1.979, std=0.948 | ⚡N ≈ 0.34 + 0.055·km + 0.100·freeMin + 1.490·(ttMult-1) + 0.024·centDist + -0.0017·km·centDist + -0.052·max(0, destCentDist−pickupCentDist) (MAE=0.294)

**Time-slot сёрдж (Cmf, sC и yaOpen)**:
  - `sunday-morning`: n=18, sC mean=0.593, std=0.369 | yaOpen mean=0.962 (n=8)
  - `sunday-midday`: n=47, sC mean=1.963, std=1.443 | yaOpen mean=3.462 (n=8)
  - `sunday-evening`: n=72, sC mean=2.583, std=4.208 | yaOpen mean=2.619 (n=68)
  - `sunday-late`: n=53, sC mean=2.865, std=2.507 | yaOpen mean=2.45 (n=24)
  - `weekday-morning`: n=104, sC mean=1.946, std=0.945 | yaOpen mean=1.979 (n=104)

**Hidden Эконом-boost (overall)**: n=294, mean=×0.967

**Трафик**: ttMean=1.065, ttMean=1.06, корреляция surge↔traffic = 0.03.


## 2026-04-27 08:58 — обучение #67

**Δ vs прошлый запуск** (что изменилось):
  - MAPE intra: 18.9% → 19.4% (+0.5pp ↑ хуже)
  - MAE intra : 2.97 → 3.01 br (+0.04 br)
  - ±10% попаданий: 92 → 97 (+5)
  - ±20% попаданий: 130 → 138 (+8)
  - Всего точек intra: 196 → 207 (+11)

**Dataset**: 306 заказов из 24 прогонов калибровки. С открытым ⚡N: 223.

**L1 SANITY (v3)**: ✅ v3 подтверждена: |perKm|=0.0210 < 0.05, |perMin|=0.0292 < 0.05. Baza Yandex плоская.
  - регрессия: pickup=9.589, perKm=-0.021, perMin=0.0292 (MAE=0.236)


**L1 SURGE MODEL (v3)** ⚡N(km, min, slot):
  - `sunday-morning`: n=8, mean=0.962, std=0.498 | ⚡N ≈ 0.71 + 0.353·km + -0.176·freeMin + -21.053·(ttMult-1) (MAE=0.208)
  - `sunday-midday`: n=8, mean=3.462, std=2.006 | ⚡N ≈ 0.84 + 0.073·km + 0.049·min (MAE=1.103)
  - `sunday-evening`: n=68, mean=2.619, std=4.326 | ⚡N ≈ 1.31 + 0.217·km + -0.254·freeMin + 0.943·(ttMult-1) + 0.261·centDist + 0.0002·km·centDist + 0.259·max(0, destCentDist−pickupCentDist) (MAE=0.697)
  - `sunday-late`: n=24, mean=2.45, std=0.958 | ⚡N ≈ 4.01 + 0.230·km + -0.306·freeMin + -6.195·(ttMult-1) + -1.071·centDist + 0.1070·km·centDist + 0.238·max(0, destCentDist−pickupCentDist) (MAE=0.236)
  - `weekday-morning`: n=104, mean=1.979, std=0.948 | ⚡N ≈ 0.34 + 0.055·km + 0.100·freeMin + 1.490·(ttMult-1) + 0.024·centDist + -0.0017·km·centDist + -0.052·max(0, destCentDist−pickupCentDist) (MAE=0.294)
  - `weekday-midday`: n=11, mean=1.055, std=0.216 | ⚡N ≈ 0.20 + 0.020·km + 0.056·freeMin + 2.273·(ttMult-1) + 0.020·centDist + 0.0106·km·centDist + 0.002·max(0, destCentDist−pickupCentDist) (MAE=0.035)

**Time-slot сёрдж (Cmf, sC и yaOpen)**:
  - `sunday-morning`: n=18, sC mean=0.593, std=0.369 | yaOpen mean=0.962 (n=8)
  - `sunday-midday`: n=47, sC mean=1.963, std=1.443 | yaOpen mean=3.462 (n=8)
  - `sunday-evening`: n=72, sC mean=2.583, std=4.208 | yaOpen mean=2.619 (n=68)
  - `sunday-late`: n=53, sC mean=2.865, std=2.507 | yaOpen mean=2.45 (n=24)
  - `weekday-morning`: n=104, sC mean=1.946, std=0.945 | yaOpen mean=1.979 (n=104)
  - `weekday-midday`: n=11, sC mean=0.996, std=0.22 | yaOpen mean=1.055 (n=11)

**Hidden Эконом-boost (overall)**: n=305, mean=×0.968

**Трафик**: ttMean=1.065, ttMean=1.06, корреляция surge↔traffic = 0.03.


## 2026-04-27 12:09 — обучение #68

**Δ vs прошлый запуск** (что изменилось):
  - MAPE intra: 19.4% → 19% (-0.4pp ↓ лучше)
  - MAE intra : 3.01 → 2.97 br (-0.04 br)
  - ±10% попаданий: 97 → 79 (-18)
  - ±20% попаданий: 138 → 145 (+7)
  - Всего точек intra: 207 → 217 (+10)

**Dataset**: 316 заказов из 25 прогонов калибровки. С открытым ⚡N: 233.

**L1 SANITY (v3)**: ✅ v3 подтверждена: |perKm|=0.0189 < 0.05, |perMin|=0.0268 < 0.05. Baza Yandex плоская.
  - регрессия: pickup=9.594, perKm=-0.0189, perMin=0.0268 (MAE=0.234)


**L1 SURGE MODEL (v3)** ⚡N(km, min, slot):
  - `sunday-h10`: n=8, mean=0.962, std=0.498 | ⚡N ≈ 0.71 + 0.353·km + -0.176·freeMin + -21.053·(ttMult-1) (MAE=0.208)
  - `sunday-h11`: n=8, mean=3.462, std=2.006 | ⚡N ≈ 0.84 + 0.073·km + 0.049·min (MAE=1.103)
  - `sunday-h15`: n=44, mean=3.032, std=5.34 | ⚡N ≈ 2.88 + 0.288·km + -0.444·freeMin + -4.645·(ttMult-1) + 0.088·centDist + 0.0100·km·centDist + 0.350·max(0, destCentDist−pickupCentDist) (MAE=0.794)
  - `sunday-h17`: n=13, mean=2, std=0.512 | ⚡N ≈ 0.82 + -0.176·km + 0.172·freeMin + 5.507·(ttMult-1) + -0.121·centDist + 0.0187·km·centDist + -0.045·max(0, destCentDist−pickupCentDist) (MAE=0.122)
  - `sunday-h19`: n=11, mean=1.7, std=0.502 | ⚡N ≈ 0.79 + -0.011·km + 0.089·freeMin + 1.203·(ttMult-1) (MAE=0.125)
  - `sunday-h22`: n=24, mean=2.45, std=0.958 | ⚡N ≈ 4.01 + 0.230·km + -0.306·freeMin + -6.195·(ttMult-1) + -1.071·centDist + 0.1070·km·centDist + 0.238·max(0, destCentDist−pickupCentDist) (MAE=0.236)
  - `weekday-h7`: n=41, mean=2.783, std=0.792 | ⚡N ≈ 1.34 + -0.044·km + 0.105·freeMin + 0.315·(ttMult-1) + -0.031·centDist + 0.0079·km·centDist + 0.053·max(0, destCentDist−pickupCentDist) (MAE=0.266)
  - `weekday-h8`: n=17, mean=2.276, std=0.428 | ⚡N ≈ -0.01 + 0.055·km + 0.297·freeMin + -0.997·(ttMult-1) + 0.218·centDist + -0.0497·km·centDist + -0.117·max(0, destCentDist−pickupCentDist) (MAE=0.163)
  - `weekday-h9`: n=16, mean=1, std=0.314 | ⚡N ≈ -0.01 + -0.308·km + 0.181·freeMin + 3.752·(ttMult-1) + 0.321·centDist + 0.0112·km·centDist + 0.247·max(0, destCentDist−pickupCentDist) (MAE=0.112)
  - `weekday-h10`: n=30, mean=1.233, std=0.327 | ⚡N ≈ 0.57 + -0.015·km + 0.089·freeMin + -2.281·(ttMult-1) + 0.110·centDist + -0.0116·km·centDist + -0.040·max(0, destCentDist−pickupCentDist) (MAE=0.137)
  - `weekday-h11`: n=11, mean=1.055, std=0.216 | ⚡N ≈ 0.97 + 0.074·km + -0.075·freeMin + -1.153·(ttMult-1) + -0.059·centDist + 0.0486·km·centDist + -0.023·max(0, destCentDist−pickupCentDist) (MAE=0.043)
  - `weekday-h13`: n=10, mean=1.71, std=0.567 | ⚡N ≈ 0.35 + 0.158·km + 0.056·freeMin + -2.954·(ttMult-1) + 0.091·centDist + -0.0185·km·centDist + -0.139·max(0, destCentDist−pickupCentDist) (MAE=0.098)

**Time-slot сёрдж (Cmf, sC и yaOpen)**:
  - `sunday-h10`: n=8, sC mean=0.447, std=0.202 | yaOpen mean=0.962 (n=8)
  - `sunday-h11`: n=8, sC mean=0.731, std=0.375 | yaOpen mean=3.462 (n=8)
  - `sunday-h12`: n=10, sC mean=1.859, std=0.66
  - `sunday-h13`: n=27, sC mean=2.321, std=1.618
  - `sunday-h14`: n=2, sC mean=2.58, std=2.517
  - `sunday-h15`: n=44, sC mean=3.009, std=5.343 | yaOpen mean=3.032 (n=44)
  - `sunday-h17`: n=17, sC mean=2.074, std=0.589 | yaOpen mean=2 (n=13)
  - `sunday-h19`: n=11, sC mean=1.661, std=0.49 | yaOpen mean=1.7 (n=11)
  - `sunday-h20`: n=29, sC mean=3.254, std=3.25
  - `sunday-h22`: n=24, sC mean=2.396, std=0.966 | yaOpen mean=2.45 (n=24)
  - `sunday-h9`: n=10, sC mean=0.71, std=0.438
  - `weekday-h7`: n=41, sC mean=2.764, std=0.751 | yaOpen mean=2.783 (n=41)
  - `weekday-h8`: n=17, sC mean=2.245, std=0.423 | yaOpen mean=2.276 (n=17)
  - `weekday-h9`: n=16, sC mean=0.968, std=0.318 | yaOpen mean=1 (n=16)
  - `weekday-h10`: n=30, sC mean=1.18, std=0.324 | yaOpen mean=1.233 (n=30)
  - `weekday-h11`: n=11, sC mean=0.996, std=0.22 | yaOpen mean=1.055 (n=11)
  - `weekday-h13`: n=10, sC mean=1.655, std=0.563 | yaOpen mean=1.71 (n=10)

**Hidden Эконом-boost (overall)**: n=315, mean=×0.969

**Трафик**: ttMean=1.065, ttMean=1.06, корреляция surge↔traffic = 0.029.


## 2026-04-27 12:17 — обучение #69

**Δ vs прошлый запуск** (что изменилось):
  - MAPE intra: 19% → 19% (+0pp → без изменений)
  - MAE intra : 2.97 → 2.97 br (+0 br)
  - ±10% попаданий: 79 → 79 (+0)
  - ±20% попаданий: 145 → 145 (+0)
  - Всего точек intra: 217 → 217 (+0)

**Dataset**: 316 заказов из 25 прогонов калибровки. С открытым ⚡N: 233.

**L1 SANITY (v3)**: ✅ v3 подтверждена: |perKm|=0.0189 < 0.05, |perMin|=0.0268 < 0.05. Baza Yandex плоская.
  - регрессия: pickup=9.594, perKm=-0.0189, perMin=0.0268 (MAE=0.234)


**L1 SURGE MODEL (v3)** ⚡N(km, min, slot):
  - `sunday-h10`: n=8, mean=0.962, std=0.498 | ⚡N ≈ 0.71 + 0.353·km + -0.176·freeMin + -21.053·(ttMult-1) (MAE=0.208)
  - `sunday-h11`: n=8, mean=3.462, std=2.006 | ⚡N ≈ 0.84 + 0.073·km + 0.049·min (MAE=1.103)
  - `sunday-h15`: n=44, mean=3.032, std=5.34 | ⚡N ≈ 2.88 + 0.288·km + -0.444·freeMin + -4.645·(ttMult-1) + 0.088·centDist + 0.0100·km·centDist + 0.350·max(0, destCentDist−pickupCentDist) (MAE=0.794)
  - `sunday-h17`: n=13, mean=2, std=0.512 | ⚡N ≈ 0.82 + -0.176·km + 0.172·freeMin + 5.507·(ttMult-1) + -0.121·centDist + 0.0187·km·centDist + -0.045·max(0, destCentDist−pickupCentDist) (MAE=0.122)
  - `sunday-h19`: n=11, mean=1.7, std=0.502 | ⚡N ≈ 0.79 + -0.011·km + 0.089·freeMin + 1.203·(ttMult-1) (MAE=0.125)
  - `sunday-h22`: n=24, mean=2.45, std=0.958 | ⚡N ≈ 4.01 + 0.230·km + -0.306·freeMin + -6.195·(ttMult-1) + -1.071·centDist + 0.1070·km·centDist + 0.238·max(0, destCentDist−pickupCentDist) (MAE=0.236)
  - `weekday-h7`: n=41, mean=2.783, std=0.792 | ⚡N ≈ 1.34 + -0.044·km + 0.105·freeMin + 0.315·(ttMult-1) + -0.031·centDist + 0.0079·km·centDist + 0.053·max(0, destCentDist−pickupCentDist) (MAE=0.266)
  - `weekday-h8`: n=17, mean=2.276, std=0.428 | ⚡N ≈ -0.01 + 0.055·km + 0.297·freeMin + -0.997·(ttMult-1) + 0.218·centDist + -0.0497·km·centDist + -0.117·max(0, destCentDist−pickupCentDist) (MAE=0.163)
  - `weekday-h9`: n=16, mean=1, std=0.314 | ⚡N ≈ -0.01 + -0.308·km + 0.181·freeMin + 3.752·(ttMult-1) + 0.321·centDist + 0.0112·km·centDist + 0.247·max(0, destCentDist−pickupCentDist) (MAE=0.112)
  - `weekday-h10`: n=30, mean=1.233, std=0.327 | ⚡N ≈ 0.57 + -0.015·km + 0.089·freeMin + -2.281·(ttMult-1) + 0.110·centDist + -0.0116·km·centDist + -0.040·max(0, destCentDist−pickupCentDist) (MAE=0.137)
  - `weekday-h11`: n=11, mean=1.055, std=0.216 | ⚡N ≈ 0.97 + 0.074·km + -0.075·freeMin + -1.153·(ttMult-1) + -0.059·centDist + 0.0486·km·centDist + -0.023·max(0, destCentDist−pickupCentDist) (MAE=0.043)
  - `weekday-h13`: n=10, mean=1.71, std=0.567 | ⚡N ≈ 0.35 + 0.158·km + 0.056·freeMin + -2.954·(ttMult-1) + 0.091·centDist + -0.0185·km·centDist + -0.139·max(0, destCentDist−pickupCentDist) (MAE=0.098)

**Time-slot сёрдж (Cmf, sC и yaOpen)**:
  - `sunday-h10`: n=8, sC mean=0.447, std=0.202 | yaOpen mean=0.962 (n=8)
  - `sunday-h11`: n=8, sC mean=0.731, std=0.375 | yaOpen mean=3.462 (n=8)
  - `sunday-h12`: n=10, sC mean=1.859, std=0.66
  - `sunday-h13`: n=27, sC mean=2.321, std=1.618
  - `sunday-h14`: n=2, sC mean=2.58, std=2.517
  - `sunday-h15`: n=44, sC mean=3.009, std=5.343 | yaOpen mean=3.032 (n=44)
  - `sunday-h17`: n=17, sC mean=2.074, std=0.589 | yaOpen mean=2 (n=13)
  - `sunday-h19`: n=11, sC mean=1.661, std=0.49 | yaOpen mean=1.7 (n=11)
  - `sunday-h20`: n=29, sC mean=3.254, std=3.25
  - `sunday-h22`: n=24, sC mean=2.396, std=0.966 | yaOpen mean=2.45 (n=24)
  - `sunday-h9`: n=10, sC mean=0.71, std=0.438
  - `weekday-h7`: n=41, sC mean=2.764, std=0.751 | yaOpen mean=2.783 (n=41)
  - `weekday-h8`: n=17, sC mean=2.245, std=0.423 | yaOpen mean=2.276 (n=17)
  - `weekday-h9`: n=16, sC mean=0.968, std=0.318 | yaOpen mean=1 (n=16)
  - `weekday-h10`: n=30, sC mean=1.18, std=0.324 | yaOpen mean=1.233 (n=30)
  - `weekday-h11`: n=11, sC mean=0.996, std=0.22 | yaOpen mean=1.055 (n=11)
  - `weekday-h13`: n=10, sC mean=1.655, std=0.563 | yaOpen mean=1.71 (n=10)

**Hidden Эконом-boost (overall)**: n=315, mean=×0.969

**Трафик**: ttMean=1.065, ttMean=1.06, корреляция surge↔traffic = 0.029.


## 2026-04-27 13:37 — обучение #70

**Δ vs прошлый запуск** (что изменилось):
  - MAPE intra: 19% → 19% (+0pp → без изменений)
  - MAE intra : 2.97 → 2.97 br (+0 br)
  - ±10% попаданий: 79 → 79 (+0)
  - ±20% попаданий: 145 → 145 (+0)
  - Всего точек intra: 217 → 217 (+0)

**Dataset**: 351 заказов из 27 прогонов калибровки. С открытым ⚡N: 233.

**L1 SANITY (v3)**: ✅ v3 подтверждена: |perKm|=0.0189 < 0.05, |perMin|=0.0268 < 0.05. Baza Yandex плоская.
  - регрессия: pickup=9.594, perKm=-0.0189, perMin=0.0268 (MAE=0.234)


**L1 SURGE MODEL (v3)** ⚡N(km, min, slot):
  - `sunday-h10`: n=8, mean=0.962, std=0.498 | ⚡N ≈ 0.71 + 0.353·km + -0.176·freeMin + -21.053·(ttMult-1) (MAE=0.208)
  - `sunday-h11`: n=8, mean=3.462, std=2.006 | ⚡N ≈ 0.84 + 0.073·km + 0.049·min (MAE=1.103)
  - `sunday-h15`: n=44, mean=3.032, std=5.34 | ⚡N ≈ 2.88 + 0.288·km + -0.444·freeMin + -4.645·(ttMult-1) + 0.088·centDist + 0.0100·km·centDist + 0.350·max(0, destCentDist−pickupCentDist) (MAE=0.794)
  - `sunday-h17`: n=13, mean=2, std=0.512 | ⚡N ≈ 0.82 + -0.176·km + 0.172·freeMin + 5.507·(ttMult-1) + -0.121·centDist + 0.0187·km·centDist + -0.045·max(0, destCentDist−pickupCentDist) (MAE=0.122)
  - `sunday-h19`: n=11, mean=1.7, std=0.502 | ⚡N ≈ 0.79 + -0.011·km + 0.089·freeMin + 1.203·(ttMult-1) (MAE=0.125)
  - `sunday-h22`: n=24, mean=2.45, std=0.958 | ⚡N ≈ 4.01 + 0.230·km + -0.306·freeMin + -6.195·(ttMult-1) + -1.071·centDist + 0.1070·km·centDist + 0.238·max(0, destCentDist−pickupCentDist) (MAE=0.236)
  - `weekday-h7`: n=41, mean=2.783, std=0.792 | ⚡N ≈ 1.34 + -0.044·km + 0.105·freeMin + 0.315·(ttMult-1) + -0.031·centDist + 0.0079·km·centDist + 0.053·max(0, destCentDist−pickupCentDist) (MAE=0.266)
  - `weekday-h8`: n=17, mean=2.276, std=0.428 | ⚡N ≈ -0.01 + 0.055·km + 0.297·freeMin + -0.997·(ttMult-1) + 0.218·centDist + -0.0497·km·centDist + -0.117·max(0, destCentDist−pickupCentDist) (MAE=0.163)
  - `weekday-h9`: n=16, mean=1, std=0.314 | ⚡N ≈ -0.01 + -0.308·km + 0.181·freeMin + 3.752·(ttMult-1) + 0.321·centDist + 0.0112·km·centDist + 0.247·max(0, destCentDist−pickupCentDist) (MAE=0.112)
  - `weekday-h10`: n=30, mean=1.233, std=0.327 | ⚡N ≈ 0.57 + -0.015·km + 0.089·freeMin + -2.281·(ttMult-1) + 0.110·centDist + -0.0116·km·centDist + -0.040·max(0, destCentDist−pickupCentDist) (MAE=0.137)
  - `weekday-h11`: n=11, mean=1.055, std=0.216 | ⚡N ≈ 0.97 + 0.074·km + -0.075·freeMin + -1.153·(ttMult-1) + -0.059·centDist + 0.0486·km·centDist + -0.023·max(0, destCentDist−pickupCentDist) (MAE=0.043)
  - `weekday-h13`: n=10, mean=1.71, std=0.567 | ⚡N ≈ 0.35 + 0.158·km + 0.056·freeMin + -2.954·(ttMult-1) + 0.091·centDist + -0.0185·km·centDist + -0.139·max(0, destCentDist−pickupCentDist) (MAE=0.098)

**Time-slot сёрдж (Cmf, sC и yaOpen)**:
  - `sunday-h10`: n=8, sC mean=0.447, std=0.202 | yaOpen mean=0.962 (n=8)
  - `sunday-h11`: n=8, sC mean=0.731, std=0.375 | yaOpen mean=3.462 (n=8)
  - `sunday-h12`: n=10, sC mean=1.859, std=0.66
  - `sunday-h13`: n=27, sC mean=2.321, std=1.618
  - `sunday-h14`: n=2, sC mean=2.58, std=2.517
  - `sunday-h15`: n=44, sC mean=3.009, std=5.343 | yaOpen mean=3.032 (n=44)
  - `sunday-h17`: n=17, sC mean=2.074, std=0.589 | yaOpen mean=2 (n=13)
  - `sunday-h19`: n=11, sC mean=1.661, std=0.49 | yaOpen mean=1.7 (n=11)
  - `sunday-h20`: n=29, sC mean=3.254, std=3.25
  - `sunday-h22`: n=24, sC mean=2.396, std=0.966 | yaOpen mean=2.45 (n=24)
  - `sunday-h9`: n=10, sC mean=0.71, std=0.438
  - `weekday-h7`: n=51, sC mean=3.001, std=2.6 | yaOpen mean=2.783 (n=41)
  - `weekday-h8`: n=17, sC mean=2.245, std=0.423 | yaOpen mean=2.276 (n=17)
  - `weekday-h9`: n=16, sC mean=0.968, std=0.318 | yaOpen mean=1 (n=16)
  - `weekday-h10`: n=30, sC mean=1.18, std=0.324 | yaOpen mean=1.233 (n=30)
  - `weekday-h11`: n=11, sC mean=0.996, std=0.22 | yaOpen mean=1.055 (n=11)
  - `weekday-h13`: n=10, sC mean=1.655, std=0.563 | yaOpen mean=1.71 (n=10)
  - `weekday-h15`: n=25, sC mean=0.564, std=0.107

**Hidden Эконом-boost (overall)**: n=350, mean=×0.966

**Трафик**: ttMean=1.064, ttMean=1.06, корреляция surge↔traffic = 0.03.


## 2026-05-10 07:59 — обучение #71

**Δ vs прошлый запуск** (что изменилось):
  - MAPE intra: 19% → 19% (+0pp → без изменений)
  - MAE intra : 2.97 → 2.97 br (+0 br)
  - ±10% попаданий: 79 → 79 (+0)
  - ±20% попаданий: 145 → 145 (+0)
  - Всего точек intra: 217 → 217 (+0)

**Dataset**: 351 заказов из 27 прогонов калибровки. С открытым ⚡N: 233.

**L1 SANITY (v3)**: ✅ v3 подтверждена: |perKm|=0.0189 < 0.05, |perMin|=0.0268 < 0.05. Baza Yandex плоская.
  - регрессия: pickup=9.594, perKm=-0.0189, perMin=0.0268 (MAE=0.234)


**L1 SURGE MODEL (v3)** ⚡N(km, min, slot):
  - `sunday-h10`: n=8, mean=0.962, std=0.498 | ⚡N ≈ 0.71 + 0.353·km + -0.176·freeMin + -21.053·(ttMult-1) (MAE=0.208)
  - `sunday-h11`: n=8, mean=3.462, std=2.006 | ⚡N ≈ 0.84 + 0.073·km + 0.049·min (MAE=1.103)
  - `sunday-h15`: n=44, mean=3.032, std=5.34 | ⚡N ≈ 2.88 + 0.288·km + -0.444·freeMin + -4.645·(ttMult-1) + 0.088·centDist + 0.0100·km·centDist + 0.350·max(0, destCentDist−pickupCentDist) (MAE=0.794)
  - `sunday-h17`: n=13, mean=2, std=0.512 | ⚡N ≈ 0.82 + -0.176·km + 0.172·freeMin + 5.507·(ttMult-1) + -0.121·centDist + 0.0187·km·centDist + -0.045·max(0, destCentDist−pickupCentDist) (MAE=0.122)
  - `sunday-h19`: n=11, mean=1.7, std=0.502 | ⚡N ≈ 0.79 + -0.011·km + 0.089·freeMin + 1.203·(ttMult-1) (MAE=0.125)
  - `sunday-h22`: n=24, mean=2.45, std=0.958 | ⚡N ≈ 4.01 + 0.230·km + -0.306·freeMin + -6.195·(ttMult-1) + -1.071·centDist + 0.1070·km·centDist + 0.238·max(0, destCentDist−pickupCentDist) (MAE=0.236)
  - `weekday-h7`: n=41, mean=2.783, std=0.792 | ⚡N ≈ 1.34 + -0.044·km + 0.105·freeMin + 0.315·(ttMult-1) + -0.031·centDist + 0.0079·km·centDist + 0.053·max(0, destCentDist−pickupCentDist) (MAE=0.266)
  - `weekday-h8`: n=17, mean=2.276, std=0.428 | ⚡N ≈ -0.01 + 0.055·km + 0.297·freeMin + -0.997·(ttMult-1) + 0.218·centDist + -0.0497·km·centDist + -0.117·max(0, destCentDist−pickupCentDist) (MAE=0.163)
  - `weekday-h9`: n=16, mean=1, std=0.314 | ⚡N ≈ -0.01 + -0.308·km + 0.181·freeMin + 3.752·(ttMult-1) + 0.321·centDist + 0.0112·km·centDist + 0.247·max(0, destCentDist−pickupCentDist) (MAE=0.112)
  - `weekday-h10`: n=30, mean=1.233, std=0.327 | ⚡N ≈ 0.57 + -0.015·km + 0.089·freeMin + -2.281·(ttMult-1) + 0.110·centDist + -0.0116·km·centDist + -0.040·max(0, destCentDist−pickupCentDist) (MAE=0.137)
  - `weekday-h11`: n=11, mean=1.055, std=0.216 | ⚡N ≈ 0.97 + 0.074·km + -0.075·freeMin + -1.153·(ttMult-1) + -0.059·centDist + 0.0486·km·centDist + -0.023·max(0, destCentDist−pickupCentDist) (MAE=0.043)
  - `weekday-h13`: n=10, mean=1.71, std=0.567 | ⚡N ≈ 0.35 + 0.158·km + 0.056·freeMin + -2.954·(ttMult-1) + 0.091·centDist + -0.0185·km·centDist + -0.139·max(0, destCentDist−pickupCentDist) (MAE=0.098)

**Time-slot сёрдж (Cmf, sC и yaOpen)**:
  - `sunday-h10`: n=8, sC mean=0.447, std=0.202 | yaOpen mean=0.962 (n=8)
  - `sunday-h11`: n=8, sC mean=0.731, std=0.375 | yaOpen mean=3.462 (n=8)
  - `sunday-h12`: n=10, sC mean=1.859, std=0.66
  - `sunday-h13`: n=27, sC mean=2.321, std=1.618
  - `sunday-h14`: n=2, sC mean=2.58, std=2.517
  - `sunday-h15`: n=44, sC mean=3.009, std=5.343 | yaOpen mean=3.032 (n=44)
  - `sunday-h17`: n=17, sC mean=2.074, std=0.589 | yaOpen mean=2 (n=13)
  - `sunday-h19`: n=11, sC mean=1.661, std=0.49 | yaOpen mean=1.7 (n=11)
  - `sunday-h20`: n=29, sC mean=3.254, std=3.25
  - `sunday-h22`: n=24, sC mean=2.396, std=0.966 | yaOpen mean=2.45 (n=24)
  - `sunday-h9`: n=10, sC mean=0.71, std=0.438
  - `weekday-h7`: n=51, sC mean=3.001, std=2.6 | yaOpen mean=2.783 (n=41)
  - `weekday-h8`: n=17, sC mean=2.245, std=0.423 | yaOpen mean=2.276 (n=17)
  - `weekday-h9`: n=16, sC mean=0.968, std=0.318 | yaOpen mean=1 (n=16)
  - `weekday-h10`: n=30, sC mean=1.18, std=0.324 | yaOpen mean=1.233 (n=30)
  - `weekday-h11`: n=11, sC mean=0.996, std=0.22 | yaOpen mean=1.055 (n=11)
  - `weekday-h13`: n=10, sC mean=1.655, std=0.563 | yaOpen mean=1.71 (n=10)
  - `weekday-h15`: n=25, sC mean=0.564, std=0.107

**Hidden Эконом-boost (overall)**: n=350, mean=×0.966

**Трафик**: ttMean=1.064, ttMean=1.06, корреляция surge↔traffic = 0.03.
