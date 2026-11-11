package io.github.zhyiec.qingyu;

import android.app.job.JobInfo;
import android.app.job.JobParameters;
import android.app.job.JobScheduler;
import android.app.job.JobService;
import android.content.ComponentName;
import android.content.Context;

/** Background fetch for the widget: waits for any network, retries on failure, repeats every 30 min. */
public class WeatherJob extends JobService {
    private static final int NOW = 1, PERIODIC = 2, STATION = 3;

    static void scheduleNow(Context ctx) {
        JobScheduler js = ctx.getSystemService(JobScheduler.class);
        js.schedule(new JobInfo.Builder(NOW, new ComponentName(ctx, WeatherJob.class))
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                .setBackoffCriteria(30_000, JobInfo.BACKOFF_POLICY_EXPONENTIAL)
                .build());
    }

    static void scheduleStation(Context ctx) {
        ctx.getSystemService(JobScheduler.class).schedule(new JobInfo.Builder(STATION, new ComponentName(ctx, WeatherJob.class))
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                .build());
    }

    static void schedulePeriodic(Context ctx) {
        JobScheduler js = ctx.getSystemService(JobScheduler.class);
        if (js.getPendingJob(PERIODIC) != null) return;
        js.schedule(new JobInfo.Builder(PERIODIC, new ComponentName(ctx, WeatherJob.class))
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                .setPeriodic(30 * 60 * 1000L)
                .setPersisted(false)
                .build());
    }

    @Override
    public boolean onStartJob(JobParameters params) {
        new Thread(() -> {
            boolean ok = true;
            try {
            if (params.getJobId() == STATION) {
                WeatherWidget.refineWithStation(getApplicationContext());
            } else {
                ok = WeatherWidget.fetchAndRender(getApplicationContext()) == null;
            }
            } catch (Throwable t) {
                WeatherWidget.note(getApplicationContext(), t);
            }
            jobFinished(params, !ok); // ask the system to retry later if it failed
        }).start();
        return true;
    }

    @Override
    public boolean onStopJob(JobParameters params) {
        return true;
    }
}
