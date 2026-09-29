"use client";

import Link from "next/link";
import { GamesFrame } from "@/app/components/games/shell/games-frame";

/** Ticker Tap is held back for now (lib/games/flags.ts): what the page shows instead. */
export function TickerTapPaused() {
  return (
    <GamesFrame kicker="Ticker Tap" title="Back soon" blurb="The tapping game is off while we make runs harder to script. Nothing was charged, and no pool is running.">
      <p>
        Try <Link href="/games/blackjack">blackjack</Link>, an <Link href="/games/duel">oshi duel</Link> or <Link href="/games/high-low">high-low</Link> in the meantime.
      </p>
    </GamesFrame>
  );
}
