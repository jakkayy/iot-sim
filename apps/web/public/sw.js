// Caches the heavy runtime binaries (MicroPython wasm/loader, compiled sketches
// fixtures) so only the first Run downloads them. Cache-first; the URL carries
// a ?v= version, so a new runtime version is a new cache entry.
const CACHE = "sim-runtime-v1";
const CACHED_PATHS = [/^\/micropython\//, /^\/arduino\//];

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key.startsWith("sim-runtime-") && key !== CACHE) await caches.delete(key);
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;
  if (!CACHED_PATHS.some((re) => re.test(url.pathname))) return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(event.request);
      if (hit) return hit;
      const res = await fetch(event.request);
      if (res.ok) await cache.put(event.request, res.clone());
      return res;
    })(),
  );
});
