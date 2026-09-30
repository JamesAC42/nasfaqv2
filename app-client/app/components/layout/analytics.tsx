"use client";

import { usePathname } from "next/navigation";
import Script from "next/script";

// Umami records the full URL, query string included. The pages that email links open carry a
// one-time token there (verify your email, reset your password), so the tracker doesn't load on them.
const TOKEN_PAGES = /^\/(reset-password|verify-email)(\/|$)/;

export function Analytics() {
  const pathname = usePathname() || "";
  if (TOKEN_PAGES.test(pathname)) return null;
  return <Script src="https://umami.fukuin.dev/script.js" data-website-id="1aaf939c-cd8e-4e9d-bef7-cb4739440bae" strategy="afterInteractive" />;
}
