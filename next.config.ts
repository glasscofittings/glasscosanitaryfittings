import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  distDir: "out",
  trailingSlash: true, // Fixes route file resolution in Tauri static exports
  images: {
    unoptimized: true,
  },
};

export default nextConfig;