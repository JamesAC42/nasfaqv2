import type { Metadata } from "next";
import { SiteShell } from "@/app/components/layout/site-shell";
import { StatusPage } from "@/app/components/site/status-page";

export const metadata: Metadata = { title: "Not found" };

export default function NotFound() {
  return (
    <SiteShell>
      <StatusPage slot="site-not-found" kicker="404" title="Off the chart" line="This page doesn't exist, got delisted, or never IPO'd. The line just stops here." />
    </SiteShell>
  );
}
