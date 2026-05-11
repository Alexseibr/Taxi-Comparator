#!/usr/bin/env python3
"""
rwbtaxi-price-probe.py — РЕАЛЬНЫЕ цены Яндекс Go + surge multiplier.

Первый запуск:  python3 rwbtaxi-price-probe.py          (откроет Chrome, один раз войди)
Следующие:      python3 rwbtaxi-price-probe.py          (полностью автоматически)
VPS/cron:       python3 rwbtaxi-price-probe.py --cron   (без Chrome, без ввода, анонимно)
Сброс сессии:   python3 rwbtaxi-price-probe.py --reset
Дебаг:          python3 rwbtaxi-price-probe.py --debug
Зависимости: только стандартная библиотека Python.
"""
import json, os, sys, time, struct, socket, base64, hashlib, subprocess
import urllib.request
from datetime import datetime, timezone, timedelta

DEBUG = "--debug" in sys.argv
RESET = "--reset" in sys.argv
CRON  = "--cron"  in sys.argv   # режим VPS: без Chrome, без input(), тихий выход

# Задайте через переменные окружения или ~/.rwbtaxi-notify.env:
#   BOT_TOKEN=<telegram_bot_token>
#   CHAT_ID=<telegram_chat_id>
def _read_notify_env():
    import pathlib
    p = pathlib.Path(os.path.expanduser("~/.rwbtaxi-notify.env"))
    out = {}
    if p.exists():
        for ln in p.read_text().splitlines():
            if "=" in ln and not ln.strip().startswith("#"):
                k, _, v = ln.partition("=")
                out[k.strip()] = v.strip()
    return out
_notify = _read_notify_env()
BOT_TOKEN   = os.environ.get("BOT_TOKEN", _notify.get("BOT_TOKEN", ""))
CHAT_ID     = os.environ.get("CHAT_ID",   _notify.get("CHAT_ID",   ""))
PROBE_URL   = ("http://localhost:3011/yandex-probe" if CRON
               else "https://rwbtaxi.by/api/screens/yandex-probe")
AUTH_FILE   = os.path.expanduser("~/.rwbtaxi-auth.json")
CHROME_DIR  = os.path.expanduser("~/.rwbtaxi-chrome")  # постоянный профиль Chrome

ROUTES = [
  {"id":"vokzal→arena",    "from":[27.5495,53.8902],"to":[27.4825,53.9347],
   "label":"Вокзал→Арена",      "from_addr":"ул. Вокзальная 17",     "to_addr":"пр. Победителей 111",
   "fallback_km":5.5, "fallback_min":13},
  {"id":"nemiga→uruchye",  "from":[27.5485,53.9028],"to":[27.6810,53.9509],
   "label":"Немига→Уручье",      "from_addr":"ул. Немига 12б",        "to_addr":"ул. Ложинская 18",
   "fallback_km":11.8,"fallback_min":24},
  {"id":"kuncevsh→pobedy", "from":[27.4687,53.9165],"to":[27.5722,53.9079],
   "label":"Кунцевщина→Победы", "from_addr":"ул. Матусевича 46",     "to_addr":"пр. Независимости 31A",
   "fallback_km":8.1, "fallback_min":18},
  {"id":"malinovka→cum",   "from":[27.4675,53.8500],"to":[27.5876,53.9145],
   "label":"Малиновка→ЦУМ",      "from_addr":"ул. Есенина 6/1",       "to_addr":"пр. Независимости 54",
   "fallback_km":12.3,"fallback_min":26},
  {"id":"vokzal→kamgorka", "from":[27.5497,53.8910],"to":[27.4561,53.9221],
   "label":"Вокзал→КамГорка",   "from_addr":"Привокзальная пл. 3",   "to_addr":"ул. Аладовых 13",
   "fallback_km":8.7, "fallback_min":20},
  {"id":"pobedy→moskovsk", "from":[27.5722,53.9079],"to":[27.6193,53.9343],
   "label":"Победы→Московская", "from_addr":"пр. Независимости 31A", "to_addr":"ул. Волгоградская 23",
   "fallback_km":6.4, "fallback_min":15},
]

