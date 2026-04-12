"use client";

import type { CSSProperties } from "react";
import { normalizeHexColor } from "@/app/lib/color";
import { getIconUrl } from "@/app/lib/normalizers";
import styles from "@/app/components/common/asset-coin.module.scss";

export function AssetCoin({
  symbol,
  icon,
  color,
  className,
  shape = "default",
  appearance = "default",
}: {
  symbol: string;
  icon?: string | null;
  color?: string | null;
  className?: string;
  shape?: "default" | "circle";
  appearance?: "default" | "plain";
}) {
  const accentColor = normalizeHexColor(color);
  const style = (accentColor ? { "--coin-accent": accentColor } : undefined) as CSSProperties | undefined;
  const iconUrl = getIconUrl(icon);

  return (
    <div
      className={[
        styles.coin,
        shape === "circle" ? styles.circle : "",
        appearance === "plain" ? styles.plain : "",
        className,
      ].filter(Boolean).join(" ")}
      style={style}
      aria-hidden="true"
    >
      {iconUrl ? (
        <img src={iconUrl} alt="" className={styles.image} />
      ) : (
        <div className={styles.fallback}>{symbol.slice(0, 1)}</div>
      )}
    </div>
  );
}
