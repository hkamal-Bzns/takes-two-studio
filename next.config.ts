import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* Hostinger Node.js deployment uses `next start` — no standalone needed */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**" },
    ],
  },
};

export default nextConfig;
