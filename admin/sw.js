// Push-only service worker — no offline caching, since the admin panel
// always needs fresh live data (orders, stock) and stale cached data here
// would be actively dangerous, not just inconvenient. Its only job is to
// stay registered so the browser/OS can wake it for a push event even with
// the app fully closed, and show the notification when that happens.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

self.addEventListener('push', event => {
  let data = { title: 'BBK', body: 'New activity', url: 'index.html' };
  try { data = { ...data, ...event.data.json() }; } catch { /* keep defaults */ }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '../assets/bbk-logo.jpg',
      badge: '../assets/bbk-logo.jpg',
      data: { url: data.url },
      tag: data.tag || 'bbk-order',
      // A single push can only play its sound once — this is what makes it
      // hard to miss until then: stays pinned in the notification shade
      // instead of auto-dismissing, and buzzes instead of just chiming.
      requireInteraction: true,
      vibrate: [500, 200, 500, 200, 500, 200, 500],
      // A re-send for the same still-pending order reuses this tag — without
      // renotify, Chrome would silently swap the notification's text with no
      // new sound/vibration, which defeats the entire point of resending.
      renotify: true,
    })
  );
});

// A background push means the app was closed — there's essentially never a
// real installed-app window already open worth reusing. The Clients API
// has no reliable way to tell a leftover regular Chrome tab apart from the
// actual installed standalone app, and "reuse whatever matches" risked
// focusing that leftover tab (which opens as a browser tab, not the app).
// Always opening fresh lets Android route it to the installed app itself.
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const targetUrl = new URL(event.notification.data?.url || 'index.html', self.registration.scope).href;
  event.waitUntil(self.clients.openWindow(targetUrl));
});
