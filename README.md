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
- `/games`.
- `/youtube` — the page renders, but downloading doesn't work (that needs
  the server route this repo doesn't have).

What doesn't work here: the proxy (so browsing itself — the actual point of
Devon — doesn't function), YouTube downloads, page-safety checks, Devon AI,
and sign-in/sync. For the real thing, see
[dlcasto2/db-v2](https://github.com/dlcasto2/db-v2).

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
