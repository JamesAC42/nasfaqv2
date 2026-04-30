import type { Metadata } from "next";
import "./globals.scss";
import { AppProviders } from "@/app/providers/app-providers";

import Script from "next/script";

export const metadata: Metadata = {
  title: "NASFAQ",
  description: "VTuber Numbers",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
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
