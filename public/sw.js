const CACHE = "killer-shell-v1";
self.addEventListener("install", (event) => { event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(["/", "/manifest.webmanifest"]))); self.skipWaiting(); });
self.addEventListener("activate", (event) => { event.waitUntil(self.clients.claim()); });
self.addEventListener("fetch", (event) => { if (event.request.method !== "GET") return; event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request).then((response) => { const copy = response.clone(); caches.open(CACHE).then((cache) => cache.put(event.request, copy)); return response; }).catch(() => caches.match("/")))); });
self.addEventListener("push", (event) => { event.waitUntil(self.registration.showNotification("KILLER", { body: "มีเหตุการณ์ใหม่ในห้อง เปิดเว็บเพื่อดูรายละเอียด", icon: "/icon-192.png", badge: "/icon-192.png", tag: "killer-event" })); });
self.addEventListener("notificationclick", (event) => { event.notification.close(); event.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then((tabs) => tabs[0]?.focus() || clients.openWindow("/"))); });
