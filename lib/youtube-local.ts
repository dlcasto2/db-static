/**
 * Devon's YouTube backend, running in the page: search, video info and the
 * stream URLs behind <base>/yt/stream. Ported from db-v2's server
 * (lib/youtube-server.ts there), which this static build doesn't have.
 *
 * youtubei.js talks to YouTube through Devon's proxy (proxyFetch), so YouTube
 * sees the proxy server's IP — the same IP that then fetches the video bytes
 * (public/devon-sw.js), which matters: YouTube ties stream URLs to the IP that
 * asked for them.
 *
 * Loaded on demand (lib/youtube.ts imports it dynamically), so youtubei.js is
 * only downloaded when the YouTube app is used.
 */
import { Innertube, Platform, YTNodes, type Types } from "youtubei.js/web"
import { ensureDevonSw } from "@/lib/devon-sw"
import { getProxyServer, proxyFetch } from "@/lib/uv"
import type { YTFormat, YTSearchItem, YTVideo } from "@/lib/youtube"

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class YTError extends Error {
  status: number
  /**
   * "bot-check" — YouTube answered and is blocking the proxy server's IP.
   * "network-unreachable" — the proxy couldn't reach YouTube at all.
   * "stream-unavailable" — neither of the above; a catch-all.
   */
  code?: string
  /** What each YouTube client answered, for the error card */
  details?: string[]

  constructor(message: string, status = 502, code?: string, details?: string[]) {
    super(message)
    this.status = status
    this.code = code
    this.details = details
  }
}

/** YouTube's bot check. It's about the proxy server's IP, so every client gets it. */
const BOT_CHECK_RE = /not a bot|sign in to confirm|confirm you.re not|unusual traffic|LOGIN_REQUIRED/i

/** A failure to reach YouTube at all through the proxy (curl's / the transport's words) */
const UNREACHABLE_RE = /error code (6|7|28|35|52|56)\b|could not connect|couldn.t resolve|websocket|wisp/i

function unreachable(error: unknown): string | null {
  const message = error instanceof Error ? error.message : String(error)
  return UNREACHABLE_RE.test(message) ? `[network] ${message}` : null
}

// ---------------------------------------------------------------------------
// Running YouTube's player code
// ---------------------------------------------------------------------------

/**
 * youtubei.js extracts the signature / "n" functions from YouTube's player
 * script and needs something to run them. They run in a sandboxed iframe with
 * an opaque origin — no access to Devon's storage, cookies or pages — like the
 * separate V8 context db-v2's server uses.
 */
let evalFrame: Promise<HTMLIFrameElement> | null = null
const evalWaiting = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
let evalSeq = 0

function sandbox(): Promise<HTMLIFrameElement> {
  if (!evalFrame) {
    evalFrame = new Promise((resolve) => {
      const frame = document.createElement("iframe")
      frame.setAttribute("sandbox", "allow-scripts")
      frame.setAttribute("aria-hidden", "true")
      frame.style.display = "none"
      frame.srcdoc = `<script>
addEventListener("message", (event) => {
  const { id, code, env } = event.data || {}
  let result = null, error = null
  try { result = new Function("env", code)(env) } catch (e) { error = String((e && e.message) || e) }
  event.source.postMessage({ id, result, error }, "*")
})
</script>`
      window.addEventListener("message", (event) => {
        if (event.source !== frame.contentWindow) return
        const { id, result, error } = event.data || {}
        const waiting = evalWaiting.get(id)
        if (!waiting) return
        evalWaiting.delete(id)
        if (error) waiting.reject(new Error(error))
        else waiting.resolve(result)
      })
      frame.addEventListener("load", () => resolve(frame), { once: true })
      document.body.appendChild(frame)
    })
  }
  return evalFrame
}

Platform.shim.eval = async (data, env) => {
  const frame = await sandbox()
  const id = ++evalSeq
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      evalWaiting.delete(id)
      reject(new Error("YouTube's player code took too long to run."))
    }, 5000)
    evalWaiting.set(id, {
      resolve: (v) => {
        clearTimeout(timer)
        resolve(v as Awaited<ReturnType<typeof Platform.shim.eval>>)
      },
      reject: (e) => {
        clearTimeout(timer)
        reject(e)
      },
    })
    // data.output is a function body that ends with `return process(n, sp, sig)`
    frame.contentWindow?.postMessage({ id, code: data.output, env }, "*")
  })
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

