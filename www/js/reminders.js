/*
 * reminders.js — Capacitor Native AlarmManager adapter.
 * Срабатывает всегда в точное время (Android LocalNotifications).
 */
	const Reminders = (() => {
	  // Проверяем, запущено ли приложение в нативном контейнере Capacitor
	  const isCapacitor = !!(typeof window !== 'undefined' && window.Capacitor?.Plugins?.LocalNotifications);

	  // Флаг, чтобы канал создавался только один раз
	  let channelReady = false;

	  /**
	   * Создаёт Android Notification Channel для громких напоминаний-будильников.
	   * Идемпотентный вызов — повторные вызовы безопасны.
	   */
	  async function ensureChannel() {
	    if (channelReady || !isCapacitor) return;
	    try {
	      const { LocalNotifications } = window.Capacitor.Plugins;
	      await LocalNotifications.createChannel({
	        id: 'alarm_channel_v2',
	        name: 'Будильники и напоминания',
	        description: 'Канал для громких звуковых сигналов',
	        importance: 5,   // IMPORTANCE_MAX
	        visibility: 1,   // VISIBILITY_PUBLIC
	        sound: 'default',
	        vibration: true,
	        lights: true,
	        lightColor: '#FF0000'
	      });
	      channelReady = true;
	    } catch (e) {
	      // Не фатально — если createChannel не поддерживается, 
	      // уведомления всё равно сработают через дефолтный канал
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

    // Идентификатор для нативных уведомлений должен быть числом 32-bit int
    const notificationId = typeof id === 'number' ? id : Math.abs(hashCode(String(id)));

	    if (isCapacitor) {
	      const { LocalNotifications } = window.Capacitor.Plugins;
	      
	      // Отменяем старое уведомление с тем же ID
	      await cancel(id);

	      // Создаём канал будильника (идемпотентно)
	      await ensureChannel();

	      // Регистрируем нативный будильник в Android AlarmManager
	      await LocalNotifications.schedule({
	        notifications: [
	          {
	            title: title || 'Напоминание',
	            body: body || '',
	            id: notificationId,
	            schedule: { at: new Date(timestamp) },
	            channelId: 'alarm_channel_v2',
	            actionTypeId: '',
	            extra: null
	          }
	        ]
	      });
	      return true;
	    }

    // Фоллбек для обычного браузера (старый код)
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
      await LocalNotifications.cancel({ notifications: [{ id: notificationId }] });
    }
  }

  function rearm(notes) {
    // В Capacitor rearm не требуется: Android AlarmManager помнит 
    // все запланированные уведомления даже после перезагрузки телефона.
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

  // Хелпер для преобразования строковых ID заметок в целое число (int32)
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