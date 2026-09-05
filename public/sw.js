const CACHE = "killer-shell-v3";
const SHELL = ["/", "/manifest.webmanifest"];
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
  event.waitUntil(self.registration.showNotification("KILLER", {
    body: GENERIC_NOTIFICATION_BODY,
    tag: "killer-event",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
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
