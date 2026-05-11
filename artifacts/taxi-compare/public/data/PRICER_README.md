# rwbtaxi-pricer — мини-калькулятор тарифа Яндекс.Такси (Минск)

Автономный JS-модуль, который считает цену поездки по нашей обученной модели
(методика **v3**, на 26.04.2026), без обращения к Yandex API.

## Что это значит

На сайте `rwbtaxi.by` мы накопили базу замеров фактических цен Yandex по
скриншотам приложения и обучили простую регрессионную модель:

> **цена = базовая_монета(класс) × surge(день, час) × hidden_boost(класс, день, час)**

Параметры модели лежат в двух обычных JSON-файлах, которые свободно
скачиваются с нашего сайта:

| URL | Что внутри |
|---|---|
| `https://rwbtaxi.by/data/surge-map.json` | Среднее значение surge по `день недели × час` |
| `https://rwbtaxi.by/data/hidden-boost.json` | Скидка Эконома относительно Комфорта по тем же слотам |
| `https://rwbtaxi.by/data/pricer.js` | Сам калькулятор (≈90 строк, без зависимостей) |

Этого достаточно, чтобы у себя на бэкенде (или прямо в браузере) посчитать
прогноз цены Yandex для **любого часа любого дня недели** — например, для
ваших клиентов «сравните, у нас дешевле на ~X BYN».

## Базовые константы (вшиты в pricer.js)

| параметр | значение | смысл |
|---|---|---|
| `MIN_E` | **9.39 BYN** | минимум Эконома (та самая «плоская монета» Яндекса) |
| `MIN_C` | **9.86 BYN** | минимум Комфорта |
| `SURGE_MIN` | 0.3 | защитная нижняя граница |
| `SURGE_MAX` | 10.0 | защитная верхняя граница |
| `FALLBACK_SURGE` | 1.0 | если данных по слоту нет вовсе |

> Минимумы получены из медианы 73 замеров с открытым ⚡N и не округлены.
> Yandex обновляет базу очень редко — раз в 6–12 месяцев.

## Установка (Node.js)

```bash
mkdir rwbtaxi-mini && cd rwbtaxi-mini
curl -O https://rwbtaxi.by/data/pricer.js
curl -O https://rwbtaxi.by/data/surge-map.json
curl -O https://rwbtaxi.by/data/hidden-boost.json
```

## Использование (Node.js)

```js
const { createPricer } = require("./pricer.js");
const surgeMap = require("./surge-map.json");
const boostMap = require("./hidden-boost.json");

const pricer = createPricer({ surgeMap, boostMap });

// Воскресенье, 22:00, Комфорт:
console.log(pricer.predict({
  taxiClass: "comfort",
  dayType:   "sunday",
  hour:      22,
}));
// → { price: 19.7, surge: 2.0, boost: 1.0, source: "ourModel", n: 14, base: 9.86 }
```

## Использование (браузер)

```html
<script src="https://rwbtaxi.by/data/pricer.js"></script>
<script>
  Promise.all([
    fetch("https://rwbtaxi.by/data/surge-map.json").then(r => r.json()),
    fetch("https://rwbtaxi.by/data/hidden-boost.json").then(r => r.json()),
  ]).then(([surge, boost]) => {
    const p = window.RwbPricer.createPricer({ surgeMap: surge, boostMap: boost });
    const res = p.predict({ taxiClass: "econom", dayType: "weekday", hour: 8 });
    document.body.textContent = `Прогноз: ${res.price} BYN (sC=${res.surge.toFixed(2)})`;
  });
</script>
```

## Параметры функции `predict()`

| поле | тип | обязательно | значения |
|---|---|---|---|
| `taxiClass` | string | да | `"econom"` или `"comfort"` |
| `dayType` | string | да | `"weekday"`, `"saturday"`, `"sunday"` |
| `hour` | number | да | `0..23` |
| `trafficRatio` | number | нет | `0..1`, отношение текущей скорости к свободной (`0.5` = в 2 раза медленнее). Если меньше `0.7` — surge увеличивается. Если опустить — пробки не учитываются. |

## Что возвращает

```ts
{
  price:  number,   // итоговая цена в BYN, округлённая до 0.10
  surge:  number,   // применённый множитель (после защит)
  boost:  number,   // hidden Эконом-boost (для Комфорта = 1.0)
  source: "ourModel" | "fallback",  // откуда взяли surge
  n:      number,   // сколько замеров стояло за этим прогнозом
  base:   number,   // базовая монета (9.39 или 9.86)
}
```

## Когда `source = "fallback"`

Это значит, что для запрошенного `(день × час)` у нас в базе **меньше 3
замеров** (или вообще ни одного). Калькулятор берёт `surge = 1.0` (то есть
просто базовую монету) — это безопасный, но грубый прогноз.

**Что делать:** заходите на `https://rwbtaxi.by` → меню → «Карта дыр» —
там видно, в какие часы и в каких зонах нужно ещё прислать скрины. Когда
тестер закроет дыру, следующая `surge-map.json` уже будет содержать ячейку,
и калькулятор перейдёт на `source: "ourModel"`.

## Версия и обновление

- Версия модели: **v3 (плоская монета × surge)** от **26.04.2026**.
- Обновляется автоматически каждый раз, когда мы пересобираем фронт. Чтобы
  ваш бэкенд тоже всегда работал по свежим данным — раз в сутки качайте
  свежие `surge-map.json` и `hidden-boost.json` (cron: `0 4 * * *`).
- Сам `pricer.js` версионируется реже (только при изменении формулы);
  можно зафиксировать у себя локально.

## Лицензия

Используйте свободно. Если нашли расхождение с реальным Yandex — пришлите
скрин в «Скрины: план/факт» на нашем сайте, модель улучшится для всех.
