const CACHE_NAME = "tracer-cache-v16";

// Paths are resolved relative to this file's own location, so this works
// whether the site is served from a domain root or a GitHub Pages
// project subpath like /my-repo/.
const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./css/styles.css",
  "./js/firebase-config.js",
  "./js/reference-data.js",
  "./js/storage.js",
  "./js/sync.js",
  "./js/app.js",
  "./js/firebase-adapter.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL.map((p) => new URL(p, self.registration.scope))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Network-first for everything: when online you always get the latest files
// (so updates show up without a hard refresh); when offline the last cached
// copy is used. Firebase's own data traffic isn't cached here — Firestore
// keeps its own offline copy of the data.
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  const isSameOrigin = url.origin === self.location.origin;
  const isSdk = url.hostname === "www.gstatic.com" || url.hostname === "fonts.googleapis.com" ||
                url.hostname === "fonts.gstatic.com" || url.hostname === "cdnjs.cloudflare.com";
  if (!isSameOrigin && !isSdk) return;   // let Firebase API calls etc. go straight to the network

  event.respondWith(
    fetch(req, isSameOrigin ? { cache: "no-cache" } : undefined).then((res) => {
      if (res && res.ok) {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
      }
      return res;
    }).catch(() =>
      caches.match(req).then((cached) => cached || (isSameOrigin ? caches.match("./index.html") : Response.error()))
    )
  );
});
