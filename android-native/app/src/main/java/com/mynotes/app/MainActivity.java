package com.mynotes.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;
import com.mynotes.app.alarm.NativeAlarmPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // registerPlugin ДО super.onCreate() — таково требование Capacitor:
        // мост инициализируется внутри super.onCreate(), плагины нужно
        // зарегистрировать заранее.
        registerPlugin(NativeAlarmPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
