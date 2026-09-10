const CACHE = "killer-shell-v5";
const SHELL = ["/", "/manifest.webmanifest"];
const POLICE_CHECK_REMINDER = "\u0e15\u0e33\u0e23\u0e27\u0e08\u0e08\u0e30\u0e17\u0e33\u0e01\u0e32\u0e23\u0e0a\u0e35\u0e49\u0e15\u0e31\u0e27\u0e43\u0e19 3 \u0e19\u0e32\u0e17\u0e35";
const GENERIC_NOTIFICATION_BODY = "มีเหตุการณ์ใหม่ในห้อง เปิดเว็บเพื่อดูรายละเอียด";
const NOTIFICATION_DB = "killer-notification-dedup";
const NOTIFICATION_STORE = "seen";
const NOTIFICATION_TTL = 24 * 60 * 60 * 1000;

function claimNotification(notificationId) {
  if (!notificationId || typeof indexedDB === "undefined") return Promise.resolve(true);
  return new Promise((resolve) => {
    const request = indexedDB.open(NOTIFICATION_DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(NOTIFICATION_STORE, { keyPath: "id" });
    request.onerror = () => resolve(true);
    request.onsuccess = () => {
      const db = request.result;
      let claimed = false;
      try {
        const tx = db.transaction(NOTIFICATION_STORE, "readwrite");
        const store = tx.objectStore(NOTIFICATION_STORE);
        const now = Date.now();
        const lookup = store.get(notificationId);
        lookup.onsuccess = () => {
          if (!lookup.result) {
            claimed = true;
            store.put({ id: notificationId, seenAt: now });
          }
        };
        const cursor = store.openCursor();
        cursor.onsuccess = () => {
          const item = cursor.result;
          if (!item) return;
          if (item.value.seenAt < now - NOTIFICATION_TTL) item.delete();
          item.continue();
        };
        tx.oncomplete = () => { db.close(); resolve(claimed); };
        tx.onerror = () => { db.close(); resolve(true); };
      } catch (_) {
        db.close();
        resolve(true);
      }
    };
  });
}

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});
self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(
    keys.filter((key) => key.startsWith("killer-shell-") && key !== CACHE).map((key) => caches.delete(key))
  )).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  // Never cache authenticated views, APIs, signed URLs, or evidence images.
  if (event.request.method !== "GET" || url.origin !== self.location.origin || url.search ||
      (!SHELL.includes(url.pathname) && !url.pathname.startsWith("/_next/static/"))) return;
  event.respondWith(fetch(event.request).then(async (response) => {
    if (response.ok && !response.redirected) {
      const cache = await caches.open(CACHE);
      await cache.put(event.request, response.clone());
    }
    return response;
  }).catch(async () => (await caches.match(event.request)) || Response.error()));
});

self.addEventListener("push", (event) => {
  // Keep the lock-screen text generic; details are only shown after opening the game.
  let data = {};
  try { data = event.data?.json() || {}; } catch (_) {}
  const requestedBody = typeof data.body === "string" ? data.body : "";
  const notificationId = typeof data.notificationId === "string" ? data.notificationId : "";
  const body = [POLICE_CHECK_REMINDER].includes(requestedBody)
    ? requestedBody
    : GENERIC_NOTIFICATION_BODY;
  event.waitUntil(claimNotification(notificationId).then((claimed) => {
    if (!claimed) return undefined;
    return self.registration.showNotification("KILLER", {
      body,
      tag: notificationId ? `killer-event:${notificationId}` : "killer-event",
      icon: "/icon-192.png?v=8bit-1",
      badge: '/notification-badge.png?v=8bit-1',
      silent: false,
      renotify: false,
      requireInteraction: true,
      vibrate: [200, 100, 200],
      data: { url: typeof data.url === "string" ? data.url : "/" },
    });
  }));
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((tabs) => {
    const tab = tabs.find((candidate) => candidate.url.startsWith(self.location.origin));
    if (!tab) return self.clients.openWindow(url);
    return tab.navigate(url).then(() => tab.focus());
  }));
});
