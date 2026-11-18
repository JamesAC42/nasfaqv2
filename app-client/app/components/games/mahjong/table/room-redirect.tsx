"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { SiteShell } from "@/app/components/layout/site-shell";
import { gameErrorText } from "@/app/lib/games/errors";
import { fetchRoom } from "@/app/lib/games/mahjong/api";
import styles from "@/app/components/games/mahjong/table/table-page.module.scss";
import panels from "@/app/components/games/mahjong/table/table-panels.module.scss";

/** A friend link: look the code up and go to the table, where "Sit down" is waiting. */
export function RoomRedirect({ code }: { code: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchRoom(code)
      .then((room) => {
        if (!cancelled) router.replace(`/games/mahjong/table/${room.table_id}`);
      })
      .catch((caught) => {
        if (!cancelled) setError(gameErrorText(caught));
      });
    return () => {
      cancelled = true;
    };
  }, [code, router]);
  return (
    <SiteShell>
      <div className={styles.page}>
        <div className={styles.message}>
          {error ? (
            <>
              <p>{error === "That table is gone." ? "That room has closed, or the code is wrong." : error}</p>
              <Link href="/games/mahjong" className={panels.plain}>
                Back to the lobby
              </Link>
            </>
          ) : (
            <p aria-busy="true">Finding the room…</p>
          )}
        </div>
      </div>
    </SiteShell>
  );
}
