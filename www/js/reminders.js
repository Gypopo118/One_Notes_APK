/*
 * reminders.js — нативный будильник на Android через плагин NativeAlarm
 * (см. android-native/.../alarm/NativeAlarmPlugin.java), с откатом на
 * @capacitor/local-notifications / Web Notification API вне Android
 * (веб-разработка, iOS в будущем).
 *
 * Публичный API (schedule/cancel/rearm/ensurePermission) не менялся —
 * app.js вызывает его точно так же, как раньше.
 */
const Reminders = (() => {
  function getNativeAlarm() {
    return (typeof window !== 'undefined' && (window.Capacitor?.Plugins?.NativeAlarm || window.NativeAlarm)) || null;
  }

  function getLocalNotifications() {
    return (typeof window !== 'undefined' && window.Capacitor?.Plugins?.LocalNotifications) || null;
  }

  function isNative() {
    return !!getNativeAlarm();
  }

  // ---------- Разрешения ----------
  async function ensurePermission() {
    const native = getNativeAlarm();
    if (native) {
      try {
        // Гарантируем создание канала звука
        if (typeof native.ensureChannel === 'function') {
          await native.ensureChannel();
        }

        // Запрашиваем runtime разрешение POST_NOTIFICATIONS (Android 13+)
        if (typeof native.requestNotificationPermission === 'function') {
          const res = await native.requestNotificationPermission();
          if (res && res.granted === false) {
            return false;
          }
        }

        // Проверяем точные будильники (Android 12+)
        if (typeof native.canScheduleExactAlarms === 'function') {
          const { value } = await native.canScheduleExactAlarms();
          if (value === false && typeof native.requestExactAlarmPermission === 'function') {
            await native.requestExactAlarmPermission();
          }
        }

        return true;
      } catch (err) {
        console.warn('Ошибка при проверке разрешений будильника:', err);
        return true; // продолжаем попытку
      }
    }

    const localNotif = getLocalNotifications();
    if (localNotif) {
      try {
        const perm = await localNotif.checkPermissions();
        if (perm && perm.display === 'granted') return true;
        const req = await localNotif.requestPermissions();
        return req && req.display === 'granted';
      } catch (e) {
        return false;
      }
    }

    if (typeof window !== 'undefined' && 'Notification' in window) {
      if (Notification.permission === 'granted') return true;
      if (Notification.permission === 'denied') return false;
      try {
        const res = await Notification.requestPermission();
        return res === 'granted';
      } catch (e) {
        return false;
      }
    }

    return true;
  }

  async function ensureAlarmSetup() {
    const native = getNativeAlarm();
    if (!native) return;
    try {
      if (typeof native.ensureChannel === 'function') await native.ensureChannel();
      if (typeof native.canScheduleExactAlarms === 'function') {
        const { value } = await native.canScheduleExactAlarms();
        if (!value && typeof native.requestExactAlarmPermission === 'function') {
          await native.requestExactAlarmPermission();
        }
      }
      if (typeof native.requestFullScreenIntentPermission === 'function') {
        await native.requestFullScreenIntentPermission();
      }
      if (typeof native.requestIgnoreBatteryOptimizations === 'function') {
        await native.requestIgnoreBatteryOptimizations();
      }
    } catch (e) {}
  }

  // ---------- Планирование ----------
  async function schedule(id, timestamp, title, body) {
    const granted = await ensurePermission();
    if (!granted) {
      throw new Error('Нет разрешения на отправку уведомлений');
    }

    const notificationId = typeof id === 'number' ? id : Math.abs(hashCode(String(id)));
    const targetTimestamp = typeof timestamp === 'number' ? timestamp : Number(timestamp);
    const native = getNativeAlarm();

    if (native) {
      const soundUri = await getCustomSoundUri();
      await native.schedule({
        id: Number(notificationId),
        at: Number(targetTimestamp),
        title: title || 'Будильник',
        body: body || '',
        soundUri: soundUri || null,
      });
      return true;
    }

    const localNotif = getLocalNotifications();
    if (localNotif) {
      await cancel(id);
      await localNotif.schedule({
        notifications: [{
          title: title || 'Напоминание',
          body: body || '',
          id: Number(notificationId),
          schedule: { at: new Date(targetTimestamp) },
        }],
      });
      return true;
    }

    if (typeof window !== 'undefined' && 'Notification' in window) {
      const delay = targetTimestamp - Date.now();
      if (delay <= 0) {
        new Notification(title || 'Напоминание', { body: body || '', tag: String(id) });
      } else {
        setTimeout(() => new Notification(title || 'Напоминание', { body: body || '', tag: String(id) }), delay);
      }
    }
    return true;
  }

  async function cancel(id) {
    const notificationId = typeof id === 'number' ? id : Math.abs(hashCode(String(id)));
    const native = getNativeAlarm();
    if (native) {
      try { await native.cancel({ id: Number(notificationId) }); } catch (e) {}
      return;
    }
    const localNotif = getLocalNotifications();
    if (localNotif) {
      try { await localNotif.cancel({ notifications: [{ id: notificationId }] }); } catch (e) {}
    }
  }

  function rearm(notes) {
    if (isNative()) return;

    const now = Date.now();
    notes.forEach((note) => {
      if (!note.reminderAt) return;
      const preview = (note.text || '').split('\n')[0].slice(0, 60) || 'Заметка';
      if (note.reminderAt > now) {
        schedule(note.id, note.reminderAt, 'Напоминание', preview).catch(() => {});
      }
    });
  }

  // ---------- Выбор своей мелодии ----------
  const SOUND_KEY = 'mynotes_custom_alarm_sound_uri';

  async function pickCustomSound() {
    const native = getNativeAlarm();
    if (!native || typeof native.pickSound !== 'function') return null;
    try {
      const { uri } = await native.pickSound();
      if (uri) localStorage.setItem(SOUND_KEY, uri);
      return uri || null;
    } catch (e) {
      return null;
    }
  }

  async function getCustomSoundUri() {
    try {
      return localStorage.getItem(SOUND_KEY) || null;
    } catch (e) {
      return null;
    }
  }

  function hashCode(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = (hash << 5) - hash + str.charCodeAt(i);
      hash |= 0;
    }
    return hash;
  }

  return { schedule, cancel, rearm, ensurePermission, ensureAlarmSetup, pickCustomSound, isNative };
})();
