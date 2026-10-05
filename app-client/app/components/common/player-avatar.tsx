"use client";

/* eslint-disable @next/next/no-img-element */
import { useState } from "react";
import { ReactionFace, parseReaction } from "@/app/components/common/reaction-face";
import { COSMETIC_TINT } from "@/app/components/common/cosmetic-chip";
import { fitStyle } from "@/app/lib/hat-fit";
import type { Equipped, LeaderboardEntry } from "@/app/lib/types";
import styles from "@/app/components/common/player-avatar.module.scss";

/**
 * A player's picture (or initials on their colour), wearing what they equipped from the capsule:
 * the hat on top, the item they're holding in front of it, and the profile frame around it (its
 * image, or a ring in the frame's rarity). One of each: equipping fills a slot.
 */
export function PlayerAvatar({
  username,
  pictureUrl,
  color,
  hat,
  equipped,
  size = 28,
  className,
}: {
  username: string;
  pictureUrl?: string | null;
  color?: string | null;
  hat?: LeaderboardEntry["equipped_hat"];
  equipped?: Equipped;
  size?: number;
  className?: string;
}) {
  const [broken, setBroken] = useState<Set<string>>(() => new Set());
  const ok = (url: string | null | undefined): url is string => Boolean(url) && !broken.has(url!);
  const fail = (url: string) => setBroken((current) => new Set(current).add(url));
  const wornHat = equipped?.hat ?? hat ?? null;
  const hatKey = wornHat ? ("key" in wornHat ? wornHat.key : wornHat.cosmetic_key) : null;
  const heldItem = equipped?.item ?? null;
  const frame = equipped?.profile_frame ?? null;
  const initials = username.replace(/[^a-z0-9]/gi, "").slice(0, 2).toUpperCase() || "?";
  // "reaction:PEK/hype": a card reaction the player picked as their avatar.
  const reaction = parseReaction(pictureUrl);
  return (
    <span
      className={`${styles.avatar} ${color ? "" : styles.plain} ${frame ? styles.framed : ""} ${className ?? ""}`}
      style={{ "--pc": color || "var(--ink-4)", "--s": `${size}px`, "--frame": frame ? (COSMETIC_TINT[frame.rarity] ?? COSMETIC_TINT.common) : undefined } as React.CSSProperties}
      data-frame-rarity={frame?.rarity}
      aria-hidden="true"
    >
      {reaction ? <ReactionFace symbol={reaction.symbol} pose={reaction.pose} size={size} /> : pictureUrl ? <img src={pictureUrl} alt="" loading="lazy" /> : <b>{initials}</b>}
      {/* Missing prize images drop out: the frame falls back to its rarity ring, a hat or item just isn't drawn. */}
      {frame && ok(frame.image_url) ? <img src={frame.image_url} alt="" className={styles.frameArt} title={frame.display_name} onError={() => fail(frame.image_url!)} /> : null}
      {wornHat && ok(wornHat.image_url) ? (
        <img src={wornHat.image_url} alt="" className={styles.hat} style={fitStyle(hatKey)} title={wornHat.display_name} onError={() => fail(wornHat.image_url!)} />
      ) : null}
      {heldItem && ok(heldItem.image_url) ? (
        <img src={heldItem.image_url} alt="" className={styles.item} style={fitStyle(heldItem.key)} title={heldItem.display_name} onError={() => fail(heldItem.image_url!)} />
      ) : null}
    </span>
  );
}
