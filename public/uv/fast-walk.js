/*global Ultraviolet,__uv$config*/
// A faster tree walk for Ultraviolet's script rewriter. Loaded by sw.js after
// uv.bundle.js and uv.config.js.
//
// Ultraviolet rewrites every script a proxied page loads, in its service worker,
// before the page may run it: it parses the script with meriyah, walks every
// node, and patches the spots that touch location, eval, top, parent and so on.
// The worker does nothing else meanwhile. Profiling the rewrite of a 9 MB
// minified script showed the walk alone costing as much as the parse (~1 s
// each here, ~10 s each on a 4 GB Chromebook), because Ultraviolet's
// JS.prototype.iterate loops over every property of all ~2 million nodes,
// including the [start, end] array meriyah adds to each, with a new closure
// per array; and recast() then goes through EventEmitter.emit for every node,
// which copies the listener list each time for types with two listeners.
//
// This replaces those two methods with versions that visit the same nodes in
// the same order and call the same listeners with the same arguments, so the
// rewritten script is byte-for-byte what Ultraviolet produced before: just
// 25–40% sooner (more the slower the CPU). A self-check below compares both on
// a sample using everything the rewriter handles, and keeps Ultraviolet's own
// methods if anything differs (say, after an Ultraviolet update).
;(() => {
  let JS
  try {
    JS = Object.getPrototypeOf(new Ultraviolet(__uv$config).js)
  } catch {
    return
  }
  const original = { iterate: JS.iterate, recast: JS.recast }
  if (typeof original.iterate !== "function" || typeof original.recast !== "function") return
  if (typeof JS.eventNames !== "function" || typeof JS.listeners !== "function") return

  function iterate(ast, handler) {
    if (typeof ast != "object" || !handler) return
    walk(ast, null)
    function walk(node, parent) {
      handler(node, parent, handler)
      for (const key in node) {
        // "range" only ever holds two numbers, which the original visited and skipped
        if (key === "parent" || key === "range") continue
        const value = node[key]
        if (value === null || typeof value !== "object") continue
        if (Array.isArray(value)) {
          for (let i = 0; i < value.length; i++) {
            const entry = value[i]
            if (entry && typeof entry === "object") walk(entry, node)
          }
        } else walk(value, node)
      }
      if (typeof node.iterateEnd === "function") node.iterateEnd()
    }
  }

  // Ultraviolet 3.2.10's recast(), except for how each node reaches its listeners
  function recast(str, data = {}, type = "") {
    try {
      const output = []
      const ast = this.parse(str, this.parseOptions)
      const meta = {
        data,
        changes: [],
        input: str,
        ast,
        get slice() {
          return slice
        },
      }
      let slice = 0
      // Looked up once per script; emit() would look them up (and copy them) per node
      const listeners = new Map()
      for (const name of this.eventNames()) listeners.set(name, this.listeners(name))
      const js = this
      this.iterate(ast, (node, parent = null) => {
        if (parent && parent.inTransformer) node.isTransformer = true
        node.parent = parent
        const fns = listeners.get(node.type)
        if (fns) for (let i = 0; i < fns.length; i++) fns[i].call(js, node, meta, type)
      })

      meta.changes.sort((a, b) => a.start - b.start || a.end - b.end)

      for (const change of meta.changes) {
        if ("start" in change && typeof change.start === "number") output.push(str.slice(slice, change.start))
        if (change.node)
          output.push(typeof change.node === "string" ? change.node : this.generate(change.node, this.generationOptions))
        if ("end" in change && typeof change.end === "number") slice = change.end
      }
      output.push(str.slice(slice))
      return output.join("")
    } catch {
      return str
    }
  }

  // Everything Ultraviolet's rewriter reacts to, plus the places it must not
  const SAMPLE = [
    'import d from "./dep.js"; export * from "./all.js"; export { q } from "./q.js";',
    "var a = location.href, b = window.location, c = top, e = parent.frames, g = self.top;",
    'location = "/x"; window.location.href = "y"; o[k] = 1; o["location"] = 2; o[0]; o[`${k}`];',
    'eval("1+1"); window.eval(x); (0, eval)(y); w.postMessage("m", "*"); top.postMessage(1);',
    'import("./m.js").then((m) => m); import(u + ".js");',
    "const { location: loc } = obj; function f(location, ...top) { return location + top }",
    "let h = { location, top: 1, parent() {} }; class C { location() {} static top = parent }",
    "a?.[b]?.location; `${location}`; label: for (;;) break label; location++; --top;",
    "x.__uv$location; __uv.$wrap((k)); __uv.$get(location); __uv$setSource(__uv).top;",
  ].join("\n")

  function sameOutput() {
    const run = () => {
      const uv = new Ultraviolet(__uv$config)
      uv.meta.url = uv.meta.base = new URL("https://example.com/dir/script.js")
      const rewritten = uv.js.rewrite(SAMPLE)
      return [rewritten, uv.js.source(rewritten)]
    }
    const before = run()
    JS.iterate = iterate
    JS.recast = recast
    const after = run()
    return before[0] !== SAMPLE && before[0] === after[0] && before[1] === after[1]
  }

  try {
    if (sameOutput()) return
  } catch {
    // fall through
  }
  JS.iterate = original.iterate
  JS.recast = original.recast
  console.warn("Devon: Ultraviolet's rewriter changed; using its own (slower) tree walk")
})()
