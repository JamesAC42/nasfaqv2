import type { Metadata } from "next";
import "./globals.scss";
import { AppProviders } from "@/app/providers/app-providers";

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
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
