/*global UVServiceWorker,__uv$config*/
// Ultraviolet's service worker. Registered by lib/uv.ts with the scope
// <base>/uv/service/ only, so it never touches Devon's own pages: it handles
// the proxied pages inside Devon's frame and everything they load.
//
// The other files are imported relative to this script, which keeps it working
// both at /db-static/uv/sw.js (GitHub Pages) and /uv/sw.js (`pnpm dev`).
importScripts("uv.bundle.js")
importScripts("uv.config.js")
importScripts(__uv$config.sw)

const uv = new UVServiceWorker()

// A new deploy's worker takes over straight away instead of waiting for every
// tab to close, so a fix reaches people on their next page load.
self.addEventListener("install", () => self.skipWaiting())
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()))

self.addEventListener("fetch", (event) => {
  if (!uv.route(event)) return // not a proxied request: let the browser handle it
  event.respondWith(uv.fetch(event))
})
