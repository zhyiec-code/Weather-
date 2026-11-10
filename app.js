'use strict';

const HOME = { name: 'Houston · Memorial', lat: 29.776, lon: -95.535 };
const REFRESH_MS = 10 * 60 * 1000;
const $ = (id) => document.getElementById(id);

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

let place = store.get('place', HOME);
let unit = store.get('unit', 'F');
let lastData = null;
let lastNws = null;
let lastRadar = null;
let lastFetch = 0;

/* ---------- Icons ---------- */
const SUN = (cx, cy, r) => {
  let rays = '';
  for (let i = 0; i < 8; i++) {
    const a = (Math.PI / 4) * i;
    const x1 = cx + Math.cos(a) * (r + 4), y1 = cy + Math.sin(a) * (r + 4);
    const x2 = cx + Math.cos(a) * (r + 9), y2 = cy + Math.sin(a) * (r + 9);
    rays += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"/>`;
  }
  return `<g stroke="#ffc83d" stroke-width="3.2" stroke-linecap="round">${rays}</g><circle cx="${cx}" cy="${cy}" r="${r}" fill="#ffc83d"/>`;
};
const MOON = (cx, cy, r) =>
  `<path d="M${cx + r * 0.35} ${cy - r} a${r} ${r} 0 1 0 ${r * 0.65} ${r * 1.55} a${r * 0.82} ${r * 0.82} 0 0 1 -${r * 0.65} -${r * 1.55}z" fill="#f4e9b8"/>`;
const CLOUD = (fill = '#f2f6fa', dx = 0, dy = 0, s = 1) =>
  `<path transform="translate(${dx} ${dy}) scale(${s})" d="M20 52h30a12 12 0 0 0 0-24 16 16 0 0 0-30-4 13 13 0 0 0 0 28z" fill="${fill}"/>`;
const DROPS = (n, color = '#7cc8ff') => {
  const xs = n === 2 ? [26, 40] : [22, 34, 46];
  return xs.map((x) => `<line x1="${x}" y1="56" x2="${x - 4}" y2="64" stroke="${color}" stroke-width="3.4" stroke-linecap="round"/>`).join('');
};
const FLAKES = () => [22, 34, 46].map((x) => `<circle cx="${x - 2}" cy="60" r="2.8" fill="#fff"/>`).join('');
const BOLT = `<path d="M36 50l-7 10h7l-4 9 11-13h-7l4-6z" fill="#ffd23d"/>`;

