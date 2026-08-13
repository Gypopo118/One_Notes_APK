#!/usr/bin/env python3
"""
Запускается в CI после `npx cap add android` и ДО `npx cap sync`.

Делает две вещи:
1) копирует шаблон android-native/ (Java-классы, layout, drawable будильника,
   переопределённый MainActivity) поверх только что сгенерированной папки android/;
2) вставляет в AndroidManifest.xml разрешения и объявления
   receiver/service/activity для будильника.

Почему это отдельный шаг, а не правки "на будущее" в самом android/:
папка android/ НЕ хранится в репозитории и пересоздаётся с нуля при каждом
запуске `cap add android` в build-apk.yml — значит любые ручные правки внутри
android/ бесследно исчезают при следующей сборке. Правки нужно делать именно
здесь, автоматически, при каждой сборке.
"""
import os
import re
import shutil
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NATIVE_SRC = os.path.join(ROOT, "android-native")
ANDROID_DIR = os.path.join(ROOT, "android")
MANIFEST_PATH = os.path.join(ANDROID_DIR, "app", "src", "main", "AndroidManifest.xml")


def copy_native_sources():
    if not os.path.isdir(NATIVE_SRC):
        print(f"::error::android-native/ не найдена по пути {NATIVE_SRC}")
        sys.exit(1)
    if not os.path.isdir(ANDROID_DIR):
        print(f"::error::android/ не найдена — убедитесь, что этот скрипт запускается после `cap add android`")
        sys.exit(1)

    for dirpath, _, filenames in os.walk(NATIVE_SRC):
        for fname in filenames:
            src = os.path.join(dirpath, fname)
            rel = os.path.relpath(src, NATIVE_SRC)
            dst = os.path.join(ANDROID_DIR, rel)
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            shutil.copyfile(src, dst)
            print(f"copied {rel}")


PERMISSIONS = """
    <uses-permission android:name="android.permission.USE_EXACT_ALARM" />
    <uses-permission android:name="android.permission.SCHEDULE_EXACT_ALARM" />
    <uses-permission android:name="android.permission.WAKE_LOCK" />
    <uses-permission android:name="android.permission.VIBRATE" />
    <uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED" />
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK" />
    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
    <uses-permission android:name="android.permission.USE_FULL_SCREEN_INTENT" />
    <uses-permission android:name="android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS" />
"""

COMPONENTS = """
        <receiver
            android:name="com.mynotes.app.alarm.AlarmReceiver"
            android:exported="false" />

        <receiver
            android:name="com.mynotes.app.alarm.BootReceiver"
            android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.BOOT_COMPLETED" />
                <action android:name="android.intent.action.QUICKBOOT_POWERON" />
            </intent-filter>
        </receiver>

        <service
            android:name="com.mynotes.app.alarm.AlarmService"
            android:exported="false"
            android:foregroundServiceType="mediaPlayback" />

        <activity
            android:name="com.mynotes.app.alarm.AlarmActivity"
            android:exported="false"
            android:launchMode="singleTop"
            android:excludeFromRecents="true" />
        <!-- Показ поверх заблокированного экрана делается программно в
             AlarmActivity.onCreate() через setShowWhenLocked/setTurnScreenOn
             (или через WindowManager-флаги на API < 27) — отдельного
             манифест-атрибута/темы для этого не требуется. -->
"""


def patch_manifest():
    with open(MANIFEST_PATH, "r", encoding="utf-8") as f:
        content = f.read()

    if "com.mynotes.app.alarm.AlarmReceiver" in content:
        print("Manifest уже пропатчен, пропускаю.")
        return

    # 1) permissions — вставляем перед <application
    content = re.sub(r"(\s*<application)", PERMISSIONS + r"\1", content, count=1)

    # 2) components — вставляем перед закрывающим </application>
    content = content.replace("</application>", COMPONENTS + "    </application>")

    with open(MANIFEST_PATH, "w", encoding="utf-8") as f:
        f.write(content)
    print("AndroidManifest.xml пропатчен.")


if __name__ == "__main__":
    copy_native_sources()
    patch_manifest()
