// Solo el shell de la app. Los audios y paquetes viven en IndexedDB, no en la red.
const CACHE = "wcsl-shell-0.3-r1";
const FILES = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./library-core.js",
  "./database.js",
  "./playback.js",
  "./list-controls.js",
  "./share-core.js",
  "./pin-core.js",
  "./db-utils.js",
  "./team-controls.js",
  "./live-controls.js",
  "./offline.js",
  "./tempo-core.js",
  "./tempo-worker.js",
];
const urls = FILES.map((file) => new URL(file, self.registration.scope).href);
self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      for (const url of urls) {
        const response = await fetch(url, {
          cache: "reload",
          credentials: "same-origin",
        });
        if (
          !response.ok ||
          response.redirected ||
          (url.endsWith(".js") &&
            !/(javascript|ecmascript)/i.test(
              response.headers.get("Content-Type") || "",
            ))
        )
          throw new Error("El shell no está disponible con la sesión actual");
        await cache.put(url, response);
      }
      await self.skipWaiting();
    })(),
  );
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys())
        if (key.startsWith("wcsl-shell-") && key !== CACHE)
          await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" || !urls.includes(event.request.url))
    return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      try {
        const response = await fetch(event.request);
        if (response.ok && !response.redirected)
          await cache.put(event.request, response.clone());
        return response;
      } catch (error) {
        const cached = await cache.match(event.request);
        if (cached) return cached;
        throw error;
      }
    })(),
  );
});