function iconKind(code, isDay) {
  if (code === 0 || code === 1) return isDay ? 'sun' : 'moon';
  if (code === 2) return isDay ? 'partly-day' : 'partly-night';
  if (code === 3) return 'cloud';
  if (code === 45 || code === 48) return 'fog';
  if ([51, 53, 55].includes(code)) return 'drizzle';
  if ([56, 57, 66, 67].includes(code)) return 'sleet';
  if ([61, 63, 65, 80, 81, 82].includes(code)) return 'rain';
  if ([71, 73, 75, 77, 85, 86].includes(code)) return 'snow';
  if ([95, 96, 99].includes(code)) return 'storm';
  return 'cloud';
}
function icon(code, isDay) {
  const k = iconKind(code, isDay);
  let g = '';
  switch (k) {
    case 'sun': g = SUN(36, 36, 13); break;
    case 'moon': g = MOON(34, 36, 17); break;
    case 'partly-day': g = SUN(26, 24, 10) + CLOUD('#f2f6fa', 6, 6, 0.95); break;
    case 'partly-night': g = MOON(24, 22, 12) + CLOUD('#dde4ec', 6, 6, 0.95); break;
    case 'cloud': g = CLOUD('#c9d3dd', -4, -4, 0.9) + CLOUD('#f2f6fa', 6, 2, 0.95); break;
    case 'fog': g = CLOUD('#dfe5ea', 2, -6, 0.95) + '<g stroke="#e6ebf0" stroke-width="3.4" stroke-linecap="round"><line x1="14" y1="56" x2="58" y2="56"/><line x1="20" y1="64" x2="52" y2="64"/></g>'; break;
    case 'drizzle': g = CLOUD('#dfe5ea', 2, -6, 0.95) + DROPS(2); break;
    case 'rain': g = CLOUD('#c3cdd8', 2, -6, 0.95) + DROPS(3); break;
    case 'sleet': g = CLOUD('#c3cdd8', 2, -6, 0.95) + DROPS(2, '#bfe3ff') + '<circle cx="34" cy="62" r="2.6" fill="#fff"/>'; break;
    case 'snow': g = CLOUD('#e6ebf0', 2, -6, 0.95) + FLAKES(); break;
    case 'storm': g = CLOUD('#8f9caa', 2, -8, 0.95) + BOLT; break;
  }
  return `<svg viewBox="0 0 72 72" aria-hidden="true">${g}</svg>`;
}
const COND = {
  0: '晴', 1: '大致晴朗', 2: '局部多云', 3: '阴', 45: '雾', 48: '冻雾',
  51: '小毛毛雨', 53: '毛毛雨', 55: '大毛毛雨', 56: '冻毛毛雨', 57: '冻毛毛雨',
  61: '小雨', 63: '中雨', 65: '大雨', 66: '冻雨', 67: '强冻雨',
  71: '小雪', 73: '中雪', 75: '大雪', 77: '雪粒',
  80: '阵雨', 81: '较强阵雨', 82: '强阵雨', 85: '阵雪', 86: '强阵雪',
  95: '雷暴', 96: '雷暴伴冰雹', 99: '强雷暴伴冰雹',
};
function condText(code, isDay) {
  if (code === 0 && !isDay) return '晴朗';
  return COND[code] ?? '—';
}
function skyFor(code, isDay) {
  const k = iconKind(code, isDay);
  if (k === 'storm') return 'storm';
  if (['rain', 'drizzle', 'sleet', 'snow'].includes(k)) return 'rain';
  if (k === 'fog') return 'fog';
  if (k === 'sun' || k === 'partly-day') return 'clear-day';
  if (k === 'moon' || k === 'partly-night') return 'clear-night';
  return isDay ? 'cloudy-day' : 'cloudy-night';
}

/* ---------- Units ---------- */
const T = (f) => (f == null ? '--' : Math.round(unit === 'F' ? f : (f - 32) * 5 / 9)) + '°';
const rainAmt = (inch) => (unit === 'F' ? `${inch < 0.01 ? '<0.01' : inch.toFixed(2)} in` : `${(inch * 25.4).toFixed(1)} mm`);
const windSpd = (mph) => (unit === 'F' ? `${Math.round(mph)} mph` : `${Math.round(mph * 1.609)} km/h`);
const DIRS = ['北', '东北', '东', '东南', '南', '西南', '西', '西北'];
const dirText = (deg) => DIRS[Math.round(((deg % 360) / 45)) % 8] + '风';

