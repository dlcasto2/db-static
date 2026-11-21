// GitHub Pages serves this repo at a subpath — https://<user>.github.io/db-static/,
// not a domain root — but the rest of this codebase (forked from db-v2, which
// deploys at a domain root everywhere: Netlify, Vercel, EdgeOne, a custom
// domain) hardcodes every asset/page reference as root-absolute ("/icon.svg",
// "/games/...", etc.). Next's own `basePath` config (see next.config.mjs)
// only rewrites what it generates itself — next/link, next/image, and the
// _next/static chunks — not plain strings we write ourselves, so every one of
// those hardcoded references needs this prefix added by hand.
//
// NEXT_PUBLIC_BASE_PATH is the one kind of env var Next inlines into
// client-side code too, so it's readable here regardless of which component
// imports it. next.config.mjs sets it (via `env`) to the same value as its
// basePath: "/db-static" for `next build`, empty for `next dev`.
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? ""

export function withBasePath(path: string): string {
  return `${BASE_PATH}${path}`
}
