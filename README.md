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
- `/games`.
- `/youtube` — the page renders, but downloading doesn't work (that needs
  the server route this repo doesn't have).

What doesn't work here: YouTube downloads, page-safety checks, Devon AI,
sign-in/sync, and the extras that hook into db-v2's server-rewritten pages
(extensions/userscripts, dev tools, saving pages, "ask about this page"). For
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
- [bare-mux](https://github.com/MercuryWorkshop/bare-mux) + the
  [Epoxy](https://github.com/MercuryWorkshop/epoxy-tls) transport carry the
  requests. Epoxy does TLS in the browser and tunnels raw TCP through a
  **Wisp server** — the one part that can't live on GitHub Pages, since it's a
  WebSocket server.

The Wisp server defaults to Mercury Workshop's public demo,
`wss://wisp.mercurywork.shop/`, which is rate-limited. Point Devon at your own
from the ⋮ menu → **Proxy server…** (saved per browser). Any Wisp server works
on any host that allows WebSockets, e.g.
[wisp-js](https://github.com/MercuryWorkshop/wisp-js) (`npx wisp-js-server`).

Ultraviolet's prebuilt scripts, the bare-mux worker and the Epoxy transport are
copied out of `node_modules` into `public/` by `scripts/copy-vendor.mjs` on
every install (and gitignored); `public/uv/sw.js` and `public/uv/uv.config.js`
are the hand-written parts. `uv.config.js` works out the base path from its own
URL, so the same files work at `/db-static/` and at the root in `pnpm dev`.

Ultraviolet and the Epoxy transport are AGPL-3.0 (per their LICENSE files);
this repo being public keeps the source of what it serves available, as that
license asks.

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
