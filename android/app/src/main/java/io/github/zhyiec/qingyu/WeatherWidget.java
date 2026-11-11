package io.github.zhyiec.qingyu;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.location.Address;
import android.location.Geocoder;
import android.location.Location;
import android.location.LocationManager;
import android.net.Uri;
import android.os.Build;
import android.widget.RemoteViews;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.List;
import java.util.Locale;

/** Home-screen widget: current temperature with a weather symbol under it. */
public class WeatherWidget extends AppWidgetProvider {
    static final String APP_URL = "https://zhyiec-code.github.io/Weather-/";
    // Used until the phone has a location fix: Houston · Memorial
    static final double HOME_LAT = 29.776, HOME_LON = -95.535;

    @Override
    public void onUpdate(Context ctx, AppWidgetManager mgr, int[] ids) {
        // Show the last good reading at once, then fetch straight away inside this broadcast
        // (quick model request only). Background jobs alone proved unreliable: Android defers them
        // for hours when the app is rarely opened, which froze the widget on one reading.
        try {
            render(ctx, mgr, ids);
            scheduleAlarm(ctx);
            WeatherJob.schedulePeriodic(ctx);
        } catch (Throwable t) {
            note(ctx, t);
        }
        final PendingResult pending = goAsync();
        final Context app = ctx.getApplicationContext();
        new Thread(() -> {
            try {
                // Same order as the web app: station thermometer when fresh, model otherwise.
                if (fetchModel(app, 4000) != null) WeatherJob.scheduleNow(app); // retry when network allows
                else refineWithStation(app);
            } catch (Throwable t) {
                note(app, t);
            } finally {
                pending.finish();
            }
        }).start();
    }

    /** Keeps a widget problem from crashing the app; remembers it for the self-check. */
    static void note(Context ctx, Throwable t) {
        try {
            ctx.getSharedPreferences("w", Context.MODE_PRIVATE).edit()
                    .putString("crash", t.getClass().getSimpleName() + ": " + t.getMessage()).apply();
        } catch (Throwable ignored) {
        }
    }

    @Override
    public void onReceive(Context ctx, Intent intent) {
        // After an app update, redraw right away so the new look shows without waiting 30 minutes.
        if (Intent.ACTION_MY_PACKAGE_REPLACED.equals(intent.getAction())) {
            try { refreshAll(ctx); } catch (Throwable t) { note(ctx, t); }
            return;
        }
        super.onReceive(ctx, intent);
    }

    /** A 15-minute repeating alarm as a second trigger next to the system's 30-minute widget timer. */
    static void scheduleAlarm(Context ctx) {
        AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
        Intent i = new Intent(ctx, WeatherWidget.class).setAction(AppWidgetManager.ACTION_APPWIDGET_UPDATE)
                .putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, mgr.getAppWidgetIds(new ComponentName(ctx, WeatherWidget.class)));
        PendingIntent pi = PendingIntent.getBroadcast(ctx, 7, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        android.app.AlarmManager am = ctx.getSystemService(android.app.AlarmManager.class);
        am.setInexactRepeating(android.app.AlarmManager.ELAPSED_REALTIME,
                android.os.SystemClock.elapsedRealtime() + android.app.AlarmManager.INTERVAL_FIFTEEN_MINUTES,
                android.app.AlarmManager.INTERVAL_FIFTEEN_MINUTES, pi);
    }

