// 晴雨小组件 · 在 Scriptable 中运行
// 桌面显示当前温度，下面是天气符号。点一下打开晴雨天气 app。
// 数据：Open-Meteo（免费，无需密钥）

const APP_URL = "https://zhyiec-code.github.io/weather/";
const HOME = { lat: 29.776, lon: -95.535, name: "Memorial" }; // 定位失败时用这里
const UNIT = "F"; // 想看摄氏度改成 "C"

// WMO 天气代码 → SF Symbols 图标和中文
function symbolFor(code, isDay) {
  if (code === 0 || code === 1) return [isDay ? "sun.max.fill" : "moon.stars.fill", code === 0 ? "晴" : "大致晴朗"];
  if (code === 2) return [isDay ? "cloud.sun.fill" : "cloud.moon.fill", "局部多云"];
  if (code === 3) return ["cloud.fill", "阴"];
  if (code === 45 || code === 48) return ["cloud.fog.fill", "雾"];
  if ([51, 53, 55].includes(code)) return ["cloud.drizzle.fill", "毛毛雨"];
  if ([56, 57, 66, 67].includes(code)) return ["cloud.sleet.fill", "冻雨"];
  if ([61, 63, 80, 81].includes(code)) return ["cloud.rain.fill", "雨"];
  if ([65, 82].includes(code)) return ["cloud.heavyrain.fill", "大雨"];
  if ([71, 73, 75, 77, 85, 86].includes(code)) return ["cloud.snow.fill", "雪"];
  if ([95, 96, 99].includes(code)) return ["cloud.bolt.rain.fill", "雷暴"];
  return ["cloud.fill", ""];
}

async function getLocation() {
  try {
    Location.setAccuracyToThreeKilometers();
    const l = await Location.current();
    return { lat: l.latitude, lon: l.longitude };
  } catch (e) {
    return HOME;
  }
}

async function getWeather(loc) {
  const url = "https://api.open-meteo.com/v1/forecast"
    + `?latitude=${loc.lat}&longitude=${loc.lon}`
    + "&current=temperature_2m,weather_code,is_day"
    + "&daily=temperature_2m_max,temperature_2m_min&forecast_days=1"
    + `&temperature_unit=${UNIT === "C" ? "celsius" : "fahrenheit"}&timezone=auto`;
  const req = new Request(url);
  return await req.loadJSON();
}

function topColor(code, isDay) {
  if (!isDay) return ["#0b1630", "#26406e"];
  if ([95, 96, 99].includes(code)) return ["#1d2533", "#46506a"];
  if (code >= 51) return ["#2f4256", "#5f7487"];
  if (code === 3 || code === 45 || code === 48) return ["#4f6b86", "#95a9bd"];
  return ["#1f6fc0", "#78b8ea"];
}

async function build() {
  const w = new ListWidget();
  w.url = APP_URL;
  w.setPadding(12, 12, 12, 12);
  let data;
  try {
    data = await getWeather(await getLocation());
  } catch (e) {
    w.backgroundColor = new Color("#2a4a6b");
    const t = w.addText("无网络");
    t.textColor = Color.white();
    return w;
  }
  const c = data.current;
  const isDay = c.is_day === 1;
  const [sym, label] = symbolFor(c.weather_code, isDay);
  const [a, b] = topColor(c.weather_code, isDay);
  const g = new LinearGradient();
  g.colors = [new Color(a), new Color(b)];
  g.locations = [0, 1];
  w.backgroundGradient = g;

  const family = config.widgetFamily || "small";

  if (family === "accessoryCircular" || family === "accessoryInline" || family === "accessoryRectangular") {
    // 锁屏小组件
    const st = w.addStack();
    st.layoutVertically();
    st.centerAlignContent();
    const t = st.addText(`${Math.round(c.temperature_2m)}°`);
    t.font = Font.boldSystemFont(20);
    t.centerAlignText();
    const img = st.addImage(SFSymbol.named(sym).image);
    img.imageSize = new Size(18, 18);
    img.centerAlignImage();
    return w;
  }

  w.addSpacer();
  const temp = w.addText(`${Math.round(c.temperature_2m)}°`);
  temp.font = Font.lightSystemFont(52);
  temp.textColor = Color.white();
  temp.centerAlignText();

  const s = SFSymbol.named(sym);
  s.applyFont(Font.systemFont(34));
  const img = w.addImage(s.image);
  img.imageSize = new Size(40, 40);
  img.centerAlignImage();
  // 彩色符号：太阳黄色，其余白色
  img.tintColor = sym.startsWith("sun") ? new Color("#ffc83d") : Color.white();

  w.addSpacer(4);
  const d = data.daily;
  const sub = w.addText(`${label}  ${Math.round(d.temperature_2m_max[0])}°/${Math.round(d.temperature_2m_min[0])}°`);
  sub.font = Font.mediumSystemFont(12);
  sub.textColor = new Color("#ffffff", 0.85);
  sub.centerAlignText();
  w.addSpacer();

  // 大约每 15 分钟刷新（iOS 决定实际刷新时间）
  w.refreshAfterDate = new Date(Date.now() + 15 * 60 * 1000);
  return w;
}

const widget = await build();
if (config.runsInWidget) {
  Script.setWidget(widget);
} else {
  await widget.presentSmall();
}
Script.complete();
