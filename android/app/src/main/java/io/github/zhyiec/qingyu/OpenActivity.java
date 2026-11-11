package io.github.zhyiec.qingyu;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.widget.Toast;

/**
 * Opening the app asks for location once (so the widget follows the phone),
 * then opens 晴雨 in the browser / installed web app.
 */
public class OpenActivity extends Activity {
    private static final int REQ_FG = 1, REQ_BG = 2;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        if (checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.ACCESS_COARSE_LOCATION}, REQ_FG);
        } else if (needsBackground()) {
            askBackground();
        } else {
            done();
        }
    }

    private boolean needsBackground() {
        return Build.VERSION.SDK_INT >= 29
                && checkSelfPermission(Manifest.permission.ACCESS_BACKGROUND_LOCATION) != PackageManager.PERMISSION_GRANTED
                && !getSharedPreferences("w", MODE_PRIVATE).getBoolean("askedBg", false);
    }

    private void askBackground() {
        getSharedPreferences("w", MODE_PRIVATE).edit().putBoolean("askedBg", true).apply();
        Toast.makeText(this, "请选择“始终允许”，小组件才能在后台跟着你的位置更新", Toast.LENGTH_LONG).show();
        requestPermissions(new String[]{Manifest.permission.ACCESS_BACKGROUND_LOCATION}, REQ_BG);
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] perms, int[] res) {
        if (code == REQ_FG && res.length > 0 && res[0] == PackageManager.PERMISSION_GRANTED && needsBackground()) {
            askBackground();
            return;
        }
        done();
    }

    private void done() {
        // Self-check: fetch right now and say what happened, so a stuck widget explains itself.
        final android.content.Context app = getApplicationContext();
        new Thread(() -> {
            String err = WeatherWidget.fetchAndRender(app);
            int t = app.getSharedPreferences("w", MODE_PRIVATE).getInt("temp", 0);
            String msg = err == null ? "晴雨小组件 " + BuildConfig.VERSION_NAME + "：已更新 " + t + "°"
                    : "晴雨小组件 " + BuildConfig.VERSION_NAME + " 更新失败：" + err;
            new android.os.Handler(android.os.Looper.getMainLooper()).post(() -> Toast.makeText(app, msg, Toast.LENGTH_LONG).show());
        }).start();
        WeatherJob.schedulePeriodic(this);
        WeatherWidget.scheduleAlarm(this);
        startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(WeatherWidget.APP_URL)));
        finish();
    }
}