    static void refreshAll(Context ctx) {
        AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
        int[] ids = mgr.getAppWidgetIds(new ComponentName(ctx, WeatherWidget.class));
        if (ids.length == 0) return;
        Intent i = new Intent(ctx, WeatherWidget.class);
        i.setAction(AppWidgetManager.ACTION_APPWIDGET_UPDATE);
        i.putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, ids);
        ctx.sendBroadcast(i);
    }

    /** Full refresh: model reading first, then the nearest station's thermometer if it is fresh. */
    static String fetchAndRender(Context ctx) {
        String err = fetchModel(ctx, 15000);
        if (err != null) return err;
        refineWithStation(ctx);
        return null;
    }

    /** Model reading for the phone's location; saved and drawn. Null on success, else the reason. */
    static String fetchModel(Context ctx, int timeoutMs) {
        double[] loc = location(ctx);
        SharedPreferences sp = ctx.getSharedPreferences("w", Context.MODE_PRIVATE);
        try {
            String url = String.format(Locale.US,
                    "https://api.open-meteo.com/v1/forecast?latitude=%.3f&longitude=%.3f"
                            + "&current=temperature_2m,weather_code,is_day&temperature_unit=fahrenheit&timezone=auto",
                    loc[0], loc[1]);
            JSONObject cur = new JSONObject(get(url, timeoutMs)).getJSONObject("current");
            SharedPreferences.Editor ed = sp.edit();
            ed.putInt("temp", (int) Math.round(cur.getDouble("temperature_2m")));
            ed.putInt("code", cur.getInt("weather_code"))
                    .putBoolean("day", cur.getInt("is_day") == 1)
                    .putLong("at", System.currentTimeMillis())
                    .remove("err")
                    .apply();
            renderAll(ctx);
            return null;
        } catch (Exception e) {
            String why = e.getClass().getSimpleName() + (e.getMessage() != null ? ": " + e.getMessage() : "");
            sp.edit().putString("err", why).putLong("errAt", System.currentTimeMillis()).apply();
            renderAll(ctx);
            return why;
        }
    }

    static void refineWithStation(Context ctx) {
        Double obs = stationTempF(ctx, location(ctx));
        if (obs != null) {
            ctx.getSharedPreferences("w", Context.MODE_PRIVATE).edit().putInt("temp", (int) Math.round(obs))
                    .putLong("obsAt", System.currentTimeMillis()).apply();
            renderAll(ctx);
        }
    }

    static void renderAll(Context ctx) {
        try {
            AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
            render(ctx, mgr, mgr.getAppWidgetIds(new ComponentName(ctx, WeatherWidget.class)));
        } catch (Throwable t) {
            note(ctx, t);
        }
    }

    /** Draws the last saved reading; never blanks the widget when a fetch fails. */
    static void render(Context ctx, AppWidgetManager mgr, int[] ids) {
        SharedPreferences sp = ctx.getSharedPreferences("w", Context.MODE_PRIVATE);
        RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.widget);
        // Tapping opens 晴雨 directly. (Routing the tap through our own screen to refresh first
        // stopped the web app from opening on Yu's phone, so the widget refreshes on its timers instead.)
        Intent open = new Intent(Intent.ACTION_VIEW, Uri.parse(APP_URL));
        v.setOnClickPendingIntent(R.id.root, PendingIntent.getActivity(ctx, 0, open,
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT));
        long at = sp.getLong("at", 0), errAt = sp.getLong("errAt", 0);
        java.text.SimpleDateFormat hm = new java.text.SimpleDateFormat("H:mm", Locale.US);
        if (errAt > at) v.setTextViewText(R.id.updated, "⚠ " + hm.format(new java.util.Date(errAt)));
        else if (at > 0) v.setTextViewText(R.id.updated, hm.format(new java.util.Date(at)));
        if (!sp.contains("temp")) {
            v.setTextViewText(R.id.temp, sp.contains("err") ? "!" : "…");
        } else {
            int code = sp.getInt("code", 3);
            boolean day = sp.getBoolean("day", true);
            v.setTextViewText(R.id.temp, sp.getInt("temp", 0) + "°");
            v.setImageViewResource(R.id.icon, iconFor(code, day));
            v.setTextViewText(R.id.cond, condFor(code, day));
        }
        for (int id : ids) mgr.updateAppWidget(id, v);
    }

    /** Newest location the phone already knows (no GPS wake-up), else the last one saved, else Memorial. */
    static double[] location(Context ctx) {
        SharedPreferences sp = ctx.getSharedPreferences("w", Context.MODE_PRIVATE);
        if (ctx.checkSelfPermission(android.Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED) {
            try {
                LocationManager lm = (LocationManager) ctx.getSystemService(Context.LOCATION_SERVICE);
                Location best = null;
                for (String p : lm.getProviders(true)) {
                    Location l = lm.getLastKnownLocation(p);
                    if (l != null && (best == null || l.getTime() > best.getTime())) best = l;
                }
                if (best != null) {
                    double la = Math.round(best.getLatitude() * 1000) / 1000.0;
                    double lo = Math.round(best.getLongitude() * 1000) / 1000.0;
                    sp.edit().putString("lat", String.valueOf(la)).putString("lon", String.valueOf(lo)).apply();
                    return new double[]{la, lo};
                }
            } catch (SecurityException ignored) {
            }
        }
        String la = sp.getString("lat", null), lo = sp.getString("lon", null);
        if (la != null && lo != null) return new double[]{Double.parseDouble(la), Double.parseDouble(lo)};
        return new double[]{HOME_LAT, HOME_LON};
    }

    /** Latest reading from the nearest NWS station if it is under 90 minutes old, else null. */
    static Double stationTempF(Context ctx, double[] loc) {
        try {
            SharedPreferences sp = ctx.getSharedPreferences("w", Context.MODE_PRIVATE);
            String key = String.format(Locale.US, "%.2f,%.2f", loc[0], loc[1]);
            String station = key.equals(sp.getString("stKey", "")) ? sp.getString("st", null) : null;
            if (station == null) {
                JSONObject pt = new JSONObject(get("https://api.weather.gov/points/" + key, 2500));
                String stUrl = pt.getJSONObject("properties").getString("observationStations");
                station = new JSONObject(get(stUrl, 2500)).getJSONArray("features").getJSONObject(0)
                        .getJSONObject("properties").getString("stationIdentifier");
                sp.edit().putString("stKey", key).putString("st", station).apply();
            }
            JSONObject p = new JSONObject(get("https://api.weather.gov/stations/" + station + "/observations/latest", 3000))
                    .getJSONObject("properties");
            long t = java.time.OffsetDateTime.parse(p.getString("timestamp")).toInstant().toEpochMilli();
            if (System.currentTimeMillis() - t > 90 * 60 * 1000L) return null;
            JSONObject temp = p.getJSONObject("temperature");
            if (temp.isNull("value")) return null;
            return temp.getDouble("value") * 9 / 5 + 32;
        } catch (Exception e) {
            return null;
        }
    }

    static String placeName(Context ctx, double[] loc) {
        if (loc[0] == HOME_LAT && loc[1] == HOME_LON) return "Memorial";
        try {
            List<Address> a = new Geocoder(ctx, Locale.US).getFromLocation(loc[0], loc[1], 1);
            if (a != null && !a.isEmpty()) {
                String n = a.get(0).getSubLocality();
                if (n == null) n = a.get(0).getLocality();
                if (n != null) return n;
            }
        } catch (Exception ignored) {
        }
        return "";
    }

    static String get(String u) throws Exception {
        return get(u, 6000);
    }

    static String get(String u, int timeoutMs) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(u).openConnection();
        c.setConnectTimeout(timeoutMs);
        c.setReadTimeout(timeoutMs);
        c.setRequestProperty("User-Agent", "QingyuWidget/1.6 (personal weather widget)");
        c.setRequestProperty("Accept", "application/geo+json, application/json");
        int code = c.getResponseCode();
        if (code != 200) throw new Exception("HTTP " + code + " " + new URL(u).getHost());
        try (BufferedReader r = new BufferedReader(new InputStreamReader(c.getInputStream()))) {
            StringBuilder sb = new StringBuilder();
            String line;
            while ((line = r.readLine()) != null) sb.append(line);
            return sb.toString();
        } finally {
            c.disconnect();
        }
    }

    static int iconFor(int code, boolean day) {
        if (code == 0 || code == 1) return day ? R.drawable.ic_sun : R.drawable.ic_moon;
        if (code == 2) return day ? R.drawable.ic_partly_day : R.drawable.ic_partly_night;
        if (code == 3) return R.drawable.ic_cloud;
        if (code == 45 || code == 48) return R.drawable.ic_fog;
        if (code >= 71 && code <= 77 || code == 85 || code == 86) return R.drawable.ic_snow;
        if (code >= 95) return R.drawable.ic_storm;
        if (code >= 51) return R.drawable.ic_rain;
        return R.drawable.ic_cloud;
    }

    static String condFor(int code, boolean day) {
        if (code == 0) return day ? "晴" : "晴朗";
        if (code == 1) return "大致晴朗";
        if (code == 2) return "局部多云";
        if (code == 3) return "阴";
        if (code == 45 || code == 48) return "雾";
        if (code >= 51 && code <= 57) return "毛毛雨";
        if (code == 61 || code == 80) return "小雨";
        if (code == 63 || code == 81) return "中雨";
        if (code == 65 || code == 82) return "大雨";
        if (code == 66 || code == 67) return "冻雨";
        if (code >= 71 && code <= 86) return "雪";
        if (code >= 95) return "雷暴";
        return "";
    }
}
