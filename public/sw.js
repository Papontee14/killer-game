const CACHE = "killer-shell-v3";
const SHELL = ["/", "/manifest.webmanifest"];
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
self.addEventListener("push", (event) => { event.waitUntil(self.registration.showNotification("KILLER", { body: "มีเหตุการณ์ใหม่ในห้อง เปิดเว็บเพื่อดูรายละเอียด", tag: "killer-event" })); });
self.addEventListener("notificationclick", (event) => { event.notification.close(); event.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then((tabs) => tabs[0]?.focus() || clients.openWindow("/"))); });
