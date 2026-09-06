const CACHE = "killer-shell-v3";
const SHELL = ["/", "/manifest.webmanifest"];
const POLICE_CHECK_REMINDER = "\u0e15\u0e33\u0e23\u0e27\u0e08\u0e08\u0e30\u0e17\u0e33\u0e01\u0e32\u0e23\u0e0a\u0e35\u0e49\u0e15\u0e31\u0e27\u0e43\u0e19 3 \u0e19\u0e32\u0e17\u0e35";
const EVIDENCE_RECEIVED = "\u0e21\u0e35\u0e2b\u0e25\u0e31\u0e01\u0e10\u0e32\u0e19\u0e43\u0e2b\u0e21\u0e48\u0e23\u0e2d Host \u0e15\u0e23\u0e27\u0e08\u0e2a\u0e2d\u0e1a";
const GENERIC_NOTIFICATION_BODY = "มีเหตุการณ์ใหม่ในห้อง เปิดเว็บเพื่อดูรายละเอียด";

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
  const body = [POLICE_CHECK_REMINDER, EVIDENCE_RECEIVED].includes(requestedBody)
    ? requestedBody
    : GENERIC_NOTIFICATION_BODY;
  event.waitUntil(self.registration.showNotification("KILLER", {
    body,
    tag: "killer-event",
    icon: "/icon-192.png?v=8bit-1",
    badge: '/notification-badge.png?v=8bit-1',
    // These options request the most prominent web notification available.
    silent: false,
    renotify: true,
    requireInteraction: true,
    vibrate: [200, 100, 200],
    data: { url: typeof data.url === "string" ? data.url : "/" },
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
