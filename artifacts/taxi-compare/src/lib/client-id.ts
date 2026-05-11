// Стабильный идентификатор клиента (один на устройство/браузер) — нужен серверу,
// чтобы отличить «свою» бронь адреса от «чужой» (вкладка «Скриншот» → книжечка
// рекомендованных адресов). Логин у нас общий (rwb), поэтому юзера различаем
// только по этому id, который живёт в localStorage.

const STORAGE_KEY = "rwb_client_id_v1";

function generate(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `cid-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
}

export function getOrCreateClientId(): string {
  if (typeof window === "undefined") return "ssr";
  try {
    const ls = window.localStorage;
    let id = ls.getItem(STORAGE_KEY);
    if (!id || id.length < 6) {
      id = generate();
      ls.setItem(STORAGE_KEY, id);
    }
    return id;
  } catch {
    // приватный режим / отказ в localStorage — генерим эпhemeral id на сессию
    return `cid-fallback-${Date.now().toString(36)}`;
  }
}
