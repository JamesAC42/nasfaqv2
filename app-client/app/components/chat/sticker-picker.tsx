"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Oshimark } from "@/app/components/common/oshimark";
import { ReactionFace } from "@/app/components/common/reaction-face";
import type { ChibiPose } from "@/app/lib/art-manifest";
import { useReactionStore } from "@/app/stores/reaction-store";
import styles from "@/app/components/chat/sticker-picker.module.scss";

const POSE_LABEL: Record<ChibiPose, string> = { idle: "Idle", hype: "Hype", moon: "Moon", cope: "Cope", smug: "Smug", shock: "Shock" };

/**
 * Card reactions as chat stickers: one tab per talent the player has a card of, her six poses
 * below. Picking one sends it straight away.
 */
export function StickerPicker({ onPick, onClose, disabled }: { onPick: (symbol: string, pose: ChibiPose) => void; onClose: () => void; disabled?: boolean }) {
  const unlocked = useReactionStore((state) => state.unlocked);
  const load = useReactionStore((state) => state.load);
  const [chosen, setChosen] = useState<string | null>(null);

  useEffect(() => {
    void load(true);
  }, [load]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const talent = unlocked?.find((row) => row.symbol === chosen) ?? unlocked?.[0] ?? null;

  return (
    <div className={styles.picker} role="dialog" aria-label="Stickers">
      <header className={styles.head}>
        <b>Stickers</b>
        <small>your card reactions</small>
        <button type="button" onClick={onClose} aria-label="Close stickers">
          ✕
        </button>
      </header>
      {unlocked === null ? (
        <p className={styles.note}>Loading…</p>
      ) : !talent ? (
        <p className={styles.note}>
          Own any card of a talent and her six reactions become stickers. Pull one from the <Link href="/games/cards">card gacha</Link>.
        </p>
      ) : (
        <>
          <div className={styles.tabs} role="tablist" aria-label="Talents">
            {unlocked.map((row) => (
              <button
                key={row.symbol}
                type="button"
                role="tab"
                aria-selected={row.symbol === talent.symbol}
                title={row.display_name}
                onClick={() => setChosen(row.symbol)}
                style={{ "--tal": row.color || "var(--blue)" } as React.CSSProperties}
              >
                <Oshimark icon={row.icon} symbol={row.symbol} size={18} />
              </button>
            ))}
          </div>
          <div className={styles.grid} style={{ "--tal": talent.color || "var(--blue)" } as React.CSSProperties}>
            {talent.poses.map((pose) => (
              <button key={pose} type="button" disabled={disabled} onClick={() => onPick(talent.symbol, pose)} title={`${talent.display_name}: ${POSE_LABEL[pose]}`}>
                <ReactionFace symbol={talent.symbol} pose={pose} size={84} crop="full" />
                <span>{POSE_LABEL[pose]}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
