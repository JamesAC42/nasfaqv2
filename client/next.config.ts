import type { NextConfig } from "next";

const apiMode = process.env.API_MODE || (process.env.NODE_ENV === "development" ? "proxy" : "direct");
const apiProxyBaseUrl = process.env.API_PROXY_BASE_URL || "http://localhost:4001";

const nextConfig: NextConfig = {
  async rewrites() {
    if (apiMode !== "proxy") {
      return [];
    }
    return [{ source: "/api/:path*", destination: `${apiProxyBaseUrl}/api/:path*` }];
  },
};

export default nextConfig;
