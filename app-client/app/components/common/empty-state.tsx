"use client";

import type { ReactNode } from "react";
import { TalentReaction } from "@/app/components/common/talent-reaction";
import type { ChibiPose } from "@/app/lib/art-manifest";
import styles from "@/app/components/common/empty-state.module.scss";

/**
 * An empty list: a talent idling beside the message. On a stock page pass that talent's symbol so
 * it's them waiting; elsewhere a random talent with the pose shows up. `size="page"` stacks a
 * bigger portrait over the text for whole-page lists.
 */
export function EmptyState({
  children,
  symbol,
  pose = "idle",
  size = "panel",
  className,
}: {
  children: ReactNode;
  symbol?: string | null;
  pose?: ChibiPose;
  size?: "panel" | "page";
  className?: string;
}) {
  return (
    <div className={[styles.empty, className].filter(Boolean).join(" ")} data-size={size}>
      <TalentReaction pose={pose} symbol={symbol} size={size === "page" ? 112 : 52} className={styles.face} />
      <div className={styles.body}>{children}</div>
    </div>
  );
}
