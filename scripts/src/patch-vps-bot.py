#!/usr/bin/env python3
"""Патч: добавляет Excel-генерацию и send_document в rwbtaxi-tg-bot.py."""
import sys

BOT_PATH = '/usr/local/bin/rwbtaxi-tg-bot.py'

with open(BOT_PATH, 'r') as f:
    src = f.read()

# Бэкап
with open(BOT_PATH + '.bak2', 'w') as f:
    f.write(src)

# ─── 1. Добавляем импорты ────────────────────────────────────────────────────
OLD_IMPORTS = 'import json, html, os, sys, glob, time, math, urllib.request, urllib.parse, traceback'
NEW_IMPORTS = (
    'import json, html, os, sys, glob, time, math, urllib.request, urllib.parse, traceback\n'
    'import io, uuid\n'
    'try:\n'
    '    import openpyxl\n'
    '    from openpyxl.styles import PatternFill, Font, Alignment\n'
    '    from openpyxl.utils import get_column_letter\n'
    '    HAS_OPENPYXL = True\n'
    'except ImportError:\n'
    '    HAS_OPENPYXL = False'
)
assert OLD_IMPORTS in src, "Не найдена строка импортов"
src = src.replace(OLD_IMPORTS, NEW_IMPORTS, 1)

# ─── 2. Вставляем Excel-функции перед # ─── /прогноз ───────────────────────
EXCEL_CODE = r'''
def send_document(chat_id, file_bytes, filename,
                  mime='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'):
    """Отправить файл через multipart/form-data."""
    boundary = uuid.uuid4().hex
    CRLF = b'\r\n'
    parts = []
    def field(name, value):
        parts.append(('--' + boundary).encode())
        parts.append(('Content-Disposition: form-data; name="' + name + '"').encode())
        parts.append(b'')
        parts.append(str(value).encode())
    def file_part(name, fname, data, ct):
        parts.append(('--' + boundary).encode())
        parts.append(('Content-Disposition: form-data; name="' + name + '"; filename="' + fname + '"').encode())
        parts.append(('Content-Type: ' + ct).encode())
        parts.append(b'')
        parts.append(data)
    field('chat_id', chat_id)
    file_part('document', filename, file_bytes, mime)
    parts.append(('--' + boundary + '--').encode())
    body = CRLF.join(parts)
    url = f'https://api.telegram.org/bot{BOT_TOKEN}/sendDocument'
    rq = urllib.request.Request(
        url, data=body,
        headers={'Content-Type': f'multipart/form-data; boundary={boundary}'})
    with urllib.request.urlopen(rq, timeout=60) as r:
        return json.loads(r.read())


# ── Тарифные константы v4/v5 (синхронизировано с zones.ts) ──────────────
_TYPE_BASELINE = {
    'center': 1.26, 'sleeper': 0.83, 'mall': 1.36,
    'transport-hub': 0.94, 'premium': 1.33, 'industrial': 0.66,
}
_ZONE_RU = {
    'center': 'Центр', 'sleeper': 'Спальник', 'mall': 'ТЦ/Молл',
    'transport-hub': 'Вокзал', 'premium': 'Премиум', 'industrial': 'Промзона',
}
_TIME_MULT = {
    'center':       {'weekday': {'night':0.64,'morning':1.21,'midday':1.00,'evening':1.36,'late':1.07},
                     'saturday':{'night':0.71,'morning':0.79,'midday':1.07,'evening':1.43,'late':1.21},
                     'sunday':  {'night':0.64,'morning':0.71,'midday':1.00,'evening':1.29,'late':1.07}},
    'sleeper':      {'weekday': {'night':0.73,'morning':2.09,'midday':1.00,'evening':1.91,'late':1.18},
                     'saturday':{'night':0.82,'morning':0.91,'midday':1.27,'evening':1.82,'late':1.36},
                     'sunday':  {'night':0.73,'morning':0.82,'midday':1.18,'evening':1.55,'late':1.27}},
    'mall':         {'weekday': {'night':0.47,'morning':0.59,'midday':1.00,'evening':1.29,'late':0.94},
                     'saturday':{'night':0.53,'morning':0.65,'midday':1.41,'evening':1.18,'late':1.00},
                     'sunday':  {'night':0.47,'morning':0.59,'midday':1.35,'evening':1.12,'late':0.88}},
    'transport-hub':{'weekday': {'night':0.71,'morning':1.06,'midday':1.00,'evening':1.12,'late':0.94},
                     'saturday':{'night':0.65,'morning':0.82,'midday':1.00,'evening':1.18,'late':0.94},
                     'sunday':  {'night':0.65,'morning':0.82,'midday':1.00,'evening':1.12,'late':0.94}},
    'premium':      {'weekday': {'night':0.71,'morning':1.14,'midday':1.00,'evening':1.43,'late':1.07},
                     'saturday':{'night':0.71,'morning':0.79,'midday':1.07,'evening':1.43,'late':1.21},
                     'sunday':  {'night':0.64,'morning':0.71,'midday':1.00,'evening':1.29,'late':1.07}},
    'industrial':   {'weekday': {'night':0.64,'morning':1.55,'midday':1.00,'evening':1.55,'late':0.91},
                     'saturday':{'night':0.73,'morning':0.91,'midday':1.27,'evening':1.82,'late':1.09},
                     'sunday':  {'night':0.64,'morning':0.73,'midday':1.00,'evening':1.27,'late':1.00}},
}
_SLOT_KEYS = ['night','morning','midday','evening','late']
_SLOT_RU   = {'night':'Ночь (00-06)','morning':'Утро (06-10)',
               'midday':'День (10-15)','evening':'Вечер (15-22)','late':'Поздно (22-00)'}
_ECON    = {'pickup':5.567,'perKm':0.503,'perMin':0.209,'minimum':6.40}
_CMF_MIN = 9.10
_BY_HOLIDAYS = {
    '01-01':'Новый год','01-07':'Рождество православное','03-08':'День женщин',
    '03-15':'День Конституции','05-01':'День труда','05-09':'День Победы',
    '07-03':'День Независимости','11-07':'День Октябрьской революции',
    '12-25':'Рождество католическое',
}
_RADUNICA = {'2026':'04-21','2027':'05-11','2028':'04-25','2029':'04-17'}

def _get_holiday(d):
    mmdd = d.strftime('%m-%d')
    if _RADUNICA.get(str(d.year)) == mmdd:
        return 'Радуница'
    return _BY_HOLIDAYS.get(mmdd)

def _day_type(d, holiday):
    if holiday:        return 'sunday'
    if d.weekday()==6: return 'sunday'
    if d.weekday()==5: return 'saturday'
    return 'weekday'

def _wx_mod(wx_hourly):
    if not wx_hourly: return 0.0
    max_prec = max(w['precip'] for w in wx_hourly)
    max_snow = max(w['snow']   for w in wx_hourly)
    max_wind = max(w['wind']   for w in wx_hourly)
    mod = 0.0
    if   max_snow > 0.5:  mod = 0.30
    elif max_snow > 0.1:  mod = 0.20
    elif max_prec > 5.0:  mod = 0.18
    elif max_prec > 1.0:  mod = 0.12
    elif max_prec > 0.3:  mod = 0.08
    if max_wind > 15: mod += 0.10
    elif max_wind > 10: mod += 0.05
    return min(mod, 0.50)

def _wx_label(wx_hourly):
    if not wx_hourly: return ('?', 'нет данных')
    max_snow = max(w['snow']  for w in wx_hourly)
    max_prec = max(w['precip'] for w in wx_hourly)
    max_wind = max(w['wind']  for w in wx_hourly)
    if max_snow > 0.5: return ('❄️', f'Снег, ветер {max_wind:.0f} км/ч')
    if max_prec > 5.0: return ('🌧', 'Сильный дождь')
    if max_prec > 1.0: return ('🌦', 'Дождь')
    if max_prec > 0.3: return ('🌦', 'Морось')
    if max_wind > 10:  return ('💨', f'Ясно, ветер {max_wind:.0f} км/ч')
    return ('☀️', 'Ясно')

def _surge_fill(s):
    if s >= 2.5: return PatternFill('solid', fgColor='FFD6D6')
    if s >= 1.5: return PatternFill('solid', fgColor='FFF3CC')
    if s >= 1.0: return PatternFill('solid', fgColor='FFF0C8')
    return PatternFill('solid', fgColor='D6FFE8')

def build_forecast_excel():
    """Генерирует 7-дневный Excel-прогноз, возвращает bytes или None."""
    if not HAS_OPENPYXL:
        return None
    # Погода на 8 дней (hourly, Open-Meteo)
    try:
        url = (f'https://api.open-meteo.com/v1/forecast'
               f'?latitude={MINSK_LAT}&longitude={MINSK_LON}'
               '&hourly=temperature_2m,precipitation,snowfall,weathercode,windspeed_10m'
               '&forecast_days=8&timezone=Europe%2FMinsk')
        with urllib.request.urlopen(url, timeout=10) as r:
            raw_wx = json.loads(r.read())
        hourly = raw_wx['hourly']
    except Exception:
        hourly = None

    from datetime import date as _date, timedelta as _td
    now_msk = datetime.now(MSK)
    today   = now_msk.date()

    days = []
    for i in range(1, 8):
        d       = today + _td(days=i)
        holiday = _get_holiday(d)
        dtype   = _day_type(d, holiday)
        dlabel  = {'weekday':'Будни','saturday':'Суббота','sunday':'Вс/Праздник'}[dtype]
        dnames  = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс']
        label   = f"{d.strftime('%d.%m')} {dnames[d.weekday()]}"
        if holiday: label += f' ({holiday})'

        wx_day = []
        if hourly:
            for idx, t in enumerate(hourly['time']):
                if t.startswith(d.isoformat()):
                    wx_day.append({'hour':int(t[11:13]),
                                   'precip':hourly['precipitation'][idx],
                                   'snow':hourly['snowfall'][idx],
                                   'wcode':hourly['weathercode'][idx],
                                   'wind':hourly['windspeed_10m'][idx]})
        wmod          = _wx_mod(wx_day)
        wx_emoji, wx_desc = _wx_label(wx_day)

        reasons = []
        if holiday:          reasons.append(f'праздник — {holiday}')
        if dtype=='saturday': reasons.append('суббота — повышенный вечерний спрос')
        if dtype=='sunday':   reasons.append('воскресенье — низкий деловой трафик')
        if wmod >= 0.25:      reasons.append(f'сильные осадки (+{round(wmod*100)}% surge)')
        elif wmod >= 0.10:    reasons.append(f'осадки (+{round(wmod*100)}% surge)')
        elif wmod >= 0.05:    reasons.append(f'ветер (+{round(wmod*100)}% surge)')
        if not reasons:       reasons.append('стандартный день')

        surges = {}
        for z in _TYPE_BASELINE:
            surges[z] = {s: round(_TYPE_BASELINE[z]*_TIME_MULT[z][dtype][s]*(1+wmod),3)
                         for s in _SLOT_KEYS}

        days.append({'label':label,'dtype':dtype,'dlabel':dlabel,
                     'holiday':holiday,'wx_emoji':wx_emoji,'wx_desc':wx_desc,
                     'wmod':wmod,'reasons':'; '.join(reasons),'surges':surges})

    wb  = openpyxl.Workbook()
    HDR = {'fill': PatternFill('solid', fgColor='1E3A5F'),
           'font': Font(bold=True, color='FFFFFF', size=11),
           'alignment': Alignment(horizontal='center', vertical='center', wrap_text=True)}

    def apply_hdr(cell):
        for k, v in HDR.items(): setattr(cell, k, v)

    ZONES_SHOW = ['center','sleeper','mall']
    SLOTS_SHOW = ['morning','midday','evening']
    slot_sh    = {'morning':'Утро','midday':'День','evening':'Вечер'}

    # ── Лист 1 ──────────────────────────────────────────────────────────────
    ws1 = wb.active; ws1.title = 'Прогноз на неделю'
    ws1.freeze_panes = 'A4'
    ws1.append(['RWBTaxi · Прогноз тарифов Yandex Go Минск · v4/v5'])
    ws1.merge_cells('A1:O1')
    ws1['A1'].font = Font(bold=True, size=14, color='1E3A5F')
    ws1.row_dimensions[1].height = 26
    ts = now_msk.strftime('%d.%m.%Y %H:%M')
    ws1.append([f'Сформировано: {ts} МСК · Якорь: будни·полдень = x1.00 · Тариф v4/v5'])
    ws1.merge_cells('A2:O2')
    ws1['A2'].font = Font(italic=True, size=9, color='555555')
    ws1.row_dimensions[2].height = 14
    hdr1 = ['Дата / День','Тип','Погода','Причины surge']
    for z in ZONES_SHOW:
        for s in SLOTS_SHOW:
            hdr1.append(f'{_ZONE_RU[z]}\n{slot_sh[s]}')
    ws1.append(hdr1)
    ws1.row_dimensions[3].height = 44
    for c in ws1[3]: apply_hdr(c)
    ws1.column_dimensions['A'].width = 22
    ws1.column_dimensions['B'].width = 12
    ws1.column_dimensions['C'].width = 28
    ws1.column_dimensions['D'].width = 38
    for ci in range(5, 5+len(ZONES_SHOW)*len(SLOTS_SHOW)):
        ws1.column_dimensions[get_column_letter(ci)].width = 10

    for d in days:
        row = [d['label'], d['dlabel'], f"{d['wx_emoji']} {d['wx_desc']}", d['reasons']]
        for z in ZONES_SHOW:
            for s in SLOTS_SHOW:
                row.append(f"{d['surges'][z][s]:.2f}x")
        ws1.append(row)
        ri = ws1.max_row; ws1.row_dimensions[ri].height = 20
        if d['holiday']:
            for col in ['A','B','C','D']:
                ws1[f'{col}{ri}'].fill = PatternFill('solid', fgColor='FFF0D0')
        ci = 5
        for z in ZONES_SHOW:
            for s in SLOTS_SHOW:
                sv = d['surges'][z][s]
                cell = ws1.cell(ri, ci)
                cell.fill = _surge_fill(sv)
                cell.alignment = Alignment(horizontal='center')
                if sv >= 1.5: cell.font = Font(bold=True)
                ci += 1
    ws1.append([])
    leg_row = ws1.max_row + 1
    ws1.append(['Легенда: surge <1.0=зелёный · 1.0-1.5=жёлтый · 1.5-2.5=оранжевый · >=2.5=красный'])
    ws1.merge_cells(f'A{leg_row}:O{leg_row}')
    ws1.cell(leg_row, 1).font = Font(italic=True, size=9)

    # ── Лист 2: Детали по зонам ─────────────────────────────────────────────
    ws2 = wb.create_sheet('Детали по зонам'); ws2.freeze_panes = 'C2'
    ws2.append(['Зона','Слот'] + [d['label'] for d in days])
    ws2.row_dimensions[1].height = 36
    for c in ws2[1]: apply_hdr(c)
    ws2.column_dimensions['A'].width = 20
    ws2.column_dimensions['B'].width = 18
    for ci in range(3, 3+len(days)):
        ws2.column_dimensions[get_column_letter(ci)].width = 13
    for z in _TYPE_BASELINE:
        for si, slot in enumerate(_SLOT_KEYS):
            row2 = [_ZONE_RU[z] if si==0 else '', _SLOT_RU[slot]]
            row2 += [round(d['surges'][z][slot], 2) for d in days]
            ws2.append(row2)
            ri2 = ws2.max_row; ws2.row_dimensions[ri2].height = 18
            if si==0: ws2.cell(ri2,1).font = Font(bold=True, color='1E3A5F')
            for di, d in enumerate(days):
                c2 = ws2.cell(ri2, di+3)
                c2.fill      = _surge_fill(d['surges'][z][slot])
                c2.alignment = Alignment(horizontal='center')
                c2.number_format = '0.00'
        ws2.append([])

    # ── Лист 3: Цены 5км/12мин ──────────────────────────────────────────────
    ws3 = wb.create_sheet('Цены 5км·12мин'); ws3.freeze_panes = 'C2'
    ws3.append(['Зона / Тариф','Слот'] + [d['label'] for d in days])
    ws3.row_dimensions[1].height = 36
    for c in ws3[1]: apply_hdr(c)
    ws3.column_dimensions['A'].width = 24
    ws3.column_dimensions['B'].width = 18
    for ci in range(3, 3+len(days)):
        ws3.column_dimensions[get_column_letter(ci)].width = 13
    baza_5_12 = _ECON['pickup'] + _ECON['perKm']*5 + _ECON['perMin']*12
    for z in _TYPE_BASELINE:
        for si, slot in enumerate(_SLOT_KEYS):
            rowC = [f"{_ZONE_RU[z]} · Комфорт" if si==0 else '', _SLOT_RU[slot]]
            rowC += [round(max(_CMF_MIN, _CMF_MIN*d['surges'][z][slot]), 2) for d in days]
            ws3.append(rowC)
            riC = ws3.max_row; ws3.row_dimensions[riC].height = 18
            if si==0: ws3.cell(riC,1).font = Font(bold=True, color='1E3A5F')
            for di, d in enumerate(days):
                c3 = ws3.cell(riC, di+3)
                c3.fill = _surge_fill(d['surges'][z][slot])
                c3.alignment = Alignment(horizontal='center')
                c3.number_format = '"BYN "0.00'
        for si, slot in enumerate(_SLOT_KEYS):
            rowE = [f"{_ZONE_RU[z]} · Эконом" if si==0 else '', _SLOT_RU[slot]]
            rowE += [round(max(_ECON['minimum'], baza_5_12*d['surges'][z][slot]), 2) for d in days]
            ws3.append(rowE)
            riE = ws3.max_row; ws3.row_dimensions[riE].height = 18
            for di, d in enumerate(days):
                c3e = ws3.cell(riE, di+3)
                c3e.fill = _surge_fill(d['surges'][z][slot])
                c3e.alignment = Alignment(horizontal='center')
                c3e.number_format = '"BYN "0.00'
        ws3.append([])

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()

'''

