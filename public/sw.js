// Minimal service worker. Its jobs: satisfy Chrome's installability
// requirement (a fetch handler), cache static assets, and let the app shell
// load when the phone is offline.
//
// Hard rules, learned the hard way:
//  - Pages (navigations) always go to the network first. A cache-first page
//    would keep showing a stale shell from before the passcode existed and
//    skip the redirect to /login.
//  - Never cache /api/* responses; they need the passcode cookie and a live
//    network round trip.
//  - Never cache redirects or the login page.
const CACHE_NAME = "seefar-shell-v2";

self.addEventListener("install", () => {
  // Take over from an older worker immediately instead of waiting for every
  // open tab to close.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

function isStaticAsset(url) {
  return (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname === "/favicon.ico"
  );
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  // Pages: network first, cached copy only when offline.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok && !response.redirected && url.pathname !== "/login") {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() =>
          caches.match(request).then(
            (cached) => cached ?? new Response("You are offline.", { status: 503 })
          )
        )
    );
    return;
  }

  // Static assets are fingerprinted, so cache-first is safe.
  if (isStaticAsset(url)) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ??
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
            }
            return response;
          })
      )
    );
  }
});
