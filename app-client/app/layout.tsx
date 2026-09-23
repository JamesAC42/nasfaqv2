import type { Metadata, Viewport } from "next";
import "./globals.scss";
import { AppProviders } from "@/app/providers/app-providers";
import { fontVariables } from "@/app/fonts";

import Script from "next/script";

export const metadata: Metadata = {
  title: "NASFAQ",
  description: "VTuber Numbers",
};

export const viewport: Viewport = {
  themeColor: "#0a0c11",
  viewportFit: "cover",
};

// Applies the saved theme and calm-mode preference before first paint so the
// page never flashes the wrong palette or plays animations it shouldn't.
const bootScript = `(function(){try{var d=document.documentElement;var t=localStorage.getItem("nasfaq.theme");d.dataset.theme=(t==="light"||t==="dark")?t:"dark";var c=localStorage.getItem("nasfaq.calm");d.dataset.calm=(c==="1"||(c===null&&matchMedia("(prefers-reduced-motion: reduce)").matches))?"true":"false";}catch(e){}})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" data-theme="dark" data-calm="false" className={fontVariables} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: bootScript }} />
      </head>
      <body>
        <Script
          src="https://umami.fukuin.dev/script.js"
          data-website-id="1aaf939c-cd8e-4e9d-bef7-cb4739440bae"
          strategy="afterInteractive"
        />
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