/* ---------- Time helpers (API returns location-local wall time) ---------- */
const hourOf = (s) => parseInt(s.slice(11, 13), 10);
const minOf = (s) => parseInt(s.slice(14, 16), 10);
const fmtClock = (s) => {
  const h = hourOf(s), m = minOf(s);
  const ap = h < 12 ? '上午' : '下午';
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${ap}${hh}:${String(m).padStart(2, '0')}`;
};
const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const dayLabel = (s, i) => {
  if (i === 0) return '今天';
  const [y, m, d] = s.split('-').map(Number);
  return WEEK[new Date(y, m - 1, d).getDay()];
};

/* ---------- Data ---------- */
async function fetchOpenMeteo(lat, lon) {
  const p = new URLSearchParams({
    latitude: lat, longitude: lon,
    current: 'temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,wind_speed_10m,wind_gusts_10m,wind_direction_10m,dew_point_2m',
    minutely_15: 'precipitation',
    hourly: 'temperature_2m,precipitation_probability,precipitation,weather_code,uv_index,is_day',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,uv_index_max,sunrise,sunset',
    temperature_unit: 'fahrenheit', wind_speed_unit: 'mph', precipitation_unit: 'inch',
    timezone: 'auto', forecast_days: '10', models: 'best_match',
  });
  const r = await fetch('https://api.open-meteo.com/v1/forecast?' + p);
  if (!r.ok) throw new Error('Open-Meteo ' + r.status);
  return r.json();
}

async function fetchNws(lat, lon) {
  const out = { alerts: [], periods: [], city: null, obs: null };
  const la = (+lat).toFixed(4), lo = (+lon).toFixed(4);
  const [pt, al] = await Promise.allSettled([
    fetch(`https://api.weather.gov/points/${la},${lo}`, { headers: { Accept: 'application/geo+json' } }).then((r) => (r.ok ? r.json() : null)),
    fetch(`https://api.weather.gov/alerts/active?point=${la},${lo}`, { headers: { Accept: 'application/geo+json' } }).then((r) => (r.ok ? r.json() : null)),
  ]);
  if (al.status === 'fulfilled' && al.value) {
    out.alerts = (al.value.features || []).map((f) => f.properties);
  }
  if (pt.status === 'fulfilled' && pt.value) {
    const rl = pt.value.properties?.relativeLocation?.properties;
    if (rl) out.city = `${rl.city}, ${rl.state}`;
    const url = pt.value.properties?.forecast;
    const stUrl = pt.value.properties?.observationStations;
    const H = { headers: { Accept: 'application/geo+json' } };
    await Promise.allSettled([
      url && fetch(url, H).then((r) => (r.ok ? r.json() : null)).then((f) => { out.periods = f?.properties?.periods || []; }),
      stUrl && fetch(stUrl, H).then((r) => (r.ok ? r.json() : null)).then(async (st) => {
        const id = st?.features?.[0]?.properties?.stationIdentifier;
        if (!id) return;
        const o = await fetch(`https://api.weather.gov/stations/${id}/observations/latest`, H).then((r) => (r.ok ? r.json() : null));
        const p = o?.properties;
        if (p) out.obs = { station: id, text: p.textDescription || '', time: p.timestamp, precip1h: p.precipitationLastHour?.value };
      }),
    ]);
  }
  return out;
}

