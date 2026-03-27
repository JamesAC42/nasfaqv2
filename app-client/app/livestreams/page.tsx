import { SiteShell } from "@/app/components/layout/site-shell";
import { LivestreamListing } from "@/app/components/livestreams/livestream-listing";

export default function LivestreamsPage() {
  return (
    <SiteShell>
      <LivestreamListing />
    </SiteShell>
  );
}
