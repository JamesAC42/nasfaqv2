"use client";

import { useEffect, useRef, useState } from "react";
import { AssetCoin } from "@/app/components/common/asset-coin";
import type { MarketAsset } from "@/app/lib/types";
import styles from "@/app/components/common/asset-picker.module.scss";

function normalize(value: string | null | undefined) {
  return (value || "").trim().toLowerCase();
}

export function AssetPicker({
  assets,
  value,
  onChange,
  placeholder = "Select stock",
  emptyLabel = "All stocks",
}: {
  assets: MarketAsset[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  emptyLabel?: string;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!isOpen) return;

    function handlePointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  const normalizedValue = normalize(value);
  const selectedAsset = assets.find((asset) => normalize(asset.symbol) === normalizedValue) || null;
  const normalizedQuery = normalize(query);
  const filteredAssets = assets.filter((asset) => (
    !normalizedQuery
    || normalize(asset.symbol).includes(normalizedQuery)
    || normalize(asset.display_name).includes(normalizedQuery)
  ));

  return (
    <div className={styles.root} ref={rootRef}>
      <button
        type="button"
        className={`${styles.trigger} ${isOpen ? styles.triggerOpen : ""}`.trim()}
        onClick={() => {
          setIsOpen((current) => !current);
          if (!isOpen) setQuery("");
        }}
        aria-expanded={isOpen}
      >
        {selectedAsset ? (
          <span className={styles.triggerValue}>
            <AssetCoin symbol={selectedAsset.symbol} icon={selectedAsset.icon} color={selectedAsset.color} className={styles.coin} />
            <span className={styles.triggerText}>
              <span className={styles.triggerName}>{selectedAsset.display_name}</span>
              <span className={styles.triggerSymbol}>{selectedAsset.symbol}</span>
            </span>
          </span>
        ) : (
          <span className={styles.placeholder}>{placeholder}</span>
        )}
        <span className={styles.chevron} aria-hidden="true">▾</span>
      </button>

      {isOpen ? (
        <div className={styles.popover}>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className={styles.search}
            placeholder="Search channels or tickers"
            autoFocus
          />

          <div className={styles.list}>
            <button
              type="button"
              className={`${styles.option} ${!selectedAsset ? styles.optionActive : ""}`.trim()}
              onClick={() => {
                onChange("");
                setIsOpen(false);
                setQuery("");
              }}
            >
              <span className={styles.optionTextOnly}>{emptyLabel}</span>
            </button>

            {filteredAssets.map((asset) => {
              const isActive = normalize(asset.symbol) === normalizedValue;
              return (
                <button
                  key={asset.symbol}
                  type="button"
                  className={`${styles.option} ${isActive ? styles.optionActive : ""}`.trim()}
                  onClick={() => {
                    onChange(asset.symbol);
                    setIsOpen(false);
                    setQuery("");
                  }}
                >
                  <AssetCoin symbol={asset.symbol} icon={asset.icon} color={asset.color} className={styles.coin} />
                  <span className={styles.optionText}>
                    <span className={styles.optionName}>{asset.display_name}</span>
                    <span className={styles.optionMeta}>{asset.symbol}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
