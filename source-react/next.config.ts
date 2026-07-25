import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep page-data collection within the memory budget of local and CI runners.
  experimental: {
    cpus: 2,
  },
};

export default nextConfig;
