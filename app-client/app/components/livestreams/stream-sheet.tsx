"use client";

/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { Oshimark } from "@/app/components/common/oshimark";
import { Sparkline } from "@/app/components/common/sparkline";
import { apiFetch } from "@/app/lib/api";
import { markSeries, unitLabel } from "@/app/lib/market-units";
import { normalizeCandles, normalizeLivestreams } from "@/app/lib/normalizers";
import {
  assetForStream,
  CHAT_ROOM_LABEL,
  chatRoomKind,
  clockDuration,
  compactCount,
  localDateTime,
  localTime,
  median,
  normalizePastStream,
  num,
  previewOf,
  shortDuration,
  untilLabel,
  youtubeUrl,
  type PastStream,
  type PastStreamRow,
  type StreamPreview,
} from "@/app/lib/streams";
import { talentAccent } from "@/app/lib/talent-color";
import { signedPct, toneOf } from "@/app/lib/time";
import type { CandlePoint, LivestreamItem, MarketAsset } from "@/app/lib/types";
import { getBucketWsUrl } from "@/app/lib/ws";
import { useTheme } from "@/app/providers/theme-provider";
import { useLivestreamStore } from "@/app/stores/livestream-store";
import { useMarketStore } from "@/app/stores/market-store";
import { useOpenStream, useStreamStore } from "@/app/stores/stream-store";
import { useTradeStore } from "@/app/stores/trade-store";
import styles from "@/app/components/livestreams/stream-sheet.module.scss";

type Session = {
  video_id: string;
  youtube_channel_id: string;
  status: "upcoming" | "live" | "ended";
  video_title: string | null;
  thumbnail_url: string | null;
  scheduled_start_at: string | null;
  actual_start_at: string | null;
  ended_at: string | null;
  total_views: number | string | null;
  avg_concurrent_viewers: number | string | null;
  max_concurrent_viewers: number | string | null;
  max_concurrent_viewers_at?: string | null;
  duration_seconds: number | string | null;
  channel_name: string;
  channel_icon: string | null;
  channel_color: string | null;
  /** Filled the day after a stream, once the superchat archive is scraped. */
  superchats?: { total_in_yen: number; donation_count: number } | null;
};

type Bucket = { bucket_start: string; bucket_end: string; avg_viewers: number | null; max_viewers: number | null };

function toBucket(raw: Record<string, unknown>): Bucket {
  return { bucket_start: String(raw.bucket_start), bucket_end: String(raw.bucket_end), avg_viewers: num(raw.avg_viewers), max_viewers: num(raw.max_viewers) };
}

function mergeBuckets(current: Bucket[], incoming: Bucket[]) {
  const byStart = new Map(current.map((bucket) => [bucket.bucket_start, bucket]));
  for (const bucket of incoming) byStart.set(bucket.bucket_start, { ...byStart.get(bucket.bucket_start), ...bucket });
  return [...byStart.values()].sort((a, b) => a.bucket_start.localeCompare(b.bucket_start));
}

/** Mounted once in the shell. Shows the sheet whenever the URL has `?stream=`. */
export function StreamSheetHost() {
  return (
    <Suspense fallback={null}>
      <Host />
    </Suspense>
  );
}

function Host() {
  const id = useSearchParams().get("stream");
  return id ? <StreamSheet key={id} id={id} /> : null;
}

