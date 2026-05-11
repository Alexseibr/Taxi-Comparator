// Минимальный service worker, нужный только для регистрации PWA
// и установки на главный экран. Без офлайн-кэша — все запросы идут в сеть.
// Если в будущем понадобится офлайн-режим, здесь же добавим cache-first
// для статики из /assets/ и сетевой fallback на index.html.

const VERSION = "v1";

self.addEventListener("install", (event) => {
  // Сразу активируем новую версию SW, не дожидаясь закрытия всех вкладок.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  // Чистим старые кэши на случай если они были.
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  // Прозрачный pass-through. Браузер сам решит как обработать запрос.
  // SW зарегистрирован просто чтобы PWA можно было установить.
});
