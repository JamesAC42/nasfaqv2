"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { useApi } from "@/app/components/stock/use-stock-data";
import type { OshiStatus } from "@/app/lib/types";
import styles from "@/app/components/stock/dossier.module.scss";

// Oshi protection on the stock page (api/src/services/oshi.js): on your oshi, the shares you've held
// since last Saturday 00:00 ET skip a share fee at this Saturday's review. A dividend still pays on
// every share. Nothing shows on a stock that isn't your oshi, unless you have none yet.

const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : Number(value) || 0);
const normalize = (raw: Record<string, unknown>) => raw as unknown as OshiStatus;
const shares = (value: number) => value.toLocaleString("en-US", { maximumFractionDigits: 2 });
const weekday = (iso: string) => new Date(iso).toLocaleDateString("en-US", { weekday: "short", timeZone: "America/New_York" });

export function OshiProtection({ symbol, held }: { symbol: string; held: number }) {
  const status = useApi<OshiStatus>("/api/market/me/oshi", normalize);
  const { reload } = status;
  // A fill here changes what's covered: read it again when the position moves.
  const lastHeld = useRef(held);
  useEffect(() => {
    if (lastHeld.current === held) return;
    lastHeld.current = held;
    reload();
  }, [held, reload]);

  const data = status.data;
  if (!data || !data.protection_enabled) return null;
  if (!data.oshi) {
    return (
      <p className={styles.oshiHint}>
        No oshi yet. <Link href="/profile?edit=1">Pick one</Link>: the shares of your oshi you hold all week skip Saturday&apos;s share fee.
      </p>
    );
  }
  if (data.oshi.symbol.toUpperCase() !== symbol.toUpperCase()) return null;

  const covered = num(data.protected_shares);
  const holding = num(data.held);
  return (
    <div className={styles.oshiShield} aria-label="Oshi protection">
      <span className={styles.oshiShieldHead}>Your oshi · fee protection</span>
      {!data.covered ? (
        <p>
          {data.set_at ? `Your oshi since ${weekday(data.set_at)}. ` : ""}Protection starts with next week: hold through it and those shares skip the share fee. A dividend
          still pays on every share.
        </p>
      ) : holding > 0 ? (
        <p>
          <b>
            {shares(covered)} of {shares(holding)}
          </b>{" "}
          shares held since Sat 00:00 ET pay no share fee at Saturday&apos;s review.
          {covered < holding ? ` The ${shares(holding - covered)} bought since are covered from next week.` : ""} A dividend still pays on every share.
        </p>
      ) : (
        <p>Shares of your oshi held all week skip Saturday&apos;s share fee. A dividend still pays on every share.</p>
      )}
      {data.change.available_at ? (
        <small>Your oshi can change again {new Date(data.change.available_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}.</small>
      ) : null}
    </div>
  );
}