function StreamSheet({ id }: { id: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const { theme } = useTheme();
  const preview = useStreamStore((state) => state.previews[id]);
  const pushed = useStreamStore((state) => state.pushed);
  const setPushed = useStreamStore((state) => state.setPushed);
  const openStream = useOpenStream();
  const openTrade = useTradeStore((state) => state.openTrade);
  const assets = useMarketStore((state) => state.assets);
  const liveList = useLivestreamStore((state) => state.live);
  const upcomingList = useLivestreamStore((state) => state.upcoming);
  const fetchLivestreams = useLivestreamStore((state) => state.fetchLivestreams);
  const listed = useMemo(() => [...liveList, ...upcomingList].find((item) => item.id === id) ?? null, [id, liveList, upcomingList]);

  const [session, setSession] = useState<Session | null>(null);
  const [buckets, setBuckets] = useState<Bucket[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const returnFocus = useRef<HTMLElement | null>(null);
  const closeBtn = useRef<HTMLButtonElement | null>(null);

  const close = useCallback(() => {
    if (pushed) {
      setPushed(false);
      router.back();
    } else {
      const params = new URLSearchParams(window.location.search);
      params.delete("stream");
      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    }
    returnFocus.current?.focus?.();
  }, [pathname, pushed, router, setPushed]);

  useEffect(() => {
    returnFocus.current = document.activeElement as HTMLElement | null;
    closeBtn.current?.focus();
    // The live list keeps viewer counts current; pages outside /livestreams may not have loaded it.
    if (!useLivestreamStore.getState().live.length) void fetchLivestreams();
  }, [fetchLivestreams]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // The trade drawer sits on top and handles its own Escape first.
      if (event.key === "Escape" && !useTradeStore.getState().symbol) close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [close]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      apiFetch<{ session: Session | null }>(`/api/livestreams/${encodeURIComponent(id)}`),
      apiFetch<{ buckets: Array<Record<string, unknown>> }>(`/api/livestreams/${encodeURIComponent(id)}/buckets`),
    ]).then(
      ([sessionResult, bucketResult]) => {
        if (cancelled) return;
        setSession(sessionResult.session);
        setBuckets((bucketResult.buckets ?? []).map(toBucket));
        setLoaded(true);
      },
      (reason) => {
        if (cancelled) return;
        setError(String((reason as Error).message || reason));
        setLoaded(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [id]);

  const status = (listed?.status as Session["status"] | undefined) ?? session?.status ?? (preview?.status as Session["status"] | undefined) ?? "ended";
  const isLive = status === "live";

  useEffect(() => {
    if (status === "ended") return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [status]);

  // Five-minute viewer buckets stream in while the broadcast is on.
  useEffect(() => {
    if (!isLive) return;
    const url = getBucketWsUrl();
    if (!url) return;
    let closed = false;
    let retry: number | null = null;
    let socket: WebSocket | null = null;
    const connect = () => {
      if (closed) return;
      socket = new WebSocket(url);
      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(String(event.data)) as Record<string, unknown>;
          if (message.video_id !== id || !message.bucket_start) return;
          setBuckets((current) => mergeBuckets(current, [toBucket(message)]));
        } catch {
          /* not ours */
        }
      };
      socket.onclose = () => {
        if (!closed) retry = window.setTimeout(connect, 5000);
      };
      socket.onerror = () => socket?.close();
    };
    connect();
    return () => {
      closed = true;
      if (retry !== null) window.clearTimeout(retry);
      socket?.close();
    };
  }, [id, isLive]);

  const channelId = session?.youtube_channel_id ?? listed?.channel_id ?? preview?.channel_id ?? null;
  const creator = session?.channel_name ?? listed?.creator ?? preview?.creator ?? "";
  const asset = useMemo(() => assetForStream(assets, channelId, creator), [assets, channelId, creator]);
  const accent = talentAccent(asset?.color ?? session?.channel_color ?? preview?.channel_color, theme);
  const title = (session?.video_title ?? listed?.title ?? preview?.title ?? "").trim() || "Livestream";
  const thumb = session?.thumbnail_url ?? listed?.thumbnail_url ?? preview?.thumbnail_url ?? `https://i.ytimg.com/vi/${encodeURIComponent(id)}/hqdefault.jpg`;
  const scheduled = session?.scheduled_start_at ?? (status === "upcoming" ? listed?.started_at ?? preview?.started_at ?? null : null);
  const actual = session?.actual_start_at ?? (status !== "upcoming" ? preview?.actual_start_time ?? listed?.started_at ?? preview?.started_at ?? null : null);
  const ended = session?.ended_at ?? preview?.ended_at ?? null;
  const lateMins = actual && scheduled ? Math.round((Date.parse(actual) - Date.parse(scheduled)) / 60_000) : null;
  const roomKind = status === "upcoming" ? chatRoomKind({ title: session?.video_title ?? listed?.title ?? preview?.title ?? "", started_at: scheduled }, now) : null;
  const channel = useChannelStreams(channelId);
  // Their typical peak over the last two weeks, for "1.8× usual".
  const usualPeak = useMemo(() => {
    const peaks = (channel?.past ?? []).filter((stream) => stream.id !== id).map((stream) => stream.max_viewers ?? NaN);
    return peaks.filter(Number.isFinite).length >= 2 ? median(peaks) : null;
  }, [channel, id]);
  const liveRank = isLive ? liveList.findIndex((item) => item.id === id) : -1;
  const superchats = session?.superchats ?? null;
  const watching = isLive ? listed?.viewer_count ?? preview?.viewer_count ?? null : null;
  const bucketPeak = buckets.reduce((max, bucket) => Math.max(max, bucket.max_viewers ?? 0), 0);
  const peak = Math.max(num(session?.max_concurrent_viewers) ?? 0, bucketPeak, watching ?? 0) || null;
  const avgs = buckets.map((bucket) => bucket.avg_viewers).filter((value): value is number => value !== null);
  const average = num(session?.avg_concurrent_viewers) ?? (avgs.length ? avgs.reduce((sum, value) => sum + value, 0) / avgs.length : null);
  const duration = status === "ended" ? num(session?.duration_seconds) ?? (actual && ended ? (Date.parse(ended) - Date.parse(actual)) / 1000 : null) : actual ? (now - Date.parse(actual)) / 1000 : null;

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked */
    }
  };

  return (
    <>
      <div className={styles.scrim} onClick={close} aria-hidden="true" />
      <aside className={styles.sheet} role="dialog" aria-modal="true" aria-labelledby="stream-title" style={{ "--tal": accent } as React.CSSProperties}>
        <header className={styles.top}>
          <StatusPill status={status} roomKind={roomKind} watching={watching} scheduled={scheduled} ended={ended} now={now} />
          <button type="button" className={styles.linkBtn} onClick={() => void copyLink()}>
            {copied ? "LINK COPIED" : "COPY LINK"}
          </button>
          <button type="button" className={styles.close} onClick={close} aria-label="Close" ref={closeBtn}>
            ✕
          </button>
        </header>

        <div className={styles.player}>
          {playing ? (
            <iframe
              src={`https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?autoplay=1&rel=0`}
              title={title}
              allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
              allowFullScreen
            />
          ) : (
            <button type="button" className={styles.poster} onClick={() => setPlaying(true)} aria-label={`Play ${title} here`}>
              <img src={thumb} alt="" />
              <span className={styles.play}>
                <i aria-hidden="true">▶</i>
                {roomKind ? "OPEN THE CHAT ROOM" : status === "upcoming" ? "OPEN THE WAITING ROOM" : isLive ? "WATCH HERE" : "WATCH THE VOD"}
              </span>
            </button>
          )}
        </div>

        <div className={styles.head}>
          <h2 id="stream-title">{title}</h2>
          <div className={styles.who}>
            {asset ? <Oshimark icon={asset.icon} symbol={asset.symbol} size={22} /> : null}
            <b>{creator || "Unknown channel"}</b>
            {asset?.unit ? <span>{unitLabel(asset.unit)}</span> : null}
            <a href={youtubeUrl(id)} target="_blank" rel="noreferrer noopener">
              YouTube ↗
            </a>
          </div>
        </div>

        {asset ? <StockStrip asset={asset} onTrade={() => openTrade(asset.symbol, "buy")} onNavigate={close} /> : null}

        <section className={styles.stats}>
          {status === "upcoming" ? (
            <>
              {roomKind ? <Stat label="Slot" value={CHAT_ROOM_LABEL[roomKind]} small /> : <Stat label="Starts" value={untilLabel(scheduled, now)} />}
              <Stat label="Scheduled" value={localDateTime(scheduled)} small />
              {usualPeak ? <Stat label="Usual peak" value={compactCount(usualPeak)} sub="median, last 2 weeks" /> : null}
            </>
          ) : (
            <>
              {isLive ? (
                <Stat label="Watching now" value={compactCount(watching)} sub={liveRank >= 0 ? `#${liveRank + 1} of ${liveList.length} live` : undefined} live />
              ) : (
                <Stat label="Views" value={compactCount(num(session?.total_views))} />
              )}
              <Stat
                label="Peak"
                value={compactCount(peak)}
                sub={[session?.max_concurrent_viewers_at ? `at ${localTime(session.max_concurrent_viewers_at)}` : null, peak && usualPeak ? `${(peak / usualPeak).toFixed(1)}× usual` : null].filter(Boolean).join(" · ") || undefined}
              />
              <Stat label="Average" value={compactCount(average)} />
              <Stat label={isLive ? "On air" : "Length"} value={isLive ? clockDuration(duration) : shortDuration(duration)} />
              {superchats && superchats.total_in_yen ? <Stat label="Superchats" value={`¥${compactCount(superchats.total_in_yen)}`} sub={`${superchats.donation_count.toLocaleString("en-US")} donations`} /> : null}
            </>
          )}
        </section>
        {status !== "upcoming" && actual ? (
          <p className={styles.when}>
            {isLive ? "Went live" : "Streamed"} {localDateTime(actual)}
            {status === "ended" && ended ? ` – ${localTime(ended)}` : ""}
            {lateMins !== null && lateMins >= 2 ? ` · started ${lateMins}m late` : ""}
          </p>
        ) : null}

        {status === "upcoming" ? (
          <p className={styles.note}>
            {roomKind === "free-chat"
              ? "This looks like a free-chat room: a slot kept open for the community chat. These usually never go live."
              : roomKind === "never-started"
                ? "This slot is well past its start time and never went live. It's most likely being kept open for the chat."
                : roomKind === "placeholder"
                  ? "This slot is scheduled far enough out that it's probably a placeholder rather than a real start time."
                  : "Viewer counts and the price overlay start once the stream goes live."}
          </p>
        ) : (
          <StreamChart buckets={buckets} asset={asset} start={actual} end={status === "ended" ? ended : null} live={isLive} now={Math.floor(now / 30_000) * 30_000} loading={!loaded} error={error} />
        )}

        {channelId && channel ? <MoreFrom data={channel} channelId={channelId} currentId={id} creator={creator} onOpen={openStream} /> : null}

        <footer className={styles.foot}>
          <span>Esc to close</span>
          {asset ? (
            <Link href={`/chat?channel=${encodeURIComponent(`asset:${asset.id}`)}`} onClick={close}>
              Talk about it in #{asset.symbol.toLowerCase()} →
            </Link>
          ) : null}
        </footer>
      </aside>
    </>
  );
}

