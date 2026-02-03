import type { NextConfig } from "next";

const apiBaseUrl = process.env.API_BASE_URL || "http://localhost:5067";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${apiBaseUrl}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
