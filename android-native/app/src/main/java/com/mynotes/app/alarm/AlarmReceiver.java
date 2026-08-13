package com.mynotes.app.alarm;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.PowerManager;

/**
 * Срабатывает по PendingIntent от AlarmManager.setAlarmClock().
 * Окно выполнения onReceive() у BroadcastReceiver ограничено (~10 сек до
 * возможного повторного Doze), поэтому здесь только:
 *  1) короткий PARTIAL_WAKE_LOCK, чтобы CPU не уснул раньше времени;
 *  2) немедленный запуск foreground-сервиса (весь долгий wake — уже на нём).
 */
public class AlarmReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        PowerManager pm = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
        PowerManager.WakeLock wl = null;
        if (pm != null) {
            wl = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "mynotes:alarm_trigger");
            wl.acquire(15000);
        }

        Intent serviceIntent = new Intent(context, AlarmService.class);
        serviceIntent.putExtra("id", intent.getLongExtra("id", 0));
        serviceIntent.putExtra("title", intent.getStringExtra("title"));
        serviceIntent.putExtra("body", intent.getStringExtra("body"));
        if (intent.hasExtra("soundUri")) {
            serviceIntent.putExtra("soundUri", intent.getStringExtra("soundUri"));
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(serviceIntent);
        } else {
            context.startService(serviceIntent);
        }

        if (wl != null && wl.isHeld()) wl.release();
    }
}