/* ---------- Live radar at your spot ---------- */
// Reads the real radar picture at the chosen location so "now" reflects what is actually falling,
// not only what the model expected. Returns 0 none, 1 light, 2 moderate, 3 heavy; null if unreadable.
function tileXY(lat, lon, z) {
  const n = 2 ** z;
  const x = ((lon + 180) / 360) * n;
  const r = (lat * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n;
  return { tx: Math.floor(x), ty: Math.floor(y), px: Math.floor((x % 1) * 256), py: Math.floor((y % 1) * 256) };
}
function classifyPixel(r, g, b, a) {
  if (a < 60) return 0;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  if (max - min < 25) return 0; // grey/white map noise
  let h;
  const d = max - min;
  if (max === r) h = (60 * ((g - b) / d) + 360) % 360;
  else if (max === g) h = 60 * ((b - r) / d) + 120;
  else h = 60 * ((r - g) / d) + 240;
  if (h >= 170 && h < 260) return 0.5; // blue: very light echo
  if (h >= 75 && h < 170) return 1;    // green: light rain
  if (h >= 42 && h < 75) return 2;     // yellow: moderate
  return 3;                            // orange, red, magenta: heavy
}
async function readTile(url, px, py) {
  const r = await fetch(url, { mode: 'cors', cache: 'no-store' });
  if (!r.ok) throw new Error('tile ' + r.status);
  const bmp = await createImageBitmap(await r.blob());
  const cv = document.createElement('canvas');
  cv.width = bmp.width; cv.height = bmp.height;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  cx.drawImage(bmp, 0, 0);
  const R = 3;
  const x0 = Math.max(0, px - R), y0 = Math.max(0, py - R);
  const img = cx.getImageData(x0, y0, Math.min(2 * R + 1, cv.width - x0), Math.min(2 * R + 1, cv.height - y0)).data;
  let best = 0, wet = 0, n = 0;
  for (let i = 0; i < img.length; i += 4) {
    const c = classifyPixel(img[i], img[i + 1], img[i + 2], img[i + 3]);
    n++;
    if (c >= 1) wet++;
    best = Math.max(best, c);
  }
  // Require several wet pixels so a single speck doesn't count as rain.
  return wet >= Math.max(3, n * 0.2) ? best : best >= 1 ? 0.5 : best;
}
async function sampleRadar(lat, lon) {
  const z = 10;
  const t = tileXY(lat, lon, z);
  try {
    const v = await readTile(`https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/nexrad-n0q-900913/${z}/${t.tx}/${t.ty}.png?_=${Math.floor(Date.now() / 300000)}`, t.px, t.py);
    return { level: v, source: 'NEXRAD' };
  } catch (e) {}
  try {
    const m = await fetch('https://api.rainviewer.com/public/weather-maps.json').then((r) => r.json());
    const last = m.radar.past[m.radar.past.length - 1];
    const v = await readTile(`${m.host}${last.path}/256/${z}/${t.tx}/${t.ty}/4/0_0.png`, t.px, t.py);
    return { level: v, source: 'RainViewer' };
  } catch (e) {}
  return null;
}
const RAIN_WORDS = /rain|shower|drizzle|thunder|storm|precip/i;
function liveRain() {
  // Combine the radar reading with the nearest NWS station's latest report.
  let level = lastRadar?.level ?? null;
  const o = lastNws?.obs;
  const fresh = o && Date.now() - Date.parse(o.time) < 90 * 60e3;
  const stationWet = fresh && RAIN_WORDS.test(o.text);
  if (level == null) level = stationWet ? 1 : null;
  else if (level < 1 && stationWet && /rain|shower|thunder/i.test(o.text)) level = 1;
  const thunder = fresh && /thunder/i.test(o.text);
  return { level, thunder, station: fresh ? o : null };
}

/* ---------- Render ---------- */
function render() {
  const d = lastData;
  if (!d) return;
  const c = d.current;
  const H = d.hourly, D = d.daily, M = d.minutely_15;
  const curKey = c.time.slice(0, 13);
  let hi0 = H.time.findIndex((t) => t.slice(0, 13) === curKey);
  if (hi0 < 0) hi0 = 0;

  const live = liveRain();
  let code = c.weather_code;
  const modelWet = code >= 51 && code !== 45 && code !== 48;
  if (live.level != null && live.level >= 1) {
    if (live.thunder) code = 95;
    else if (!modelWet || code < 61) code = live.level >= 3 ? 65 : live.level >= 2 ? 63 : 61;
  } else if (live.level === 0.5 && !modelWet) {
    code = 51;
  } else if (live.level === 0 && modelWet && !live.station) {
    code = 3; // radar clear at your spot: the model's rain isn't here (yet)
  }
  document.body.dataset.sky = skyFor(code, c.is_day);
  $('nowIcon').innerHTML = icon(code, c.is_day);
  $('nowTemp').textContent = T(c.temperature_2m);
  $('nowCond').textContent = condText(code, c.is_day);
  $('nowFeels').textContent = T(c.apparent_temperature);
  $('nowHi').textContent = T(D.temperature_2m_max[0]);
  $('nowLo').textContent = T(D.temperature_2m_min[0]);

  // NWS cross-check line
  const nws = lastNws;
  if (nws && nws.periods.length) {
    const p0 = nws.periods[0];
    const day = nws.periods.find((p) => p.isDaytime);
    const night = nws.periods.find((p) => !p.isDaytime);
    const conv = (t) => T(t);
    let s = `美国气象局：${p0.name} ${p0.shortForecast}`;
    if (day && night) s += `，高 ${conv(day.temperature)} / 低 ${conv(night.temperature)}`;
    $('nwsLine').textContent = s;
  } else {
    $('nwsLine').textContent = '';
  }

  // Alerts
  const al = $('alerts');
  al.innerHTML = '';
  (nws?.alerts || []).forEach((a) => {
    const det = document.createElement('details');
    det.className = 'alert';
    const sum = document.createElement('summary');
    sum.textContent = '⚠ ' + (a.event || '天气警报') + (a.ends || a.expires ? `（至 ${new Date(a.ends || a.expires).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' })}）` : '');
    const p = document.createElement('p');
    p.textContent = [a.headline, a.description, a.instruction].filter(Boolean).join('\n\n');
    det.append(sum, p);
    al.append(det);
  });

  renderNextHour(c, H, M, hi0, live);

  // Hourly: next 24h
  let hh = '';
  for (let i = hi0; i < Math.min(hi0 + 25, H.time.length); i++) {
    const prob = H.precipitation_probability[i];
    hh += `<div class="hr${i === hi0 ? ' now-h' : ''}">
      <div class="t">${i === hi0 ? '现在' : hourOf(H.time[i]) + '时'}</div>
      <div class="i">${icon(H.weather_code[i], H.is_day[i])}</div>
      <div class="p">${prob >= 10 ? prob + '%' : ''}</div>
      <div class="v">${T(i === hi0 ? c.temperature_2m : H.temperature_2m[i])}</div>
    </div>`;
  }
  $('hourly').innerHTML = hh;
  $('hourly').scrollLeft = 0;

  // Daily
  const lo = Math.min(...D.temperature_2m_min), hi = Math.max(...D.temperature_2m_max);
  const span = Math.max(1, hi - lo);
  let dd = '';
  for (let i = 0; i < D.time.length; i++) {
    const a = ((D.temperature_2m_min[i] - lo) / span) * 100;
    const b = ((D.temperature_2m_max[i] - lo) / span) * 100;
    const pp = D.precipitation_probability_max[i];
    dd += `<div class="dy">
      <span class="d">${dayLabel(D.time[i], i)}</span>
      <span class="i">${icon(D.weather_code[i], 1)}</span>
      <span class="p">${pp >= 10 ? pp + '%' : ''}</span>
      <span class="lo">${T(D.temperature_2m_min[i])}</span>
      <span class="range"><i style="left:${a.toFixed(1)}%;right:${(100 - b).toFixed(1)}%"></i></span>
      <span class="hi">${T(D.temperature_2m_max[i])}</span>
    </div>`;
  }
  $('daily').innerHTML = dd;

  // UV
  const uv = H.uv_index[hi0] ?? 0;
  const uvMax = D.uv_index_max[0] ?? 0;
  $('uvNow').textContent = uv.toFixed(0);
  $('uvText').textContent = `${uvLevel(uv)} · 今天最高 ${uvMax.toFixed(0)}（${uvLevel(uvMax)}）`;
  $('uvDot').style.left = Math.min(100, (uv / 12) * 100) + '%';

  // Wind
  $('wind').textContent = windSpd(c.wind_speed_10m);
  $('windSub').textContent = `${dirText(c.wind_direction_10m)} · 阵风 ${windSpd(c.wind_gusts_10m)}`;

  // Humidity
  $('hum').textContent = c.relative_humidity_2m + '%';
  $('humSub').textContent = `露点 ${T(c.dew_point_2m)}`;

  // Sun
  $('sun').textContent = fmtClock(D.sunrise[0]);
  $('sunSub').textContent = `日落 ${fmtClock(D.sunset[0])}`;

  const ago = Math.round((Date.now() - lastFetch) / 60000);
  $('updated').textContent = lastFetch ? `更新于 ${ago <= 0 ? '刚刚' : ago + ' 分钟前'}` : '';
}

function uvLevel(u) {
  if (u < 3) return '低';
  if (u < 6) return '中等';
  if (u < 8) return '高';
  if (u < 11) return '很高';
  return '极高';
}

function renderNextHour(c, H, M, hi0, live) {
  const el = $('nextHour');
  const slots = [];
  if (M && M.time) {
    let mi = M.time.findIndex((t) => t >= c.time);
    if (mi < 0) mi = 0;
    for (let k = 0; k < 4 && mi + k < M.time.length; k++) {
      slots.push({ t: M.time[mi + k], v: M.precipitation[mi + k] ?? 0 });
    }
  }
  const prob = Math.max(H.precipitation_probability[hi0] ?? 0, H.precipitation_probability[hi0 + 1] ?? 0);
  const total = slots.reduce((s, x) => s + x.v, 0);
  // The first slot is "now": trust the live radar/station over the model when we have them.
  if (slots[0] && live && live.level != null) {
    const lv = live.level;
    slots[0].live = true;
    slots[0].lvl = lv;
    slots[0].modelMissed = lv >= 1 && slots[0].v < 0.004;
    if (lv >= 1 && slots[0].v < 0.004) slots[0].v = lv >= 3 ? 0.1 : lv >= 2 ? 0.04 : 0.01;
    if (lv < 1) slots[0].v = lv === 0.5 ? Math.min(slots[0].v, 0.003) : 0;
  }
  const rainingNow = (slots[0] && slots[0].v >= 0.004) || (!slots[0]?.live && c.precipitation > 0);
  const firstWet = slots.findIndex((x) => x.v >= 0.004);
  const firstDry = slots.findIndex((x) => x.v < 0.004);

  let head;
  if (rainingNow && slots[0]?.modelMissed) {
    head = '正在下雨（雷达实测）';
  } else if (rainingNow) {
    head = firstDry > 0 ? `正在下雨，约 ${firstDry * 15} 分钟后停` : '正在下雨，未来一小时会持续';
  } else if (firstWet > 0) {
    head = `约 ${firstWet * 15} 分钟后开始下雨`;
  } else if (prob >= 40) {
    head = '未来一小时预计无雨，但有下雨的可能';
  } else {
    head = '未来一小时不会下雨';
  }
  const clock = (t) => `${hourOf(t)}:${String(minOf(t)).padStart(2, '0')}`;
  const endOf = (t) => { let h = hourOf(t), m = minOf(t) + 15; if (m >= 60) { m -= 60; h = (h + 1) % 24; } return `${h}:${String(m).padStart(2, '0')}`; };
  const rows = slots.map((x) => {
    const rate = x.v * 4; // inches per hour
    let word = '无雨', cls = 'dry', w = 0;
    if (x.live && x.lvl === 0.5) { word = '零星'; cls = 'light'; w = 15; }
    if (x.v >= 0.004) {
      if (rate < 0.1) { word = '小雨'; cls = 'light'; w = 33; }
      else if (rate < 0.3) { word = '中雨'; cls = 'mod'; w = 66; }
      else { word = '大雨'; cls = 'heavy'; w = 100; }
    }
    return `<div class="nh-row ${cls}">
      <span class="nh-t">${clock(x.t)}–${endOf(x.t)}</span>
      <span class="nh-w">${word}</span>
      <span class="nh-meter"><i style="width:${w}%"></i></span>
      <span class="nh-a">${x.live ? '雷达实测' : x.v >= 0.004 ? rainAmt(x.v) : ''}</span>
    </div>`;
  }).join('');
  el.innerHTML = `<div class="headline">${head}</div>
    <div class="nh-rows">${rows}</div>
    <div class="tile-sub nh-foot">这一小时的降雨概率 ${prob}%${total >= 0.004 ? ` · 合计约 ${rainAmt(total)}` : ''}<br>${slots[0]?.live ? (slots[0].modelMissed ? '<b>模型没算到这场雨，后面三行仅供参考，看下面雷达动画里雨区往哪走更准。</b><br>' : '') + '第一行来自实时雷达' + (live.station ? `和 ${live.station.station} 气象站（${live.station.text || '无描述'}）` : '') + '，后面三行是 HRRR 模型预报。' : '这几行都是模型预报，暂时读不到实时雷达。'}</div>`;
}

/* ---------- Load ---------- */
async function load(force) {
  if (!force && Date.now() - lastFetch < 60 * 1000) return;
  $('refreshBtn').classList.add('spin');
  try {
    const [om, nws, rad] = await Promise.all([
      fetchOpenMeteo(place.lat, place.lon),
      fetchNws(place.lat, place.lon).catch(() => null),
      sampleRadar(place.lat, place.lon).catch(() => null),
    ]);
    lastData = om; lastNws = nws; lastRadar = rad; lastFetch = Date.now();
    if (place.auto && nws?.city) { place.name = nws.city; store.set('place', place); $('placeName').textContent = place.name; }
    store.set('cache', { key: place.lat + ',' + place.lon, om, nws, at: lastFetch });
    render();
  } catch (e) {
    $('updated').innerHTML = `<span class="err">无法获取最新数据（${e.message}）。请检查网络后点刷新。</span>`;
  } finally {
    $('refreshBtn').classList.remove('spin');
  }
}

/* ---------- Radar ---------- */
// Past: observed NEXRAD composite, every 5 min for the last 50 min.
// Future: HRRR model simulated reflectivity, every 15 min for 2 hours, then hourly out to 12 hours.
const IEM = 'https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/';
const PAST = ['m50m', 'm45m', 'm40m', 'm35m', 'm30m', 'm25m', 'm20m', 'm15m', 'm10m', 'm05m', ''];
const FUTURE_MIN = [15, 30, 45, 60, 75, 90, 105, 120, 180, 240, 300, 360, 420, 480, 540, 600, 660, 720];
let map, frames = [], radarLayers = [], frame = 0, nowIdx = PAST.length - 1, playing = null, hereMarker;

async function hrrrInit() {
  // Latest HRRR run time published by IEM; fall back to an estimate (runs arrive ~2 h after start).
  try {
    const r = await fetch('https://mesonet.agron.iastate.edu/data/gis/images/4326/hrrr/refd_0000.json', { cache: 'no-store' });
    const j = await r.json();
    const t = Date.parse(j.model_init_utc);
    if (t) return t;
  } catch {}
  const h = 3600e3;
  return Math.floor((Date.now() - 2 * h) / h) * h;
}

function clockLabel(ms) {
  const d = new Date(ms);
  const t = d.toLocaleTimeString('zh-CN', { hour: 'numeric', minute: '2-digit', hour12: false });
  return d.getDate() !== new Date().getDate() ? '明天 ' + t : t;
}

async function buildFrames() {
  const v = Math.floor(Date.now() / 300000);
  const out = PAST.map((f, k) => {
    const mins = (PAST.length - 1 - k) * 5;
    return { url: `${IEM}nexrad-n0q-900913${f ? '-' + f : ''}/{z}/{x}/{y}.png?_=${v}`, label: mins ? `${mins} 分钟前` : '现在', future: false };
  });
  const init = await hrrrInit();
  const q = 15 * 60e3;
  const now = Date.now();
  const seen = new Set();
  for (const m of FUTURE_MIN) {
    const step = m > 120 ? 4 * q : q;
    const valid = Math.round((now + m * 60e3) / step) * step;
    const fmin = Math.round((valid - init) / 60e3);
    if (fmin < 15 || fmin > 18 * 60 || seen.has(fmin)) continue;
    seen.add(fmin);
    const F = String(fmin).padStart(4, '0');
    out.push({ url: `${IEM}hrrr::REFD-F${F}-0/{z}/{x}/{y}.png?_=${Math.floor(init / 60000)}`, label: `预报 ${clockLabel(valid)}`, future: true });
  }
  return out;
}

async function initRadar() {
  if (!window.L) { $('radar').textContent = '地图库加载失败'; return; }
  // One finger scrolls the page; pinch zooms. Tap 放大 to pan the map freely in full screen.
  map = L.map('radar', { zoomControl: false, attributionControl: true, dragging: false, tap: false }).setView([place.lat, place.lon], 8);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
    subdomains: 'abcd', maxZoom: 13, attribution: '© OpenStreetMap © CARTO',
  }).addTo(map);
  $('radarFull').addEventListener('click', toggleFull);
  hereMarker = L.marker([place.lat, place.lon], { icon: L.divIcon({ className: '', html: '<div class="here-dot"></div>', iconSize: [14, 14] }) }).addTo(map);
  $('radarSlider').addEventListener('input', (e) => { stop(); showFrame(+e.target.value); });
  $('radarPlay').addEventListener('click', () => (playing ? stop() : play()));
  await loadFrames();
}

