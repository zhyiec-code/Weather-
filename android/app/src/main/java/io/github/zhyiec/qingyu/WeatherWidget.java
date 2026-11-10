package io.github.zhyiec.qingyu;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.widget.RemoteViews;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;

/** Home-screen widget: current temperature with a weather symbol under it. */
public class WeatherWidget extends AppWidgetProvider {
    static final String APP_URL = "https://zhyiec-code.github.io/Weather-/";
    // Houston · Memorial
    static final double LAT = 29.776, LON = -95.535;

    @Override
    public void onUpdate(Context ctx, AppWidgetManager mgr, int[] ids) {
        final PendingResult pending = goAsync();
        final Context app = ctx.getApplicationContext();
        new Thread(() -> {
            try {
                update(app, mgr, ids);
            } finally {
                pending.finish();
            }
        }).start();
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

    static void update(Context ctx, AppWidgetManager mgr, int[] ids) {
        RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.widget);
        Intent open = new Intent(Intent.ACTION_VIEW, Uri.parse(APP_URL));
        v.setOnClickPendingIntent(R.id.root, PendingIntent.getActivity(ctx, 0, open, PendingIntent.FLAG_IMMUTABLE));
        try {
            String url = "https://api.open-meteo.com/v1/forecast?latitude=" + LAT + "&longitude=" + LON
                    + "&current=temperature_2m,weather_code,is_day&temperature_unit=fahrenheit&timezone=auto";
            JSONObject cur = new JSONObject(get(url)).getJSONObject("current");
            int temp = (int) Math.round(cur.getDouble("temperature_2m"));
            int code = cur.getInt("weather_code");
            boolean day = cur.getInt("is_day") == 1;
            v.setTextViewText(R.id.temp, temp + "°");
            v.setImageViewResource(R.id.icon, iconFor(code, day));
            v.setTextViewText(R.id.cond, condFor(code, day));
        } catch (Exception e) {
            v.setTextViewText(R.id.cond, "无网络");
        }
        for (int id : ids) mgr.updateAppWidget(id, v);
    }

    static String get(String u) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(u).openConnection();
        c.setConnectTimeout(10000);
        c.setReadTimeout(10000);
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
