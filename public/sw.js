// Service worker: keeps the booth loadable when the venue's internet is down.
// The music itself never needs the network (it plays from the club's local
// folder); this caches the app shell so a reboot or reload works offline too.
//
//   /_next/static/*        cache-first (file names are content-hashed)
//   pages and RSC data     network-first, cached copy when offline
//   other same-origin GETs stale-while-revalidate (worklets, manifest, icons)

const CACHE = "ai-dj-v2";
const CORE = ["/booth", "/library", "/moods", "/history", "/worklets/keylock.js", "/worklets/scrub.js", "/manifest.webmanifest", "/favicon.ico"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => Promise.all(CORE.map((url) => cache.add(url).catch(() => undefined))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function cacheFirst(request) {
  const hit = await caches.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) (await caches.open(CACHE)).put(request, res.clone());
  return res;
}

async function networkFirst(request) {
  try {
    const res = await fetch(request);
    if (res.ok) (await caches.open(CACHE)).put(request, res.clone());
    return res;
  } catch (err) {
    const hit = (await caches.match(request)) ?? (request.mode === "navigate" ? await caches.match("/booth") : undefined);
    if (hit) return hit;
    throw err;
  }
}

async function staleWhileRevalidate(request) {
  const hit = await caches.match(request);
  const refresh = fetch(request)
    .then(async (res) => {
      if (res.ok) (await caches.open(CACHE)).put(request, res.clone());
      return res;
    })
    .catch(() => undefined);
  return hit ?? (await refresh) ?? Response.error();
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/_next/static/")) event.respondWith(cacheFirst(request));
  else if (request.mode === "navigate" || request.headers.get("RSC") === "1" || url.searchParams.has("_rsc"))
    event.respondWith(networkFirst(request));
  else if (!url.pathname.startsWith("/_next/")) event.respondWith(staleWhileRevalidate(request));
});
