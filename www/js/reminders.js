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
  const plugins = (typeof window !== 'undefined' && window.Capacitor?.Plugins) || {};
  const NativeAlarm = plugins.NativeAlarm || null;
  const LocalNotifications = plugins.LocalNotifications || null;
  const isNative = !!NativeAlarm;

  // ---------- Разрешения ----------
  async function ensurePermission() {
    if (isNative) {
      // POST_NOTIFICATIONS (Android 13+) запрашивается автоматически при
      // первом создании канала системой Capacitor; специфичные для
      // будильника разрешения (точные будильники, полноэкранный интент,
      // игнор оптимизации батареи) — отдельные шаги, см. ensureAlarmSetup().
      return true;
    }
    if (LocalNotifications) {
      const perm = await LocalNotifications.checkPermissions();
      if (perm.display === 'granted') return true;
      const req = await LocalNotifications.requestPermissions();
      return req.display === 'granted';
    }
    if (!('Notification' in window)) return false;
    if (Notification.permission === 'granted') return true;
    return (await Notification.requestPermission()) === 'granted';
  }

  // Вызывать один раз при старте приложения (например, из экрана настроек
  // или при первом создании напоминания) — проверяет и по очереди
  // запрашивает разрешения, без которых будильник может не сработать
  // при выключенном экране / на MIUI-подобных прошивках.
  async function ensureAlarmSetup() {
    if (!isNative) return;
    try {
      const { value } = await NativeAlarm.canScheduleExactAlarms();
      if (!value) await NativeAlarm.requestExactAlarmPermission();
    } catch (e) {}
    try {
      await NativeAlarm.requestFullScreenIntentPermission();
    } catch (e) {}
    try {
      await NativeAlarm.requestIgnoreBatteryOptimizations();
    } catch (e) {}
  }

  // ---------- Планирование ----------
  async function schedule(id, timestamp, title, body) {
    const granted = await ensurePermission();
    if (!granted) return false;

    const notificationId = typeof id === 'number' ? id : Math.abs(hashCode(String(id)));

    if (isNative) {
      const soundUri = await getCustomSoundUri();
      await NativeAlarm.schedule({
        id: notificationId,
        at: timestamp,
        title: title || 'Напоминание',
        body: body || '',
        soundUri: soundUri || null,
      });
      return true;
    }

    if (LocalNotifications) {
      await cancel(id);
      await LocalNotifications.schedule({
        notifications: [{
          title: title || 'Напоминание',
          body: body || '',
          id: notificationId,
          schedule: { at: new Date(timestamp) },
        }],
      });
      return true;
    }

    const delay = timestamp - Date.now();
    if (delay <= 0) {
      new Notification(title, { body, tag: id });
    } else {
      setTimeout(() => new Notification(title, { body, tag: id }), delay);
    }
    return true;
  }

  async function cancel(id) {
    const notificationId = typeof id === 'number' ? id : Math.abs(hashCode(String(id)));
    if (isNative) {
      try { await NativeAlarm.cancel({ id: notificationId }); } catch (e) {}
      return;
    }
    if (LocalNotifications) {
      try { await LocalNotifications.cancel({ notifications: [{ id: notificationId }] }); } catch (e) {}
    }
  }

  function rearm(notes) {
    // На Android перепланирование при перезапуске приложения не нужно:
    // все активные будильники живут в SharedPreferences нативного слоя и
    // переставляются самостоятельно через BootReceiver при перезагрузке
    // устройства, а не при перезапуске веб-контекста.
    if (isNative) return;

    const now = Date.now();
    notes.forEach((note) => {
      if (!note.reminderAt) return;
      const preview = (note.text || '').split('\n')[0].slice(0, 60) || 'Заметка';
      if (note.reminderAt > now) {
        schedule(note.id, note.reminderAt, 'Напоминание', preview);
      }
    });
  }

  // ---------- Выбор своей мелодии (опционально, экран настроек) ----------
  const SOUND_KEY = 'mynotes_custom_alarm_sound_uri';

  async function pickCustomSound() {
    if (!isNative) return null;
    try {
      const { uri } = await NativeAlarm.pickSound();
      if (uri) localStorage.setItem(SOUND_KEY, uri);
      return uri || null;
    } catch (e) {
      return null; // пользователь отменил выбор — не фатально
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

  return { schedule, cancel, rearm, ensurePermission, ensureAlarmSetup, pickCustomSound };
})();
