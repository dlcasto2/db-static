/*global Ultraviolet*/
// Ultraviolet's config, loaded by the service worker (public/uv/sw.js) and by
// every proxied page and worker it serves.
//
// Devon is served from /db-static/ on GitHub Pages but from the root in
// `pnpm dev`, and this file can't be built per environment, so it works out
// the base from where it's running instead. Every context that loads it is
// under <base>/uv/: the service worker (<base>/uv/sw.js), a proxied page's
// <script src="<base>/uv/uv.config.js">, or a proxied page or worker itself
// (<base>/uv/service/...).
;(function () {
  var script = typeof document !== "undefined" && document.currentScript
  var path = new URL((script && script.src) || self.location.href).pathname
  var at = path.indexOf("/uv/")
  var dir = (at === -1 ? "" : path.slice(0, at)) + "/uv/"

  self.__uv$config = {
    // Must match lib/uv.ts (UV_PREFIX) and the encoding it uses
    prefix: dir + "service/",
    encodeUrl: Ultraviolet.codec.xor.encode,
    decodeUrl: Ultraviolet.codec.xor.decode,
    handler: dir + "uv.handler.js",
    client: dir + "uv.client.js",
    bundle: dir + "uv.bundle.js",
    config: dir + "uv.config.js",
    sw: dir + "uv.sw.js",
  }
})()
