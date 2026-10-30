import type { NextConfig } from "next";
import { SITE_IMAGE_HOSTS } from "./app/lib/image-hosts";

const dev = process.env.NODE_ENV !== "production";

/** The origins (http and ws, or https and wss) of an absolute URL from the environment. */
function originsOf(value: string | undefined): string[] {
  try {
    const url = new URL(String(value || ""));
    const secure = url.protocol === "https:" || url.protocol === "wss:";
    return [`${secure ? "https" : "http"}://${url.host}`, `${secure ? "wss" : "ws"}://${url.host}`];
  } catch {
    return [];
  }
}

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "";
const reportUrl = `${siteUrl.replace(/\/+$/, "")}/api/site/csp-report`;

// The Content-Security-Policy, by directive. It's only reported for now (Content-Security-Policy-
// Report-Only, to /api/site/csp-report, counted in Redis by api/src/services/cspReports.js) while
// real pages show what it would block: pictures come from data written by players and scrapers,
// and Cloudflare may add scripts of its own. Build with CSP_ENFORCE=true to enforce all of it.
const CSP: Record<string, string[]> = {
  "default-src": ["'self'"],
  // 'unsafe-inline': Next.js bootstraps statically rendered pages with inline scripts (nonces would
  // mean rendering every page per request). Other hosts' scripts are still held to these: Turnstile,
  // Umami, and Cloudflare's analytics beacon if it's switched on. Development needs eval.
  "script-src": ["'self'", "'unsafe-inline'", ...(dev ? ["'unsafe-eval'"] : []), "https://challenges.cloudflare.com", "https://umami.fukuin.dev", "https://static.cloudflareinsights.com"],
  "style-src": ["'self'", "'unsafe-inline'"],
  "img-src": ["'self'", "data:", "blob:", ...SITE_IMAGE_HOSTS.map((host) => `https://${host}`)],
  "media-src": ["'self'", "https://i.4cdn.org"],
  "font-src": ["'self'", "data:"],
  // The API and its sockets are this origin in production; in development they can be elsewhere.
  "connect-src": [
    "'self'",
    ...originsOf(siteUrl),
    ...originsOf(process.env.NEXT_PUBLIC_API_BASE),
    ...originsOf(process.env.NEXT_PUBLIC_WS_API_BASE),
    "https://challenges.cloudflare.com",
    "https://umami.fukuin.dev",
    "https://cloudflareinsights.com",
  ],
  "frame-src": ["https://challenges.cloudflare.com", "https://www.youtube-nocookie.com", "https://www.youtube.com"],
  "worker-src": ["'self'", "blob:"],
  "manifest-src": ["'self'"],
  "object-src": ["'none'"],
  "base-uri": ["'self'"],
  "form-action": ["'self'"],
  "frame-ancestors": ["'self'"],
  "report-uri": [reportUrl],
  "report-to": ["csp"],
};

const policy = (directives: Record<string, string[]>) =>
  Object.entries(directives)
    .filter(([, sources]) => sources.length)
    .map(([name, sources]) => [name, ...new Set(sources)].join(" "))
    .join("; ");

// Enforced already: nothing on the site needs framing by others, plugins, or a <base> elsewhere.
const ENFORCED_CSP = policy({ "frame-ancestors": ["'self'"], "object-src": ["'none'"], "base-uri": ["'self'"] });
const enforceAll = process.env.CSP_ENFORCE === "true";

// Every page: no framing by other sites (the trade and bet buttons can't be clickjacked), no MIME
// sniffing, only the origin in referrers to other sites, HTTPS only, and no camera, microphone,
// location or payment APIs for anything on the page.
const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: enforceAll ? policy(CSP) : ENFORCED_CSP },
  // (frame-ancestors is enforced above; browsers ignore it, with a warning, in a report-only policy.)
  ...(enforceAll ? [] : [{ key: "Content-Security-Policy-Report-Only", value: policy({ ...CSP, "frame-ancestors": [] }) }]),
  { key: "Reporting-Endpoints", value: `csp="${reportUrl}"` },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  ...(dev ? [] : [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }]),
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), display-capture=(), browsing-topics=()" },
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
