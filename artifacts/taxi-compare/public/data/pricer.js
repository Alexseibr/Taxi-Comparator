/* eslint-disable */
/**
 * rwbtaxi-pricer v3 — мини-калькулятор цены такси Яндекс (Минск)
 * без обращения к Yandex API. Реализует методику v3 (плоская монета × surge).
 *
 *   цена = МИН(класс) × surge(день, час) × hidden_boost(класс, день, час)
 *
 * Зависит от двух наших обученных JSON-файлов:
 *   - https://rwbtaxi.by/data/surge-map.json     (день × час → mean surge)
 *   - https://rwbtaxi.by/data/hidden-boost.json  (день × час → boost эконома)
 *
 * Запуск (Node.js):
 *   const { createPricer } = require("./pricer.js");
 *   const surgeMap   = require("./surge-map.json");
 *   const boostMap   = require("./hidden-boost.json");
 *   const pricer = createPricer({ surgeMap, boostMap });
 *   pricer.predict({ taxiClass: "comfort", dayType: "weekday", hour: 22 });
 *   // → { price: 19.7, surge: 2.0, source: "ourModel", n: 14 }
 *
 * Запуск (браузер):
 *   <script src="/data/pricer.js"></script>
 *   <script>
 *     Promise.all([
 *       fetch("/data/surge-map.json").then(r=>r.json()),
 *       fetch("/data/hidden-boost.json").then(r=>r.json()),
 *     ]).then(([s,b]) => {
 *       const p = window.RwbPricer.createPricer({ surgeMap: s, boostMap: b });
 *       console.log(p.predict({ taxiClass:"econom", dayType:"sunday", hour:23 }));
 *     });
 *   </script>
 *
 * Параметры (актуальны на 26.04.2026, обновляются при ребилде модели):
 *   MIN_E       — базовая «монета» Эконома (BYN)
 *   MIN_C       — базовая «монета» Комфорта (BYN)
 *   SURGE_MIN   — нижняя граница сёрджа (модель не опускается ниже)
 *   SURGE_MAX   — верхняя граница (защита от выбросов)
 *   FALLBACK    — какой surge брать, если данных по слоту вообще нет
 */
"use strict";

const MIN_E = 9.39;
const MIN_C = 9.86;
const SURGE_MIN = 0.3;
const SURGE_MAX = 10.0;
const FALLBACK_SURGE = 1.0;

/**
 * @param {{surgeMap:object, boostMap:object}} opts
 * @returns {{predict: function, params: object}}
 */
function createPricer(opts) {
  const surgeMap = (opts && opts.surgeMap) || {};
  const boostMap = (opts && opts.boostMap) || {};
  const ourModel = (surgeMap.ourModel) || {};
  const bySlot   = (boostMap.bySlot)   || {};

  /**
   * @param {{taxiClass:"econom"|"comfort", dayType:"weekday"|"saturday"|"sunday",
   *          hour:number, trafficRatio?:number}} q
   */
  function predict(q) {
    const cls   = q.taxiClass === "econom" ? "econom" : "comfort";
    const day   = q.dayType;
    const hour  = Number(q.hour);
    const tt    = typeof q.trafficRatio === "number" ? q.trafficRatio : 1.0;

    // 1) Смотрим в нашу модель (ourModel[day]["h{hour}"]).
    const slotKey = "h" + hour;
    const dayBucket = ourModel[day] || {};
    const slot = dayBucket[slotKey];

    let surge, source, n;
    if (slot && typeof slot.mean === "number" && slot.n >= 3) {
      surge = slot.mean;
      source = "ourModel";
      n = slot.n;
    } else {
      surge = FALLBACK_SURGE;
      source = "fallback";
      n = slot ? slot.n : 0;
    }

    // 2) Поправка на пробки (едем медленнее свободного потока).
    if (tt > 0 && tt < 0.7) {
      surge *= 1 + 0.6 * (1 / tt - 1);
    }

    // 3) Защита от выбросов.
    if (surge < SURGE_MIN) surge = SURGE_MIN;
    if (surge > SURGE_MAX) surge = SURGE_MAX;

    // 4) Hidden Эконом-boost (Эконом обычно дешевле Комфорта в той же ситуации).
    let boost = 1.0;
    if (cls === "econom") {
      const bKey = day + "-h" + hour;
      const b = bySlot[bKey];
      if (b && typeof b.mean === "number" && b.n >= 3) boost = b.mean;
      else boost = 0.93; // default по 109 замерам
    }

    const min = cls === "econom" ? MIN_E : MIN_C;
    const raw = min * surge * boost;
    const price = Math.round(raw * 10) / 10; // округление до 0.1 BYN

    return { price, surge, boost, source, n, base: min };
  }

  return {
    predict,
    params: { MIN_E, MIN_C, SURGE_MIN, SURGE_MAX, FALLBACK_SURGE },
  };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { createPricer };
}
if (typeof window !== "undefined") {
  window.RwbPricer = { createPricer };
}
