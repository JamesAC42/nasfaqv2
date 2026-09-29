"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Oshimark } from "@/app/components/common/oshimark";
import { talentAccent } from "@/app/lib/talent-color";
import { useMarketStore } from "@/app/stores/market-store";
import styles from "@/app/components/predictions/admin/create-market.module.scss";

export type TalentOption = { symbol: string; display_name: string; icon: string | null; color: string | null };

/** The listed talents (from the market store the site shell loads). */
export function useTalents(): TalentOption[] {
  const assets = useMarketStore((state) => state.assets);
  return useMemo(
    () =>
      assets
        .map((asset) => ({ symbol: asset.symbol, display_name: asset.display_name, icon: asset.icon ?? null, color: asset.color ?? null }))
        .sort((a, b) => a.display_name.localeCompare(b.display_name)),
    [assets],
  );
}

/** Links a multi outcome to a talent: shows their oshimark and colour on the market. */
export function TalentPicker({ value, onChange, label }: { value: string; onChange: (talent: TalentOption | null) => void; label: string }) {
  const talents = useTalents();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const root = useRef<HTMLDivElement | null>(null);
  const selected = talents.find((talent) => talent.symbol === value) ?? null;

  useEffect(() => {
    if (!open) return;
    const down = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", down);
      document.removeEventListener("keydown", key);
    };
  }, [open]);

  const q = query.trim().toLowerCase();
  const list = q ? talents.filter((talent) => talent.symbol.toLowerCase().includes(q) || talent.display_name.toLowerCase().includes(q)) : talents;

  return (
    <div className={styles.picker} ref={root}>
      <button
        type="button"
        className={styles.pickerBtn}
        data-set={selected ? true : undefined}
        style={selected?.color ? { ["--tal" as string]: talentAccent(selected.color) } : undefined}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={selected ? `${label}: linked to ${selected.display_name}. Change` : `${label}: link a talent`}
        onClick={() => {
          setOpen((current) => !current);
          setQuery("");
        }}
      >
        {selected ? (
          <>
            <Oshimark icon={selected.icon} symbol={selected.symbol} size={16} />
            <b>{selected.symbol}</b>
          </>
        ) : (
          <span>+ Talent</span>
        )}
      </button>
      {open ? (
        <div className={styles.pickerPop}>
          <input className={styles.pickerSearch} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search talent or ticker" aria-label="Search talents" autoFocus />
          <div className={styles.pickerList} role="listbox" aria-label="Talents">
            {selected ? (
              <button
                type="button"
                role="option"
                aria-selected={false}
                className={styles.pickerOption}
                onClick={() => {
                  onChange(null);
                  setOpen(false);
                }}
              >
                <span className={styles.pickerNone}>No talent link</span>
              </button>
            ) : null}
            {list.slice(0, 80).map((talent) => (
              <button
                key={talent.symbol}
                type="button"
                role="option"
                aria-selected={talent.symbol === value}
                className={styles.pickerOption}
                style={talent.color ? { ["--tal" as string]: talentAccent(talent.color) } : undefined}
                onClick={() => {
                  onChange(talent);
                  setOpen(false);
                }}
              >
                <Oshimark icon={talent.icon} symbol={talent.symbol} size={18} />
                <span>{talent.display_name}</span>
                <b>{talent.symbol}</b>
              </button>
            ))}
            {!list.length ? <p className={styles.pickerNone}>{talents.length ? "No match." : "Talents are still loading…"}</p> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
