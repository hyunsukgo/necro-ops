import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@necro-ops/core", "@necro-ops/autopsy", "@necro-ops/db"],
  experimental: {
    serverComponentsExternalPackages: ["better-sqlite3"],
  },
};

export default nextConfig;
