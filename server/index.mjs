// Devon's proxy backend: the server half Ultraviolet needs, for hosts that
// can run Node. GitHub Pages can't, so db-static proxies through a public
// Wisp server by default; run this somewhere and Devon can use your own.
//
// Ported from Abyss-Web's server (github.com/AbyssServices/Abyss-Web,
// index.mjs): the same Bare server at /bare/ that Abyss's Ultraviolet talks
// to, plus a Wisp server at /wisp/ for Devon's Epoxy transport. Devon accepts
// either address under ⋮ → Settings → Proxy server. If Devon has been built
// (`pnpm build` → out/), this also serves it at /db-static/, and Devon then
// picks this server up by itself (see /devon-backend.json below).
//
// Env: PORT (default 8080). DEVON_ALLOW_LOCAL=1 lets the proxy reach private
// and loopback addresses — for local testing only, never on a public host.
import { createBareServer } from "@tomphttp/bare-server-node"
import { server as wisp, logging } from "@mercuryworkshop/wisp-js/server"
import compression from "compression"
import express from "express"
import { existsSync, statSync } from "node:fs"
import http from "node:http"
import { hostname } from "node:os"
import { dirname, extname, join, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"

const port = Number.parseInt(process.env.PORT ?? "", 10) || 8080
const allowLocal = process.env.DEVON_ALLOW_LOCAL === "1"

/** Where Devon's static build expects to live (next.config.mjs basePath) */
const BASE = "/db-static"
const site = resolve(dirname(fileURLToPath(import.meta.url)), "..", "out")
const hasSite = existsSync(join(site, "index.html"))

// Both refuse private and loopback addresses unless told otherwise, so the
// proxy can't be pointed at the host's own network.
const bare = createBareServer("/bare/", { blockLocal: !allowLocal })
wisp.options.allow_private_ips = allowLocal
wisp.options.allow_loopback_ips = allowLocal
wisp.options.allow_udp_streams = false // Devon only ever opens TCP streams
logging.set_level(logging.WARN)

const app = express()
app.disable("x-powered-by")
app.use(compression())

// Devon asks for this on start: when it's there, Devon is being served by
// its own backend and proxies through it instead of the public demo server.
app.get("/devon-backend.json", (_req, res) => {
  res.set("cache-control", "no-store").json({ wisp: "/wisp/", bare: "/bare/" })
})

if (hasSite) {
  app.get("/", (_req, res) => res.redirect(`${BASE}/`))
  // Next's export writes /games as games.html beside a games/ folder of
  // assets; serve the page for the extension-less address, like GitHub Pages.
  app.use(BASE, (req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next()
    if (req.path === "/" || extname(req.path)) return next()
    const file = resolve(site, `.${req.path.replace(/\/+$/, "")}.html`)
    if (!file.startsWith(site + sep)) return next()
    if (existsSync(file) && statSync(file).isFile()) return res.sendFile(file)
    next()
  })
  app.use(BASE, express.static(site, { redirect: false }))
} else {
  app.get("/", (_req, res) => {
    res
      .type("text")
      .send("Devon proxy backend.\n\nBare server: /bare/\nWisp server: /wisp/\n\nBuild Devon (pnpm build) to serve it here too.\n")
  })
}

app.use((_req, res) => res.status(404).type("text").send("Not found"))

const server = http.createServer()

server.on("request", (req, res) => {
  if (bare.shouldRoute(req)) bare.routeRequest(req, res)
  else app(req, res)
})

server.on("upgrade", (req, socket, head) => {
  if (bare.shouldRoute(req)) bare.routeUpgrade(req, socket, head)
  else if (req.url?.startsWith("/wisp/")) wisp.routeRequest(req, socket, head)
  else socket.end()
})

server.on("error", (error) => console.error(`ERROR: ${error}`))

server.on("listening", () => {
  const { port: listening } = server.address()
  console.log("Devon proxy backend started.")
  console.log(`\thttp://localhost:${listening}${hasSite ? `${BASE}/` : "/"}`)
  console.log(`\thttp://${hostname()}:${listening}`)
  console.log(`\tBare: /bare/  Wisp: /wisp/${hasSite ? "" : "  (no Devon build found in out/)"}`)
  if (allowLocal) console.warn("DEVON_ALLOW_LOCAL=1: the proxy can reach private addresses. Testing only.")
})

function shutdown() {
  console.log("Shutting down")
  server.close()
  bare.close()
  process.exit(0)
}
process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)

server.listen({ port })