function StatusPill({ status, roomKind, watching, scheduled, ended, now }: { status: string; roomKind: ReturnType<typeof chatRoomKind>; watching: number | null; scheduled: string | null; ended: string | null; now: number }) {
  if (roomKind) return <span className={styles.pill}>{CHAT_ROOM_LABEL[roomKind].toUpperCase()} ROOM</span>;
  if (status === "live")
    return (
      <span className={`${styles.pill} ${styles.pillLive}`}>
        <i aria-hidden="true" />
        LIVE{watching !== null ? ` · ${compactCount(watching)} watching` : ""}
      </span>
    );
  if (status === "upcoming") return <span className={`${styles.pill} ${styles.pillUp}`}>UPCOMING · {untilLabel(scheduled, now).toUpperCase()}</span>;
  return <span className={styles.pill}>ENDED{ended ? ` · ${localDateTime(ended).toUpperCase()}` : ""}</span>;
}

function Stat({ label, value, sub, live, small }: { label: string; value: string; sub?: string; live?: boolean; small?: boolean }) {
  return (
    <div className={`${styles.stat} ${live ? styles.statLive : ""}`}>
      <span>{label}</span>
      <b className={small ? styles.statSmall : undefined}>{value}</b>
      {sub ? <small>{sub}</small> : null}
    </div>
  );
}

