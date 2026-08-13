package com.mynotes.app.alarm;

import android.app.KeyguardManager;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.TextView;

import androidx.appcompat.app.AppCompatActivity;

import com.mynotes.app.R;

/**
 * Показывается поверх заблокированного экрана через
 * NotificationCompat#setFullScreenIntent (и напрямую стартуется из сервиса —
 * дублирование намеренное: полноэкранный интент может быть подавлен системой
 * "тихим" уведомлением на некоторых OEM, прямой startActivity — подстраховка).
 */
public class AlarmActivity extends AppCompatActivity {

    private long alarmId;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
            KeyguardManager km = (KeyguardManager) getSystemService(Context.KEYGUARD_SERVICE);
            if (km != null) km.requestDismissKeyguard(this, null);
        } else {
            getWindow().addFlags(
                    WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                            | WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD
                            | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
                            | WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        }

        setContentView(R.layout.activity_alarm);

        alarmId = getIntent().getLongExtra("id", 0);
        String title = getIntent().getStringExtra("title");
        String body = getIntent().getStringExtra("body");
        String soundUri = getIntent().getStringExtra("soundUri");

        TextView titleView = findViewById(R.id.alarmTitle);
        TextView bodyView = findViewById(R.id.alarmBody);
        titleView.setText(title == null || title.isEmpty() ? "Будильник" : title);
        bodyView.setText(body == null ? "" : body);

        Button stopBtn = findViewById(R.id.stopButton);
        Button snoozeBtn = findViewById(R.id.snoozeButton);

        stopBtn.setOnClickListener(v -> {
            Intent stopIntent = new Intent(this, AlarmService.class).setAction(AlarmService.ACTION_STOP);
            startService(stopIntent);
            finish();
        });

        snoozeBtn.setOnClickListener(v -> {
            Intent snoozeIntent = new Intent(this, AlarmService.class).setAction(AlarmService.ACTION_SNOOZE);
            snoozeIntent.putExtra("id", alarmId).putExtra("title", title).putExtra("body", body);
            if (soundUri != null) snoozeIntent.putExtra("soundUri", soundUri);
            startService(snoozeIntent);
            finish();
        });
    }

    @Override
    public void onBackPressed() {
        // Системная кнопка "назад" не должна тихо закрывать будильник без остановки звука.
    }
}
