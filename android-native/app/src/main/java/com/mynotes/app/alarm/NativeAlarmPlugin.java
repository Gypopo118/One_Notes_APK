package com.mynotes.app.alarm;

import android.app.AlarmManager;
import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "NativeAlarm")
public class NativeAlarmPlugin extends Plugin {

    @PluginMethod
    public void schedule(PluginCall call) {
        Long id = call.getLong("id");
        Long at = call.getLong("at"); // мс, unix timestamp
        String title = call.getString("title", "Напоминание");
        String body = call.getString("body", "");
        String soundUri = call.getString("soundUri", null);

        if (id == null || at == null) {
            call.reject("Требуются параметры id и at (timestamp в мс)");
            return;
        }
        AlarmScheduler.schedule(getContext(), id, at, title, body, soundUri);
        call.resolve();
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        Long id = call.getLong("id");
        if (id == null) { call.reject("Требуется параметр id"); return; }
        AlarmScheduler.cancel(getContext(), id);
        call.resolve();
    }

    @PluginMethod
    public void canScheduleExactAlarms(PluginCall call) {
        JSObject ret = new JSObject();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            AlarmManager am = (AlarmManager) getContext().getSystemService(Context.ALARM_SERVICE);
            ret.put("value", am != null && am.canScheduleExactAlarms());
        } else {
            ret.put("value", true); // до Android 12 отдельного разрешения не требовалось
        }
        call.resolve(ret);
    }

    @PluginMethod
    public void requestExactAlarmPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            Intent intent = new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM);
            intent.setData(Uri.parse("package:" + getContext().getPackageName()));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
        }
        call.resolve();
    }

    @PluginMethod
    public void requestFullScreenIntentPermission(PluginCall call) {
        // Только Android 14+ — на более старых версиях full-screen intent выдаётся автоматически.
        if (Build.VERSION.SDK_INT >= 34) {
            try {
                Intent intent = new Intent("android.settings.MANAGE_APP_USE_FULL_SCREEN_INTENT");
                intent.setData(Uri.parse("package:" + getContext().getPackageName()));
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(intent);
            } catch (Exception ignored) {}
        }
        call.resolve();
    }

    @PluginMethod
    public void requestIgnoreBatteryOptimizations(PluginCall call) {
        Context ctx = getContext();
        PowerManager pm = (PowerManager) ctx.getSystemService(Context.POWER_SERVICE);
        if (pm != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.M
                && !pm.isIgnoringBatteryOptimizations(ctx.getPackageName())) {
            try {
                Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
                intent.setData(Uri.parse("package:" + ctx.getPackageName()));
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                ctx.startActivity(intent);
            } catch (Exception ignored) {}
        }
        call.resolve();
    }

    /** Открывает системный выбор аудиофайла и запрашивает постоянный (persistable)
     *  доступ к URI, чтобы звук продолжал работать после перезапуска приложения/устройства. */
    @PluginMethod
    public void pickSound(PluginCall call) {
        saveCall(call);
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.setType("audio/*");
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        startActivityForResult(call, intent, "pickSoundResult");
    }

    @ActivityCallback
    private void pickSoundResult(PluginCall call, androidx.activity.result.ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != android.app.Activity.RESULT_OK || result.getData() == null) {
            call.reject("Выбор файла отменён");
            return;
        }
        Uri uri = result.getData().getData();
        if (uri == null) { call.reject("Не удалось получить URI файла"); return; }

        try {
            ContentResolver cr = getContext().getContentResolver();
            cr.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
        } catch (Exception e) {
            call.reject("Не удалось закрепить доступ к файлу: " + e.getMessage());
            return;
        }

        JSObject ret = new JSObject();
        ret.put("uri", uri.toString());
        call.resolve(ret);
    }
}
