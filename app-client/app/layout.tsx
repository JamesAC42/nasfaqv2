import type { Metadata, Viewport } from "next";
import "./globals.scss";
import { AppProviders } from "@/app/providers/app-providers";
import { fontVariables } from "@/app/fonts";
import { Analytics } from "@/app/components/layout/analytics";
import { seasonBootScript } from "@/app/lib/seasons";

export const metadata: Metadata = {
  // Absolute URLs for the share images (app/**/opengraph-image.tsx). Set NEXT_PUBLIC_SITE_URL per deploy
  // (the Dockerfile does). nasfaq.biz itself is still the old site: an image URL there comes back as
  // its HTML, and link previews show an empty box.
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "https://holo.nasfaq.biz"),
  title: "NASFAQ",
  description: "The hololive stock market. Every talent is a stock, priced on their real YouTube numbers.",
  openGraph: { siteName: "NASFAQ", type: "website" },
  twitter: { card: "summary_large_image" },
};

export const viewport: Viewport = {
  themeColor: "#0a0c11",
  viewportFit: "cover",
};

// Applies the saved theme and calm-mode preference, and the current season (lib/seasons.ts),
// before first paint so the page never flashes the wrong palette or plays animations it shouldn't.
const bootScript = `(function(){var d=document.documentElement;try{var t=localStorage.getItem("nasfaq.theme");d.dataset.theme=(t==="light"||t==="dark")?t:"dark";var c=localStorage.getItem("nasfaq.calm");d.dataset.calm=(c==="1"||(c===null&&matchMedia("(prefers-reduced-motion: reduce)").matches))?"true":"false";}catch(e){}${seasonBootScript}})();`;

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
        <Analytics />
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
