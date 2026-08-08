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
      vibrate: [300, 150, 300, 150, 300],
    })
  );
});

// Tapping the notification focuses an already-open admin tab if one
// exists instead of always opening a new one, then navigates it to the
// orders view — an already-open tab is the common case since it's the
// thing that couldn't alert them in the first place.
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const targetUrl = new URL(event.notification.data?.url || 'index.html', self.registration.scope).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      const existing = clients.find(c => c.url.startsWith(self.registration.scope));
      if (existing) { existing.focus(); return existing.navigate(targetUrl); }
      return self.clients.openWindow(targetUrl);
    })
  );
});
