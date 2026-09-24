/* eslint-disable @next/next/no-img-element */
import type { LeaderboardEntry } from "@/app/lib/types";
import styles from "@/app/components/common/player-avatar.module.scss";

/** A player's picture (or initials on their colour), with their equipped hat on top. */
export function PlayerAvatar({
  username,
  pictureUrl,
  color,
  hat,
  size = 28,
  className,
}: {
  username: string;
  pictureUrl?: string | null;
  color?: string | null;
  hat?: LeaderboardEntry["equipped_hat"];
  size?: number;
  className?: string;
}) {
  const initials = username.replace(/[^a-z0-9]/gi, "").slice(0, 2).toUpperCase() || "?";
  return (
    <span className={`${styles.avatar} ${color ? "" : styles.plain} ${className ?? ""}`} style={{ "--pc": color || "var(--ink-4)", "--s": `${size}px` } as React.CSSProperties} aria-hidden="true">
      {pictureUrl ? <img src={pictureUrl} alt="" loading="lazy" /> : <b>{initials}</b>}
      {hat?.image_url ? <img src={hat.image_url} alt="" className={styles.hat} title={hat.display_name} /> : null}
    </span>
  );
}
