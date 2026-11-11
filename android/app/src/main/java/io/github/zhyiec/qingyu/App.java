package io.github.zhyiec.qingyu;

import android.app.Application;

/** Records any crash so the next launch can say what went wrong. */
public class App extends Application {
    @Override
    public void onCreate() {
        super.onCreate();
        final Thread.UncaughtExceptionHandler prev = Thread.getDefaultUncaughtExceptionHandler();
        Thread.setDefaultUncaughtExceptionHandler((t, e) -> {
            try {
                StackTraceElement[] st = e.getStackTrace();
                String where = st.length > 0 ? st[0].getClassName() + "." + st[0].getMethodName() + ":" + st[0].getLineNumber() : "";
                getSharedPreferences("w", MODE_PRIVATE).edit()
                        .putString("crash", e.getClass().getSimpleName() + ": " + e.getMessage() + " @ " + where).commit();
            } catch (Throwable ignored) {
            }
            if (prev != null) prev.uncaughtException(t, e);
        });
    }
}
