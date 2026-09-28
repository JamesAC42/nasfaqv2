"use client";

import Link from "next/link";
import type { ComponentType } from "react";
import { FaAt, FaHandHoldingDollar, FaMedal, FaNewspaper, FaRegBell, FaReply, FaRightLeft, FaHeart, FaSnowflake, FaSquarePollVertical, FaUserCheck, FaUserPlus } from "react-icons/fa6";
import { timeAgo } from "@/app/lib/time";
import type { NotificationItem } from "@/app/stores/notification-store";
import styles from "@/app/components/notifications/notifications.module.scss";

const ICONS: Record<string, ComponentType<{ "aria-hidden"?: boolean }>> = {
  friend_request: FaUserPlus,
  friend_accepted: FaUserCheck,
  mention: FaAt,
  reply: FaReply,
  achievement: FaMedal,
  prediction_won: FaSquarePollVertical,
  prediction_lost: FaSquarePollVertical,
  prediction_void: FaSquarePollVertical,
  proposal_approved: FaNewspaper,
  exchange: FaRightLeft,
  wishlist: FaHeart,
  dividend: FaHandHoldingDollar,
  buyback: FaSnowflake,
};

const TONE: Record<string, string> = {
  achievement: "win",
  prediction_won: "win",
  proposal_approved: "win",
  prediction_lost: "down",
  mention: "blue",
  reply: "blue",
  wishlist: "blue",
  dividend: "win",
  buyback: "blue",
};

/** One line of the inbox: icon, what happened, when, and a dot while it's new. */
export function NotificationRow({ item, onOpen, now }: { item: NotificationItem; onOpen?: (item: NotificationItem) => void; now?: number }) {
  const Icon = ICONS[item.kind] ?? FaRegBell;
  const inner = (
    <>
      <span className={styles.icon} data-tone={TONE[item.kind] ?? undefined}>
        <Icon aria-hidden />
      </span>
      <span className={styles.text}>
        <b>{item.title}</b>
        {item.body ? <span className={styles.body}>{item.body}</span> : null}
        <time dateTime={item.created_at} suppressHydrationWarning>
          {timeAgo(item.created_at, now)}
        </time>
      </span>
      {!item.read ? <i className={styles.dot} aria-label="new" /> : null}
    </>
  );
  return item.href ? (
    <Link href={item.href} className={styles.row} data-unread={!item.read || undefined} onClick={() => onOpen?.(item)}>
      {inner}
    </Link>
  ) : (
    <div className={styles.row} data-unread={!item.read || undefined}>
      {inner}
    </div>
  );
}
