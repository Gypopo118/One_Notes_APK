const CACHE_NAME = 'notes-app-v9';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/db.js',
  './js/reminders.js',
  './js/app.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

// Установка: кешируем каждый файл отдельно — провал одного ассета
// не ломает установку всего Service Worker.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.all(ASSETS.map((url) =>
        cache.add(url).catch(() => {
          // Отдельный ассет не загрузился — не фатально,
          // заберём его позже при сетевом запросе.
        })
      ))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  // Навигация (запуск с ярлыка): пробуем сеть, при обрыве — отдаём
  // закешированный index.html, чтобы не показывать ошибку браузера.
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => caches.match('./index.html'))
    );
    return;
  }

  // Все остальные GET-запросы (JS, CSS, иконки): СНАЧАЛА СЕТЬ,
  // при неудаче — кеш. Это гарантирует, что битый/устаревший кеш
  // никогда не заблокирует загрузку свежих скриптов и стилей.
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        // Кешируем свежий ответ на будущее
        const copy = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((clients) => {
      if (clients.length > 0) return clients[0].focus();
      return self.clients.openWindow('./');
    })
  );
});
