import type { Metadata, Viewport } from "next";
import "./globals.scss";
import { AppProviders } from "@/app/providers/app-providers";
import { fontVariables } from "@/app/fonts";
import { Analytics } from "@/app/components/layout/analytics";

export const metadata: Metadata = {
  // Absolute URLs for the share images (app/**/opengraph-image.tsx). Set NEXT_PUBLIC_SITE_URL per deploy.
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "https://nasfaq.biz"),
  title: "NASFAQ",
  description: "VTuber Numbers",
  openGraph: { siteName: "NASFAQ", type: "website" },
  twitter: { card: "summary_large_image" },
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
        <Analytics />
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
