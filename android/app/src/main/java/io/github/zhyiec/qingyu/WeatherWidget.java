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
        // Show the last good reading at once, then fetch in a background job that waits for a network
        // and has minutes (not the ~10 s a broadcast gets) to finish.
        render(ctx, mgr, ids);
        WeatherJob.scheduleNow(ctx);
        WeatherJob.schedulePeriodic(ctx);
    }

    @Override
    public void onReceive(Context ctx, Intent intent) {
        // After an app update, redraw right away so the new look shows without waiting 30 minutes.
        if (Intent.ACTION_MY_PACKAGE_REPLACED.equals(intent.getAction())) {
            refreshAll(ctx);
            return;
        }
        super.onReceive(ctx, intent);
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

    /**
     * Fetches fresh weather, saves it, and redraws. Returns null on success, or a short reason on failure.
     * The model reading is saved and drawn first; the slower station reading only refines it.
     */
    static String fetchAndRender(Context ctx) {
        double[] loc = location(ctx);
        SharedPreferences sp = ctx.getSharedPreferences("w", Context.MODE_PRIVATE);
        AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
        int[] ids = mgr.getAppWidgetIds(new ComponentName(ctx, WeatherWidget.class));
        try {
            String url = String.format(Locale.US,
                    "https://api.open-meteo.com/v1/forecast?latitude=%.3f&longitude=%.3f"
                            + "&current=temperature_2m,weather_code,is_day&temperature_unit=fahrenheit&timezone=auto",
                    loc[0], loc[1]);
            JSONObject cur = new JSONObject(get(url, 15000)).getJSONObject("current");
            sp.edit().putInt("temp", (int) Math.round(cur.getDouble("temperature_2m")))
                    .putInt("code", cur.getInt("weather_code"))
                    .putBoolean("day", cur.getInt("is_day") == 1)
                    .putLong("at", System.currentTimeMillis())
                    .remove("err")
                    .apply();
            render(ctx, mgr, ids);
        } catch (Exception e) {
            String why = e.getClass().getSimpleName() + (e.getMessage() != null ? ": " + e.getMessage() : "");
            sp.edit().putString("err", why).apply();
            render(ctx, mgr, ids);
            return why;
        }
        Double obs = stationTempF(ctx, loc); // real thermometer beats the model estimate
        if (obs != null) {
            sp.edit().putInt("temp", (int) Math.round(obs)).apply();
            render(ctx, mgr, ids);
        }
        return null;
    }

    /** Draws the last saved reading; never blanks the widget when a fetch fails. */
    static void render(Context ctx, AppWidgetManager mgr, int[] ids) {
        SharedPreferences sp = ctx.getSharedPreferences("w", Context.MODE_PRIVATE);
        RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.widget);
        Intent open = new Intent(Intent.ACTION_VIEW, Uri.parse(APP_URL));
        v.setOnClickPendingIntent(R.id.root, PendingIntent.getActivity(ctx, 0, open, PendingIntent.FLAG_IMMUTABLE));
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
                JSONObject pt = new JSONObject(get("https://api.weather.gov/points/" + key));
                String stUrl = pt.getJSONObject("properties").getString("observationStations");
                station = new JSONObject(get(stUrl)).getJSONArray("features").getJSONObject(0)
                        .getJSONObject("properties").getString("stationIdentifier");
                sp.edit().putString("stKey", key).putString("st", station).apply();
            }
            JSONObject p = new JSONObject(get("https://api.weather.gov/stations/" + station + "/observations/latest"))
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
