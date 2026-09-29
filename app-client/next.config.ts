import type { NextConfig } from "next";

// Every page: no framing by other sites (the trade and bet buttons can't be clickjacked), no MIME
// sniffing, and only the origin in referrers to other sites.
const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
  async rewrites() {
    const apiBase = process.env.SERVER_API_BASE || process.env.NEXT_PUBLIC_API_BASE || "http://localhost:4001";
    return [
      {
        source: "/internal/:path*",
        destination: `${apiBase}/internal/:path*`,
      },
      {
        source: "/api/:path*",
        destination: `${apiBase}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