const YT_HOST = /(^|\.)(youtube\.com|youtube-nocookie\.com|googleapis\.com|googlevideo\.com)$/i

/**
 * proxyFetch, plus what a request from youtube.com itself would carry: a page
 * can't send Origin, Referer or User-Agent with fetch(), but through the proxy
 * they go as given.
 */
const ytFetch: typeof fetch = (input, init) => {
  const url = input instanceof Request ? input.url : String(input)
  let host = ""
  try {
    host = new URL(url).hostname
  } catch {
    // relative: leave it
  }
  if (YT_HOST.test(host)) {
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
    if (!headers.has("origin")) headers.set("origin", "https://www.youtube.com")
    if (!headers.has("referer")) headers.set("referer", "https://www.youtube.com/")
    if (!headers.has("user-agent")) headers.set("user-agent", navigator.userAgent)
    init = { ...init, headers }
  }
  return proxyFetch(input, init)
}

const COOKIE_KEY = "devon-yt-cookie"

export function readCookie(): string {
  try {
    return localStorage.getItem(COOKIE_KEY) ?? ""
  } catch {
    return ""
  }
}

let session: { promise: Promise<Innertube>; cookie: string; born: number } | null = null
const SESSION_TTL = 6 * 60 * 60 * 1000

function yt(): Promise<Innertube> {
  const cookie = readCookie()
  if (session && session.cookie === cookie && Date.now() - session.born < SESSION_TTL) return session.promise
  const promise = Innertube.create({
    retrieve_player: true,
    lang: "en",
    location: "US",
    fetch: ytFetch,
    ...(cookie ? { cookie } : {}),
  }).catch((error) => {
    session = null
    throw error
  })
  session = { promise, cookie, born: Date.now() }
  return promise
}

/** Throws away the session and resolved videos, e.g. after the cookie changed or YouTube rotated its player */
export function resetSession() {
  session = null
  cache.clear()
}

