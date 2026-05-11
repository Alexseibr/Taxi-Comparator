import { useState, useRef, useEffect } from "react";
import { Copy, Check, GripHorizontal } from "lucide-react";

const ROUTES = [
  {
    id: "vokzal→arena", label: "Вокзал→Арена", km: 8.55, min: 13,
    from: [27.5497, 53.8910], to: [27.6225, 53.9029],
    addrs: [
      ["Привокзальная площадь, 1",  "проспект Победителей, 111"],
      ["улица Свердлова, 17",        "проспект Победителей, 109"],
      ["улица Кирова, 16",           "улица Олимпийская, 14"],
    ],
  },
  {
    id: "nemiga→uruchye", label: "Немига→Уручье", km: 13.17, min: 19,
    from: [27.5485, 53.9028], to: [27.6810, 53.9509],
    addrs: [
      ["улица Немига, 12б",           "улица Ложинская, 18"],
      ["проспект Победителей, 21",    "улица Городецкая, 43"],
      ["улица Революционная, 19",     "улица Рокоссовского, 68"],
    ],
  },
  {
    id: "kuncevsh→pobedy", label: "Кунц.→Победы", km: 9.4, min: 14,
    from: [27.4687, 53.9165], to: [27.5722, 53.9079],
    addrs: [
      ["улица Матусевича, 46",        "проспект Независимости, 31А"],
      ["улица Матусевича, 34",        "проспект Независимости, 29"],
      ["улица Тимошенко, 28",         "улица Комсомольская, 1"],
    ],
  },
  {
    id: "malinovka→cum", label: "Малиновка→ЦУМ", km: 12.37, min: 18,
    from: [27.4675, 53.8500], to: [27.5876, 53.9145],
    addrs: [
      ["улица Есенина, 6",            "проспект Независимости, 54"],
      ["улица Малинина, 5",           "проспект Независимости, 44"],
      ["улица Одоевского, 93",        "улица Немига, 16"],
    ],
  },
  {
    id: "vokzal→kamgorka", label: "Вокзал→КамГорка", km: 9.01, min: 12,
    from: [27.5497, 53.8910], to: [27.4561, 53.9221],
    addrs: [
      ["Привокзальная площадь, 3",    "улица Аладовых, 13"],
      ["улица Кирова, 4",             "проспект Газеты Правда, 19"],
      ["улица Свердлова, 9",          "улица Лобанка, 99"],
    ],
  },
  {
    id: "pobedy→moskovsk", label: "Победы→Московская", km: 5.5, min: 8,
    from: [27.5722, 53.9079], to: [27.6193, 53.9343],
    addrs: [
      ["проспект Независимости, 31А", "улица Волгоградская, 23"],
      ["проспект Независимости, 37",  "улица Московская, 15"],
      ["проспект Независимости, 25",  "улица Якубовского, 12"],
    ],
  },
];

