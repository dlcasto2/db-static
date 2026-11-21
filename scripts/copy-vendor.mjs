// Copies browser builds of dependencies that must run inside proxied pages
// into public/vendor, so the app can serve them same-origin.
import { copyFileSync, mkdirSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const require = createRequire(import.meta.url)
const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const out = join(root, "public", "vendor")
mkdirSync(out, { recursive: true })

try {
  copyFileSync(require.resolve("eruda/eruda.js"), join(out, "eruda.js"))
  console.log("copy-vendor: eruda.js -> public/vendor/")
} catch (error) {
  console.warn("copy-vendor: eruda not installed, skipping", error.message)
}

// ffmpeg.wasm's small JS wrapper + worker (the YouTube page uses it to join HD
// video with its audio, and to make MP3s). It must be same-origin because it
// starts a Web Worker from its own URL. The big core (.wasm) loads from a CDN.
try {
  const src = dirname(require.resolve("@ffmpeg/ffmpeg/worker"))
  const dest = join(out, "ffmpeg")
  mkdirSync(dest, { recursive: true })
  for (const file of ["index.js", "classes.js", "const.js", "errors.js", "types.js", "utils.js", "worker.js"]) {
    copyFileSync(join(src, file), join(dest, file))
  }
  console.log("copy-vendor: @ffmpeg/ffmpeg -> public/vendor/ffmpeg/")
} catch (error) {
  console.warn("copy-vendor: @ffmpeg/ffmpeg not installed, skipping", error.message)
}

// Ultraviolet, the proxy this static build browses through (see lib/uv.ts and
// public/uv/sw.js). Its service worker, page scripts and the bare-mux worker
// all have to be same-origin files, and the Wisp transport is loaded by URL
// from inside that worker, so none of them can go through Next's bundler.
// public/uv/sw.js and public/uv/uv.config.js are hand-written and committed;
// everything copied here is gitignored and regenerated on every install.
// (Found by their folder rather than require.resolve: bare-mux's "exports"
// field doesn't expose its worker build or package.json.)
const pkgDir = (name) => join(root, "node_modules", ...name.split("/"))
try {
  const uvDist = join(pkgDir("@titaniumnetwork-dev/ultraviolet"), "dist")
  const uvOut = join(root, "public", "uv")
  mkdirSync(uvOut, { recursive: true })
  for (const file of ["uv.bundle.js", "uv.client.js", "uv.handler.js", "uv.sw.js"]) {
    copyFileSync(join(uvDist, file), join(uvOut, file))
    copyFileSync(join(uvDist, `${file}.map`), join(uvOut, `${file}.map`))
  }
  console.log("copy-vendor: @titaniumnetwork-dev/ultraviolet -> public/uv/")

  const bareMuxDist = join(pkgDir("@mercuryworkshop/bare-mux"), "dist")
  const bareMuxOut = join(root, "public", "baremux")
  mkdirSync(bareMuxOut, { recursive: true })
  copyFileSync(join(bareMuxDist, "worker.js"), join(bareMuxOut, "worker.js"))
  copyFileSync(join(bareMuxDist, "worker.js.map"), join(bareMuxOut, "worker.js.map"))
  // Its UMD build (window.BareMux / self.BareMux), for Devon's own service
  // worker (public/devon-sw.js), which loads it with importScripts
  copyFileSync(join(bareMuxDist, "index.js"), join(bareMuxOut, "index.js"))
  console.log("copy-vendor: @mercuryworkshop/bare-mux worker -> public/baremux/")

  // The ES module build, saved as .js rather than .mjs: the bare-mux worker
  // import()s it, which needs a JavaScript MIME type, and not every static
  // host maps .mjs to one.
  const epoxyDist = join(pkgDir("@mercuryworkshop/epoxy-transport"), "dist")
  const epoxyOut = join(root, "public", "epoxy")
  mkdirSync(epoxyOut, { recursive: true })
  copyFileSync(join(epoxyDist, "index.mjs"), join(epoxyOut, "index.js"))
  console.log("copy-vendor: @mercuryworkshop/epoxy-transport -> public/epoxy/")

  // The Bare transport, for Bare servers like Abyss-Web's /bare/ (and
  // server/index.mjs's): same reason for the .js name as Epoxy above.
  const bareModDist = join(pkgDir("@mercuryworkshop/bare-as-module3"), "dist")
  const bareModOut = join(root, "public", "baremod")
  mkdirSync(bareModOut, { recursive: true })
  copyFileSync(join(bareModDist, "index.mjs"), join(bareModOut, "index.js"))
  console.log("copy-vendor: @mercuryworkshop/bare-as-module3 -> public/baremod/")

  // libcurl.js — curl compiled to WebAssembly — for Devon's default Wisp
  // transport (public/transports/libcurl.js, hand-written). The ES module
  // build is saved as .js for the same reason as Epoxy; its WebAssembly is
  // loaded separately, next to it.
  const libcurlDir = pkgDir("libcurl.js")
  const libcurlOut = join(root, "public", "libcurl")
  mkdirSync(libcurlOut, { recursive: true })
  copyFileSync(join(libcurlDir, "libcurl.mjs"), join(libcurlOut, "libcurl.js"))
  copyFileSync(join(libcurlDir, "libcurl.wasm"), join(libcurlOut, "libcurl.wasm"))
  console.log("copy-vendor: libcurl.js -> public/libcurl/")
} catch (error) {
  console.warn("copy-vendor: Ultraviolet files not installed, skipping", error.message)
}

// ffmpeg.wasm's core (~31 MB), served from Devon itself so HD merging and MP3
// work on networks that block CDNs. The .wasm is gzipped and split into ~3 MB
// parts to stay under static-hosting file limits; lib/youtube.ts joins and
// unzips them in the browser (DecompressionStream).
try {
  const { readFileSync, writeFileSync, rmSync } = await import("node:fs")
  const { gzipSync } = await import("node:zlib")
  const src = join(dirname(require.resolve("@ffmpeg/core")), "..", "esm")
  const dest = join(out, "ffmpeg-core")
  rmSync(dest, { recursive: true, force: true })
  mkdirSync(dest, { recursive: true })
  copyFileSync(join(src, "ffmpeg-core.js"), join(dest, "ffmpeg-core.js"))
  const wasm = readFileSync(join(src, "ffmpeg-core.wasm"))
  const gz = gzipSync(wasm, { level: 9 })
  const PART = 3 * 1024 * 1024
  let parts = 0
  for (let i = 0; i < gz.length; i += PART) {
    writeFileSync(join(dest, `ffmpeg-core.wasm.gz.part${String(parts).padStart(2, "0")}`), gz.subarray(i, i + PART))
    parts++
  }
  writeFileSync(join(dest, "manifest.json"), JSON.stringify({ parts, size: wasm.length, gzipSize: gz.length }))
  console.log(`copy-vendor: @ffmpeg/core -> public/vendor/ffmpeg-core/ (${parts} parts)`)
} catch (error) {
  console.warn("copy-vendor: @ffmpeg/core not installed, skipping", error.message)
}
