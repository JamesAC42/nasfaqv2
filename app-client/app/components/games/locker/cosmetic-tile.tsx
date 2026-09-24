"use client";

/* eslint-disable @next/next/no-img-element */
import { useState, type CSSProperties, type ReactNode } from "react";
import { FaCommentDots, FaCrown, FaGem, FaHatWizard, FaLock, FaMedal, FaVectorSquare } from "react-icons/fa6";
import { unitLabel } from "@/app/lib/market-units";
import { COSMETIC_COLOR } from "@/app/components/games/locker/cosmetics";
import styles from "@/app/components/games/locker/cosmetic-tile.module.scss";

const TYPE_ICON: Record<string, ReactNode> = {
  hat: <FaHatWizard />,
  profile_frame: <FaVectorSquare />,
  profile_badge: <FaMedal />,
  chat_flair: <FaCommentDots />,
  item: <FaGem />,
};

type Props = {
  name: string;
  type: string;
  rarity: string;
  imageUrl?: string;
  setReward?: { unit: string; tier: "roster" | "spotlight" } | null;
  equipped?: boolean;
  locked?: boolean;
  /** Small mono line under the name ("×3 pulled", "Equipped"). */
  meta?: ReactNode;
  action?: ReactNode;
  error?: string | null;
};

/** One cosmetic in the locker: art (or a drawn crest for set rewards), name, rarity, equip. */
export function CosmeticTile({ name, type, rarity, imageUrl, setReward = null, equipped = false, locked = false, meta, action, error }: Props) {
  const [broken, setBroken] = useState(false);
  const showImage = Boolean(imageUrl) && !broken && !locked;

  return (
    <li
      className={styles.tile}
      data-rarity={rarity}
      data-equipped={equipped || undefined}
      data-locked={locked || undefined}
      style={{ "--cc": COSMETIC_COLOR[rarity] ?? COSMETIC_COLOR.common } as CSSProperties}
    >
      <span className={styles.art} aria-hidden="true">
        {setReward ? (
          <SetCrest unit={setReward.unit} tier={setReward.tier} />
        ) : showImage ? (
          <img src={imageUrl} alt="" loading="lazy" onError={() => setBroken(true)} />
        ) : (
          <span className={styles.glyph}>{locked ? <FaLock /> : TYPE_ICON[type] ?? <FaCrown />}</span>
        )}
        {equipped ? <span className={styles.equippedTag}>Equipped</span> : null}
      </span>
      <span className={styles.body}>
        <b className={styles.name} title={name}>
          {locked ? "???" : name}
        </b>
        <span className={styles.rarity}>{rarity}</span>
        {meta ? <span className={styles.meta}>{meta}</span> : null}
      </span>
      {action ? <span className={styles.action}>{action}</span> : null}
      {error ? (
        <span className={styles.error} role="alert">
          {error}
        </span>
      ) : null}
    </li>
  );
}

/** Set rewards have no capsule art: draw them. Roster is a badge, spotlight is a frame. */
export function SetCrest({ unit, tier }: { unit: string; tier: "roster" | "spotlight" }) {
  const label = unitLabel(unit) || unit;
  return (
    <span className={styles.crest} data-tier={tier}>
      <span className={styles.crestInner}>
        <small>{tier === "spotlight" ? "SPOTLIGHT" : "ROSTER"}</small>
        <b>{label}</b>
      </span>
    </span>
  );
}
