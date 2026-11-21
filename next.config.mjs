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
  typescript: {
    ignoreBuildErrors: false,
  },
  images: {
    unoptimized: true,
  },
}

export default nextConfig