async function loadFrames() {
  frames = await buildFrames();
  radarLayers.forEach((l) => map.removeLayer(l));
  // Layers join the map only when first shown (plus the next one ahead), to keep data use down.
  radarLayers = frames.map((f) => L.tileLayer(f.url, { opacity: 0, maxZoom: 13, maxNativeZoom: 11, detectRetina: true, attribution: 'NEXRAD / HRRR via IEM' }));
  $('radarSlider').max = frames.length - 1;
  $('radarNowMark').style.left = (nowIdx / (frames.length - 1)) * 100 + '%';
  showFrame(nowIdx);
}

function showFrame(i) {
  frame = i;
  [i, i + 1].forEach((k) => { if (radarLayers[k] && !map.hasLayer(radarLayers[k])) radarLayers[k].addTo(map); });
  radarLayers.forEach((l, k) => l.setOpacity(k === i ? 0.75 : 0));
  $('radarSlider').value = i;
  const f = frames[i];
  $('radarTime').textContent = f.label;
  $('radarTime').classList.toggle('future', f.future);
  $('radar').classList.toggle('future', f.future);
}
function toggleFull() {
  const card = $('radar').closest('.card');
  const full = !card.classList.contains('full');
  card.classList.toggle('full', full);
  document.body.classList.toggle('noscroll', full);
  $('radarFull').textContent = full ? '完成' : '放大';
  if (full) { map.dragging.enable(); map.addControl(zoomCtl); } else { map.dragging.disable(); map.removeControl(zoomCtl); }
  setTimeout(() => map.invalidateSize(), 50);
}
const zoomCtl = window.L ? L.control.zoom({ position: 'topright' }) : null;
function play() {
  $('radarPlay').textContent = '暂停';
  playing = setInterval(() => showFrame(frame >= frames.length - 1 ? 0 : frame + 1), 600);
}
function stop() {
  if (playing) clearInterval(playing);
  playing = null;
  $('radarPlay').textContent = '播放';
}
function refreshRadar() {
  if (!map) return;
  stop();
  loadFrames();
}

