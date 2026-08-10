/*
 * reminders.js — Capacitor Native AlarmManager adapter for Android / HyperOS.
 */
const Reminders = (() => {
  const isCapacitor = !!(typeof window !== 'undefined' && window.Capacitor?.Plugins?.LocalNotifications);

  let channelCreated = false;

  async function ensureChannel() {
    if (!isCapacitor || channelCreated) return;
    try {
      const { LocalNotifications } = window.Capacitor.Plugins;
      
      // Регистрируем высокоприоритетный канал со звуком
      await LocalNotifications.createChannel({
        id: 'alarm_channel_v3',
        name: 'Будильники и напоминания',
        description: 'Громкий канал для точных напоминаний',
        importance: 5, // MAX importance (вызывает всплывающий баннер)
        visibility: 1, // VISIBILITY_PUBLIC (показывает на экране блокировки)
        sound: 'default',
        vibration: true,
        lights: true,
        lightColor: '#FF0000'
      });
      
      channelCreated = true;
    } catch (e) {
      console.error('Ошибка создания канала уведомлений:', e);
    }
  }

  async function ensurePermission() {
    if (isCapacitor) {
      const { LocalNotifications } = window.Capacitor.Plugins;
      const perm = await LocalNotifications.checkPermissions();
      if (perm.display === 'granted') return true;
      const req = await LocalNotifications.requestPermissions();
      return req.display === 'granted';
    }
    if (!('Notification' in window)) return false;
    if (Notification.permission === 'granted') return true;
    return (await Notification.requestPermission()) === 'granted';
  }

  async function schedule(id, timestamp, title, body) {
    const granted = await ensurePermission();
    if (!granted) return false;

    const notificationId = typeof id === 'number' ? id : Math.abs(hashCode(String(id)));

    if (isCapacitor) {
      const { LocalNotifications } = window.Capacitor.Plugins;

      // Гарантируем создание канала перед планированием
      await ensureChannel();
      
      await cancel(id);

      await LocalNotifications.schedule({
        notifications: [
          {
            title: title || 'Напоминание',
            body: body || '',
            id: notificationId,
            schedule: { at: new Date(timestamp), allowWhileIdle: true },
            channelId: 'alarm_channel_v3',
            sound: 'default',
            actionTypeId: '',
            extra: null
          }
        ]
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
    if (isCapacitor) {
      const { LocalNotifications } = window.Capacitor.Plugins;
      try {
        await LocalNotifications.cancel({ notifications: [{ id: notificationId }] });
      } catch (e) {}
    }
  }

  function rearm(notes) {
    if (isCapacitor) return;

    const now = Date.now();
    notes.forEach((note) => {
      if (!note.reminderAt) return;
      const preview = (note.text || '').split('\n')[0].slice(0, 60) || 'Заметка';
      if (note.reminderAt > now) {
        schedule(note.id, note.reminderAt, 'Напоминание', preview);
      }
    });
  }

  function hashCode(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = (hash << 5) - hash + str.charCodeAt(i);
      hash |= 0;
    }
    return hash;
  }

  return { schedule, cancel, rearm, ensurePermission };
})();