import path from "node:path";

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    /*
     * Pin the workspace root to this directory. Without it, Turbopack walks up
     * and finds a stray package-lock.json in the home directory, then warns
     * about inferring a root outside the repo.
     */
    root: path.resolve(import.meta.dirname),
  },
};

export default nextConfig;
