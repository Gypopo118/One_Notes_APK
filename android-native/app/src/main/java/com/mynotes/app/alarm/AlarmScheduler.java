package com.mynotes.app.alarm;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * Единая точка планирования/отмены нативных будильников.
 *
 * Хранилище: SharedPreferences "alarms_store", ключ "alarms" — JSON-массив
 * объектов {id, triggerAt, title, body, soundUri}. Это единственный источник
 * правды, который читает BootReceiver после перезагрузки устройства — сама
 * система AlarmManager ничего не помнит после reboot, поэтому пересборка
 * состояния из этого хранилища обязательна.
 */
public class AlarmScheduler {

    private static final String PREFS = "alarms_store";
    private static final String KEY_ALARMS = "alarms";

    public static class AlarmEntry {
        public long id;
        public long triggerAt;
        public String title;
        public String body;
        public String soundUri; // может быть null -> будет использован дефолтный звук будильника системы

        JSONObject toJson() throws JSONException {
            JSONObject o = new JSONObject();
            o.put("id", id);
            o.put("triggerAt", triggerAt);
            o.put("title", title == null ? "" : title);
            o.put("body", body == null ? "" : body);
            o.put("soundUri", soundUri == null ? JSONObject.NULL : soundUri);
            return o;
        }

        static AlarmEntry fromJson(JSONObject o) throws JSONException {
            AlarmEntry e = new AlarmEntry();
            e.id = o.getLong("id");
            e.triggerAt = o.getLong("triggerAt");
            e.title = o.optString("title", "");
            e.body = o.optString("body", "");
            e.soundUri = o.isNull("soundUri") ? null : o.optString("soundUri", null);
            return e;
        }
    }

    public static void schedule(Context ctx, long id, long triggerAt, String title, String body, String soundUri) {
        AlarmEntry e = new AlarmEntry();
        e.id = id; e.triggerAt = triggerAt; e.title = title; e.body = body; e.soundUri = soundUri;
        saveEntry(ctx, e);
        armSystemAlarm(ctx, e);
    }

    /** Вызывается и из schedule(), и из BootReceiver — не трогает хранилище. */
    static void armSystemAlarm(Context ctx, AlarmEntry e) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;

        Intent intent = new Intent(ctx, AlarmReceiver.class);
        intent.putExtra("id", e.id);
        intent.putExtra("title", e.title);
        intent.putExtra("body", e.body);
        if (e.soundUri != null) intent.putExtra("soundUri", e.soundUri);

        int flags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
        PendingIntent operation = PendingIntent.getBroadcast(ctx, (int) e.id, intent, flags);

        Intent showIntent = new Intent(ctx, com.mynotes.app.MainActivity.class);
        PendingIntent showPI = PendingIntent.getActivity(ctx, (int) e.id, showIntent, flags);

        AlarmManager.AlarmClockInfo info = new AlarmManager.AlarmClockInfo(e.triggerAt, showPI);

        // setAlarmClock требует SCHEDULE_EXACT_ALARM на API 31+. Если разрешения нет,
        // система бросит SecurityException — ловим и откатываемся на менее точный,
        // но всё же "allow while idle" вариант, чтобы будильник не пропал совсем.
        try {
            am.setAlarmClock(info, operation);
        } catch (SecurityException se) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, e.triggerAt, operation);
            } else {
                am.setExact(AlarmManager.RTC_WAKEUP, e.triggerAt, operation);
            }
        }
    }

    public static void cancel(Context ctx, long id) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        Intent intent = new Intent(ctx, AlarmReceiver.class);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
        PendingIntent operation = PendingIntent.getBroadcast(ctx, (int) id, intent, flags);
        if (am != null) am.cancel(operation);
        operation.cancel();
        removeEntry(ctx, id);
    }

    public static List<AlarmEntry> loadAll(Context ctx) {
        List<AlarmEntry> result = new ArrayList<>();
        SharedPreferences prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String raw = prefs.getString(KEY_ALARMS, "[]");
        try {
            JSONArray arr = new JSONArray(raw);
            for (int i = 0; i < arr.length(); i++) {
                result.add(AlarmEntry.fromJson(arr.getJSONObject(i)));
            }
        } catch (JSONException ignored) {}
        return result;
    }

    private static void saveEntry(Context ctx, AlarmEntry e) {
        List<AlarmEntry> all = loadAll(ctx);
        for (int i = 0; i < all.size(); i++) {
            if (all.get(i).id == e.id) { all.remove(i); break; }
        }
        all.add(e);
        persist(ctx, all);
    }

    private static void removeEntry(Context ctx, long id) {
        List<AlarmEntry> all = loadAll(ctx);
        for (int i = 0; i < all.size(); i++) {
            if (all.get(i).id == id) { all.remove(i); break; }
        }
        persist(ctx, all);
    }

    private static void persist(Context ctx, List<AlarmEntry> all) {
        JSONArray arr = new JSONArray();
        try {
            for (AlarmEntry e : all) arr.put(e.toJson());
        } catch (JSONException ignored) {}
        SharedPreferences prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        prefs.edit().putString(KEY_ALARMS, arr.toString()).apply();
    }
}
