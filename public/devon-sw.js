/*global BareMux*/
// Devon's own service worker, registered by lib/devon-sw.ts with the scope of
// all of Devon. It answers two kinds of address and nothing else — every other
// request goes to the network as if it weren't here:
//
//   <base>/yt/stream?id=<video>&itag=<format>&c=<client>
//     A YouTube format's bytes, in slices of at most 3 MB, honoring Range so a
//     <video> can play and seek and the downloader can fetch slice by slice.
//     (What db-v2's /api/youtube/stream does on its server.) YouTube ties
//     stream URLs to the IP that asked for them, so the page resolves the URL
//     through the proxy (lib/youtube-local.ts) and this fetches the bytes
//     through the same proxy.
//   <base>/yt/thumb?id=<video>&f=<mqdefault|hqdefault|…>
//     A video's thumbnail from i.ytimg.com, through the proxy.
//
// Requests go out over bare-mux, the same transport Ultraviolet uses; the page
// that registered this hands it a port to the transport's SharedWorker.
importScripts("baremux/index.js")

const BASE = new URL("./", self.location.href).pathname
const STREAM = BASE + "yt/stream"
const THUMB = BASE + "yt/thumb"
const CHUNK = 3 * 1024 * 1024
const VIDEO_ID = /^[\w-]{11}$/
const STREAM_HEADERS = { accept: "*/*", origin: "https://www.youtube.com", referer: "https://www.youtube.com/" }
/** Stream URLs last about 6 hours; keep them for 1 */
const URL_TTL = 60 * 60 * 1000

let bareClient = null
const bare = () => (bareClient ??= new BareMux.BareClient())

self.addEventListener("install", () => self.skipWaiting())
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()))
// A page loaded without this worker (first visit, hard reload) asks it to take over
self.addEventListener("message", (event) => {
  if (event.data?.type === "devon-claim") event.waitUntil(self.clients.claim())
})

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url)
  if (url.origin !== self.location.origin || event.request.method !== "GET") return
  if (url.pathname === STREAM) event.respondWith(stream(event, url).catch(failed))
  else if (url.pathname === THUMB) event.respondWith(thumb(url).catch(failed))
})

function failed(error) {
  const status = Number(error?.status) || 502
  return json({ error: error?.message || String(error) }, status)
}

function json(body, status) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}

// ---------------------------------------------------------------------------
// Thumbnails
// ---------------------------------------------------------------------------

async function thumb(url) {
  const id = url.searchParams.get("id") || ""
  const file = url.searchParams.get("f") || "mqdefault"
  if (!VIDEO_ID.test(id) || !/^(default|mqdefault|hqdefault|sddefault|maxresdefault)$/.test(file)) {
    return json({ error: "Bad thumbnail." }, 400)
  }
  const res = await bare().fetch(`https://i.ytimg.com/vi/${id}/${file}.jpg`)
  return new Response(res.body, {
    status: res.status,
    headers: { "content-type": res.headers.get("content-type") || "image/jpeg", "cache-control": "private, max-age=86400" },
  })
}

// ---------------------------------------------------------------------------
// Streams
// ---------------------------------------------------------------------------

/** id|itag|client → { url, size, mime, expires } */
const resolved = new Map()

/** Asks one of Devon's pages for a format's stream URL (lib/youtube-local.ts answers) */
function ask(win, message) {
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel()
    const timer = setTimeout(() => reject(new Error("Devon's YouTube page didn't answer.")), 60000)
    channel.port1.onmessage = (event) => {
      clearTimeout(timer)
      resolve(event.data)
    }
    win.postMessage(message, [channel.port2])
  })
}

async function resolveStream(event, id, itag, client, fresh) {
  const key = `${id}|${itag}|${client}`
  const hit = resolved.get(key)
  if (!fresh && hit && hit.expires > Date.now()) return hit

  // The page that asked (a <video>, or the downloader) knows the video
  const asker = event.clientId ? await self.clients.get(event.clientId) : null
  const pages = asker ? [asker] : await self.clients.matchAll({ type: "window" })
  if (!pages.length) throw Object.assign(new Error("Open the video in Devon's YouTube app first."), { status: 409 })

  let lastError = null
  for (const page of pages) {
    try {
      const answer = await ask(page, { type: "devon-yt-resolve", id, itag, client, fresh })
      if (answer?.error) throw Object.assign(new Error(answer.error), { status: answer.status || 502 })
      const out = { url: answer.url, size: answer.size ?? null, mime: answer.mime || "application/octet-stream", expires: Date.now() + URL_TTL }
      resolved.set(key, out)
      if (resolved.size > 200) resolved.delete(resolved.keys().next().value)
      return out
    } catch (error) {
      lastError = error
    }
  }
  throw lastError
}

function fetchRange(url, start, end) {
  return bare().fetch(`${url}${url.includes("?") ? "&" : "?"}range=${start}-${end}`, { headers: STREAM_HEADERS })
}

async function stream(event, url) {
  const id = url.searchParams.get("id") || ""
  const itag = Number(url.searchParams.get("itag"))
  const client = url.searchParams.get("c") || ""
  if (!VIDEO_ID.test(id) || !Number.isInteger(itag) || itag <= 0) return json({ error: "Bad video or format." }, 400)

  let start = 0
  let endWanted = null
  const range = event.request.headers.get("range")?.match(/^bytes=(\d*)-(\d*)$/)
  if (range && range[1]) {
    start = Number(range[1])
    if (range[2]) endWanted = Number(range[2])
  }

  let r = await resolveStream(event, id, itag, client, false)
  const total = r.size
  if (total !== null && start >= total) {
    return new Response(null, { status: 416, headers: { "content-range": `bytes */${total}` } })
  }
  let end = start + CHUNK - 1
  if (endWanted !== null && endWanted >= start) end = Math.min(end, endWanted)
  if (total !== null) end = Math.min(end, total - 1)

  let res = await fetchRange(r.url, start, end)
  if (res.status === 403 || res.status === 410) {
    // Expired, or tied to an IP the proxy no longer has: resolve again
    await res.body?.cancel().catch(() => {})
    r = await resolveStream(event, id, itag, client, true)
    res = await fetchRange(r.url, start, end)
  }
  if (!res.ok) {
    await res.body?.cancel().catch(() => {})
    return json({ error: `YouTube refused the stream (HTTP ${res.status}).` }, 502)
  }

  // googlevideo answers range= with 200 and just those bytes
  const length = Number(res.headers.get("content-length"))
  if (length > 0) end = start + Math.min(length, end - start + 1) - 1
  const fromRange = Number(res.headers.get("content-range")?.match(/\/(\d+)$/)?.[1])
  const whole = total ?? (fromRange || null)
  return new Response(res.body, {
    status: 206,
    headers: {
      "content-type": r.mime.split(";")[0] || "application/octet-stream",
      "content-length": String(end - start + 1),
      "content-range": `bytes ${start}-${end}/${whole ?? "*"}`,
      "accept-ranges": "bytes",
    },
  })
}
