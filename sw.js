/* NUCLY service worker — offline support */
const VERSION = "nucly-v2.0";
const CACHE_NAME = "nucly-shell-" + VERSION;

const SHELL = [
  "/",
  "/index.html",
  "/app.js",
  "/styles.css",
  "/manifest.webmanifest",
  "/icons/favicon.ico",
  "/icons/favicon-32.png",
  "/icons/apple-touch-icon.png",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/fonts/archivo-latin-var.woff2",
  "/img/rifaei.jpg",
  "/vendor/opencv.js"
];

function isSameOrigin(url) {
  return new URL(url).origin === location.origin;
}

self.addEventListener("install", function (e) {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(function (cache) {
        return cache.addAll(SHELL);
      })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(
          keys.filter(function (k) { return k.indexOf("nucly-shell-") === 0 && k !== CACHE_NAME; })
              .map(function (k) { return caches.delete(k); })
        );
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (e) {
  if (e.request.method !== "GET") return;
  var url = new URL(e.request.url);
  if (!isSameOrigin(url)) return;

  // Never let a network miss break SPA navigation.
  if (e.request.mode === "navigate") {
    e.respondWith(
      fetch(e.request)
        .then(function (resp) {
          var copy = resp.clone();
          caches.open(CACHE_NAME).then(function (c) { c.put(e.request, copy); });
          return resp;
        })
        .catch(function () {
          return caches.match("/index.html").then(function (r) { return r || caches.match("/"); });
        })
    );
    return;
  }

  e.respondWith(
    caches.match(e.request).then(function (cached) {
      var fetched = fetch(e.request).then(function (resp) {
        if (resp && resp.ok) {
          var copy = resp.clone();
          caches.open(CACHE_NAME).then(function (c) { c.put(e.request, copy); });
        }
        return resp;
      }).catch(function () {
        return cached || caches.match("/index.html");
      });
      return cached || fetched;
    })
  );
});

self.addEventListener("message", function (e) {
  if (e.data && e.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});