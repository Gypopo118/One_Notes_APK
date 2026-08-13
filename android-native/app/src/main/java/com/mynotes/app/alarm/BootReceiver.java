package com.mynotes.app.alarm;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

import java.util.List;

/**
 * AlarmManager полностью забывает все запланированные алармы после
 * перезагрузки устройства — единственный источник правды после reboot это
 * наше собственное хранилище (см. AlarmScheduler), которое мы перечитываем
 * здесь и переставляем заново.
 */
public class BootReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent.getAction();
        if (action == null) return;
        boolean isBootAction =
                Intent.ACTION_BOOT_COMPLETED.equals(action)
                        || "android.intent.action.QUICKBOOT_POWERON".equals(action)
                        || "com.htc.intent.action.QUICKBOOT_POWERON".equals(action);
        if (!isBootAction) return;

        long now = System.currentTimeMillis();
        List<AlarmScheduler.AlarmEntry> all = AlarmScheduler.loadAll(context);
        for (AlarmScheduler.AlarmEntry e : all) {
            if (e.triggerAt <= now) {
                // Пропущенный во время выключения будильник — не молчим,
                // ставим на срабатывание почти немедленно (+3с) вместо того
                // чтобы тихо его потерять.
                e.triggerAt = now + 3000;
            }
            AlarmScheduler.armSystemAlarm(context, e);
        }
    }
}
