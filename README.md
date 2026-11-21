# db-static

A static-only fork of [Devon Browser](https://github.com/dlcasto2/db-v2) — the
browser UI shell, with no server behind it at all.

## What's here and what isn't

db-v2 is a Next.js app with a real backend: a proxy, YouTube downloads,
page-safety checks, Devon AI chat, and sign-in/sync all run as server routes.
This repo is `next build` with `output: "export"` — a pure static site, no
Node server, nothing dynamic — so every one of those server routes was
removed before this config file was ever written, not worked around in it.

What that leaves:
- The browser UI shell (tabs, address bar, bookmarks, history, new-tab page).
- Browsing, through [Ultraviolet](https://github.com/titaniumnetwork-dev/Ultraviolet)
  instead of db-v2's server proxy (see below).
- Settings (⋮ → Settings): the proxy server, plus features ported from
  [Abyss-Web](https://github.com/AbyssServices/Abyss-Web) — tab cloak,
  about:blank cloak, panic key, themes and a search engine picker (see below).
- `/games`.
- The YouTube app (devon://apps/youtube) — search, watching and downloads,
  with no server of its own (see below).

What doesn't work here: page-safety checks, Devon AI,
sign-in/sync, and the extras that hook into db-v2's server-rewritten pages
(extensions/userscripts, saving pages, "ask about this page"). For
the real thing, see [dlcasto2/db-v2](https://github.com/dlcasto2/db-v2).

## Browsing: Ultraviolet

With no server to fetch pages through, every web page loads through
Ultraviolet, which proxies in the browser itself:

- `public/uv/sw.js` — a service worker scoped to `/db-static/uv/service/`
  only, so it never touches Devon's own pages. A page is an iframe pointed at
  `/db-static/uv/service/<encoded url>`; the worker rewrites it and everything
  it loads. `lib/uv.ts` registers it, and `components/proxy-browser.tsx` reads
  each page's real address and title back out of the frame for the address
  bar, tab and history.
- [bare-mux](https://github.com/MercuryWorkshop/bare-mux) carries the
  requests to a **proxy server** — the one part that can't live on GitHub
  Pages. Two kinds work, set under ⋮ → Settings → Proxy server:
  - a **Wisp** server (`wss://…`), which only relays encrypted traffic: TLS
    happens in the browser. Two transports speak it, picked under the same
    setting:
    - [libcurl.js](https://github.com/ading2210/libcurl.js) — real curl,
      compiled to WebAssembly — the default, through Devon's own small
      transport, `public/transports/libcurl.js`;
    - [Epoxy](https://github.com/MercuryWorkshop/epoxy-tls), Ultraviolet's
      usual one. Its HTTP/2 client keeps hyper's 16 KB cap on response
      headers, with no option to raise it, so sites that send more — YouTube
      does — fail with `Reset(StreamId(n), PROTOCOL_ERROR, Library)`. That's
      why it isn't the default.
  - a **Bare** server (`https://…/bare/`), through
    [bare-as-module3](https://github.com/MercuryWorkshop/bare-as-module3) —
    the protocol Abyss-Web's server speaks, so any Abyss deployment works.

With nothing set, Devon uses its own backend when it's served by one (see
below), and otherwise Mercury Workshop's public demo Wisp server,
`wss://wisp.mercurywork.shop/`, which is rate-limited.

Ultraviolet's prebuilt scripts, the bare-mux worker, Epoxy, the Bare transport
and libcurl.js are
copied out of `node_modules` into `public/` by `scripts/copy-vendor.mjs` on
every install (and gitignored); `public/uv/sw.js` and `public/uv/uv.config.js`
are the hand-written parts. `uv.config.js` works out the base path from its own
URL, so the same files work at `/db-static/` and at the root in `pnpm dev`.

When a page can't load, Devon replaces Ultraviolet's error page with its own,
and says whether the site or the proxy server is the one not answering.

Ultraviolet and the Epoxy transport are AGPL-3.0 (per their LICENSE files),
libcurl.js LGPL-3.0;
this repo being public keeps the source of what it serves available, as that
license asks.

## The YouTube app without a server

db-v2's YouTube app calls its server (`/api/youtube/…`), which runs
[youtubei.js](https://github.com/LuanRT/YouTube.js). Here the same code runs in
the page instead (`lib/youtube-local.ts`, ported from db-v2's
`lib/youtube-server.ts`), and every request it makes goes through the proxy
(`proxyFetch` in `lib/uv.ts`) — so YouTube sees the proxy server's IP, not the
viewer's. youtubei.js is loaded only when the app is opened.

- **Search and video info**: youtubei.js, as on db-v2's server, trying the same
  YouTube clients in the same order until one gives streams that download.
  YouTube's player code (needed to unlock stream URLs) runs in a sandboxed
  iframe with its own opaque origin, the browser's version of the `vm`
  sandbox db-v2 uses.
- **Video bytes and thumbnails**: YouTube ties a stream URL to the IP that
  asked for it, so the bytes have to come through the same proxy. A second
  service worker, `public/devon-sw.js`, scoped to all of Devon but answering
  only `<base>/yt/stream` and `<base>/yt/thumb`, serves them: it asks the page
  for the stream URL, then fetches it through the proxy in 3 MB slices and
  honors Range requests, like db-v2's `/api/youtube/stream`. So `<video>` and
  the downloader work unchanged.
- **The cookie box** keeps the cookie in this browser (localStorage) and
  youtubei.js sends it to YouTube through the proxy. With a Wisp server, TLS
  is end to end, so the proxy server never sees it; a Bare server would.
- **"Through Devon" player**: the youtube-nocookie.com embed, loaded through
  Ultraviolet.

Downloads depend on YouTube accepting the proxy server's IP. The public demo
server is shared and rate-limited; your own backend (below) does better.

## Your own proxy server on Render

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/dlcasto2/db-static)

The button deploys `server/` (below) on Render's free plan, from `render.yaml`:

1. Click it, sign in to Render (with GitHub is quickest), and click **Apply**
   / **Deploy Blueprint**. The first deploy takes a minute or two.
2. Render names the service `devon-proxy` and gives it an address like
   `https://devon-proxy-abcd.onrender.com`. Opening it shows "Devon proxy
   backend".
3. Point Devon at it, either:
   - just in your browser: ⋮ → Settings → Proxy server →
     `wss://devon-proxy-abcd.onrender.com/wisp/`, or
   - for everyone using this site: put it in `public/devon-config.json` —
     `{ "proxyServer": "wss://devon-proxy-abcd.onrender.com/wisp/" }` — and
     push. A server chosen in Settings still wins.

The free plan puts the server to sleep after about 15 minutes without use;
the next visit wakes it, which takes up to a minute. Devon knocks on it as soon
as it opens, so it's usually awake by the first page. Render's addresses are
datacenter IPs: YouTube may still ask them to sign in, in which case the
YouTube app's cookie box is the way through.

## The proxy backend (`server/`)

Abyss-Web's server, ported: a Node server with the same Bare server at
`/bare/`, plus a Wisp server at `/wisp/`. It refuses private and loopback
addresses, so it can't be used to reach the host's own network. Run it
anywhere that allows WebSockets and either address works as Devon's proxy
server:

```
cd server && npm ci && npm start      # PORT defaults to 8080
```

Start it with `npm start` (or the Dockerfile), not bare `node index.mjs`: both
add `--max-http-header-size=262144`. Node reads only 16 KB of response
headers by default, so the Bare server would fail on big sites with
`Header overflow` — the same limit that trips Epoxy, and one that other Bare
servers, Abyss deployments included, usually still have.

If Devon has been built (`pnpm build` → `out/`), the server also serves it at
`/db-static/` (and redirects `/` there). Devon then finds the server at
`/devon-backend.json` and proxies through its Wisp endpoint without being
told — one deploy, no settings.

`server/Dockerfile` does both in one image (build Devon, then run the server):

```
docker build -f server/Dockerfile -t devon .
docker run -p 8080:8080 devon
```

That image needs more memory to build than Render's free plan has, so
`render.yaml` runs just the server on Render's Node runtime instead. Vercel and
serverless hosts like wawesome can't run it: they have no WebSockets for the
Wisp server, or won't connect to arbitrary sites.

## Ported from Abyss-Web

Under ⋮ → Settings, saved per browser:

- **Tab cloak** — Abyss's presets (Google Classroom, Drive, Docs, Google,
  Schoology, Mathspace, Khan Academy, IXL) or any title and icon
  (`lib/cloak.ts`).
- **about:blank** — opens Devon inside an about:blank tab, so its address
  never shows in the address bar or history, and sends the original tab to the
  panic URL. Can reopen that way on every visit; browsers only allow that
  pop-up after a click, so Devon offers a button when it's blocked.
- **Panic key** — any key or keys pressed within a second of each other,
  including while a proxied page has focus, send the whole tab to the panic
  URL.
- **Themes** — Abyss's Black, Grey, Mocha, Macchiato, Frappé and Cappuccino,
  each mixed into Devon's surfaces (`lib/themes.ts`, `app/globals.css`).
- **Search engine** — Google, DuckDuckGo, Mojeek, Ecosia, Brave or Bing.
- **Inspect element** — Devon's developer tools (Eruda) now work on proxied
  pages too.

Not ported: Abyss's apps/games list, particles background, ads, and its
second proxy (Dynamic, which is unmaintained).

## node_modules is committed

Unlike almost every JS repo, `node_modules/` is tracked in git here on
purpose — clone this repo and `next build` works almost immediately, with
no real `pnpm install` step.

The one exception: Next's Rust-based compiler, `@next/swc`, ships as a
~125 MB native binary — over GitHub's hard 100 MB-per-file limit, so it
isn't in the commit (see `.gitignore`). The normal fix for a single
oversized file like this is Git LFS, but this repo was pushed from an
environment whose network policy couldn't reach LFS's storage backend, so
it went with the plainer option instead: run `pnpm install
--frozen-lockfile` once after cloning to fetch it. (On a fresh machine pnpm
sees the committed `node_modules` was made against a different store and
reinstalls it from the lockfile, which is also what happens in the Pages
workflow.)

This only targets glibc Linux (what GitHub's own runners and most desktop
Linux use). `.npmrc` asks pnpm to skip musl builds of native dependencies,
and `.gitignore` keeps the musl `@next/swc` binary out of the commit for
the times pnpm installs it anyway.

## Building

```
pnpm install --frozen-lockfile   # fetches @next/swc (see above)
pnpm build
```

Output goes to `out/` — plain HTML/CSS/JS, no server needed to serve it.
Every build expects to be served from `/db-static/` (see below), so to
preview one locally, serve it under that path rather than at a root.
`pnpm dev` runs at the root as usual.

## Deploying

`.github/workflows/pages.yml` builds and publishes `out/` to GitHub Pages on
every push to `main` (Pages must be set to deploy from "GitHub Actions" in
this repo's Settings → Pages, not from a branch).

GitHub Pages serves a project repo from a subpath —
`https://<user>.github.io/db-static/`, not a domain root — so
`next.config.mjs` sets `basePath` to `/db-static` for production builds
(`next build`) and leaves it empty for `next dev`. If the repo is renamed or
moved to a custom domain, that's the one value to change.

Next only adds that prefix to what it generates itself (its JS/CSS chunks,
`next/link`, `next/image`). The rest of this codebase, inherited from
db-v2, hardcodes root-absolute paths like `/icon.svg` and `/games/...`, so
each of those goes through `withBasePath()` from `lib/base-path.ts`, which
gets the same value via `next.config.mjs`'s `env`. Any new one needs to as
well, or it'll 404 on Pages while working fine in `pnpm dev`.

## Why this exists

This is the no-server counterpart to db-v2's Windows desktop app build: the
same frontend, packaged with nothing bundled to go wrong. See db-v2's
`desktop/README.md` for the Tauri build that *does* bundle a real Node
server, if you want Devon's actual features in a desktop app.
