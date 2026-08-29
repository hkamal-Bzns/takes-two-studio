import type { NextConfig } from "next";

/**
 * The public site is a single static file. These paths all serve it, so the
 * address bar keeps a real URL and a refresh lands back on the same view —
 * the SPA reads location.pathname on load to decide what to show.
 *
 * `beforeFiles` matters: an ordinary rewrite runs *after* filesystem routes,
 * so `/` would still be handled by any app/page.tsx and never reach here.
 */
const SPA_PATHS = ["/", "/advertising", "/food-beverage", "/about", "/contact", "/clients"];

const nextConfig: NextConfig = {
  /* Hostinger Node.js deployment uses `next start` — no standalone needed */
  typescript: {
    ignoreBuildErrors: false,
  },
  async rewrites() {
    return {
      beforeFiles: SPA_PATHS.map((source) => ({ source, destination: "/index.html" })),
      afterFiles: [],
      fallback: [],
    };
  },
  reactStrictMode: false,
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "takes.takestwostudio.com" },
    ],
  },
};

export default nextConfig;