TARIFFS = {
    "econom":      {"base": 2.00, "per_km": 0.78, "per_min": 0.20, "min": 3.0},
    "business":    {"base": 3.00, "per_km": 0.95, "per_min": 0.25, "min": 4.0},
    "comfortplus": {"base": 3.50, "per_km": 1.10, "per_min": 0.28, "min": 5.0},
    "vip":         {"base": 5.00, "per_km": 1.50, "per_min": 0.40, "min": 8.0},
}

MOBILE_UA = (
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) "
    "AppleWebKit/605.1.15 (KHTML, like Gecko) "
    "Version/18.5 Mobile/15E148 Safari/604.1"
)
MSK = timezone(timedelta(hours=3))

CHROME_PATHS = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
]

# ─── минимальный WebSocket клиент (без pip) ───────────────────────────────────
def _ws_handshake(s, host, port, path):
    key = base64.b64encode(os.urandom(16)).decode()
    s.send((
        f"GET {path} HTTP/1.1\r\n"
        f"Host: {host}:{port}\r\n"
        f"Upgrade: websocket\r\nConnection: Upgrade\r\n"
        f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n"
    ).encode())
    buf = b""
    while b"\r\n\r\n" not in buf:
        buf += s.recv(512)

def _ws_send(s, msg):
    data = msg.encode()
    mask = os.urandom(4)
    masked = bytes(b ^ mask[i % 4] for i, b in enumerate(data))
    n = len(data)
    hdr = bytes([0x81, 0x80 | n]) if n < 126 else bytes([0x81, 0xFE, n >> 8, n & 0xFF])
    s.sendall(hdr + mask + masked)

def _ws_recv(s, timeout=10):
    s.settimeout(timeout)
    b2 = s.recv(2)
    length = b2[1] & 0x7F
    if length == 126:
        length = struct.unpack(">H", s.recv(2))[0]
    elif length == 127:
        length = struct.unpack(">Q", s.recv(8))[0]
    data = b""
    while len(data) < length:
        chunk = s.recv(length - len(data))
        if not chunk:
            break
        data += chunk
    return json.loads(data)

def cdp_get_cookies():
    """Читает куки из запущенного Chrome через CDP WebSocket."""
    try:
        raw = urllib.request.urlopen("http://localhost:9222/json", timeout=3).read()
        tabs = json.loads(raw)
    except Exception as e:
        return None, f"CDP недоступен: {e}"

    # ищем вкладку taxi.yandex.by, иначе первую
    tab = next((t for t in tabs if "taxi.yandex" in t.get("url", "")), tabs[0] if tabs else None)
    if not tab:
        return None, "нет открытых вкладок"

    ws_url = tab.get("webSocketDebuggerUrl", "")
    # ws://localhost:9222/devtools/page/...
    path = ws_url.split("localhost:9222", 1)[-1]

    s = socket.socket()
    s.connect(("localhost", 9222))
    _ws_handshake(s, "localhost", 9222, path)

    _ws_send(s, json.dumps({"id": 1, "method": "Network.getAllCookies"}))
    resp = _ws_recv(s, timeout=8)
    s.close()

    all_cookies = resp.get("result", {}).get("cookies", [])
    yandex = {c["name"]: c["value"]
              for c in all_cookies
              if any(d in c.get("domain", "") for d in ["yandex.by", "yandex.ru"])}
    return yandex, None

def find_chrome():
    for p in CHROME_PATHS:
        if os.path.exists(p):
            return p
    # попробуем через which
    for name in ["google-chrome", "chromium", "chromium-browser"]:
        try:
            r = subprocess.run(["which", name], capture_output=True, text=True)
            if r.stdout.strip():
                return r.stdout.strip()
        except:
            pass
    return None

# ─── авторизация ──────────────────────────────────────────────────────────────
def load_auth():
    if os.path.exists(AUTH_FILE):
        try: return json.load(open(AUTH_FILE, encoding="utf-8"))
        except: return None

def save_auth(d):
    with open(AUTH_FILE, "w", encoding="utf-8") as f:
        json.dump(d, f, ensure_ascii=False, indent=2)
    os.chmod(AUTH_FILE, 0o600)

