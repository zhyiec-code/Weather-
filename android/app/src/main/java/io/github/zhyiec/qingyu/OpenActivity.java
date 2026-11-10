package io.github.zhyiec.qingyu;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;

/** Opening the app (or tapping the widget) opens 晴雨 in the browser / installed web app. */
public class OpenActivity extends Activity {
    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        WeatherWidget.refreshAll(this);
        startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(WeatherWidget.APP_URL)));
        finish();
    }
}
