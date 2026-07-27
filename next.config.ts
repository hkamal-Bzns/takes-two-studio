import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* Hostinger Node.js deployment uses `next start` — no standalone needed */
  typescript: {
    ignoreBuildErrors: false,
  },
  reactStrictMode: false,
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "takes.takestwostudio.com" },
    ],
  },
};

export default nextConfig;
