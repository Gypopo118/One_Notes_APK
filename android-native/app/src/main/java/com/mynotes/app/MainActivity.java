package com.mynotes.app;

import android.os.Bundle;
import android.webkit.WebView;

import androidx.activity.OnBackPressedCallback;

import com.getcapacitor.BridgeActivity;
import com.mynotes.app.alarm.AlarmScheduler;
import com.mynotes.app.alarm.NativeAlarmPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // registerPlugin ДО super.onCreate() — таково требование Capacitor:
        // мост инициализируется внутри super.onCreate(), плагины нужно
        // зарегистрировать заранее.
        registerPlugin(NativeAlarmPlugin.class);
        AlarmScheduler.ensureChannelCreated(this);
        super.onCreate(savedInstanceState);

        // Системный жест/кнопка "назад" должны вести себя точно так же, как
        // стрелка-назад в шапке (которая вызывает history.back() в JS) —
        // то есть навигация по истории WebView, а не сворачивание приложения.
        // Без явной регистрации через OnBackPressedDispatcher переопределение
        // Activity#onBackPressed() может не сработать на Android 13+ с
        // включённым predictive back gesture, поэтому используем dispatcher.
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                WebView webView = getBridge() != null ? getBridge().getWebView() : null;
                if (webView != null && webView.canGoBack()) {
                    webView.goBack();
                } else {
                    // Ничего в истории WebView — штатное системное поведение
                    // (сворачивание/выход из приложения).
                    setEnabled(false);
                    getOnBackPressedDispatcher().onBackPressed();
                    setEnabled(true);
                }
            }
        });
    }
}
