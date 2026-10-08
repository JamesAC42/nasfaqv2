"use client";

import { useState } from "react";
import { Oshimark } from "@/app/components/common/oshimark";
import { getIconUrl } from "@/app/lib/normalizers";

/**
 * A new talent's oshimark next to her ticker. Her emoji's Twemoji when she has one (the same picture
 * her icon is made from), otherwise her icon, and the ticker's letter if that SVG isn't uploaded yet.
 */
export function IpoMark({ oshimarkUrl, icon, symbol, size = 16, className }: { oshimarkUrl: string | null; icon: string | null; symbol: string; size?: number; className?: string }) {
  // Remembers which URL failed, so a new one (her oshimark just got set) is tried again.
  const [failed, setFailed] = useState<string | null>(null);
  const url = oshimarkUrl || getIconUrl(icon);
  if (!url || failed === url) return <Oshimark icon={null} symbol={symbol} size={size} className={className} />;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} width={size} height={size} alt="" aria-hidden="true" className={className} onError={() => setFailed(url)} draggable={false} style={{ flex: "none" }} />
  );
}
