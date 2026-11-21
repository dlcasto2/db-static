// Ultraviolet: the proxy this static build browses through.
//
// db-v2 proxies pages through its own server (/api/proxy). This repo has no
// server, so pages load through Ultraviolet instead, which runs entirely in the
// browser: a service worker (public/uv/sw.js) rewrites each page and forwards
// its requests, over a bare-mux SharedWorker, to an Epoxy transport that
// tunnels them as raw TCP streams through a Wisp server — the one piece that
// has to live somewhere else, since GitHub Pages can't host a WebSocket
// server. TLS for https:// sites happens here in the browser (Epoxy), so the
// Wisp server relays encrypted bytes and never sees those pages' contents.
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
const TRANSPORT = withBasePath("/epoxy/index.js")

/**
 * Mercury Workshop's public demo Wisp server. It's throttled, so it's a
 * fallback that works out of the box — point Devon at your own server (menu →
 * Proxy server) for real use.
 */
export const DEFAULT_WISP_SERVER = "wss://wisp.mercurywork.shop/"
const WISP_STORAGE_KEY = "devon-wisp-server"

export function isValidWispUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === "wss:" || url.protocol === "ws:"
  } catch {
    return false
  }
}

export function getWispServer(): string {
  try {
    const saved = localStorage.getItem(WISP_STORAGE_KEY)
    if (saved && isValidWispUrl(saved)) return saved
  } catch {
    // storage blocked
  }
  return DEFAULT_WISP_SERVER
}

/** Saves the Wisp server (null = back to the default) and switches to it. Throws on an invalid URL. */
export async function setWispServer(value: string | null): Promise<void> {
  const next = value?.trim() || null
  if (next && !isValidWispUrl(next)) throw new Error("A Wisp server address starts with wss:// (or ws://)")
  try {
    if (next && next !== DEFAULT_WISP_SERVER) localStorage.setItem(WISP_STORAGE_KEY, next)
    else localStorage.removeItem(WISP_STORAGE_KEY)
  } catch {
    // storage blocked: still switch for this visit
  }
  if (connection) await connection.setTransport(TRANSPORT, [{ wisp: getWispServer() }])
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
  const registration = await navigator.serviceWorker.register(SW_URL, { scope: UV_PREFIX, updateViaCache: "none" })
  await activated(registration)
  // Also answers the service worker when it asks the page for a port to the
  // bare-mux worker, so this connection has to stay alive for the visit.
  // Loaded on first use: it touches browser-only globals as soon as it's imported
  const { BareMuxConnection } = await import("@mercuryworkshop/bare-mux")
  connection = new BareMuxConnection(BAREMUX_WORKER)
  await connection.setTransport(TRANSPORT, [{ wisp: getWispServer() }])
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

/** Forgets what proxied sites stored: Ultraviolet keeps their cookies in this IndexedDB database. */
export function clearUvData() {
  try {
    indexedDB.deleteDatabase("__op")
  } catch {
    // best-effort
  }
}