function StockStrip({ asset, onTrade, onNavigate }: { asset: MarketAsset; onTrade: () => void; onNavigate: () => void }) {
  return (
    <section className={styles.stock}>
      <Link href={`/stocks/${encodeURIComponent(asset.symbol)}`} className={styles.stockId} onClick={onNavigate} data-peek-stock={asset.symbol}>
        <b>{asset.symbol}</b>
        <span>{asset.current_mid_price?.toFixed(2) ?? "—"}</span>
        <span className={styles[toneOf(asset.move_24h_pct)]}>{signedPct(asset.move_24h_pct)} today</span>
      </Link>
      <Sparkline values={markSeries(asset)} tone={toneOf(asset.move_24h_pct) === "down" ? "down" : "up"} width={120} height={28} className={styles.stockSpark} />
      <button type="button" className={styles.trade} onClick={onTrade}>
        TRADE {asset.symbol}
      </button>
    </section>
  );
}

// ── Viewers × price chart ────────────────────────────────────────────────
type PricePoint = { t: number; v: number; vol?: number };

function useStreamCandles(symbol: string | null, start: string | null, live: boolean) {
  const [points, setPoints] = useState<PricePoint[] | null>(null);
  const [openedAt] = useState(() => Date.now());
  const startMs = start ? Date.parse(start) : NaN;
  const age = openedAt - startMs;
  const spec = !Number.isFinite(startMs) ? null : age < 22 * 3600_000 ? "interval=5m&range=24h" : age < 6.5 * 86_400_000 ? "interval=1h&range=7d" : null;
  useEffect(() => {
    if (!symbol || !spec) return;
    let cancelled = false;
    const load = () =>
      apiFetch<{ candles?: Array<Record<string, unknown>> }>(`/api/market/assets/${encodeURIComponent(symbol)}/candles?${spec}`, { cache: "no-store" }).then(
        (raw) => {
          if (cancelled) return;
          const candles: CandlePoint[] = normalizeCandles(raw.candles ?? []);
          setPoints(candles.filter((candle) => candle.close !== null).map((candle) => ({ t: Date.parse(candle.bucket), v: candle.close as number, vol: candle.volume_shares ?? 0 })));
        },
        () => {
          if (!cancelled) setPoints([]);
        },
      );
    void load();
    const timer = live ? window.setInterval(load, 60_000) : null;
    return () => {
      cancelled = true;
      if (timer !== null) window.clearInterval(timer);
    };
  }, [live, spec, symbol]);
  return { points, tooOld: Boolean(symbol && Number.isFinite(startMs) && !spec) };
}

