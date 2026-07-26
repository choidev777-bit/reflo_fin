import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // E2E can run beside an already-open local dev server without sharing its lock.
  distDir: process.env.REFLO_NEXT_DIST_DIR || ".next",
  // Keep page-data collection within the memory budget of local and CI runners.
  experimental: {
    cpus: 2,
  },
};

export default nextConfig;
