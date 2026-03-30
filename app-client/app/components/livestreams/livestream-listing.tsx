"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { apiFetch } from "@/app/lib/api";
import { LivestreamModal, type LivestreamModalItem } from "@/app/components/livestreams/livestream-modal";
import { fmtDate, fmtDurationSeconds, fmtInteger } from "@/app/lib/format";
import { getIconUrl } from "@/app/lib/normalizers";
import type { LivestreamItem } from "@/app/lib/types";
import { useLivestreamStore } from "@/app/stores/livestream-store";
import styles from "@/app/components/livestreams/livestream-listing.module.scss";

const DEFAULT_LIVE_ACCENT = "#ff5c7a";

type PastStreamResponse = {
  video_id: string;
  status: "ended";
  video_title: string | null;
  thumbnail_url: string | null;
  channel_name: string;
  channel_icon: string | null;
  channel_color: string | null;
  scheduled_start_at: string | null;
  actual_start_at: string | null;
  ended_at: string | null;
  total_views: number | null;
  avg_concurrent_viewers: number | null;
  max_concurrent_viewers: number | null;
  duration_seconds: number | null;
};

type PastPayload = {
  page: number;
  week_start: string;
  week_end: string;
  has_older: boolean;
  streams: PastStreamResponse[];
};

type PastStreamItem = {
  id: string;
  title: string;
  creator: string;
  creator_icon: string | null;
  channel_color: string | null;
  thumbnail_url: string | null;
  started_at: string | null;
  ended_at: string | null;
  total_views: number | null;
  avg_concurrent_viewers: number | null;
  max_concurrent_viewers: number | null;
  duration_seconds: number | null;
  url: string | null;
  status: string;
};

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

function toNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function deriveDurationSeconds(start?: string | null, end?: string | null) {
  if (!start || !end) return null;
  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
  if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs < startMs) return null;
  return Math.floor((endMs - startMs) / 1000);
}

function normalizePastStream(stream: PastStreamResponse): PastStreamItem {
  return {
    id: stream.video_id,
    title: stream.video_title || "Livestream",
    creator: stream.channel_name,
    creator_icon: stream.channel_icon,
    channel_color: stream.channel_color,
    thumbnail_url: stream.thumbnail_url,
    started_at: stream.actual_start_at || stream.scheduled_start_at,
    ended_at: stream.ended_at,
    total_views: toNumber(stream.total_views),
    avg_concurrent_viewers: toNumber(stream.avg_concurrent_viewers),
    max_concurrent_viewers: toNumber(stream.max_concurrent_viewers),
    duration_seconds: toNumber(stream.duration_seconds) ?? deriveDurationSeconds(stream.actual_start_at, stream.ended_at),
    url: `https://www.youtube.com/watch?v=${encodeURIComponent(stream.video_id)}`,
    status: stream.status,
  };
}

function formatUpcomingStatus(startedAt: string | null | undefined, referenceNowMs: number) {
  if (!startedAt) return "Waiting to start";
  const startedAtMs = new Date(startedAt).getTime();
  if (Number.isNaN(startedAtMs)) return "Waiting to start";

  const diffMs = startedAtMs - referenceNowMs;
  const oneMinuteMs = 60_000;
  const oneHourMs = 60 * oneMinuteMs;
  const oneDayMs = 24 * oneHourMs;

  if (diffMs <= -oneDayMs) return "Delayed";
  if (diffMs < 0) return "Waiting to start";
  if (diffMs <= oneMinuteMs) return "Stream starting in less than a minute";

  const totalMinutes = Math.floor(diffMs / oneMinuteMs);
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;

  const parts: string[] = [];
  if (days > 0) {
    parts.push(`${days} day${days === 1 ? "" : "s"}`);
  }
  if ((days > 0 || hours > 0) && hours > 0) {
    parts.push(`${hours} hour${hours === 1 ? "" : "s"}`);
  }
  if ((days > 0 || hours > 0 || minutes > 0) && minutes > 0) {
    parts.push(`${minutes} minute${minutes === 1 ? "" : "s"}`);
  }

  return parts.length ? `Starts in ${parts.join(", ")}` : "Stream starting in less than a minute";
}