function StreamChart({ buckets, asset, start, end, live, now, loading, error }: { buckets: Bucket[]; asset: MarketAsset | null; start: string | null; end: string | null; live: boolean; now: number; loading: boolean; error: string | null }) {
  const box = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<number | null>(null);
  const prices = useStreamCandles(asset?.symbol ?? null, start, live);
  const livePrice = asset?.current_mid_price ?? null;
  const pricePoints = prices.points;

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const model = useMemo(() => {
    const startMs = start ? Date.parse(start) : buckets[0] ? Date.parse(buckets[0].bucket_start) : NaN;
    const endMs = end ? Date.parse(end) : buckets.length ? Math.max(Date.parse(buckets.at(-1)!.bucket_end), live ? now : 0) : now;
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs || width < 40) return null;
    const lead = Math.min(30 * 60_000, (endMs - startMs) * 0.12);
    const t0 = startMs - lead;
    const t1 = endMs;
    const W = width;
    const padR = 52;
    const plotW = W - padR;
    const vTop = 8;
    const vBottom = 128;
    const pTop = 150;
    const pBottom = 206;
    const x = (t: number) => ((t - t0) / (t1 - t0)) * plotW;

    const views = buckets
      .map((bucket) => ({ t: (Date.parse(bucket.bucket_start) + Date.parse(bucket.bucket_end)) / 2, avg: bucket.avg_viewers, max: bucket.max_viewers }))
      .filter((point) => point.t >= t0 && point.t <= t1 + 5 * 60_000);
    const vMax = Math.max(1, ...views.map((point) => Math.max(point.avg ?? 0, point.max ?? 0))) * 1.08;
    const vy = (value: number) => vBottom - (value / vMax) * (vBottom - vTop);
    const avgLine = views.filter((point) => point.avg !== null).map((point) => `${x(point.t).toFixed(1)},${vy(point.avg!).toFixed(1)}`);
    const maxLine = views.filter((point) => point.max !== null).map((point) => `${x(point.t).toFixed(1)},${vy(point.max!).toFixed(1)}`);

    let price = (pricePoints ?? []).filter((point) => point.t >= t0 - 60 * 60_000 && point.t <= t1);
    if (live && livePrice) price = [...price, { t: Math.min(now, t1), v: livePrice }];
    const inWindow = price.filter((point) => point.t >= t0);
    const before = price.filter((point) => point.t <= startMs).at(-1) ?? inWindow[0];
    const last = inWindow.at(-1);
    const traded = inWindow.filter((point) => point.t >= startMs).reduce((sum, point) => sum + (point.vol ?? 0), 0);
    const change = before && last ? last.v / before.v - 1 : null;
    const pMin = Math.min(...inWindow.map((point) => point.v));
    const pMax = Math.max(...inWindow.map((point) => point.v));
    const pad = (pMax - pMin || pMax * 0.02 || 1) * 0.15;
    const py = (value: number) => pBottom - ((value - (pMin - pad)) / (pMax - pMin + pad * 2)) * (pBottom - pTop);
    const priceLine = inWindow.length > 1 ? inWindow.map((point) => `${x(point.t).toFixed(1)},${py(point.v).toFixed(1)}`) : [];

    const ticks: number[] = [];
    const span = t1 - t0;
    const step = span > 10 * 3600_000 ? 3 * 3600_000 : span > 4 * 3600_000 ? 3600_000 : span > 90 * 60_000 ? 30 * 60_000 : 15 * 60_000;
    for (let t = Math.ceil(t0 / step) * step; t <= t1; t += step) ticks.push(t);

    return { W, plotW, x, vy, py, t0, t1, startMs, views, vMax, avgLine, maxLine, inWindow, priceLine, change, before, last, traded, pMin, pMax, ticks, vBottom, pTop, pBottom };
  }, [buckets, end, live, livePrice, now, pricePoints, start, width]);

  const onMove = (event: PointerEvent<SVGSVGElement>) => {
    if (!model) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const t = model.t0 + ((event.clientX - rect.left) / model.plotW) * (model.t1 - model.t0);
    setHover(Math.max(model.t0, Math.min(model.t1, t)));
  };

  const nearest = <T extends { t: number }>(list: T[], t: number) => list.reduce<T | null>((best, point) => (!best || Math.abs(point.t - t) < Math.abs(best.t - t) ? point : best), null);
  const hv = model && hover !== null ? nearest(model.views, hover) : null;
  const hp = model && hover !== null ? nearest(model.inWindow, hover) : null;

  return (
    <section className={styles.chartSec}>
      <div className={styles.chartHead}>
        <h3>Viewers{asset ? ` × ${asset.symbol}` : ""}</h3>
        <span className={styles.legend}>
          <i className={styles.lgAvg} /> avg
          <i className={styles.lgMax} /> peak
          {asset ? (
            <>
              <i className={styles.lgPx} /> price
            </>
          ) : null}
        </span>
      </div>
      {model?.change !== null && model?.change !== undefined && asset ? (
        <p className={styles.chartLede}>
          {asset.symbol} {live ? "since the stream started" : "over the stream"}: <b className={styles[toneOf(model.change)]}>{signedPct(model.change)}</b>
          <span>
            {model.before?.v.toFixed(2)} → {model.last?.v.toFixed(2)}
            {model.traded ? ` · ${model.traded.toLocaleString("en-US")} sh traded` : ""}
          </span>
        </p>
      ) : null}
      <div className={styles.chartBox} ref={box}>
        {error ? (
          <p className={styles.note}>Viewer history is unavailable ({error}).</p>
        ) : loading ? (
          <div className={styles.chartSkeleton} />
        ) : !model || model.views.length === 0 ? (
          <p className={styles.note}>{live ? "The first five-minute viewer count lands shortly after going live." : "No viewer history was recorded for this stream."}</p>
        ) : (
          <svg width={model.W} height={228} onPointerMove={onMove} onPointerLeave={() => setHover(null)} role="img" aria-label="Viewers over the stream with the stock price below">
            {[0.5, 1].map((f) => (
              <g key={f}>
                <line x1={0} x2={model.plotW} y1={model.vy(model.vMax * f / 1.08)} y2={model.vy(model.vMax * f / 1.08)} className={styles.grid} />
                <text x={model.W - 4} y={model.vy(model.vMax * f / 1.08) + 3} className={styles.axis} textAnchor="end">
                  {compactCount((model.vMax * f) / 1.08)}
                </text>
              </g>
            ))}
            {model.avgLine.length > 1 ? <polygon points={`${model.avgLine[0].split(",")[0]},${model.vBottom} ${model.avgLine.join(" ")} ${model.avgLine.at(-1)!.split(",")[0]},${model.vBottom}`} className={styles.vArea} /> : null}
            {model.maxLine.length > 1 ? <polyline points={model.maxLine.join(" ")} className={styles.vMax} /> : null}
            {model.avgLine.length > 1 ? <polyline points={model.avgLine.join(" ")} className={styles.vAvg} /> : null}
            <line x1={0} x2={model.plotW} y1={model.vBottom} y2={model.vBottom} className={styles.base} />

            {model.priceLine.length > 1 ? (
              <>
                <polyline points={model.priceLine.join(" ")} className={`${styles.pLine} ${styles[toneOf(model.change)]}`} />
                <text x={model.W - 4} y={model.py(model.pMax) + 3} className={styles.axis} textAnchor="end">
                  {model.pMax.toFixed(2)}
                </text>
                <text x={model.W - 4} y={model.py(model.pMin) + 3} className={styles.axis} textAnchor="end">
                  {model.pMin.toFixed(2)}
                </text>
              </>
            ) : asset ? (
              <text x={4} y={model.pTop + 26} className={styles.axis}>
                {prices.tooOld ? "Price detail isn't kept this far back." : prices.points === null ? "Loading price…" : "No trades in this window."}
              </text>
            ) : null}

            <line x1={model.x(model.startMs)} x2={model.x(model.startMs)} y1={0} y2={model.pBottom} className={styles.startLine} />
            <text x={model.x(model.startMs) + 4} y={12} className={styles.startLbl}>
              {live ? "WENT LIVE" : "START"}
            </text>

            {model.ticks.map((t) => (
              <text key={t} x={model.x(t)} y={224} className={styles.axis} textAnchor="middle">
                {new Date(t).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
              </text>
            ))}

            {hover !== null ? (
              <g className={styles.cross}>
                <line x1={model.x(hover)} x2={model.x(hover)} y1={0} y2={model.pBottom} />
                {hv?.avg !== null && hv?.avg !== undefined ? <circle cx={model.x(hv.t)} cy={model.vy(hv.avg)} r={3} /> : null}
                {hp ? <circle cx={model.x(hp.t)} cy={model.py(hp.v)} r={3} /> : null}
              </g>
            ) : null}
          </svg>
        )}
        {model && hover !== null && (hv || hp) ? (
          <div className={styles.tip} style={{ left: Math.min(Math.max(model.x(hover), 70), model.plotW - 70) }}>
            <b>{new Date(hover).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</b>
            {hv ? (
              <span>
                {compactCount(hv.avg)} avg · {compactCount(hv.max)} peak
              </span>
            ) : null}
            {hp && asset ? (
              <span>
                {asset.symbol} {hp.v.toFixed(2)}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}

// ── More from this channel ───────────────────────────────────────────────
type ChannelStreams = { live: LivestreamItem[]; upcoming: LivestreamItem[]; past: PastStream[] };

/** The channel's current slots plus its last two weeks of finished streams. */
function useChannelStreams(channelId: string | null) {
  const [data, setData] = useState<{ key: string; value: ChannelStreams } | null>(null);
  useEffect(() => {
    if (!channelId) return;
    let cancelled = false;
    const enc = encodeURIComponent(channelId);
    Promise.allSettled([
      apiFetch<{ live?: Array<Record<string, unknown>>; upcoming?: Array<Record<string, unknown>> }>(`/api/livestreams/channel/${enc}`),
      apiFetch<{ streams?: PastStreamRow[] }>(`/api/livestreams/history?page=0&channel=${enc}`),
      apiFetch<{ streams?: PastStreamRow[] }>(`/api/livestreams/history?page=1&channel=${enc}`),
    ]).then(([current, week0, week1]) => {
      if (cancelled) return;
      const past = [week0, week1].flatMap((week) => (week.status === "fulfilled" ? (week.value.streams ?? []).map(normalizePastStream) : []));
      setData({
        key: channelId,
        value: {
          live: current.status === "fulfilled" ? normalizeLivestreams(current.value.live ?? []) : [],
          upcoming: current.status === "fulfilled" ? normalizeLivestreams(current.value.upcoming ?? []) : [],
          past,
        },
      });
    });
    return () => {
      cancelled = true;
    };
  }, [channelId]);
  return data && data.key === channelId ? data.value : null;
}

function MoreFrom({ data, channelId, currentId, creator, onOpen }: { data: ChannelStreams; channelId: string; currentId: string; creator: string; onOpen: (item: StreamPreview) => void }) {
  const rows: Array<{ preview: StreamPreview; tag: string; meta: string; live: boolean }> = [];
  for (const item of data.live) rows.push({ preview: previewOf({ ...item, channel_id: item.channel_id ?? channelId }), tag: "LIVE", meta: `${compactCount(item.viewer_count)} watching`, live: true });
  for (const item of data.upcoming) rows.push({ preview: previewOf({ ...item, status: "upcoming", channel_id: item.channel_id ?? channelId }), tag: "NEXT", meta: localDateTime(item.started_at), live: false });
  for (const stream of data.past) rows.push({ preview: previewOf(stream), tag: stream.started_at ? new Date(stream.started_at).toLocaleDateString("en-US", { month: "short", day: "numeric" }).toUpperCase() : "PAST", meta: `${compactCount(stream.max_viewers)} peak · ${shortDuration(stream.duration_seconds)}`, live: false });
  const shown = rows.filter((row) => row.preview.id !== currentId).slice(0, 6);
  if (!shown.length) return null;
  return (
    <section className={styles.more}>
      <h3>More from {creator}</h3>
      {shown.map((row) => (
        <button key={row.preview.id} type="button" onClick={() => onOpen(row.preview)}>
          <span className={row.live ? styles.tagLive : styles.tag}>{row.tag}</span>
          <b>{row.preview.title}</b>
          <small>{row.meta}</small>
        </button>
      ))}
    </section>
  );
}
