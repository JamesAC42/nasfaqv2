"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { AssetCoin } from "@/app/components/common/asset-coin";
import { LivestreamModal, type LivestreamModalItem } from "@/app/components/livestreams/livestream-modal";
import { fmtDurationSeconds, fmtInteger } from "@/app/lib/format";
import type { LivestreamItem } from "@/app/lib/types";
import styles from "@/app/components/home/livestream-section.module.scss";

const DEFAULT_LIVE_ACCENT = "#ff5c7a";

function normalizeHexColor(value: string | null | undefined) {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) return trimmed;
  if (/^#[0-9a-fA-F]{3}$/.test(trimmed)) {
    const [, r, g, b] = trimmed;
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  return null;
}

function hexToRgb(hex: string) {
  return {
    r: Number.parseInt(hex.slice(1, 3), 16),
    g: Number.parseInt(hex.slice(3, 5), 16),
    b: Number.parseInt(hex.slice(5, 7), 16),
  };
}

function rgba(hex: string, alpha: number) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function getStreamDuration(startedAt: string | null | undefined, nowMs: number) {
  if (!startedAt) return "—";
  const startedAtMs = new Date(startedAt).getTime();
  if (Number.isNaN(startedAtMs) || startedAtMs > nowMs) return "—";
  return fmtDurationSeconds(Math.floor((nowMs - startedAtMs) / 1000));
}

function LiveViewerCount({ viewerCount }: { viewerCount: number | null }) {
  return (
    <div className={styles.viewerRow}>
      <strong className={styles.viewerCount}>
        {fmtInteger(viewerCount)}
      </strong>
      <span className={styles.viewerLabel}>watching</span>
    </div>
  );
}

function topLivestreams(items: LivestreamItem[]) {
  return [...items]
    .sort((a, b) => (b.viewer_count ?? 0) - (a.viewer_count ?? 0))
    .slice(0, 4);
}

export function LivestreamSection({ items, error }: { items: LivestreamItem[]; error: string | null }) {
  const streams = topLivestreams(items);
  const featuredStream = streams[0] || null;
  const secondaryStreams = streams.slice(1);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [selectedItem, setSelectedItem] = useState<LivestreamModalItem | null>(null);

  useEffect(() => {
    const intervalId = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(intervalId);
  }, []);

  const openModal = useCallback((item: LivestreamModalItem) => {
    setSelectedItem(item);
  }, [setSelectedItem]);

  function renderStreamCard(item: LivestreamItem, featured = false) {
    const accentColor = normalizeHexColor(item.channel_color) || DEFAULT_LIVE_ACCENT;
    const cardStyle = {
      "--stream-accent": accentColor,
      borderColor: rgba(accentColor, 0.34),
      boxShadow: `0 0 0 0.0625rem ${rgba(accentColor, 0.1)} inset, 0 0.75rem 1.6rem ${rgba(accentColor, 0.12)}`,
    } as CSSProperties;

    return (
      <button
        key={item.id}
        type="button"
        className={[styles.card, featured ? styles.cardFeatured : ""].filter(Boolean).join(" ")}
        style={cardStyle}
        onClick={() => openModal(item)}
      >
        <div className={styles.thumbWrap}>
          {item.thumbnail_url ? <img src={item.thumbnail_url} alt="" className={styles.thumb} /> : <div className={styles.thumbFallback} />}
        </div>
        <div className={styles.body}>
          <div className={styles.topRow}>
            <span className={styles.livePill}>Live</span>
            <span className={styles.duration}>{getStreamDuration(item.started_at, nowMs)}</span>
          </div>
          <strong className={styles.streamTitle}>{item.title}</strong>
          <div className={styles.creatorRow}>
            <AssetCoin symbol={item.creator.slice(0, 1)} icon={item.creator_icon} className={styles.creatorIcon} />
            <span className={styles.creatorName}>{item.creator}</span>
          </div>
          <LiveViewerCount viewerCount={item.viewer_count} />
        </div>
      </button>
    );
  }

  return (
    <>
      <section className={styles.section}>
        <div className={styles.header}>
          <div>
            <h2 className={styles.title}>Top Livestreams</h2>
            <p className={styles.copy}>The most active live channels right now.</p>
          </div>
          <Link href="/livestreams" className={styles.viewAllLink}>
            View all streams
          </Link>
        </div>

        {error ? <div className={styles.empty}>Livestream feed unavailable: {error}</div> : null}

        {featuredStream ? (
          <div className={styles.grid}>
            {renderStreamCard(featuredStream, true)}
            {secondaryStreams.length ? (
              <div className={styles.secondaryGrid}>
                {secondaryStreams.map((item) => renderStreamCard(item))}
              </div>
            ) : (
              <div className={styles.activityRail}>
                <span>Live activity</span>
                <strong>{fmtInteger(featuredStream.viewer_count)} watching now</strong>
                <p>More active streams will stack here as the live board fills in.</p>
              </div>
            )}
          </div>
        ) : !error ? (
          <div className={styles.empty}>No live channels are available right now.</div>
        ) : null}
      </section>
      <LivestreamModal open={Boolean(selectedItem)} item={selectedItem} onClose={() => setSelectedItem(null)} />
    </>
  );
}
