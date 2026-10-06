const CACHE_NAME = "staff-claims-pwa-v15";
const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icons/icon.svg",
  "./icons/icon-maskable.svg"
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith("staff-claims-pwa-") && key !== CACHE_NAME).map(key => caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  if (event.request.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const response = await fetch(event.request, { cache: "no-store" });
        if (!response.ok) throw new Error("App page unavailable");
        const cache = await caches.open(CACHE_NAME);
        await cache.put(new URL("index.html", self.registration.scope).href, response.clone());
        return response;
      } catch {
        return await caches.match(new URL("index.html", self.registration.scope).href)
          || new Response("App unavailable offline", { status: 503, headers: { "Content-Type": "text/plain" } });
      }
    })());
    return;
  }

  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request))
  );
});







