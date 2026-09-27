"use client";

import Link from "next/link";
import { useEffect } from "react";
import { SiteShell } from "@/app/components/layout/site-shell";
import { StatusPage, statusStyles } from "@/app/components/site/status-page";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <SiteShell>
      <StatusPage
        slot="site-error"
        pose="cope"
        caption="{name} is coping"
        kicker="Error"
        title="Something broke"
        line="This page tripped over its own cables. Try again; if it keeps happening, tell us in chat."
        actions={
          <>
            <button type="button" className={statusStyles.primary} onClick={() => reset()}>
              Try again
            </button>
            <Link href="/" className={statusStyles.secondary}>
              Back to the floor
            </Link>
          </>
        }
      />
    </SiteShell>
  );
}
