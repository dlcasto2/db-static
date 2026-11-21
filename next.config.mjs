/** @type {import('next').NextConfig} */
const isProd = process.env.NODE_ENV === 'production';
const basePath = isProd ? '/db-static' : '';

const nextConfig = {
  output: 'export',
  basePath,
  // basePath only prefixes what Next generates itself (its JS/CSS chunks,
  // next/link, next/image). The rest of this codebase hardcodes paths like
  // "/icon.svg" and "/games/...", which go through lib/base-path.ts — this
  // hands it the same value.
  env: { NEXT_PUBLIC_BASE_PATH: basePath },
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
