/*global UVServiceWorker,__uv$config*/
// Ultraviolet's service worker. Registered by lib/uv.ts with the scope
// <base>/uv/service/ only, so it never touches Devon's own pages: it handles
// the proxied pages inside Devon's frame and everything they load.
//
// The other files are imported relative to this script, which keeps it working
// both at /db-static/uv/sw.js (GitHub Pages) and /uv/sw.js (`pnpm dev`).
importScripts("uv.bundle.js")
importScripts("uv.config.js")
// Same rewritten scripts, sooner: see fast-walk.js
importScripts("fast-walk.js")
importScripts(__uv$config.sw)

const uv = new UVServiceWorker()

// A new deploy's worker takes over straight away instead of waiting for every
// tab to close, so a fix reaches people on their next page load.
self.addEventListener("install", () => self.skipWaiting())
self.addEventListener("activate", (event) => event.waitUntil(Promise.all([self.clients.claim(), dropOldCaches()])))

self.addEventListener("fetch", (event) => {
  if (!uv.route(event)) return // not a proxied request: let the browser handle it
  event.respondWith(cacheable(event.request) ? fromCache(event) : uv.fetch(event))
})

// ---------------------------------------------------------------------------
// Cache
//
// Responses a service worker builds never reach the browser's own HTTP cache,
// so without this every visit downloads and rewrites everything again. That
// hurts most on scripts: Ultraviolet rewrites each one before it runs, which
// for YouTube's 9.6 MB main script takes ~20 s on a 4 GB Chromebook (the
// download itself ~3 s), and this worker can't answer anything else meanwhile.
// So static files — scripts already rewritten, stylesheets, fonts, images —
// are kept here for as long as the site's own Cache-Control allows, which for
// YouTube's versioned scripts is a year.
// ---------------------------------------------------------------------------

/** Bump when Ultraviolet or its config changes: rewritten scripts depend on both */
const CACHE = "devon-uv-cache-v1"
const MAX_ENTRIES = 400
/** No entry is trusted for longer than this, whatever the site says */
const MAX_AGE_S = 30 * 24 * 60 * 60
/** Not worth keeping what goes stale within the hour */
const MIN_AGE_S = 60 * 60
const DESTINATIONS = new Set(["script", "worker", "sharedworker", "style", "font", "image"])
const EXPIRES = "x-devon-cache-expires"

function cacheable(request) {
  return request.method === "GET" && DESTINATIONS.has(request.destination) && !request.headers.has("range")
}

async function dropOldCaches() {
  for (const name of await caches.keys()) {
    if (name.startsWith("devon-uv-cache-") && name !== CACHE) await caches.delete(name)
  }
}

/** Seconds the response may be reused for, or 0 */
function lifetime(response) {
  if (response.status !== 200) return 0
  const cc = (response.headers.get("cache-control") || "").toLowerCase()
  if (/no-store|no-cache/.test(cc)) return 0
  const vary = (response.headers.get("vary") || "").toLowerCase()
  if (vary.includes("*") || vary.includes("cookie")) return 0
  let maxAge = Number(cc.match(/(?:^|,)\s*max-age=(\d+)/)?.[1])
  if (!Number.isFinite(maxAge)) {
    const expires = Date.parse(response.headers.get("expires") || "")
    maxAge = Number.isFinite(expires) ? Math.round((expires - Date.now()) / 1000) : 0
  }
  const age = Number(response.headers.get("age")) || 0
  const left = Math.min(maxAge - age, MAX_AGE_S)
  return left >= MIN_AGE_S ? left : 0
}

async function fromCache(event) {
  const url = event.request.url
  let cache = null
  try {
    cache = await caches.open(CACHE)
    const hit = await cache.match(url, { ignoreVary: true })
    if (hit) {
      if (Number(hit.headers.get(EXPIRES)) > Date.now()) return hit
      await cache.delete(url)
    }
  } catch {
    // no Cache Storage (private window, quota): just fetch
  }

  const response = await uv.fetch(event)
  const seconds = cache ? lifetime(response) : 0
  if (seconds) {
    const copy = response.clone()
    event.waitUntil(store(cache, url, copy, seconds))
  }
  return response
}

async function store(cache, url, response, seconds) {
  try {
    const headers = new Headers(response.headers)
    headers.set(EXPIRES, String(Date.now() + seconds * 1000))
    // Kept by address alone; what it varied on doesn't change within this browser
    headers.delete("vary")
    const body = await response.blob()
    await cache.put(url, new Response(body, { status: response.status, statusText: response.statusText, headers }))
    const keys = await cache.keys()
    // Oldest first: drop whatever is over the limit
    for (const old of keys.slice(0, Math.max(0, keys.length - MAX_ENTRIES))) await cache.delete(old)
  } catch {
    // full or unavailable: it just won't be cached
  }
}
