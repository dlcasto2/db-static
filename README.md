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
it went with the plainer option instead: that one file is fetched with an
ordinary `pnpm install --frozen-lockfile` (which, since the lockfile and
the rest of `node_modules` already match, only ever fetches that one
missing package) — see the one extra step in
`.github/workflows/pages.yml`, or run it yourself before building locally.

This only targets glibc Linux (what GitHub's own runners and most desktop
Linux use) — the musl build of `@next/swc`, and the musl variant of every
other native dependency, were deliberately left out (see `.npmrc`) to
avoid shipping duplicate binaries for a platform nothing here runs on.

If you want to regenerate the rest of `node_modules` yourself instead of
trusting the committed copy (a dependency bump, say), the usual
`pnpm install` works the same way — `.npmrc`'s `supportedArchitectures`
setting keeps it to one platform.

## Building

```
pnpm install --frozen-lockfile   # fetches only @next/swc (see above) — fast
pnpm exec next build             # or: node_modules/.bin/next build
```

Output goes to `out/` — plain HTML/CSS/JS, no server needed to serve it.

## Deploying

`.github/workflows/pages.yml` builds and publishes `out/` to GitHub Pages on
every push to `main`, using GitHub's own `actions/deploy-pages` (Pages must
be set to deploy from "GitHub Actions" in this repo's Settings → Pages, not
from a branch).

## Why this exists

This is the no-server counterpart to db-v2's Windows desktop app build: the
same frontend, packaged with nothing bundled to go wrong. See db-v2's
`desktop/README.md` for the Tauri build that *does* bundle a real Node
server, if you want Devon's actual features in a desktop app.
