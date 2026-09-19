/* NUCLY v2 - Service Worker (offline support) */
const CACHE_NAME = "nucly-v2-1";
const ASSETS = [
  "./",
  "index.html",
  "manifest.webmanifest",
  "opencv.js",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/apple-touch-icon.png"
];

self.addEventListener("install", function (e) {
  e.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(ASSETS);
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.filter(function (k) { return k !== CACHE_NAME; })
            .map(function (k) { return caches.delete(k); })
      );
    }).then(function () {
      return self.clients.claim();
    })
  );
});

self.addEventListener("fetch", function (e) {
  if (e.request.method !== "GET") { return; }
  e.respondWith(
    caches.match(e.request).then(function (cached) {
      if (cached) { return cached; }
      return fetch(e.request).then(function (resp) {
        const copy = resp.clone();
        if (resp && resp.ok && new URL(e.request.url).origin === location.origin) {
          caches.open(CACHE_NAME).then(function (cache) {
            cache.put(e.request, copy);
          });
        }
        return resp;
      }).catch(function () {
        return caches.match("index.html");
      });
    })
  );
});