/* ---------- Place picker ---------- */
function setPlace(p) {
  place = p;
  store.set('place', p);
  $('placeName').textContent = p.name;
  $('search').hidden = true;
  if (map) { map.setView([p.lat, p.lon], 8); hereMarker.setLatLng([p.lat, p.lon]); }
  load(true);
}
$('placeBtn').addEventListener('click', () => {
  $('search').hidden = !$('search').hidden;
  if (!$('search').hidden) $('searchInput').focus();
});
$('homeBtn').addEventListener('click', () => setPlace({ ...HOME }));
$('locateBtn').addEventListener('click', () => {
  if (!navigator.geolocation) return;
  $('locateBtn').textContent = '正在定位…';
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      $('locateBtn').textContent = '使用我现在的位置';
      setPlace({ name: '我的位置', lat: +pos.coords.latitude.toFixed(4), lon: +pos.coords.longitude.toFixed(4), auto: true });
    },
    () => { $('locateBtn').textContent = '定位失败，请在设置里允许位置权限'; },
    { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 }
  );
});
$('searchForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const q = $('searchInput').value.trim();
  if (!q) return;
  const ul = $('searchResults');
  ul.innerHTML = '<li class="tile-sub">搜索中…</li>';
  try {
    const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=8&language=zh&format=json`);
    const j = await r.json();
    ul.innerHTML = '';
    (j.results || []).forEach((g) => {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.innerHTML = `${g.name} <small>${[g.admin1, g.country].filter(Boolean).join(', ')}</small>`;
      b.addEventListener('click', () => setPlace({ name: g.name + (g.admin1 ? ', ' + g.admin1 : ''), lat: g.latitude, lon: g.longitude }));
      li.append(b);
      ul.append(li);
    });
    if (!ul.children.length) ul.innerHTML = '<li class="tile-sub">没找到，换个写法试试（英文城市名更准）</li>';
  } catch {
    ul.innerHTML = '<li class="tile-sub err">搜索失败，请检查网络</li>';
  }
});
$('unitBtn').addEventListener('click', () => {
  unit = unit === 'F' ? 'C' : 'F';
  store.set('unit', unit);
  $('unitBtn').textContent = '°' + unit;
  render();
});
$('refreshBtn').addEventListener('click', () => { load(true); refreshRadar(); });
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && Date.now() - lastFetch > REFRESH_MS) { load(true); refreshRadar(); }
});
setInterval(() => { if (document.visibilityState === 'visible') { load(true); refreshRadar(); } }, REFRESH_MS);

/* ---------- Boot ---------- */
$('placeName').textContent = place.name;
$('unitBtn').textContent = '°' + unit;
const cached = store.get('cache', null);
if (cached && cached.key === place.lat + ',' + place.lon) {
  lastData = cached.om; lastNws = cached.nws; lastFetch = cached.at;
  try { render(); } catch {}
}
initRadar().catch((e) => console.error(e));
load(true);

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