function LiveViewerCount({ streamId, viewerCount, jitterTick }: { streamId: string; viewerCount: number | null; jitterTick: number }) {
  const [displayedCount, setDisplayedCount] = useState<number | null>(viewerCount);
  const [flashTick, setFlashTick] = useState(0);
  const updateTimerRef = useRef<number | null>(null);
  const displayedCountRef = useRef<number | null>(viewerCount);
  const latestTargetRef = useRef<number | null>(viewerCount);

  useEffect(() => {
    displayedCountRef.current = displayedCount;
  }, [displayedCount]);

  useEffect(() => {
    latestTargetRef.current = viewerCount;

    if (viewerCount === null) {
      if (updateTimerRef.current !== null) {
        window.clearTimeout(updateTimerRef.current);
        updateTimerRef.current = null;
      }
      setDisplayedCount(null);
      return;
    }

    if (displayedCountRef.current === null) {
      setDisplayedCount(viewerCount);
      return;
    }

    if (viewerCount === displayedCountRef.current) return;

    if (updateTimerRef.current !== null) {
      window.clearTimeout(updateTimerRef.current);
    }

    const delayMs = 400 + Math.floor(Math.random() * 9_200);
    updateTimerRef.current = window.setTimeout(() => {
      updateTimerRef.current = null;
      setDisplayedCount(latestTargetRef.current);
      setFlashTick((value) => value + 1);
    }, delayMs);

    return () => {
      if (updateTimerRef.current !== null) {
        window.clearTimeout(updateTimerRef.current);
        updateTimerRef.current = null;
      }
    };
  }, [streamId, viewerCount]);

  useEffect(() => {
    return () => {
      if (updateTimerRef.current !== null) {
        window.clearTimeout(updateTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!jitterTick || viewerCount === null) return;
    setDisplayedCount((current) => {
      if (current === null) return current;
      if (Math.random() >= 0.7) return current;
      const next = Math.max(0, current + (Math.random() < 0.5 ? -1 : 1));
      if (next === current) return current;
      setFlashTick((value) => value + 1);
      return next;
    });
  }, [jitterTick, viewerCount]);

  return (
    <div className={styles.viewerBlock}>
      <strong key={flashTick} className={`${styles.viewerCount} ${flashTick ? styles.viewerCountFlash : ""}`}>
        {fmtInteger(displayedCount)}
      </strong>
      <span className={styles.viewerLabel}>watching</span>
    </div>
  );
}

function renderStreamCard(
  item: LivestreamItem,
  kind: "live" | "upcoming",
  nowMs: number,
  jitterTick: number,
  upcomingReferenceNowMs: number,
  onOpen: (item: LivestreamModalItem) => void
) {
  const accentColor = normalizeHexColor(item.channel_color) || DEFAULT_LIVE_ACCENT;
  const thumbStyle =
    kind === "live"
      ? ({
          "--stream-accent": accentColor,
          borderColor: accentColor,
          boxShadow: `0 0 0.8rem ${rgba(accentColor, 0.4)}, 0 0 1.7rem ${rgba(accentColor, 0.22)}`,
        } as CSSProperties)
      : undefined;

  const cardContent = (
    <>
      <div className={styles.thumbWrap} style={thumbStyle}>
        {item.thumbnail_url ? <img src={item.thumbnail_url} alt="" className={styles.thumb} /> : <div className={styles.thumbFallback} />}
        {kind === "live" ? <span className={styles.liveBadge}>LIVE</span> : null}
      </div>

      <div className={styles.body}>
        <strong className={styles.cardTitle}>{item.title}</strong>

        <div className={styles.channelRow}>
          <div className={styles.channelMeta}>
            {getIconUrl(item.creator_icon) ? <img src={getIconUrl(item.creator_icon) || ""} alt="" className={styles.icon} /> : <div className={styles.iconFallback} />}
            <span className={styles.channelName}>{item.creator}</span>
          </div>
          {kind === "live" ? <span className={styles.duration}>{getStreamDuration(item.started_at, nowMs)}</span> : null}
          {kind === "upcoming" ? <span className={styles.duration}>{fmtDate(item.started_at)}</span> : null}
        </div>

        {kind === "live" ? (
          <LiveViewerCount streamId={item.id} viewerCount={item.viewer_count} jitterTick={jitterTick} />
        ) : (
          <div className={styles.scheduledAt}>{formatUpcomingStatus(item.started_at, upcomingReferenceNowMs)}</div>
        )}
      </div>
    </>
  );

  if (kind === "upcoming") {
    const href = item.url || `https://www.youtube.com/watch?v=${encodeURIComponent(item.id)}`;
    return (
      <Link key={item.id} href={href} target="_blank" rel="noreferrer" className={styles.card}>
        {cardContent}
      </Link>
    );
  }

  return (
    <button key={item.id} className={styles.card} type="button" onClick={() => onOpen(item)}>
      {cardContent}
    </button>
  );
}

function renderPastStreamCard(item: PastStreamItem, onOpen: (item: LivestreamModalItem) => void) {
  const accentColor = normalizeHexColor(item.channel_color) || DEFAULT_LIVE_ACCENT;
  const thumbStyle = {
    borderColor: accentColor,
    boxShadow: `0 0 0.45rem ${rgba(accentColor, 0.2)}, 0 0 1rem ${rgba(accentColor, 0.1)}`,
  } as CSSProperties;

  return (
    <button
      key={item.id}
      className={styles.card}
      type="button"
      onClick={() => onOpen(item)}
    >
      <div className={styles.thumbWrap} style={thumbStyle}>
        {item.thumbnail_url ? <img src={item.thumbnail_url} alt="" className={styles.thumb} /> : <div className={styles.thumbFallback} />}
      </div>

      <div className={styles.body}>
        <strong className={styles.cardTitle}>{item.title}</strong>

        <div className={styles.channelRow}>
          <div className={styles.channelMeta}>
            {getIconUrl(item.creator_icon) ? <img src={getIconUrl(item.creator_icon) || ""} alt="" className={styles.icon} /> : <div className={styles.iconFallback} />}
            <span className={styles.channelName}>{item.creator}</span>
          </div>
        </div>

        <div className={styles.pastStatsGrid}>
          <div className={styles.pastStat}>
            <span className={styles.pastStatLabel}>Avg</span>
            <span className={styles.pastStatValue}>{fmtInteger(item.avg_concurrent_viewers)}</span>
          </div>
          <div className={styles.pastStat}>
            <span className={styles.pastStatLabel}>Max</span>
            <span className={styles.pastStatValue}>{fmtInteger(item.max_concurrent_viewers)}</span>
          </div>
          <div className={styles.pastStat}>
            <span className={styles.pastStatLabel}>Views at end</span>
            <span className={styles.pastStatValue}>{fmtInteger(item.total_views)}</span>
          </div>
          <div className={styles.pastStat}>
            <span className={styles.pastStatLabel}>Duration</span>
            <span className={styles.pastStatValue}>{fmtDurationSeconds(item.duration_seconds)}</span>
          </div>
          <div className={`${styles.pastStat} ${styles.pastStatFull}`}>
            <span className={styles.pastStatLabel}>Started</span>
            <span className={styles.pastStatValue}>{fmtDate(item.started_at)}</span>
          </div>
        </div>
      </div>
    </button>
  );
}

export function LivestreamListing() {
  const live = useLivestreamStore((state) => state.live);
  const upcoming = useLivestreamStore((state) => state.upcoming);
  const error = useLivestreamStore((state) => state.error);
  const isLoading = useLivestreamStore((state) => state.isLoading);
  const fetchLivestreams = useLivestreamStore((state) => state.fetchLivestreams);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [jitterTick, setJitterTick] = useState(0);
  const [viewMode, setViewMode] = useState<"current" | "historical">("current");
  const [pastPage, setPastPage] = useState(0);
  const [pastData, setPastData] = useState<PastPayload | null>(null);
  const [pastLoading, setPastLoading] = useState(false);
  const [pastError, setPastError] = useState<string | null>(null);
  const [selectedItem, setSelectedItem] = useState<LivestreamModalItem | null>(null);
  const upcomingReferenceNowMsRef = useRef<number | null>(null);

  useEffect(() => {
    void fetchLivestreams();
  }, [fetchLivestreams]);

  useEffect(() => {
    const intervalId = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    const intervalId = window.setInterval(() => setJitterTick((value) => value + 1), 2000);
    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    if (viewMode !== "historical") return;
    let cancelled = false;
    setPastLoading(true);
    setPastError(null);

    void apiFetch<PastPayload>(`/api/livestreams/history?page=${encodeURIComponent(String(pastPage))}`)
      .then((result) => {
        if (cancelled) return;
        setPastData(result);
      })
      .catch((error) => {
        if (cancelled) return;
        setPastData(null);
        setPastError(String((error as Error).message || error));
      })
      .finally(() => {
        if (!cancelled) {
          setPastLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [pastPage, viewMode]);

  if (upcomingReferenceNowMsRef.current === null && upcoming.length > 0) {
    upcomingReferenceNowMsRef.current = Date.now();
  }

  const hasStreams = live.length > 0 || upcoming.length > 0;
  const upcomingReferenceNowMs = upcomingReferenceNowMsRef.current ?? nowMs;
  const pastStreams = pastData?.streams?.map(normalizePastStream) || [];
  const weekLabel = pastData ? `${new Date(pastData.week_start).toLocaleDateString()} - ${new Date(pastData.week_end).toLocaleDateString()}` : "";
  const openModal = useCallback((nextItem: LivestreamModalItem) => {
    setSelectedItem(nextItem);
  }, []);

  useEffect(() => {
    if (!selectedItem || selectedItem.status === "ended") return;
    const next = [...live, ...upcoming].find((entry) => entry.id === selectedItem.id);
    if (next) setSelectedItem(next);
  }, [live, selectedItem, upcoming]);

  return (
    <>
    <section className={styles.section}>
      <div className={styles.header}>
        <div className={styles.headerSide}>
          <h1 className={styles.title}>Livestreams</h1>
          <p className={styles.copy}>{viewMode === "current" ? "Live now at the top, scheduled next below." : weekLabel || "Past week of completed streams."}</p>
        </div>
        <div className={styles.headerToggle}>
          <div className="segmentedControl" role="tablist" aria-label="Livestream mode">
            <button
              type="button"
              className={`segmentedButton${viewMode === "current" ? " active" : ""}`}
              onClick={() => setViewMode("current")}
            >
              Current
            </button>
            <button
              type="button"
              className={`segmentedButton${viewMode === "historical" ? " active" : ""}`}
              onClick={() => setViewMode("historical")}
            >
              Historical
            </button>
          </div>
        </div>
        <div className={styles.headerSide} />
      </div>

      {error ? <div className={styles.empty}>Livestream feed unavailable: {error}</div> : null}
      {isLoading && !hasStreams ? <div className={styles.empty}>Loading livestreams…</div> : null}

      {viewMode === "current" ? (
        <>
          {!isLoading && !error && !hasStreams ? <div className={styles.empty}>No live or upcoming streams in cache.</div> : null}

          <div className={styles.split}>
            <section className={styles.column}>
              <div className={styles.columnHeader}>
                <h2 className={styles.columnTitle}>Live Now</h2>
                <span className={styles.columnBadge}>{live.length}</span>
              </div>
              <div className={styles.list}>
                {live.length ? live.map((item) => renderStreamCard(item, "live", nowMs, jitterTick, upcomingReferenceNowMs, openModal)) : <div className={styles.columnEmpty}>No channels are live right now.</div>}
              </div>
            </section>

            <section className={styles.column}>
              <div className={styles.columnHeader}>
                <h2 className={styles.columnTitle}>Upcoming</h2>
                <span className={styles.columnBadge}>{upcoming.length}</span>
              </div>
              <div className={styles.list}>
                {upcoming.length ? upcoming.map((item) => renderStreamCard(item, "upcoming", nowMs, jitterTick, upcomingReferenceNowMs, openModal)) : <div className={styles.columnEmpty}>No upcoming streams in cache.</div>}
              </div>
            </section>
          </div>
        </>
      ) : (
        <section className={styles.column}>
          <div className={styles.historyToolbar}>
            <button
              type="button"
              className={styles.historyButton}
              onClick={() => setPastPage((value) => value + 1)}
              disabled={pastLoading || !pastData?.has_older}
            >
              Previous week
            </button>
            <div className={styles.historyLabel}>{weekLabel || "Loading week..."}</div>
            <button
              type="button"
              className={styles.historyButton}
              onClick={() => setPastPage((value) => Math.max(0, value - 1))}
              disabled={pastLoading || pastPage === 0}
            >
              Next week
            </button>
          </div>

          {pastError ? <div className={styles.empty}>Historical livestreams unavailable: {pastError}</div> : null}
          {pastLoading ? <div className={styles.empty}>Loading historical livestreams…</div> : null}
          {!pastLoading && !pastError && !pastStreams.length ? <div className={styles.empty}>No completed livestreams found for this week.</div> : null}

          {pastStreams.length ? (
            <>
              <div className={styles.list}>
                {pastStreams.map((item) => renderPastStreamCard(item, openModal))}
              </div>
              <div className={styles.historyToolbar}>
                <button
                  type="button"
                  className={styles.historyButton}
                  onClick={() => setPastPage((value) => value + 1)}
                  disabled={pastLoading || !pastData?.has_older}
                >
                  Previous week
                </button>
                <div className={styles.historyLabel}>{weekLabel || "Loading week..."}</div>
                <button
                  type="button"
                  className={styles.historyButton}
                  onClick={() => setPastPage((value) => Math.max(0, value - 1))}
                  disabled={pastLoading || pastPage === 0}
                >
                  Next week
                </button>
              </div>
            </>
          ) : null}
        </section>
      )}
    </section>
    <LivestreamModal open={Boolean(selectedItem)} item={selectedItem} onClose={() => setSelectedItem(null)} />
    </>
  );
}