def setup_auth_auto():
    """Полностью автоматическое получение кук через Chrome CDP."""
    chrome = find_chrome()
    if not chrome:
        print("  Chrome не найден — используем ручной ввод.")
        return setup_auth_manual()

    print(f"\n  Запускаю Chrome (постоянный профиль {CHROME_DIR}) …")
    proc = subprocess.Popen(
        [
            chrome,
            "--remote-debugging-port=9222",
            f"--user-data-dir={CHROME_DIR}",
            "--no-first-run",
            "--no-default-browser-check",
            "--disable-background-networking",
            "https://taxi.yandex.by",
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    print("  Chrome открыт. Войди в Яндекс Go если нужно.")
    print("  Когда войдёшь — нажми Enter здесь …")
    input()

    print("  Читаю куки через CDP …", end=" ", flush=True)
    # небольшая задержка чтобы страница загрузилась
    time.sleep(2)
    cookies, err = cdp_get_cookies()
    proc.terminate()

    if err or not cookies:
        print(f"ошибка ({err})")
        return setup_auth_manual()

    if "Session_id" not in cookies:
        print(f"нет Session_id ({len(cookies)} кук: {list(cookies.keys())[:5]})")
        print("  Попробуй войти в аккаунт Яндекс в открытом окне.")
        print("  Или используй ручной ввод куки.")
        return setup_auth_manual()

    print(f"OK ({len(cookies)} кук, Session_id={cookies['Session_id'][:8]}…)")
    auth = {"cookies": cookies}
    save_auth(auth)
    print(f"  ✅ Сохранено в {AUTH_FILE}")
    return auth

def setup_auth_manual():
    """Ручной ввод строки cookie из Network tab."""
    while True:
        print()
        print("━"*58)
        print("🍪  Вставь строку Cookie из DevTools → Сеть (Network)")
        print("━"*58)
        print("""
  ⚠  ВАЖНО: нужна строка из ЗАПРОСА (Request Headers),
     НЕ из ответа (Response Headers / set-cookie)!

  Правильная строка выглядит так:
    gdpr=0; yandexuid=123456; Session_id=3:xxxx...; ...
  Неправильная (Set-Cookie из ответа):
    _yasc=xxx; Domain=.yandex.net; Path=/; Expires=...

  Шаги:
  1. Открой taxi.yandex.by в браузере
  2. DevTools (Cmd+Option+I) → вкладка «Сеть» (Network)
  3. В поле фильтра введи:  ya-authproxy
  4. Обнови страницу: Cmd+R
  5. Кликни на ЛЮБОЙ запрос к ya-authproxy со статусом 200
  6. Справа → раздел «ЗАГОЛОВКИ ЗАПРОСА» (Request Headers)
     (не «Response Headers»!)
  7. Найди строку  cookie  → Правая кнопка → «Копировать значение»
""")
        cookie_str = input("Вставь cookie: ").strip()
        if not cookie_str or "=" not in cookie_str:
            print("❌ Пусто. Попробуй ещё раз.")
            continue
        # Определяем что вставили Set-Cookie из ответа
        response_markers = ["Domain=", "Path=/", "Expires=", "HttpOnly", "SameSite=", "Secure"]
        parts_raw = [p.strip() for p in cookie_str.split(";")]
        response_like = sum(1 for p in parts_raw if any(p.startswith(m) for m in response_markers))
        if response_like >= 2:
            print()
            print("❌ Это строка из ОТВЕТА сервера (Set-Cookie), а нужна из ЗАПРОСА.")
            print("   Смотри раздел «Заголовки запроса» (Request Headers), не Response.")
            print("   Правильная строка содержит много параметров через ';' без Domain/Path/Expires.")
            continue
        cookies = {}
        for part in parts_raw:
            if "=" in part:
                k, v = part.split("=", 1)
                ck, cv = k.strip(), v.strip()
                if ck not in response_markers:
                    cookies[ck] = cv
        if len(cookies) < 3:
            print(f"❌ Слишком мало кук ({len(cookies)} шт.). Попробуй ещё раз.")
            continue
        if "Session_id" not in cookies:
            print(f"⚠  Нет Session_id ({len(cookies)} кук: {list(cookies.keys())[:6]})")
            print("   Без Session_id получим только тарифные минималки, не цены маршрутов.")
            print("   Продолжить с этими куками? (y/Enter = да, n = попробовать снова)")
            ans = input("> ").strip().lower()
            if ans == "n":
                continue
        break
    print("\nОпционально — x-yataxi-userid из того же запроса (Enter = пропустить):")
    uid = input("> ").strip()
    auth = {"cookies": cookies}
    if uid: auth["x_yataxi_userid"] = uid
    save_auth(auth)
    print(f"\n✅ Сохранено в {AUTH_FILE}")
    return auth

def get_auth():
    if RESET:
        for f in [AUTH_FILE]:
            if os.path.exists(f): os.remove(f)
        print("🗑  Авторизация сброшена.")
        sys.exit(0)
    # --cron: никакого Chrome, никакого ввода — только анонимный режим
    if CRON:
        return {"cookies": {}}
    auth = load_auth()
    if auth:
        if "Session_id" not in auth.get("cookies", {}):
            print("\n⚠  Сохранённые куки без Session_id — пробуем обновить через Chrome …")
            return setup_auth_auto()
        return auth
    # первый запуск — пробуем автоматически
    print("\n🔐 Первый запуск — нужна авторизация Яндекс Go.")
    print("   Попробуем автоматически через Chrome …")
    return setup_auth_auto()

def refresh_cookies_if_needed(auth):
    """Если Chrome с профилем запущен — обновляем куки автоматически."""
    try:
        cookies, err = cdp_get_cookies()
        if not err and cookies and "Session_id" in cookies:
            auth["cookies"] = cookies
            save_auth(auth)
            print(f"🔄 Куки обновлены автоматически ({len(cookies)} шт.)")
    except Exception:
        pass  # CDP недоступен (Chrome закрыт) — используем сохранённые куки
    return auth

# ─── HTTP helpers ─────────────────────────────────────────────────────────────
def req(url, data=None, headers=None, cookies=None, timeout=20):
    h = {"User-Agent": MOBILE_UA, "Accept-Language": "ru-RU,ru;q=0.9",
         "Accept": "application/json, text/plain, */*"}
    if headers: h.update(headers)
    if cookies:
        h["Cookie"] = ("; ".join(f"{k}={v}" for k,v in cookies.items())
                       if isinstance(cookies, dict) else str(cookies))
    body = json.dumps(data).encode() if data is not None else None
    r = urllib.request.Request(url, data=body, headers=h,
                               method="POST" if data is not None else "GET")
    with urllib.request.urlopen(r, timeout=timeout) as resp:
        return resp.read(), resp.headers.get_all("Set-Cookie") or []

def parse_cookies(sc):
    out = {}
    for s in sc:
        p = s.split(";")[0].strip()
        if "=" in p:
            k, v = p.split("=", 1)
            out[k.strip()] = v.strip()
    return out

def parse_price(s):
    if not s: return None
    import re
    m = re.search(r"(\d+(?:[.,]\d+)?)", str(s))
    return float(m.group(1).replace(",", ".")) if m else None

def tg(text):
    body = json.dumps({"chat_id": CHAT_ID, "text": text[:4000], "parse_mode": "HTML"}).encode()
    r = urllib.request.Request(
        f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage",
        data=body, headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(r, timeout=15): pass
    except Exception as e:
        print(f"  ⚠ Telegram: {e}")

# ─── Расстояния (захардкожены — фиксированные маршруты, OSRM не нужен) ────────
# Значения получены от OSRM и верифицированы вручную.
ROUTE_DIST = {
    "vokzal→arena":    {"km": 8.55,  "min": 13.0},
    "nemiga→uruchye":  {"km": 13.17, "min": 19.0},
    "kuncevsh→pobedy": {"km": 9.40,  "min": 14.0},
    "malinovka→cum":   {"km": 12.37, "min": 18.0},
    "vokzal→kamgorka": {"km": 9.01,  "min": 12.0},
    "pobedy→moskovsk": {"km": 5.50,  "min": 8.0},
}

def get_distances():
    if not CRON:
        print("\n[0/3] Расстояния (кэш) … OK 6/6")
    return {rid: dict(d) for rid, d in ROUTE_DIST.items()}

# ─── surge ────────────────────────────────────────────────────────────────────
def base_price(cls, km, mn):
    t = TARIFFS.get(cls, TARIFFS["econom"])
    return max(t["base"] + t["per_km"] * km + t["per_min"] * mn, t["min"])

def surge(actual, cls, km, mn):
    bp = base_price(cls, km, mn)
    return round(actual / bp, 2) if bp else None

def surge_tag(s):
    if s is None: return ""
    if s < 1.05:  return " ✅x1.0"
    if s < 1.20:  return f" 🟡x{s}"
    if s < 1.50:  return f" 🟠x{s}"
    return             f" 🔴x{s}"

# ─── main ─────────────────────────────────────────────────────────────────────
def main():
    print("━"*52)
    print("🚕  rwbtaxi-price-probe — Яндекс Go Минск")
    print("    + surge multiplier (обратный расчёт)")
    if DEBUG: print("⚙  РЕЖИМ ОТЛАДКИ")
    print("━"*52)

    auth    = get_auth()

    # Попробуем обновить куки если Chrome CDP доступен
    auth    = refresh_cookies_if_needed(auth)

    cookies = auth.get("cookies", {})
    userid  = auth.get("x_yataxi_userid", "")
    has_sid = "Session_id" in cookies
    print(f"🔑 Куки: {len(cookies)} шт." + (" ✅ Session_id" if has_sid else " ⚠ без Session_id"))

    dist = get_distances()

    base_url = "https://ya-authproxy.taxi.yandex.by"
    origin   = "https://taxi.yandex.by"

    # CSRF
    print(f"\n[1/3] CSRF токен …", end=" ", flush=True)
    try:
        h = {"Content-Type": "application/json", "Origin": origin, "Referer": origin + "/",
             "X-Requested-With": "XMLHttpRequest",
             "X-Taxi": f"{MOBILE_UA} turboapp_taxi"}
        if userid: h["X-YaTaxi-UserId"] = userid
        raw, sc2 = req(f"{base_url}/csrf_token", data={}, headers=h, cookies=cookies)
        cookies.update(parse_cookies(sc2))
        csrf = json.loads(raw).get("sk", "")
        if not csrf: raise ValueError("пустой sk")
        print(f"OK (sk={csrf[:8]}…)")
    except Exception as e:
        print(f"❌ {e}")
        print("\nКуки устарели. Сбрось: python3 rwbtaxi-price-probe.py --reset")
        sys.exit(1)

    # Маршруты
    print(f"\n[2/3] Цены по {len(ROUTES)} маршрутам …")
    print(f"  {'маршрут':18s}  {'Эконом':>8}  {'Комфорт':>8}  {'surge E':>8}  {'surge K':>8}  {'км':>5}")
    print("  " + "─"*65)

    # Куки без Session_id — для fallback на анонимный режим (даёт минимальные тарифы)
    cookies_anon = {k: v for k, v in cookies.items()
                    if k not in ("Session_id", "sessionid2", "Session_id_nossl")}

    results = []
    first_dbg = False
    used_anon = False  # флаг: пришлось ли перейти в анонимный режим

    for r in ROUTES:
        try:
            body = {
                "route": [r["from"], r["to"]], "selected_class": "",
                "format_currency": True, "requirements": {"coupon": ""},
                "summary_version": 2, "is_lightweight": False, "supports_paid_options": True,
                "tariff_requirements": [
                    {"class": c, "requirements": {"coupon": ""}}
                    for c in ["econom", "business", "comfortplus", "vip"]
                ],
            }
            h = {"Content-Type": "application/json", "Origin": origin,
                 "Referer": origin + "/", "X-Requested-With": "XMLHttpRequest",
                 "X-Csrf-Token": csrf, "X-Taxi": f"{MOBILE_UA} turboapp_taxi"}
            if userid: h["X-YaTaxi-UserId"] = userid

            # Пробуем сначала с Session_id, при 401 — без него (анонимный)
            try:
                raw, _ = req(f"{base_url}/3.0/routestats", data=body, headers=h, cookies=cookies)
            except Exception as e401:
                if "401" in str(e401) and not used_anon:
                    used_anon = True
                    print(f"  ⚠ 401 с Session_id → переходим в анонимный режим")
                if "401" in str(e401):
                    raw, _ = req(f"{base_url}/3.0/routestats", data=body, headers=h, cookies=cookies_anon)
                else:
                    raise
            data = json.loads(raw)

            if DEBUG and not first_dbg:
                first_dbg = True
                print(f"\n=== JSON «{r['label']}» ===")
                print(json.dumps(data, ensure_ascii=False, indent=2))
                print("=== END ===\n")

            levels = data.get("service_levels", [])
            alts = data.get("alternatives", {})
            alt_opts = (alts.get("options") or []) if isinstance(alts, dict) else []
            alt_p = {}
            for opt in alt_opts:
                cls = opt.get("class") or opt.get("tariff_class") or ""
                p   = parse_price(opt.get("price") or opt.get("total_price"))
                if cls and p: alt_p[cls] = p

            def best(classes):
                for c in classes:
                    if c in alt_p: return alt_p[c], c
                for sl in levels:
                    if sl.get("class") in classes:
                        p = parse_price(sl.get("price"))
                        if p: return p, sl["class"]
                return None, None

            ep, ec = best(["econom"])
            bp, bc = best(["business", "comfortplus", "vip"])

            rd   = dist[r["id"]]
            km_v = rd["km"]; mn_v = rd["min"]
            se   = surge(ep, ec or "econom",   km_v, mn_v) if ep else None
            sb   = surge(bp, bc or "business", km_v, mn_v) if bp else None

            e_s  = f"{ep:.1f}р" if ep else "—"
            b_s  = f"{bp:.1f}р" if bp else "—"
            print(f"  {r['label']:18s}  {e_s:>8}  {b_s:>8}  {f'x{se}':>8}  {f'x{sb}':>8}  {km_v:>5}")
            results.append({**r, "econom": ep, "business": bp,
                            "surge_econom": se, "surge_business": sb,
                            "km": km_v, "minutes": mn_v,
                            "has_route_price": bool(alt_p)})
            time.sleep(0.3)
        except Exception as e:
            print(f"  ✗ {r['label']}: {e}")
            results.append({**r, "error": str(e)})

    n_ok  = sum(1 for x in results if x.get("econom") or x.get("business"))
    n_rt  = sum(1 for x in results if x.get("has_route_price"))
    surges = [x["surge_econom"] for x in results if x.get("surge_econom")]
    avg_s = round(sum(surges) / len(surges), 2) if surges else None

    print(f"\n  Итого: {n_ok}/{len(ROUTES)}  |  {n_rt} маршрутных цен")
    if avg_s:
        print(f"  Средний surge Эконом: {surge_tag(avg_s).strip()}")

    if DEBUG:
        print("\n⚙ Отладка — отправка пропущена.")
        input("Enter для выхода…")
        return

    # Отправка на сервер
    if not CRON:
        print("\n[3/3] Отправка …", end=" ", flush=True)
    sent_ok = False
    try:
        rb = json.dumps({"routes": results}).encode()
        probe_secret = os.environ.get("PROBE_SECRET", "")
        probe_headers = {"Content-Type": "application/json", "Origin": origin}
        if probe_secret:
            probe_headers["x-screens-token"] = probe_secret
        r2 = urllib.request.Request(PROBE_URL, data=rb,
            headers=probe_headers, method="POST")
        with urllib.request.urlopen(r2, timeout=15) as resp:
            resp_body = json.loads(resp.read())
            if not CRON:
                print(f"OK → {resp_body}")
            sent_ok = True
    except Exception as e:
        if not CRON:
            print(f"ошибка ({e})")

    # Telegram:
    #  - интерактив: только если сервер недоступен
    #  - cron: только если surge заметный (≥1.2) или сервер недоступен → нет спама
    surge_notable = avg_s is not None and avg_s >= 1.2
    send_tg = (not sent_ok) or (CRON and surge_notable)
    if send_tg:
        ts = datetime.now(MSK).strftime("%d.%m.%Y %H:%M МСК")
        rt_flag = "📍 маршрутные цены" if n_rt else "📋 минималки"
        lines = [f"🚕 <b>Яндекс Go — Минск</b>  🕐 {ts}  {rt_flag}\n"]
        for x in results:
            if not (x.get("econom") or x.get("business")): continue
            e  = f"🟡{x['econom']:.1f}р"   if x.get("econom")   else "🟡—"
            b  = f"🟠{x['business']:.1f}р" if x.get("business") else "🟠—"
            st = surge_tag(x.get("surge_econom"))
            lines.append(f"<b>{x['label']}</b>  {e}  {b}{st}")
        if avg_s: lines.append(f"\n📊 Средний surge: <b>{surge_tag(avg_s).strip()}</b>")
        lines.append(f"✅ {n_ok}/{len(ROUTES)}")
        tg("\n".join(lines))

    if not CRON:
        print("\n✅ Готово! Проверь Telegram.")
        input("Enter для выхода…")

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nОтменено.")
