// Ultraviolet: the proxy this static build browses through.
//
// db-v2 proxies pages through its own server (/api/proxy). This repo has no
// server, so pages load through Ultraviolet instead, which runs entirely in the
// browser: a service worker (public/uv/sw.js) rewrites each page and forwards
// its requests, over a bare-mux SharedWorker, to a transport that reaches the
// internet through a proxy server somewhere else — GitHub Pages can't host one.
// Two kinds work:
//
// - Wisp (wss://…): raw TCP streams over a WebSocket. TLS for https:// sites
//   happens here in the browser, so the Wisp server relays encrypted bytes and
//   never sees those pages' contents. Two transports speak it: libcurl.js
//   (public/transports/libcurl.js, the default) and Epoxy, which can't open
//   HTTP/2 sites whose response headers pass 16 KB — YouTube among them.
// - Bare (https://…/bare/), through the Bare transport: the older protocol
//   Abyss-Web's server speaks, so any Abyss deployment works as a backend.
//   The Bare server makes the requests itself, so it does see the pages.
//
// server/index.mjs runs both. When Devon is served by that server, it says so
// at /devon-backend.json and Devon uses it without being told.
//
// The service worker is scoped to <base>/uv/service/, so Devon's own pages
// are never touched by it; a proxied page is just an iframe pointed at
// <base>/uv/service/<encoded url>.
import type { BareMuxConnection } from "@mercuryworkshop/bare-mux"
import { withBasePath } from "@/lib/base-path"

/** Must match public/uv/uv.config.js */
export const UV_PREFIX = withBasePath("/uv/service/")
const SW_URL = withBasePath("/uv/sw.js")
const BAREMUX_WORKER = withBasePath("/baremux/worker.js")
const LIBCURL_TRANSPORT = withBasePath("/transports/libcurl.js")
const EPOXY_TRANSPORT = withBasePath("/epoxy/index.js")
const BARE_TRANSPORT = withBasePath("/baremod/index.js")

/** What carries the traffic to a Wisp server */
export type WispTransport = "libcurl" | "epoxy"
const TRANSPORT_KEY = "devon-wisp-transport"

export function getWispTransport(): WispTransport {
  try {
    if (localStorage.getItem(TRANSPORT_KEY) === "epoxy") return "epoxy"
  } catch {
    // storage blocked
  }
  return "libcurl"
}

/** Saves the Wisp transport and switches to it */
export async function setWispTransport(transport: WispTransport): Promise<void> {
  try {
    if (transport === "epoxy") localStorage.setItem(TRANSPORT_KEY, "epoxy")
    else localStorage.removeItem(TRANSPORT_KEY)
  } catch {
    // storage blocked: still switch for this visit
  }
  if (connection) await useTransport(connection)
}

/**
 * Mercury Workshop's public demo Wisp server. It's throttled, so it's a
 * fallback that works out of the box — point Devon at your own server
 * (Settings → Proxy server) for real use.
 */
export const DEFAULT_PROXY_SERVER = "wss://wisp.mercurywork.shop/"
const STORAGE_KEY = "devon-proxy-server"
/** What the first version of this setting was saved under (Wisp only) */
const LEGACY_STORAGE_KEY = "devon-wisp-server"

export type ProxyKind = "wisp" | "bare"

/** wss:// and ws:// are Wisp servers, https:// and http:// Bare servers; anything else is null */
export function proxyKind(value: string): ProxyKind | null {
  try {
    const { protocol } = new URL(value)
    if (protocol === "wss:" || protocol === "ws:") return "wisp"
    if (protocol === "https:" || protocol === "http:") return "bare"
  } catch {
    // not a URL
  }
  return null
}

/** Why `value` can't be used as a proxy server, or null if it can */
export function proxyServerProblem(value: string): string | null {
  const kind = proxyKind(value)
  if (!kind) return "Enter a Wisp server (wss://…) or a Bare server (https://…/bare/)"
  const { protocol, hostname } = new URL(value)
  const local = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]"
  // An https page can't open ws:// or fetch http:// (mixed content)
  if (typeof location !== "undefined" && location.protocol === "https:" && !local && (protocol === "ws:" || protocol === "http:")) {
    return `Devon is on https, so the server has to be ${kind === "wisp" ? "wss://" : "https://"} too`
  }
  return null
}

