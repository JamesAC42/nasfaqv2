import type { NextConfig } from "next";

const apiBaseUrl = process.env.API_BASE_URL || "http://localhost:4001";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${apiBaseUrl}/:path*`,
      },
    ];
  },
};

export default nextConfig;
