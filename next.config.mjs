// GitHub Pages serves a project repo at a subpath (https://<user>.github.io/
// <repo>/), not a domain root, so the build needs that subpath as its
// basePath. Worked out automatically from the env vars GitHub Actions
// always sets, so the Pages workflow doesn't have to pass anything:
// - NEXT_PUBLIC_BASE_PATH, if set (even to ""), always wins — e.g. "" once
//   this is moved to a custom domain served at its root;
// - otherwise, inside GitHub Actions, "/<repo name>" — except for a
//   <user>.github.io repo, which Pages serves at the domain root;
// - otherwise (a plain local build) nothing.
// See lib/base-path.ts — every hardcoded "/..." asset reference elsewhere in
// this codebase needs this same prefix added by hand, since basePath here
// only rewrites what Next generates itself (next/link, next/image, the
// _next/static chunks).
function resolveBasePath() {
  if (process.env.NEXT_PUBLIC_BASE_PATH !== undefined) return process.env.NEXT_PUBLIC_BASE_PATH
  const repo = process.env.GITHUB_REPOSITORY?.split("/")[1]
  if (process.env.GITHUB_ACTIONS === "true" && repo && !repo.endsWith(".github.io")) return `/${repo}`
  return ""
}
const basePath = resolveBasePath()

/** @type {import('next').NextConfig} */
const nextConfig = {
  // This repo is a one-purpose fork of dlcasto2/db-v2 (the real Devon
  // Browser): a fully static export, no server, nothing dynamic. That's
  // only possible here because the server routes that make up most of
  // Devon's actual functionality — the proxy, YouTube downloads,
  // page-safety checks, Devon AI chat, sign-in — were removed before this
  // config file was ever written, not worked around in it. See this repo's
  // README for what that leaves: the browser UI shell, /games, and the
  // /youtube page (not downloading).
  output: "export",
  ...(basePath ? { basePath } : {}),
  // Hands the resolved value to lib/base-path.ts (client and server code
  // alike), whether it came from NEXT_PUBLIC_BASE_PATH or was worked out
  // from GITHUB_REPOSITORY above.
  env: { NEXT_PUBLIC_BASE_PATH: basePath },
  typescript: {
    ignoreBuildErrors: false,
  },
  images: {
    unoptimized: true,
  },
}

export default nextConfig