/** The server the person chose, or null for automatic */
export function getSavedProxyServer(): string | null {
  try {
    const saved = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY)
    if (saved && proxyKind(saved)) return saved
  } catch {
    // storage blocked
  }
  return null
}

/** This site's own backend (server/index.mjs), when Devon is served by it */
let detectedBackend: string | null = null

export function getDetectedBackend(): string | null {
  return detectedBackend
}

/** The server Devon proxies through: the chosen one, else this site's own backend, else the public demo */
export function getProxyServer(): string {
  return getSavedProxyServer() ?? detectedBackend ?? DEFAULT_PROXY_SERVER
}

/** Saves the proxy server (null or empty = automatic) and switches to it. Throws if it can't be used. */
export async function setProxyServer(value: string | null): Promise<void> {
  const next = value?.trim() || null
  const problem = next ? proxyServerProblem(next) : null
  if (problem) throw new Error(problem)
  try {
    localStorage.removeItem(LEGACY_STORAGE_KEY)
    if (next) localStorage.setItem(STORAGE_KEY, next)
    else localStorage.removeItem(STORAGE_KEY)
  } catch {
    // storage blocked: still switch for this visit
  }
  if (connection) await useTransport(connection)
}

async function detectBackend(): Promise<void> {
  try {
    const res = await fetch("/devon-backend.json", { cache: "no-store", signal: AbortSignal.timeout(2500) })
    if (!res.ok) return
    const info = (await res.json()) as { wisp?: unknown }
    if (typeof info.wisp !== "string") return
    const url = new URL(info.wisp, location.origin)
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
    detectedBackend = url.href
  } catch {
    // not served by Devon's backend (GitHub Pages, `pnpm dev`)
  }
}

function useTransport(conn: BareMuxConnection): Promise<void> {
  const server = getProxyServer()
  return proxyKind(server) === "bare"
    ? conn.setTransport(BARE_TRANSPORT, [server])
    : conn.setTransport(getWispTransport() === "epoxy" ? EPOXY_TRANSPORT : LIBCURL_TRANSPORT, [{ wisp: server }])
}

/**
 * Whether the proxy server answers at all: a Wisp server accepts a
 * WebSocket, a Bare server answers a request. Used to tell "the site is down"
 * from "the proxy is down" when a load fails to connect.
 */
export function proxyServerReachable(timeoutMs = 5000): Promise<boolean> {
  const server = getProxyServer()
  if (proxyKind(server) === "bare") {
    return fetch(server, { cache: "no-store", signal: AbortSignal.timeout(timeoutMs) }).then(
      () => true,
      () => false,
    )
  }
  return new Promise((resolve) => {
    let socket: WebSocket
    try {
      socket = new WebSocket(server)
    } catch {
      resolve(false)
      return
    }
    const finish = (ok: boolean) => {
      clearTimeout(timer)
      socket.onopen = socket.onerror = socket.onclose = null
      try {
        socket.close()
      } catch {
        // already closed
      }
      resolve(ok)
    }
    const timer = setTimeout(() => finish(false), timeoutMs)
    socket.onopen = () => finish(true)
    socket.onerror = () => finish(false)
    socket.onclose = () => finish(false)
  })
}

// Ultraviolet's "xor" codec (Ultraviolet.codec.xor), the one uv.config.js
// uses: every other character XOR 2, then percent-encoded. Reimplemented here
// so Devon's own pages don't have to load Ultraviolet's 370 KB bundle.
function xorEncode(input: string): string {
  let out = ""
  for (let i = 0; i < input.length; i++) out += i % 2 ? String.fromCharCode(input.charCodeAt(i) ^ 2) : input[i]
  return encodeURIComponent(out)
}

function xorDecode(input: string): string {
  const [encoded, ...search] = input.split("?")
  const text = decodeURIComponent(encoded)
  let out = ""
  for (let i = 0; i < text.length; i++) out += i % 2 ? String.fromCharCode(text.charCodeAt(i) ^ 2) : text[i]
  return out + (search.length ? "?" + search.join("?") : "")
}

