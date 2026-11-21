// Regression check for public/uv/fast-walk.js: Ultraviolet's script rewriter
// must give byte-for-byte the same output with Devon's faster tree walk as
// without it, and the walk must survive scripts too deeply nested for
// Ultraviolet's own (which then returned them unrewritten).
//
//   pnpm test:uv                       built-in cases
//   pnpm test:uv some.js other.js      also compare these scripts, with timings
//
// Needs public/uv/uv.bundle.js, which `pnpm install` copies there.
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import vm from "node:vm"

const uvDir = fileURLToPath(new URL("../public/uv/", import.meta.url))
const bundle = readFileSync(uvDir + "uv.bundle.js", "utf8")
const fastWalk = readFileSync(uvDir + "fast-walk.js", "utf8")

function rewriter(withFastWalk) {
  // The bundle reads a few browser globals as it loads; the rewriter itself needs none of them
  class WebSocket {
    send() {}
  }
  const context = vm.createContext({
    console,
    URL,
    TextEncoder,
    TextDecoder,
    EventTarget,
    navigator: { serviceWorker: {} },
    MessagePort: class {},
    WebSocket,
    fetch,
    localStorage: {},
  })
  context.self = context
  vm.runInContext(bundle, context)
  vm.runInContext(
    "self.__uv$config = { prefix: '/uv/service/', encodeUrl: Ultraviolet.codec.xor.encode, decodeUrl: Ultraviolet.codec.xor.decode }",
    context,
  )
  if (withFastWalk) vm.runInContext(fastWalk, context)
  const active = vm.runInContext("Object.getPrototypeOf(new Ultraviolet(__uv$config).js).iterate.toString().includes('\"range\"')", context)
  return {
    active,
    rewrite: (code, url = "https://example.com/dir/script.js") => {
      context.__code = code
      context.__url = url
      return vm.runInContext(
        "(() => { const uv = new Ultraviolet(__uv$config); uv.meta.url = uv.meta.base = new URL(__url); const r = uv.js.rewrite(__code); return [r, uv.js.source(r)] })()",
        context,
      )
    },
  }
}

const original = rewriter(false)
const fast = rewriter(true)
let failed = 0
const check = (name, ok, detail = "") => {
  if (!ok) failed++
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? "  " + detail : ""}`)
}

check("fast walk active (its self-check passed)", fast.active && !original.active)

const cases = {
  "everything rewritten": [
    'import d from "./dep.js"; export * from "./all.js";',
    'var a = location.href, b = window.location, c = top, e = parent.frames;',
    'location = "/x"; o[k] = 1; o["location"] = 2; o[0]; eval("1"); window.eval(x);',
    'w.postMessage("m", "*"); import("./m.js"); const { location: loc } = obj;',
    "function f(location, ...top) { return location + top } let h = { location, top: 1 };",
    "a?.[b]?.location; `${location}`; location++; x.__uv$location; __uv.$get(location);",
  ].join("\n"),
  "nothing to rewrite": "const sum = (a, b) => a + b; sum(1, 2);",
  "not JavaScript": "this is not javascript {{{",
  empty: "",
}
for (const [name, code] of Object.entries(cases)) {
  const [a, aSource] = original.rewrite(code)
  const [b, bSource] = fast.rewrite(code)
  check(`same output: ${name}`, a === b && aSource === bSource)
}

// A 6000-term string concatenation nests 6000 deep: Ultraviolet's walk ran out
// of stack and handed the script back unrewritten, location and all
const deep = "var s = " + Array.from({ length: 6000 }, (_, i) => "location.a" + i).join(" + ") + ";"
const [deepOut, deepSource] = fast.rewrite(deep)
check("deeply nested script is rewritten", deepOut.includes("__uv.$get(location).a5999") && deepSource === deep)

for (const file of process.argv.slice(2)) {
  const code = readFileSync(file, "utf8")
  let t = performance.now()
  const [a, aSource] = original.rewrite(code)
  const before = performance.now() - t
  t = performance.now()
  const [b, bSource] = fast.rewrite(code)
  const after = performance.now() - t
  check(
    `same output: ${file}`,
    a === b && aSource === bSource,
    `${(code.length / 1e6).toFixed(1)} MB, ${Math.round(before)} ms -> ${Math.round(after)} ms`,
  )
}

if (failed) {
  console.error(`${failed} check(s) failed`)
  process.exit(1)
}