function buildBookmarklet(probeSecret = ""): string {
  const routes = JSON.stringify(ROUTES);
  const code = `(function(){
var ROUTES=${routes};
// Ротация адресов: при has_route_price=false меняем вариант адреса
var _AI='rwbtaxi_ai';
var _ai={};try{_ai=JSON.parse(localStorage.getItem(_AI)||'{}');}catch(e){}
ROUTES.forEach(function(r){
  var idx=(_ai[r.id]||0)%r.addrs.length;
  r.fa=r.addrs[idx][0];r.ta=r.addrs[idx][1];});

// === Маршруты из книжки (recommended) ===
// Читаем из rwbtaxi.by/api/screens/recommended — это те же адреса что показывает книжка.
// Добавляем их поверх фиксированных ROUTES. Координаты используем как есть (lat/lng из якорей).
var BOOK_ROUTES=[];
try{
  var cached=localStorage.getItem('rwbtaxi_book');
  if(cached){var p=JSON.parse(cached);if(p&&p.ts&&Date.now()-p.ts<300000)BOOK_ROUTES=p.routes||[];}
}catch(e){}

function px(v){
  if(v===null||v===undefined)return null;
  if(typeof v==='number')return v>0?v:null;
  var s=String(v).replace(/\\s/g,'').replace(',','.').replace(/[^\\d.]/g,'');
  var n=parseFloat(s);return(n>0&&n<9999)?n:null;}
function badge(html,color,ttl){
  var id='rwb_bm',el=document.getElementById(id);
  if(!el){el=document.createElement('div');el.id=id;
    el.style.cssText='position:fixed;top:16px;right:16px;z-index:2147483647;background:#0f172a;color:#f1f5f9;font:12px/1.5 monospace;padding:12px 16px;border-radius:12px;border:2px solid #475569;max-width:360px;word-break:break-word;box-shadow:0 8px 32px rgba(0,0,0,.7);cursor:pointer';
    el.onclick=function(){el.remove();};document.body.appendChild(el);}
  el.style.borderColor=color;el.innerHTML=html;
  clearTimeout(el._t);el._t=setTimeout(function(){if(el.parentNode)el.remove();},(ttl||10)*1000);}
if(window.__rwb_active){
  window.__rwb_active=false;window.fetch=window.__rwb_orig;
  badge('\u23f9\ufe0f \u041e\u0442\u043c\u0435\u043d\u0435\u043d\u043e','#64748b',3);return;}

// extract: берём econom + comfort (НЕ comfortplus)
// + вытаскиваем ETA маршрута из любого поля времени
function etaFromObj(o){
  // time_raw — реальное поле Яндекс Go в service_levels (секунды)
  // duration, ride_time и др. — запасные варианты
  var secs=px(o.time_raw)||px(o.duration)||px(o.ride_time)||px(o.trip_duration)||px(o.time)||px(o.time_to_arrive);
  if(secs&&secs>60)return Math.round(secs/60); // секунды → минуты
  if(secs&&secs>0&&secs<=60)return secs; // уже минуты (маленькое значение)
  var mins=px(o.duration_min)||px(o.trip_min)||px(o.ride_eta)||px(o.estimated_trip_duration)||px(o.waiting_time);
  return mins||null;}
function extract(d){
  var eco=null,cft=null,isRoute=false,eta=null;
  var altRaw=d.alternatives;
  var opts=(altRaw&&typeof altRaw==='object'?altRaw.options||[]:Array.isArray(altRaw)?altRaw:[]);
  var altP={},altT={};
  opts.forEach(function(o){
    var cls=(o.class||o.tariff_class||o.name||'');
    var p=px(o.price_raw)||px(o.price)||px(o.total_price)||px(o.price_text);
    var t=etaFromObj(o);
    if(cls&&p)altP[cls]=p;
    if(cls&&t)altT[cls]=t;});
  if(altP.econom){eco=altP.econom;isRoute=true;if(altT.econom)eta=altT.econom;}
  // ТОЛЬКО comfort (не comfortplus, не business)
  if(altP.comfort){cft=altP.comfort;isRoute=true;if(!eta&&altT.comfort)eta=altT.comfort;}
  // fallback: service_levels (price_raw — основное поле Яндекс Go)
  (d.service_levels||[]).forEach(function(sl){
    var cls=(sl.class||sl.tariff_class||sl.name||'');
    var p=px(sl.price_raw)||px(sl.price)||px(sl.price_text)||px(sl.min_price);
    var t=etaFromObj(sl);
    if(p){
      if(cls==='econom'&&!eco){eco=p;if(t&&!eta)eta=t;}
      if(cls==='comfort'&&!cft){cft=p;if(t&&!eta)eta=t;}}});
  // fallback ETA из корня ответа
  if(!eta)eta=etaFromObj(d);
  return{eco:eco,cft:cft,isRoute:isRoute,eta:eta};}

function sg(p,cls,km,mn){
  var T={econom:{b:2.0,k:0.78,m:0.20,mn:3.0},comfort:{b:2.5,k:0.90,m:0.23,mn:3.5}};
  var t=T[cls]||T.econom;var bp=Math.max(t.b+t.k*km+t.m*mn,t.mn);
  return bp>0?Math.round(p/bp*100)/100:null;}

function findEl(sels){
  for(var i=0;i<sels.length;i++){var e=document.querySelector(sels[i]);if(e)return e;}
  return null;}
function allEditables(){
  var res=[];
  Array.from(document.querySelectorAll('input')).forEach(function(el){
    if(el.type&&el.type!=='text'&&el.type!=='search'&&el.type!=='')return;
    var r=el.getBoundingClientRect();
    if(r.width>40&&r.height>8&&!el.disabled&&!el.readOnly)res.push(el);});
  Array.from(document.querySelectorAll('[contenteditable="true"],[contenteditable=""]')).forEach(function(el){
    var r=el.getBoundingClientRect();
    if(r.width>40&&r.height>8)res.push(el);});
  res.sort(function(a,b){return a.getBoundingClientRect().top-b.getBoundingClientRect().top;});
  return res;}
function setField(el,val){
  el.focus();
  if(el.tagName==='INPUT'||el.tagName==='TEXTAREA'){
    try{
      var s=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
      s.call(el,val);}catch(e){el.value=val;}
    el.dispatchEvent(new Event('input',{bubbles:true}));
    el.dispatchEvent(new Event('change',{bubbles:true}));
  }else{
    el.textContent='';
    try{document.execCommand('selectAll',false,null);
        document.execCommand('delete',false,null);
        document.execCommand('insertText',false,val);}
    catch(e){el.textContent=val;}
    el.dispatchEvent(new InputEvent('input',{bubbles:true,data:val}));
    el.dispatchEvent(new Event('change',{bubbles:true}));}
  return true;}
function findFromInput(){
  return findEl([
    '[placeholder*="\u041e\u0442\u043a\u0443\u0434\u0430"]',
    '[aria-label*="\u041e\u0442\u043a\u0443\u0434\u0430"]',
    '[data-testid*="from"]',
    '[class*="from"][contenteditable]','[class*="From"][contenteditable]',
    '[class*="origin"][contenteditable]'
  ])||allEditables()[0]||null;}
function findToInput(){
  return findEl([
    '[placeholder*="\u041a\u0443\u0434\u0430"]',
    '[aria-label*="\u041a\u0443\u0434\u0430"]',
    '[data-testid*="to"]',
    '[class*="destination"][contenteditable]','[class*="Destination"][contenteditable]'
  ])||allEditables()[1]||null;}
function waitAndClick(cb,ms){
  var t0=Date.now(),iv=setInterval(function(){
    var items=document.querySelectorAll(
      '[class*="SuggestItem"],[class*="suggest-item"],[class*="suggest__item"],'+
      '[class*="SuggestListItem"],[class*="suggest_item"],[role="option"],'+
      '[class*="GeoSuggest"],[class*="Suggest"] li,[class*="suggest"] li,'+
      '[class*="Popup"] [class*="item"],[class*="popup"] [class*="item"]');
    var vis=Array.from(items).filter(function(e){
      var r=e.getBoundingClientRect();return r.width>0&&r.height>0;});
    if(vis.length>0){clearInterval(iv);vis[0].click();if(cb)cb(true);return;}
    if(Date.now()-t0>(ms||3500)){clearInterval(iv);if(cb)cb(false);}
  },150);}
function debugInputs(){
  var all=allEditables();
  if(!all.length)return '\u043d\u0435\u0442 \u0438\u043d\u043f\u0443\u0442\u043e\u0432';
  return all.slice(0,4).map(function(el,i){
    var ph=el.placeholder||el.getAttribute('aria-label')||el.textContent.slice(0,20)||'';
    return i+':['+el.tagName+' ph='+JSON.stringify(ph.slice(0,20))
      +' cls='+el.className.slice(0,25)+']';}).join('\\n');}

// === Основной перехватчик routestats ===
var origFetch=window.fetch;
window.__rwb_orig=origFetch;
window.__rwb_active=true;
window.fetch=function(){
  var args=arguments;
  var url=(args[0]&&args[0].url)||String(args[0]||'');
  if(!window.__rwb_active||url.indexOf('routestats')===-1)
    return origFetch.apply(this,args);
  window.__rwb_active=false;
  window.fetch=origFetch;
  var cfg=args[1]||{},hdrs={};
  if(cfg.headers){
    if(typeof cfg.headers.forEach==='function')cfg.headers.forEach(function(v,k){hdrs[k]=v;});
    else Object.assign(hdrs,cfg.headers);}
  var base=url.replace(/\\/3\\.0\\/routestats.*/,'');

  // Объединяем фиксированные маршруты + маршруты из книжки
  var allRoutes=ROUTES.slice();
  BOOK_ROUTES.forEach(function(br){
    // Не дублируем если координаты те же что уже есть
    if(br.from&&br.to)allRoutes.push(br);});

  var nTotal=allRoutes.length;
  badge('\ud83d\udd04 CSRF \u2014 \u0437\u0430\u043f\u0440\u0430\u0448\u0438\u0432\u0430\u044e '+nTotal+' \u043c\u0430\u0440\u0448\u0440\u0443\u0442\u043e\u0432...','#3b82f6',30);

  // Два запроса на каждый маршрут: selected_class='econom' и 'comfort'
  // Яндекс при selected_class='' возвращает только один тариф в service_levels
  function mkReq(r,cls){
    return origFetch(base+'/3.0/routestats',{
      method:'POST',credentials:'include',headers:hdrs,
      body:JSON.stringify({route:[r.from,r.to],selected_class:cls,format_currency:true,
        requirements:{coupon:''},summary_version:2,is_lightweight:false,supports_paid_options:true,
        tariff_requirements:[{class:cls,requirements:{coupon:''}}]})
    }).then(function(res){
      var status=res.status;
      return res.json().then(function(d){return{ok:res.ok,status:status,d:d};})
               .catch(function(){return{ok:false,status:status,d:null};});
    }).catch(function(e){return{ok:false,status:0,d:null,err:e.message};});}

  var calls=allRoutes.map(function(r){
    return Promise.all([mkReq(r,'econom'),mkReq(r,'comfort')])
      .then(function(pair){return{r:r,de:pair[0],dc:pair[1]};});});

  var pageRes=origFetch.apply(this,args);
  Promise.all(calls).then(function(results){
    var lines=[],nOk=0,ts=new Date().toISOString();
    var routePayload=[];
    var first=results[0];
    var dbgLine='';
    if(first){
      var reE=first.de||{};
      var reC=first.dc||{};
      var d0=reE.d||{};
      var svc0=d0.service_levels||[];
      var dcD=reC.d||{};
      var svc1=(dcD.service_levels||[])[0];
      // HTTP статус + ключевые поля svc[0] для обоих запросов
      var svcE=svc0[0]?['price_raw','price','price_text'].map(function(f){return f+'='+JSON.stringify(svc0[0][f]);}).join(' '):'пуст';
      // Показываем ВСЕ классы из comfort-ответа чтобы найти нужное имя
      var cftAllCls=(dcD.service_levels||[]).map(function(sl,i){
        var cls=sl.class||sl.tariff_class||sl.name||'?';
        var p=px(sl.price_raw)||px(sl.price)||px(sl.price_text)||'?';
        return '['+i+']'+cls+'='+p;}).join(' ');
      var ecoSt='HTTP '+(reE.status||'?')+' svc:'+(svc0.length)+' '+svcE;
      dbgLine='<span style="color:#86efac;font-size:9px">eco: '+ecoSt.slice(0,110)+'</span><br>'+
              '<span style="color:#fde68a;font-size:9px">cft classes: '+(cftAllCls||'пуст').slice(0,150)+'</span><br>';
    }
    results.forEach(function(item){
      var r=item.r;
      var rId=r.id||r.from+'\u2192'+r.to;
      var rLabel=r.label||(r.fa&&r.ta?r.fa.split(',')[0]+'\u2192'+r.ta.split(',')[0]:rId);
      var deD=(item.de&&item.de.d)||null;
      var dcD=(item.dc&&item.dc.d)||null;
      if(!deD&&!dcD){lines.push('\u26aa '+rLabel+': err');return;}
      var exE=deD?extract(deD):{eco:null,cft:null,isRoute:false,eta:null};
      var exC=dcD?extract(dcD):{eco:null,cft:null,isRoute:false,eta:null};
      // econom из econom-запроса
      var eco=exE.eco||null;
      // comfort: сначала пробуем найти class='comfort', если нет — берём первый
      // service_levels[0] напрямую (Яндекс возвращает class='econom' даже для comfort-запроса)
      var cft=exC.cft||null;
      if(!cft&&dcD){
        var cSvcs=dcD.service_levels||[];
        // Пропускаем econom — берём первый НЕ-эконом тариф (comfort/business/etc)
        for(var ci=0;ci<cSvcs.length;ci++){
          var cCls=(cSvcs[ci].class||cSvcs[ci].tariff_class||cSvcs[ci].name||'').toLowerCase();
          if(cCls==='econom'||cCls==='ekonom')continue;
          cft=px(cSvcs[ci].price_raw)||px(cSvcs[ci].price)||px(cSvcs[ci].price_text)||null;
          if(cft)break;}}
      var eta=exE.eta||exC.eta||null;
      var isRoute=exE.isRoute||exC.isRoute;
      var se=eco?sg(eco,'econom',r.km||5,r.min||8):null;
      var sc=cft?sg(cft,'comfort',r.km||5,r.min||8):null;
      var tripMin=eta||r.min||null;
      var speedKmh=(tripMin&&r.km)?Math.round(r.km/tripMin*60):null;
      var etaStr=tripMin?Math.round(tripMin)+'мин':null;
      routePayload.push({id:rId,label:rLabel,km:r.km||null,min:r.min||null,eta_min:eta||null,speed_kmh:speedKmh||null,
        from_addr:r.fa||null,to_addr:r.ta||null,
        from_coord:r.from,to_coord:r.to,
        econom:eco,comfort:cft,
        surge_econom:se||null,surge_comfort:sc||null,
        eta_min:eta||null,
        has_route_price:isRoute,
        source:r._book?'book':'fixed'});
      if(eco||cft){
        nOk++;
        var icon=!se?'\u26aa':se>=1.5?'\ud83d\udd34':se>=1.2?'\ud83d\udfe1':'\ud83d\udfe2';
        lines.push(icon+' '+rLabel+
          ': \u042d'+(eco?eco.toFixed(1):'\u2014')+(se?' \u00d7'+se:'')+
          ' \u041a'+(cft?cft.toFixed(1):'\u2014')+
          (etaStr?' \u23f1'+etaStr:'')+(isRoute?' \ud83d\udccd':''));
      }else{
        lines.push('\u2754 '+rLabel+': \u043d\u0435\u0442 \u0446\u0435\u043d');
      }});
    // Ротация фиксированных: если большинство без route_price — сдвинуть адрес
    var fixedPayload=routePayload.filter(function(rp){return rp.source==='fixed';});
    var nMiss=fixedPayload.filter(function(rp){return!rp.has_route_price;}).length;
    if(nMiss>3){ROUTES.forEach(function(r){_ai[r.id]=(_ai[r.id]||0)+1;});}
    try{localStorage.setItem(_AI,JSON.stringify(_ai));}catch(e){}
    var payload={origin:'bookmarklet',routes:routePayload};
    var d=encodeURIComponent(btoa(unescape(encodeURIComponent(JSON.stringify(payload)))));
    var _PT=${JSON.stringify(probeSecret)};
    window.open('https://rwbtaxi.by/api/screens/yandex-probe-redirect?d='+d+(_PT?'&t='+encodeURIComponent(_PT):''),'_blank');
    var c=nOk>=4?'#22c55e':nOk>=2?'#f97316':'#ef4444';
    var bookBadge=BOOK_ROUTES.length?' +'+BOOK_ROUTES.length+'\u043a\u043d\u0438\u0436\u043a\u0430':'';
    badge('\u2705 <b>'+nOk+'/'+nTotal+'</b> \u043e\u0442\u043f\u0440\u0430\u0432\u043b\u0435\u043d\u043e'+bookBadge+'<br>'+
      dbgLine+
      '<span style="font-size:10px;line-height:1.7">'+lines.join('<br>')+'</span>',c,40);
  });
  return pageRes;};

// === Автоматическое заполнение полей ===
var r0=ROUTES[0];
var fromEl=findFromInput();
if(!fromEl){
  var dbg=debugInputs();
  badge('\u274c \u043f\u043e\u043b\u0435 "\u041e\u0442\u043a\u0443\u0434\u0430" \u043d\u0435 \u043d\u0430\u0439\u0434\u0435\u043d\u043e<br>'+
    '<span style="color:#fbbf24;font-size:9px;white-space:pre">'+dbg+'</span><br>'+
    '<span style="color:#94a3b8;font-size:9px">\u0421\u043a\u043e\u043f\u0438\u0440\u0443\u0439 \u0442\u0435\u043a\u0441\u0442 \u0432\u044b\u0448\u0435 \u0438 \u043e\u0442\u043f\u0440\u0430\u0432\u044c \u0440\u0430\u0437\u0440\u0430\u0431\u043e\u0442\u0447\u0438\u043a\u0443</span>',
    '#ef4444',20);
  window.__rwb_active=false;window.fetch=origFetch;return;}

// Параллельно загружаем маршруты из книжки (без блокировки основного потока)
fetch('https://rwbtaxi.by/api/screens/recommended?limit=6')
  .then(function(res){return res.json();})
  .then(function(data){
    var recs=(data&&data.routes)||[];
    // Преобразуем в формат ROUTE: нужны from:[lng,lat] to:[lng,lat]
    var bookRoutes=[];
    recs.forEach(function(rec){
      if(rec.fromLat==null||rec.fromLng==null||rec.toLat==null||rec.toLng==null)return;
      bookRoutes.push({
        id:'book\u2192'+rec.id,
        label:(rec.from||'').split(',')[0]+'\u2192'+(rec.to||'').split(',')[0],
        km:rec.distanceKm||null,min:null,
        from:[rec.fromLng,rec.fromLat],
        to:[rec.toLng,rec.toLat],
        fa:rec.from||'',ta:rec.to||'',
        _book:true});});
    if(bookRoutes.length){
      BOOK_ROUTES.length=0;
      bookRoutes.forEach(function(r){BOOK_ROUTES.push(r);});
      try{localStorage.setItem('rwbtaxi_book',JSON.stringify({ts:Date.now(),routes:bookRoutes}));}catch(e){}
    }
  }).catch(function(){});

badge('\u270d\ufe0f \u0417\u0430\u043f\u043e\u043b\u043d\u044f\u044e: <b>'+r0.fa+'</b><br>\u2192 <b>'+r0.ta+'</b>','#475569',30);
fromEl.focus();
setField(fromEl,r0.fa);
waitAndClick(function(ok1){
  setTimeout(function(){
    var toEl2=findToInput();
    if(!toEl2){
      badge('\u274c \u041d\u0435 \u043d\u0430\u0439\u0434\u0435\u043d\u043e \u043f\u043e\u043b\u0435 "\u041a\u0443\u0434\u0430"','#ef4444',5);return;}
    toEl2.focus();
    setField(toEl2,r0.ta);
    waitAndClick(function(ok2){
      badge('\u23f3 \u0416\u0434\u0443 \u043e\u0442\u0432\u0435\u0442\u0430 \u0441\u0442\u0440\u0430\u043d\u0438\u0446\u044b...','#475569',20);
      setTimeout(function(){
        if(window.__rwb_active){
          badge('\u26a0\ufe0f \u0410\u0434\u0440\u0435\u0441 \u0432\u0432\u0435\u0434\u0451\u043d, \u043d\u043e \u0446\u0435\u043d\u044b \u043d\u0435 \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u043b\u0438\u0441\u044c.<br>'+
            '<span style="color:#fbbf24;font-size:10px">\u041f\u043e\u043f\u0440\u043e\u0431\u0443\u0439 \u0432\u0440\u0443\u0447\u043d\u0443\u044e \u0432\u044b\u0431\u0440\u0430\u0442\u044c \u043f\u043e\u0434\u0441\u043a\u0430\u0437\u043a\u0443 \u0430\u0434\u0440\u0435\u0441\u0430</span>','#f97316',10);}
      },8000);
    },3000);
  },600);
},3000);
})();`;
  return "javascript:" + encodeURIComponent(code);
}