MARKER = '# \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 /\u043f\u0440\u043e\u0433\u043d\u043e\u0437 \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500'
assert MARKER in src, f"Маркер не найден: {repr(MARKER)}"
src = src.replace(MARKER, EXCEL_CODE + MARKER, 1)

# ─── 3. Обновляем cmd_forecast ───────────────────────────────────────────────
OLD_CMD = (
    'def cmd_forecast(chat_id):\n'
    '    try:\n'
    '        send(chat_id, build_forecast_message())\n'
    '    except Exception:\n'
    '        traceback.print_exc()\n'
    '        send(chat_id, "\u274c \u041e\u0448\u0438\u0431\u043a\u0430 \u043f\u0440\u0438 \u0444\u043e\u0440\u043c\u0438\u0440\u043e\u0432\u0430\u043d\u0438\u0438 \u043f\u0440\u043e\u0433\u043d\u043e\u0437\u0430")'
)
NEW_CMD = (
    'def cmd_forecast(chat_id):\n'
    '    try:\n'
    '        send(chat_id, build_forecast_message())\n'
    '    except Exception:\n'
    '        traceback.print_exc()\n'
    '        send(chat_id, "\u274c \u041e\u0448\u0438\u0431\u043a\u0430 \u043f\u0440\u0438 \u0444\u043e\u0440\u043c\u0438\u0440\u043e\u0432\u0430\u043d\u0438\u0438 \u043f\u0440\u043e\u0433\u043d\u043e\u0437\u0430")\n'
    '    try:\n'
    '        xls = build_forecast_excel()\n'
    '        if xls:\n'
    '            import datetime as _dt\n'
    '            fname = f"tariff-forecast-{_dt.date.today().isoformat()}.xlsx"\n'
    '            send_document(chat_id, xls, fname)\n'
    '    except Exception:\n'
    '        traceback.print_exc()\n'
    '        send(chat_id, "\u26a0\ufe0f Excel \u043d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0441\u0444\u043e\u0440\u043c\u0438\u0440\u043e\u0432\u0430\u0442\u044c")'
)
assert OLD_CMD in src, "cmd_forecast не найдена"
src = src.replace(OLD_CMD, NEW_CMD, 1)

with open(BOT_PATH, 'w') as f:
    f.write(src)

print('Патч применён успешно')
