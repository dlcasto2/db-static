// Devon's default Wisp transport: libcurl.js (real curl, compiled to
// WebAssembly) behind bare-mux 2's transport interface. lib/uv.ts hands this
// file's address to bare-mux, whose worker import()s it.
//
// Why not Epoxy, the transport Ultraviolet usually ships with: its HTTP/2
// client keeps hyper's 16 KB cap on response headers and can't be told
// otherwise, so any HTTP/2 site that sends more (YouTube does) fails with
// "Reset(StreamId(n), PROTOCOL_ERROR, Library)". curl has no such cap.
//
// Mercury Workshop's @mercuryworkshop/libcurl-transport does the same job,
// but its bare-mux 2 build bundles an older libcurl.js, without 0.7.5's CA
// certificate fixes; this ~70-line copy of it uses the current one.
import { libcurl } from "../libcurl/libcurl.js"

const WASM_URL = new URL("../libcurl/libcurl.wasm", import.meta.url).href

// bare-mux's worker calls init() on the first request it gets, and again on
// every request that arrives before that finishes; libcurl.js's load_wasm()
// isn't safe to call while it's loading (a second call instantiates the
// WebAssembly again and aborts with "Assertion failed", killing the proxy for
// the rest of the visit). So it's loaded once, and everyone waits on that.
let loading = null
const loadLibcurl = () =>
  (loading ??= Promise.resolve(libcurl.load_wasm(WASM_URL)).catch((error) => {
    loading = null // a failed download can be retried
    throw error
  }))

export default class LibcurlTransport {
  ready = false

  /** @type {Promise<void> | null} */
  initializing = null

  constructor(options) {
    let wisp = String(options?.wisp ?? "")
    if (!/^wss?:\/\//i.test(wisp)) throw new TypeError("The libcurl transport needs a ws:// or wss:// Wisp server")
    // libcurl.js insists on the trailing slash
    if (!wisp.endsWith("/")) wisp += "/"
    this.wisp = wisp
    this.session = null
  }

  init() {
    this.initializing ??= (async () => {
      await loadLibcurl()
      // Only new connections use a changed server, and each transport gets a
      // new session, so switching servers in Settings takes effect at once
      libcurl.set_websocket(this.wisp)
      this.session = new libcurl.HTTPSession()
      this.ready = true
    })().catch((error) => {
      this.initializing = null
      throw error
    })
    return this.initializing
  }

  async meta() {}

  async request(remote, method, body, headers, signal) {
    if (body instanceof Blob) body = await body.arrayBuffer()
    const res = await this.session.fetch(remote.href, { method, headers, body, redirect: "manual", signal })
    // bare-mux 2 wants { name: [values] }
    const out = {}
    for (const [key, value] of res.raw_headers) (out[key] ??= []).push(value)
    return { body: res.body, headers: out, status: res.status, statusText: res.statusText }
  }

  connect(url, protocols, requestHeaders, onopen, onmessage, onclose, onerror) {
    const socket = new libcurl.WebSocket(url.toString(), protocols, { headers: requestHeaders })
    socket.binaryType = "arraybuffer"
    socket.onopen = () => onopen("")
    socket.onclose = (event) => onclose(event.code, event.reason)
    socket.onerror = () => onerror("")
    socket.onmessage = (event) => onmessage(event.data)
    return [(data) => socket.send(data), (code, reason) => socket.close(code, reason)]
  }
}
