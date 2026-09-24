"use client";

import Link from "next/link";
import { useMemo, type ReactNode } from "react";
import { Oshimark } from "@/app/components/common/oshimark";
import type { MarketAsset } from "@/app/lib/types";
import { useMarketStore } from "@/app/stores/market-store";
import ui from "@/app/components/market/market.module.scss";

export function useAssetMap() {
  const assets = useMarketStore((state) => state.assets);
  return useMemo(() => new Map<string, MarketAsset>(assets.map((asset) => [asset.symbol.toUpperCase(), asset])), [assets]);
}

export type Tone = "up" | "down" | "flat";

/** A ranked list row: oshimark, ticker, a detail line with an optional bar, and a value. */
export function RankRow({
  symbol,
  icon,
  detail,
  bar,
  tone = "flat",
  value,
  valueTone,
}: {
  symbol: string;
  icon: string | null | undefined;
  detail?: ReactNode;
  /** 0-1 width of the bar under the detail line. */
  bar?: number | null;
  tone?: Tone;
  value: ReactNode;
  valueTone?: Tone;
}) {
  return (
    <Link href={`/stocks/${encodeURIComponent(symbol)}`} className={ui.rrow} data-peek-stock={symbol} prefetch={false}>
      <Oshimark icon={icon} symbol={symbol} size={19} />
      <b>{symbol}</b>
      <span className={`${ui.rmid} ${ui[tone]}`}>
        {detail ? <small>{detail}</small> : null}
        {bar !== undefined && bar !== null ? <i style={{ width: `${Math.max(4, Math.min(1, bar) * 100).toFixed(0)}%` }} /> : null}
      </span>
      <span className={`${ui.rval} ${ui[valueTone ?? tone]}`}>{value}</span>
    </Link>
  );
}

/** Horizontal bar with zero in the middle. value/max in [-1, 1]. */
export function DivBar({ value, max, className }: { value: number; max: number; className?: string }) {
  const width = max > 0 ? (Math.min(1, Math.abs(value) / max) * 50).toFixed(1) : "0";
  const style = value >= 0 ? { left: "50%", width: `${width}%`, background: "var(--up)" } : { right: "50%", width: `${width}%`, background: "var(--down)" };
  return (
    <span className={[ui.dbar, className].filter(Boolean).join(" ")}>
      <s style={style} />
    </span>
  );
}

export function Seg<T extends string>({
  options,
  value,
  onChange,
  label,
  className,
}: {
  options: Array<{ value: T; label: ReactNode; tone?: "up" | "down" | "blue" }>;
  value: T;
  onChange: (value: T) => void;
  label: string;
  className?: string;
}) {
  return (
    <div className={[ui.seg, className].filter(Boolean).join(" ")} role="group" aria-label={label}>
      {options.map((option) => (
        <button key={option.value} type="button" aria-pressed={option.value === value} data-tone={option.tone} onClick={() => onChange(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function toneClass(value: number | null | undefined): Tone {
  if (value === null || value === undefined || !Number.isFinite(value) || Math.abs(value) < 0.00005) return "flat";
  return value > 0 ? "up" : "down";
}

export function compactMoney(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1000) return `${sign}$${(abs / 1000).toFixed(1)}k`;
  return `${sign}$${abs.toFixed(0)}`;
}

export function num(value: number | null | undefined, digits = 2) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
