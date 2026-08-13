package com.mynotes.app.alarm;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.MediaPlayer;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;

import androidx.core.app.NotificationCompat;

import com.mynotes.app.R;

/**
 * Держит устройство "живым" пока звонит будильник: зацикленный MediaPlayer с
 * AudioAttributes USAGE_ALARM (звук идёт по громкости "будильник", а не
 * "медиа"/"уведомления" — это то, что чинит "звук отключён" в системных
 * настройках канала, если раньше канал создавался без явных AudioAttributes).
 */
public class AlarmService extends Service {

    public static final String CHANNEL_ID = AlarmScheduler.CHANNEL_ID;
    public static final String ACTION_STOP = "com.mynotes.app.alarm.ACTION_STOP";
    public static final String ACTION_SNOOZE = "com.mynotes.app.alarm.ACTION_SNOOZE";
    private static final int NOTIF_ID = 4242;

    private MediaPlayer player;
    private Vibrator vibrator;
    private PowerManager.WakeLock wakeLock;
    private long currentId;

    @Override
    public void onCreate() {
        super.onCreate();
        AlarmScheduler.ensureChannelCreated(this);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            stopRinging();
            stopSelf();
            return START_NOT_STICKY;
        }
        if (intent != null && ACTION_SNOOZE.equals(intent.getAction())) {
            long id = intent.getLongExtra("id", 0);
            String title = intent.getStringExtra("title");
            String body = intent.getStringExtra("body");
            String soundUri = intent.getStringExtra("soundUri");
            long snoozeAt = System.currentTimeMillis() + 10 * 60 * 1000L;
            AlarmScheduler.schedule(getApplicationContext(), id, snoozeAt, title, body, soundUri);
            stopRinging();
            stopSelf();
            return START_NOT_STICKY;
        }

        currentId = intent != null ? intent.getLongExtra("id", 0) : 0;
        String title = intent != null ? intent.getStringExtra("title") : null;
        String body = intent != null ? intent.getStringExtra("body") : null;
        String soundUriStr = intent != null ? intent.getStringExtra("soundUri") : null;
        if (title == null || title.isEmpty()) title = "Будильник";

        acquireWakeLock();
        Notification notification = buildNotification(title, body, soundUriStr);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIF_ID, notification, android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        } else {
            startForeground(NOTIF_ID, notification);
        }
        startRinging(soundUriStr);
        startVibration();

        Intent fullScreen = new Intent(this, AlarmActivity.class);
        fullScreen.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        fullScreen.putExtra("id", currentId);
        fullScreen.putExtra("title", title);
        fullScreen.putExtra("body", body);
        fullScreen.putExtra("soundUri", soundUriStr);
        startActivity(fullScreen);

        return START_STICKY;
    }

    private Uri defaultAlarmSoundUri() {
        return AlarmScheduler.getDefaultAlarmSoundUri(this);
    }

    private Notification buildNotification(String title, String body, String soundUriStr) {
        Intent stopIntent = new Intent(this, AlarmService.class).setAction(ACTION_STOP);
        PendingIntent stopPI = PendingIntent.getService(this, (int) currentId, stopIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        Intent snoozeIntent = new Intent(this, AlarmService.class).setAction(ACTION_SNOOZE);
        snoozeIntent.putExtra("id", currentId).putExtra("title", title).putExtra("body", body);
        if (soundUriStr != null) snoozeIntent.putExtra("soundUri", soundUriStr);
        PendingIntent snoozePI = PendingIntent.getService(this, (int) currentId + 100000, snoozeIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        Intent fullScreen = new Intent(this, AlarmActivity.class);
        fullScreen.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        fullScreen.putExtra("id", currentId);
        fullScreen.putExtra("title", title);
        fullScreen.putExtra("body", body);
        PendingIntent fsPI = PendingIntent.getActivity(this, (int) currentId, fullScreen,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        NotificationCompat.Builder b = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle(title)
                .setContentText(body == null ? "" : body)
                .setSmallIcon(R.drawable.ic_stat_alarm)
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setCategory(NotificationCompat.CATEGORY_ALARM)
                .setFullScreenIntent(fsPI, true)
                .setOngoing(true)
                .setAutoCancel(false)
                .addAction(0, "Отложить 10 мин", snoozePI)
                .addAction(0, "Остановить", stopPI);

        return b.build();
    }

    private void startRinging(String soundUriStr) {
        try {
            player = new MediaPlayer();
            AudioAttributes attrs = new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ALARM)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build();
            player.setAudioAttributes(attrs);

            Uri uri = null;
            if (soundUriStr != null && !soundUriStr.isEmpty()) {
                try {
                    uri = Uri.parse(soundUriStr);
                    // Проверяем, что у нас реально есть постоянный доступ к этому URI
                    // (пользователь мог выбрать файл через SAF ранее — см. NativeAlarmPlugin.pickSound).
                    getContentResolver().openInputStream(uri).close();
                } catch (Exception e) {
                    uri = null; // файл недоступен -> уходим на fallback ниже
                }
            }
            if (uri == null) uri = defaultAlarmSoundUri();

            player.setDataSource(this, uri);
            player.setLooping(true);
            player.setOnErrorListener((mp, what, extra) -> {
                // Битый/недоступный источник — не оставляем будильник немым.
                try {
                    mp.reset();
                    mp.setDataSource(getApplicationContext(), defaultAlarmSoundUri());
                    mp.setLooping(true);
                    mp.prepare();
                    mp.start();
                } catch (Exception ignored) {}
                return true;
            });
            player.prepare();
            player.start();
        } catch (Exception e) {
            // Последний рубеж: системный Ringtone вместо MediaPlayer.
            try {
                android.media.Ringtone rt = RingtoneManager.getRingtone(this, defaultAlarmSoundUri());
                if (rt != null) rt.play();
            } catch (Exception ignored) {}
        }
    }

    private void startVibration() {
        long[] pattern = {0, 800, 400, 800};
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            VibratorManager vm = (VibratorManager) getSystemService(Context.VIBRATOR_MANAGER_SERVICE);
            vibrator = vm != null ? vm.getDefaultVibrator() : null;
        } else {
            vibrator = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
        }
        if (vibrator == null) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            vibrator.vibrate(VibrationEffect.createWaveform(pattern, 0));
        } else {
            vibrator.vibrate(pattern, 0);
        }
    }

    private void acquireWakeLock() {
        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        if (pm == null) return;
        wakeLock = pm.newWakeLock(
                PowerManager.PARTIAL_WAKE_LOCK | PowerManager.ACQUIRE_CAUSES_WAKEUP | PowerManager.ON_AFTER_RELEASE,
                "mynotes:alarm_ringing");
        wakeLock.acquire(10 * 60 * 1000L); // жёсткий потолок 10 минут на случай, если "Остановить" не нажали
    }

    private void stopRinging() {
        if (player != null) {
            try { if (player.isPlaying()) player.stop(); } catch (Exception ignored) {}
            player.release();
            player = null;
        }
        if (vibrator != null) { vibrator.cancel(); vibrator = null; }
        if (wakeLock != null && wakeLock.isHeld()) { wakeLock.release(); wakeLock = null; }
        stopForeground(true);
    }

    @Override
    public void onDestroy() {
        stopRinging();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }
}