/** The proxy, plus Devon's service worker that thumbnails and video bytes come from */
export function ensureReady(): Promise<void> {
  return ensureDevonSw()
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export interface YTSearchPage {
  items: YTSearchItem[]
  next: string | null
}

const text = (t: unknown): string => {
  if (!t) return ""
  if (typeof t === "string") return t
  const s = String((t as { toString(): string }).toString?.() ?? "")
  return s === "[object Object]" || s === "N/A" ? "" : s
}

/** One video from a parsed list */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toItem(node: any): YTSearchItem | null {
  if (node?.is?.(YTNodes.Video)) {
    const v = node as InstanceType<typeof YTNodes.Video>
    if (!v.video_id) return null
    return {
      id: v.video_id,
      title: text(v.title),
      channel: v.author?.name && v.author.name !== "N/A" ? v.author.name : "",
      duration: v.length_text ? text(v.length_text) : v.duration?.text || "",
      views: text(v.short_view_count) || text(v.view_count),
      published: text(v.published),
      live: Boolean(v.is_live),
    }
  }
  if (node?.is?.(YTNodes.LockupView)) {
    const l = node as InstanceType<typeof YTNodes.LockupView>
    if (l.content_type !== "VIDEO" || !l.content_id) return null
    // Metadata rows look like [channel] [views · published]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows: any[] = (l.metadata?.metadata as any)?.metadata_rows ?? []
    const parts = rows.map((r) => (r?.metadata_parts ?? []).map((p: { text?: unknown }) => text(p?.text)).filter(Boolean))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const overlays: any[] = (l.content_image as any)?.overlays ?? []
    let duration = ""
    for (const o of overlays) {
      for (const b of o?.badges ?? []) if (!duration && b?.text) duration = String(b.text)
      if (!duration && o?.text) duration = String(o.text)
    }
    return {
      id: l.content_id,
      title: text(l.metadata?.title),
      channel: parts[0]?.[0] ?? "",
      duration,
      views: parts[1]?.[0] ?? "",
      published: parts[1]?.[1] ?? "",
      live: /live/i.test(duration),
    }
  }
  return null
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function collect(nodes: any[], memo?: any): YTSearchPage {
  const seen = new Set<string>()
  const items: YTSearchItem[] = []
  for (const n of nodes) {
    const item = toItem(n)
    if (item && !seen.has(item.id)) {
      seen.add(item.id)
      items.push(item)
    }
  }
  let next: string | null = null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const conts: any[] = memo?.getType?.(YTNodes.ContinuationItem) ?? []
  for (const c of conts) {
    const token = c?.endpoint?.payload?.token
    if (typeof token === "string") next = token
  }
  return { items, next }
}

/** Every video node in a parsed response (search results are nested a few levels deep) */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function allNodes(memo: any): any[] {
  if (!memo?.getType) return []
  return memo.getType(YTNodes.Video, YTNodes.LockupView)
}

/** Turns a failure to reach YouTube into words that say where to look */
function explain(error: unknown, what: string): never {
  if (error instanceof YTError) throw error
  if (unreachable(error)) {
    throw new YTError(
      `Couldn't reach YouTube through Devon's proxy server (${getProxyServer()}). It may be down or blocked; try another under ⋮ → Settings → Proxy server.`,
      503,
      "network-unreachable",
    )
  }
  const message = error instanceof Error ? error.message : String(error)
  throw new YTError(`${what} ${message}`.trim(), 502)
}

export async function search(query: string): Promise<YTSearchPage> {
  try {
    const client = await yt()
    const results = await client.search(query, { type: "video" })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const memo = (results as any).page?.contents_memo ?? (results as any).memo
    const nodes = allNodes(memo)
    return collect(nodes.length ? nodes : [...results.results], memo)
  } catch (error) {
    explain(error, "YouTube search failed:")
  }
}

export async function searchMore(token: string): Promise<YTSearchPage> {
  try {
    const client = await yt()
    const page = await client.actions.execute("/search", { continuation: token, parse: true })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = page as any
    const memo = p.on_response_received_commands_memo ?? p.continuation_contents_memo ?? p.contents_memo
    return collect(allNodes(memo), memo)
  } catch (error) {
    explain(error, "Couldn't load more results:")
  }
}

export async function suggestions(query: string): Promise<string[]> {
  const client = await yt()
  return client.getSearchSuggestions(query)
}

// ---------------------------------------------------------------------------
// Video info
// ---------------------------------------------------------------------------

interface Resolved {
  client: string
  info: YTVideo
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  raw: Map<number, any>
  urls: Map<number, string>
  expires: number
}

/** Resolved videos. Stream URLs last about 6 hours; keep them for 1. */
const cache = new Map<string, Resolved>()
const pending = new Map<string, Promise<Resolved>>()
const CACHE_TTL = 60 * 60 * 1000
/** How long finding working streams may take before giving up */
const RESOLVE_BUDGET = 30_000
/** YouTube clients tried at the same time */
const CLIENT_WAVE = 3
const VIDEO_ID_RE = /^[\w-]{11}$/

/** Clients tried in order until one returns streams that actually download (same order as db-v2) */
function clientsFor(cookie: string): Types.InnerTubeClient[] {
  // With a cookie, clients that send the account's cookies go first
  if (cookie) return ["TV", "WEB", "MWEB", "WEB_EMBEDDED", "TV_EMBEDDED", "TV_SIMPLY", "ANDROID_VR", "IOS"]
  // Some YouTube clients can stream a public video when others get a bot check
  return ["TV_EMBEDDED", "WEB_EMBEDDED", "TV_SIMPLY", "ANDROID_VR", "TV", "IOS", "MWEB", "WEB"]
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toFormat(f: any): YTFormat {
  const mime = String(f.mime_type || "")
  const container = (mime.match(/^\w+\/([\w-]+)/)?.[1] || "").toLowerCase()
  const codec = mime.match(/codecs="([^"]+)"/)?.[1] || ""
  return {
    itag: f.itag,
    mime,
    container,
    codec,
    hasVideo: Boolean(f.has_video),
    hasAudio: Boolean(f.has_audio),
    quality: f.quality_label || (f.height ? `${f.height}p` : ""),
    height: f.height || 0,
    fps: f.fps || 0,
    bitrate: f.average_bitrate || f.bitrate || 0,
    size: f.content_length ? Number(f.content_length) : null,
    audioQuality: f.audio_quality || "",
    language: f.audio_track?.display_name || f.language || "",
    drc: Boolean(f.is_drc),
  }
}

function cpn(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
  let s = ""
  for (let i = 0; i < 16; i++) s += chars[Math.floor(Math.random() * 64)]
  return s
}

async function decipher(r: Resolved, itag: number): Promise<string> {
  const hit = r.urls.get(itag)
  if (hit) return hit
  const f = r.raw.get(itag)
  if (!f) throw new YTError("That format isn't available for this video.", 404)
  const client = await yt()
  const url = await f.decipher(client.session.player)
  if (!url) throw new YTError("Couldn't unlock this format.", 502)
  const full = `${url}${url.includes("?") ? "&" : "?"}cpn=${cpn()}`
  r.urls.set(itag, full)
  return full
}

const STREAM_HEADERS = { accept: "*/*", origin: "https://www.youtube.com", referer: "https://www.youtube.com/" }

async function probe(url: string, timeoutMs: number): Promise<number> {
  const res = await Promise.race([
    proxyFetch(`${url}&range=0-1023`, { headers: STREAM_HEADERS }),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timed out")), timeoutMs)),
  ])
  await res.body?.cancel().catch(() => {})
  return res.status
}

async function resolveWith(id: string, clientName: Types.InnerTubeClient): Promise<Resolved | string> {
  const client = await yt()
  const info = await client.getBasicInfo(id, { client: clientName })
  const status = info.playability_status
  if (status?.status && status.status !== "OK") {
    return status.reason || `YouTube says this video is ${status.status.toLowerCase().replace(/_/g, " ")}.`
  }
  const sd = info.streaming_data
  if (!sd) return "YouTube didn't return any streams."
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const all: any[] = [...(sd.formats ?? []), ...(sd.adaptive_formats ?? [])]
  // Skip DRM and live (HLS/DASH-only) formats; only plain files are served
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const usable = all.filter((f: any) => f.itag && (f.url || f.signature_cipher || f.cipher) && !f.drm_families?.length)
  if (!usable.length) return info.basic_info.is_live ? "Live streams can't be downloaded." : "No downloadable streams."
  if (!usable.some((f) => f.has_audio) || !usable.some((f) => f.has_video)) {
    return "This client did not provide both video and audio streams."
  }

  const b = info.basic_info
  const r: Resolved = {
    client: clientName,
    info: {
      id,
      title: b.title || "YouTube video",
      channel: b.author || b.channel?.name || "",
      duration: b.duration || 0,
      views: typeof b.view_count === "number" ? b.view_count : null,
      description: b.short_description || "",
      live: Boolean(b.is_live),
      client: clientName,
      formats: usable.map(toFormat),
    },
    raw: new Map(usable.map((f) => [f.itag, f])),
    urls: new Map(),
    expires: Date.now() + CACHE_TTL,
  }

  // Check actual bytes for both tracks; some clients expose URLs that reject downloads
  const audio = r.info.formats.find((f) => f.hasAudio && !f.hasVideo) ?? r.info.formats.find((f) => f.hasAudio)!
  const video = r.info.formats.find((f) => f.hasVideo && !f.hasAudio) ?? r.info.formats.find((f) => f.hasVideo)!
  for (const format of new Map([audio, video].map((f) => [f.itag, f])).values()) {
    const status = await probe(await decipher(r, format.itag), 9000)
    if (status < 200 || status >= 300) return `Streams were refused (HTTP ${status}).`
  }
  return r
}

/** Finds a client whose streams work for this video */
async function resolve(id: string, preferred?: string): Promise<Resolved> {
  if (!VIDEO_ID_RE.test(id)) throw new YTError("That isn't a YouTube video ID.", 400)
  const cookie = readCookie()
  const hit = cache.get(id)
  if (hit && hit.expires > Date.now()) return hit
  const inflight = pending.get(id)
  if (inflight) return inflight

  const job = (async () => {
    const order = clientsFor(cookie)
    const pref = preferred?.toUpperCase() as Types.InnerTubeClient | undefined
    if (pref && order.includes(pref)) order.unshift(...order.splice(order.indexOf(pref), 1))
    const reasons: string[] = []
    const tried: string[] = []
    let freshSessionWave = -1

    const deadline = Date.now() + RESOLVE_BUDGET
    const left = () => deadline - Date.now()
    const withinBudget = <T,>(p: Promise<T>, what: string): Promise<T> =>
      Promise.race([
        p,
        new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${what}: timed out`)), Math.max(0, left()))),
      ])

    let retried = false
    for (let i = 0; i < order.length && left() > 1500; ) {
      // With a signed-in cookie, one request at a time (parallel sign-ins look like a bot)
      const size = cookie ? 1 : CLIENT_WAVE
      const wave = order.slice(i, i + size)
      const results = await Promise.all(
        wave.map((name) =>
          withinBudget(resolveWith(id, name), name).catch((e) => unreachable(e) ?? (e instanceof Error ? e.message : String(e))),
        ),
      )
      const found = results.find((out): out is Resolved => typeof out !== "string")
      if (found) {
        cache.set(id, found)
        if (cache.size > 100) cache.delete(cache.keys().next().value as string)
        return found
      }
      reasons.push(...(results as string[]))
      results.forEach((out, n) => tried.push(`${wave[n]}${freshSessionWave === i ? " (fresh session)" : ""}: ${String(out)}`))
      // A stale player script breaks deciphering; start a fresh session once and redo this wave
      if (!retried && results.some((m) => /decipher|player|signature|n param|nsig/i.test(m as string))) {
        retried = true
        freshSessionWave = i
        session = null
        continue
      }
      i += size
    }
    const skipped = order.filter((name) => !tried.some((t) => t.startsWith(`${name}:`) || t.startsWith(`${name} (`)))
    if (skipped.length) tried.push(`Not tried, out of time: ${skipped.join(", ")}`)

    if (reasons.length > 0 && reasons.every((r) => r.startsWith("[network] "))) {
      throw new YTError(
        `Couldn't reach YouTube through Devon's proxy server (${getProxyServer()}). It may be down or blocked; try another under ⋮ → Settings → Proxy server.`,
        503,
        "network-unreachable",
        tried,
      )
    }
    if (reasons.some((r) => BOT_CHECK_RE.test(r) || /HTTP 403/.test(r))) {
      throw new YTError(
        cookie
          ? "YouTube still refused Devon's proxy server with the cookie saved in this browser. The cookie may be expired or signed out; copy a fresh one."
          : `YouTube refused every download client from Devon's proxy server (${getProxyServer()}): it's blocking that server's IP. A cookie from a signed-in account, or a different proxy server, may get through.`,
        503,
        "bot-check",
        tried,
      )
    }
    if (left() <= 1500) {
      throw new YTError("YouTube took too long to answer. Try again in a moment.", 503, "stream-unavailable", tried)
    }
    throw new YTError(
      "Couldn't get working video and audio streams for this video. Playback in the embedded player may still work.",
      503,
      "stream-unavailable",
      tried,
    )
  })()
  pending.set(id, job)
  try {
    return await job
  } finally {
    pending.delete(id)
  }
}

export async function videoInfo(id: string): Promise<YTVideo> {
  try {
    const info = (await resolve(id)).info
    // The player and the downloader fetch through Devon's service worker
    await ensureDevonSw()
    return info
  } catch (error) {
    explain(error, "Couldn't load this video:")
  }
}

/** The stream URL, size and type of one format, for public/devon-sw.js */
async function streamTarget(id: string, itag: number, client: string, fresh: boolean) {
  if (fresh) cache.delete(id)
  const r = await resolve(id, client || undefined)
  const format = r.info.formats.find((f) => f.itag === itag)
  if (!format) throw new YTError("That format isn't available for this video.", 404)
  if (fresh) r.urls.delete(itag)
  return { url: await decipher(r, itag), size: format.size, mime: format.mime }
}

// Devon's service worker asks this page for stream URLs (see public/devon-sw.js)
if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
  navigator.serviceWorker.addEventListener("message", (event) => {
    const data = event.data
    const port = event.ports?.[0]
    if (data?.type !== "devon-yt-resolve" || !port) return
    streamTarget(String(data.id), Number(data.itag), String(data.client || ""), Boolean(data.fresh)).then(
      (target) => port.postMessage(target),
      (error) =>
        port.postMessage({
          error: error instanceof Error ? error.message : String(error),
          status: error instanceof YTError ? error.status : 502,
        }),
    )
  })
}
