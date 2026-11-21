// Registers Devon's own service worker (public/devon-sw.js). Unlike
// Ultraviolet's, it's scoped to all of Devon, so it can answer requests that
// Devon's own pages make — a <video>'s byte ranges, a thumbnail — by fetching
// them through the proxy. It answers only its own addresses (<base>/yt/…) and
// leaves everything else to the network.
import { withBasePath } from "@/lib/base-path"
import { ensureUv } from "@/lib/uv"

const SW_URL = withBasePath("/devon-sw.js")
const SCOPE = withBasePath("/")

const isDevonSw = (worker: ServiceWorker | null | undefined) => Boolean(worker?.scriptURL.endsWith("/devon-sw.js"))

let ready: Promise<void> | null = null

async function start(): Promise<void> {
  // Its requests go out over the proxy's transport, which this page provides
  await ensureUv()
  if (isDevonSw(navigator.serviceWorker.controller)) return
  const registration = await navigator.serviceWorker.register(SW_URL, { scope: SCOPE, updateViaCache: "none" })
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Devon's media service worker didn't start.")), 15000)
    const done = () => {
      clearTimeout(timer)
      navigator.serviceWorker.removeEventListener("controllerchange", check)
      resolve()
    }
    const check = () => {
      if (isDevonSw(navigator.serviceWorker.controller)) done()
    }
    navigator.serviceWorker.addEventListener("controllerchange", check)
    // An already-active worker doesn't take over a page loaded without it
    // (first visit, or a hard reload) until asked
    const ask = () => (registration.active ?? registration.waiting ?? registration.installing)?.postMessage({ type: "devon-claim" })
    ask()
    const worker = registration.installing ?? registration.waiting
    worker?.addEventListener("statechange", () => {
      if (worker.state === "activated") ask()
    })
    check()
  })
}

/** Makes sure Devon's service worker controls this page; resolves once it does. */
export function ensureDevonSw(): Promise<void> {
  if (!ready) {
    ready = start().catch((error) => {
      ready = null
      throw error
    })
  }
  return ready
}