function CopyButton({ text, label = "Копировать URL" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2500);
        });
      }}
      className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 hover:bg-blue-700 px-3 py-1.5 text-xs font-semibold text-white transition-colors"
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
      {copied ? "Скопировано!" : label}
    </button>
  );
}

const BM_VERSION = "v5.11-speed";

export function YandexProbeBookmarklet() {
  const [probeSecret, setProbeSecret] = useState("");
  const href = buildBookmarklet(probeSecret);
  const linkRef = useRef<HTMLAnchorElement>(null);
  const [dragHint, setDragHint] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);
  const [testStatus, setTestStatus] = useState<"idle" | "loading" | "ok" | "err">("idle");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    fetch("/api/screens/probe-secret")
      .then((r) => r.json())
      .then((d) => { if (d?.secret) setProbeSecret(d.secret); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (linkRef.current) {
      linkRef.current.setAttribute("href", href);
    }
  }, [href]);

  function handleButtonClick(e: React.MouseEvent) {
    e.preventDefault();
    setDragHint(true);
    setTimeout(() => setDragHint(false), 5000);
  }

  function copyCode() {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.select();
    navigator.clipboard.writeText(href).then(() => {
      setCodeCopied(true);
      setTimeout(() => setCodeCopied(false), 3000);
    });
  }

  async function testServer() {
    setTestStatus("loading");
    try {
      const img = new window.Image();
      img.src =
        "https://rwbtaxi.by/api/screens/probe-pixel?id=test%E2%86%92test&label=TEST&km=8.5&eco=7.5&bus=8.9&se=1.1&sb=1.2&ts=" +
        encodeURIComponent(new Date().toISOString()) +
        "&rt=0";
      await new Promise<void>((res, rej) => {
        img.onload = () => res();
        img.onerror = () => rej(new Error("no response"));
        setTimeout(() => res(), 3000);
      });
      setTestStatus("ok");
      setTimeout(() => setTestStatus("idle"), 4000);
    } catch {
      setTestStatus("err");
      setTimeout(() => setTestStatus("idle"), 4000);
    }
  }

  return (
    <div className="space-y-5 p-1">

      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <p className="font-semibold text-sm">Закладка Chrome — перехват цен страницы</p>
          <span className="rounded-full bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 text-[10px] font-mono px-2 py-0.5">{BM_VERSION}</span>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">
          Клик активирует перехватчик → вводишь любой маршрут на <strong>taxi.yandex.by</strong> как обычно →
          цены захватываются автоматически из ответа который уже пришёл странице.
        </p>
        <div className="rounded-md bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 p-2 text-xs text-blue-700 dark:text-blue-300 space-y-0.5">
          <p className="font-semibold">Что нового в v5:</p>
          <p>📖 Маршруты из <strong>книжки</strong> — автоматически подгружает недостающие адреса</p>
          <p>🚗 Тариф <strong>Comfort</strong> (средний класс, не Comfort+)</p>
          <p>⏱ <strong>Время в пути</strong> из ответа Яндекса</p>
        </div>
      </div>

      {/* Установка / обновление */}
      <div className="rounded-lg border p-4 space-y-4 bg-muted/20">
        <p className="text-sm font-semibold">Установка / обновление закладки</p>

        <div className="rounded-lg border-2 border-dashed border-blue-400 bg-blue-50 dark:bg-blue-950/40 p-3 space-y-2">
          <p className="text-xs text-blue-700 dark:text-blue-300 font-medium flex items-center gap-1.5">
            <GripHorizontal size={14} />
            Новая установка: перетащи кнопку на Bookmark Bar
          </p>
          <div className="flex items-center gap-3">
            <a
              ref={linkRef}
              href="#"
              draggable
              onClick={handleButtonClick}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-bold text-white shadow cursor-grab active:cursor-grabbing select-none"
            >
              🚕 RWB Probe
            </a>
            <span className="text-xs text-blue-600 dark:text-blue-400">
              ← зажми и перетащи<br />на панель закладок
            </span>
          </div>
          {dragHint && (
            <div className="rounded-md bg-amber-100 dark:bg-amber-900/50 border border-amber-300 dark:border-amber-700 p-2 text-xs text-amber-800 dark:text-amber-200">
              ⚠ Клик не работает — это закладка. Нужно <strong>зажать и перетащить</strong> на Bookmark Bar.
            </div>
          )}
        </div>

        <div className="space-y-2">
          <p className="text-xs font-medium text-foreground">
            Обновление существующей закладки — 3 шага:
          </p>
          <ol className="list-decimal list-inside space-y-1.5 text-xs text-muted-foreground">
            <li>Нажми кнопку <strong className="text-foreground">«Скопировать код»</strong> ниже</li>
            <li>
              В Chrome: <strong className="text-foreground">правый клик на старой закладке 🚕 RWB Probe</strong>{" "}
              → <strong className="text-foreground">«Изменить»</strong>
            </li>
            <li>
              В поле <strong className="text-foreground">URL</strong> — выдели всё{" "}
              <kbd className="rounded border px-1 text-[10px]">Ctrl+A</kbd> и вставь{" "}
              <kbd className="rounded border px-1 text-[10px]">Ctrl+V</kbd> → <strong className="text-foreground">Сохранить</strong>
            </li>
          </ol>

          <div className="relative">
            <textarea
              ref={textareaRef}
              readOnly
              value={href}
              rows={3}
              onClick={(e) => (e.target as HTMLTextAreaElement).select()}
              className="w-full rounded-md border bg-background font-mono text-[9px] leading-relaxed p-2 resize-none text-muted-foreground cursor-text select-all"
            />
            <button
              onClick={copyCode}
              className="absolute top-1.5 right-1.5 inline-flex items-center gap-1 rounded bg-blue-600 hover:bg-blue-700 px-2 py-1 text-[10px] font-semibold text-white transition-colors"
            >
              {codeCopied ? <><Check size={10} /> Скопировано!</> : <><Copy size={10} /> Скопировать код</>}
            </button>
          </div>
          <p className="text-[10px] text-muted-foreground">
            Кликни на поле выше — код выделится целиком. Затем скопируй и вставь в URL закладки.
          </p>
        </div>
      </div>

      {/* Как использовать */}
      <div className="rounded-lg border p-3 space-y-2">
        <p className="text-sm font-semibold">Как использовать</p>
        <ol className="list-decimal list-inside space-y-1.5 text-xs text-muted-foreground">
          <li>
            Открой{" "}
            <a
              href="https://taxi.yandex.by"
              target="_blank"
              rel="noreferrer"
              className="font-semibold text-blue-600 underline"
            >
              taxi.yandex.by
            </a>{" "}
            в Chrome и авторизуйся
          </li>
          <li>Кликни <strong className="text-foreground">🚕 RWB Probe</strong> в Bookmark Bar</li>
          <li>
            Букмарклет автоматически подгрузит маршруты из <strong className="text-foreground">книжки</strong> (до 6 адресов)
            + 6 фиксированных = до <strong className="text-foreground">12 запросов за один клик</strong>
          </li>
          <li>Оверлей покажет цены Э/К, surge и время в пути ⏱</li>
        </ol>
      </div>

      {/* Тест сервера */}
      <div className="rounded-lg border p-3 space-y-2">
        <p className="text-sm font-semibold">Тест: проверить что сервер принимает данные</p>
        <p className="text-xs text-muted-foreground">
          Отправит тестовую запись напрямую в yandex-probes.jsonl (без Яндекса).
        </p>
        <button
          onClick={testServer}
          disabled={testStatus === "loading"}
          className="inline-flex items-center gap-2 rounded-md bg-muted hover:bg-muted/70 disabled:opacity-50 px-3 py-1.5 text-xs font-medium transition-colors"
        >
          {testStatus === "loading" && "⏳ Отправка…"}
          {testStatus === "ok" && "✅ Сервер OK — данные приняты"}
          {testStatus === "err" && "❌ Ошибка — сервер недоступен"}
          {testStatus === "idle" && "Отправить тест"}
        </button>
      </div>

      {/* Маршруты */}
      <details className="rounded-lg border p-3 text-xs">
        <summary className="cursor-pointer font-medium text-sm">
          Фиксированные маршруты ({ROUTES.length}) + маршруты из книжки
        </summary>
        <div className="mt-2 grid gap-1">
          {ROUTES.map((r, i) => (
            <div key={r.id} className="flex items-center gap-2 text-muted-foreground">
              <span className="flex h-4 w-4 items-center justify-center rounded-full bg-muted text-[9px] font-bold text-foreground shrink-0">
                {i + 1}
              </span>
              <span className="font-medium text-foreground">{r.label}</span>
              <span className="text-[10px] ml-auto">{r.km}км</span>
            </div>
          ))}
          <div className="flex items-center gap-2 text-muted-foreground mt-1 pt-1 border-t">
            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-blue-100 text-[9px] font-bold text-blue-700 shrink-0">
              📖
            </span>
            <span className="text-blue-700 dark:text-blue-400">+ маршруты из книжки (до 6, кэш 5 мин)</span>
          </div>
        </div>
        <p className="text-[10px] text-muted-foreground mt-2">
          Сброс ротации адресов: <code className="bg-muted rounded px-1">localStorage.removeItem('rwbtaxi_ai')</code><br/>
          Сброс кэша книжки: <code className="bg-muted rounded px-1">localStorage.removeItem('rwbtaxi_book')</code>
        </p>
      </details>

    </div>
  );
}
