import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: [
    "@necro-ops/core",
    "@necro-ops/connectors",
    "@necro-ops/autopsy",
    "@necro-ops/db",
  ],
  serverExternalPackages: ["better-sqlite3"],
  webpack(config, { isServer }) {
    // The workspace packages are authored with NodeNext-style ".js" import
    // specifiers that actually point at ".ts" source files. Teach webpack to
    // resolve ".js" → ".ts"/".tsx" so transpilePackages can build them.
    config.resolve = config.resolve ?? {};
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      ".js": [".ts", ".tsx", ".js"],
      ".mjs": [".mts", ".mjs"],
    };

    // better-sqlite3 ships a native .node binding that must never be bundled.
    // Mark it external on the server so it is required at runtime from
    // node_modules instead of being traced through webpack.
    if (isServer) {
      const externals = Array.isArray(config.externals)
        ? config.externals
        : config.externals
          ? [config.externals]
          : [];
      config.externals = [...externals, "better-sqlite3"];
    }

    return config;
  },
};

export default nextConfig;