/** The frame address that loads `url` through Ultraviolet */
export function uvUrl(url: string): string {
  return UV_PREFIX + xorEncode(url)
}

/**
 * The real address of a proxied page or link, given its address inside the
 * frame — null if it isn't one of Ultraviolet's (it left the proxy).
 */
export function realUrlFromUv(href: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(href)
  } catch {
    return null
  }
  if (parsed.origin !== location.origin || !parsed.pathname.startsWith(UV_PREFIX)) return null
  const encoded = parsed.pathname.slice(UV_PREFIX.length) + parsed.search
  let real: string
  try {
    real = xorDecode(encoded)
    new URL(real)
  } catch {
    return null
  }
  // In-page jumps (#section) change the frame's own hash, not the encoded URL
  if (parsed.hash && !real.includes("#")) real += parsed.hash
  return real
}

let connection: BareMuxConnection | null = null
let ready: Promise<void> | null = null

function activated(registration: ServiceWorkerRegistration): Promise<void> {
  if (registration.active) return Promise.resolve()
  const worker = registration.installing ?? registration.waiting
  if (!worker) return Promise.reject(new Error("Devon's proxy service worker didn't install"))
  return new Promise((resolve, reject) => {
    const onChange = () => {
      if (worker.state === "activated") {
        worker.removeEventListener("statechange", onChange)
        resolve()
      } else if (worker.state === "redundant") {
        worker.removeEventListener("statechange", onChange)
        reject(new Error("Devon's proxy service worker failed to install"))
      }
    }
    worker.addEventListener("statechange", onChange)
    onChange()
  })
}

async function start(): Promise<void> {
  if (!("serviceWorker" in navigator)) {
    throw new Error(
      "This browser can't run Devon's proxy: service workers are turned off (Firefox does this in private windows) or unsupported.",
    )
  }
  if (typeof SharedWorker === "undefined") {
    throw new Error("This browser can't run Devon's proxy: it doesn't support SharedWorker.")
  }
  // navigator.serviceWorker.ready never resolves here — it waits for a worker
  // controlling *this* page, and this one deliberately doesn't — so wait on
  // the registration itself.
  const [registration] = await Promise.all([
    navigator.serviceWorker.register(SW_URL, { scope: UV_PREFIX, updateViaCache: "none" }),
    detectBackend(),
  ])
  await activated(registration)
  // Also answers the service worker when it asks the page for a port to the
  // bare-mux worker, so this connection has to stay alive for the visit.
  // Loaded on first use: it touches browser-only globals as soon as it's imported
  const { BareMuxConnection } = await import("@mercuryworkshop/bare-mux")
  connection = new BareMuxConnection(BAREMUX_WORKER)
  await useTransport(connection)
}

/** Starts the proxy once per visit; every navigation awaits this first. */
export function ensureUv(): Promise<void> {
  if (!ready) {
    ready = start().catch((error) => {
      ready = null // let the next navigation try again
      connection = null
      throw error
    })
  }
  return ready
}

let bareClient: import("@mercuryworkshop/bare-mux").BareClient | null = null

/**
 * fetch() through Devon's proxy, for Devon's own code that needs a site's data
 * rather than a page to show (the YouTube app). Same transport and server as
 * the pages; no CORS, and request headers go as given — including ones a
 * browser's fetch() won't send, like Cookie and Origin, when they're passed as
 * init.headers.
 */
export async function proxyFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  await ensureUv()
  if (!bareClient) {
    const { BareClient } = await import("@mercuryworkshop/bare-mux")
    bareClient = new BareClient(BAREMUX_WORKER)
  }
  init?.signal?.throwIfAborted()
  // BareClient also takes a Request (it builds one from whatever it's given),
  // though its types only say string | URL
  return bareClient.fetch((input instanceof URL ? input.href : input) as string, init)
}

/** Forgets what proxied sites stored: Ultraviolet keeps their cookies in this IndexedDB database. */
export function clearUvData() {
  try {
    indexedDB.deleteDatabase("__op")
  } catch {
    // best-effort
  }
}
