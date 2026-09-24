"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArtSlot } from "@/app/components/common/art-slot";
import { Oshimark } from "@/app/components/common/oshimark";
import { SiteShell } from "@/app/components/layout/site-shell";
import { ChartSection, TicksSection } from "@/app/components/stock/market-sections";
import { ChannelSection, StreamsSection, SuperchatSection } from "@/app/components/stock/channel-sections";
import { BoardSection, HoldersSection, NewsSection } from "@/app/components/stock/community-sections";
import { fmtBig, yen, type Rank } from "@/app/components/stock/format";
import { useChannelStreams, useSuperchats } from "@/app/components/stock/use-stock-data";
import { n2, TradeTicket } from "@/app/components/trade/trade-ticket";
import { markSeries, unitLabel } from "@/app/lib/market-units";
import { talentAccent } from "@/app/lib/talent-color";
import { money, signedPct, toneOf } from "@/app/lib/time";
import type { MarketAsset } from "@/app/lib/types";
import { useAuth } from "@/app/providers/auth-provider";
import { useTheme } from "@/app/providers/theme-provider";
import { useChannelStore } from "@/app/stores/channel-store";
import { useMarketStore } from "@/app/stores/market-store";
import { useProfileStore } from "@/app/stores/profile-store";
import { useOpenStream } from "@/app/stores/stream-store";
import { previewOf } from "@/app/lib/streams";
import { useTradeStore } from "@/app/stores/trade-store";
import styles from "@/app/components/stock/dossier.module.scss";

const SECTIONS = [
  ["s-chart", "Chart"],
  ["s-ticks", "Ticks"],
  ["s-channel", "Channel"],
  ["s-sc", "Superchats"],
  ["s-streams", "Streams"],
  ["s-holders", "Holders"],
  ["s-board", "Board"],
  ["s-news", "News"],
] as const;

function rankOf<T>(items: T[], value: (item: T) => number | null | undefined, target: T | undefined) {
  if (!target) return null;
  const mine = value(target);
  if (mine === null || mine === undefined || !Number.isFinite(mine)) return null;
  return 1 + items.filter((item) => (value(item) ?? -Infinity) > mine).length;
}

/** Which section is on screen, for the sticky section nav. */
function useScrollSpy(ids: readonly string[]) {
  const [active, setActive] = useState<string>(ids[0]);
  useEffect(() => {
    const els = ids.map((id) => document.getElementById(id)).filter((el): el is HTMLElement => el !== null);
    if (!els.length) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: "-140px 0px -55% 0px" },
    );
    els.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [ids]);
  return active;
}

export function Dossier({ symbol }: { symbol: string }) {
  const sym = symbol.trim().toUpperCase();
  const assets = useMarketStore((state) => state.assets);
  const loadingAssets = useMarketStore((state) => state.isLoadingOverview);
  const asset = useMemo(() => assets.find((entry) => entry.symbol.toUpperCase() === sym) ?? null, [assets, sym]);

  if (!asset) {
    return (
      <SiteShell>
        <div className={styles.page}>
          <Link href="/stocks" className={styles.back}>
            ← ALL STOCKS
          </Link>
          <p className={styles.missing}>{loadingAssets ? "Loading the dossier…" : `No stock called ${sym}. It may have been delisted, or the ticker is wrong.`}</p>
        </div>
      </SiteShell>
    );
  }
  return <DossierBody key={asset.symbol} asset={asset} />;
}

function DossierBody({ asset }: { asset: MarketAsset }) {
  const { theme } = useTheme();
  const { user } = useAuth();
  const assets = useMarketStore((state) => state.assets);
  const channels = useChannelStore((state) => state.channels);
  const fetchChannels = useChannelStore((state) => state.fetchChannels);
  const portfolio = useProfileStore((state) => state.portfolio);
  const pendingLiveOrders = useProfileStore((state) => state.pendingLiveOrders);
  const openTrade = useTradeStore((state) => state.openTrade);
  const openStream = useOpenStream();
  const [expanded, setExpanded] = useState(false);
  const active = useScrollSpy(useMemo(() => SECTIONS.map(([id]) => id), []));

  useEffect(() => {
    if (!channels.length) void fetchChannels();
  }, [channels.length, fetchChannels]);

  const sym = asset.symbol.toUpperCase();
  const accent = talentAccent(asset.color, theme);
  const channelId = asset.youtube_channel_id?.trim() || null;
  const streams = useChannelStreams(channelId);
  const superchats = useSuperchats(sym, Boolean(channelId));
  const live = streams.data?.live[0] ?? null;

  const channel = useMemo(() => channels.find((row) => row.channel.symbol?.toUpperCase() === sym || (channelId && row.channel.youtube_channel_id === channelId)) ?? null, [channelId, channels, sym]);
  const listed = useMemo(() => {
    const symbols = new Set(assets.map((entry) => entry.symbol.toUpperCase()));
    return channels.filter((row) => row.channel.symbol && symbols.has(row.channel.symbol.toUpperCase()));
  }, [assets, channels]);

  const holding = useMemo(() => portfolio?.holdings.find((item) => item.symbol.toUpperCase() === sym) ?? null, [portfolio, sym]);
  const pending = useMemo(() => pendingLiveOrders.filter((order) => order.symbol.toUpperCase() === sym), [pendingLiveOrders, sym]);

  const ranks = useMemo<Rank[]>(() => {
    const of = assets.length;
    const scRank = superchats.rank.data;
    return [
      { label: "Subscribers", rank: rankOf(listed, (row) => row.latest?.subscriber_count, channel ?? undefined), of: listed.length || of, value: fmtBig(channel?.latest?.subscriber_count) },
      { label: "Views", rank: rankOf(listed, (row) => row.latest?.view_count, channel ?? undefined), of: listed.length || of, value: fmtBig(channel?.latest?.view_count) },
      { label: "Superchats · 7d", rank: scRank?.rank ?? null, of, value: yen(scRank?.total_in_yen) },
      { label: "Price", rank: rankOf(assets, (entry) => entry.current_mid_price, asset), of, value: n2(asset.current_mid_price) },
      { label: "24h volume", rank: rankOf(assets, (entry) => entry.volume_24h, asset), of, value: `${(asset.volume_24h ?? 0).toLocaleString("en-US")} sh` },
      { label: "Videos", rank: rankOf(listed, (row) => row.latest?.video_count, channel ?? undefined), of: listed.length || of, value: fmtBig(channel?.latest?.video_count) },
    ];
  }, [asset, assets, channel, listed, superchats.rank.data]);

  const move = asset.move_24h_pct;
  const series = markSeries(asset);
  const d15 = series.length > 1 && asset.current_mid_price ? (asset.current_mid_price - series[0]) / series[0] : null;
  const total = (asset.circulating_supply ?? 0) + (asset.treasury_supply ?? 0);
  const float = total > 0 ? (asset.circulating_supply ?? 0) / total : null;
  const bio = channel?.channel.youtube_channel_description?.trim() ?? "";
  const bioShort = bio.split(/\n/)[0].slice(0, 160);
  const heroRanks = ranks.filter((rank) => rank.rank !== null && rank.rank <= 20).sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99)).slice(0, 4);

  const openLive = () =>
    live &&
    openStream(previewOf({ ...live, channel_id: live.channel_id ?? channelId }));

  return (
    <SiteShell>
      <div className={styles.page} style={{ "--tal": accent } as React.CSSProperties}>
        <Link href="/stocks" className={styles.back}>
          ← ALL STOCKS
        </Link>

        <header className={styles.hero}>
          <div className={styles.heroInfo}>
            <div className={styles.kicker}>
              <b>{sym}</b>
              <span>{unitLabel(asset.unit)}</span>
              {channelId ? (
                <a href={`https://www.youtube.com/channel/${encodeURIComponent(channelId)}`} target="_blank" rel="noreferrer">
                  YouTube ↗
                </a>
              ) : null}
              {live ? (
                <button type="button" className={styles.livePill} onClick={openLive}>
                  LIVE{live.viewer_count ? ` · ${fmtBig(live.viewer_count)}` : ""}
                </button>
              ) : null}
            </div>
            <h1 className={styles.name}>
              <Oshimark icon={asset.icon} symbol={sym} size={52} />
              <span>{asset.display_name}</span>
            </h1>
            {bioShort ? (
              <p className={styles.bio}>
                {expanded ? bio : bioShort}
                {bio.length > bioShort.length ? (
                  <button type="button" onClick={() => setExpanded(!expanded)}>
                    {expanded ? "less" : "more"}
                  </button>
                ) : null}
              </p>
            ) : null}
            <div className={styles.priceRow}>
              <span className={styles.bigPx}>
                <small>$</small>
                {n2(asset.current_mid_price)}
              </span>
              <span className={`${styles.chg} ${styles[toneOf(move)]}`}>
                {(move ?? 0) > 0 ? "▲" : (move ?? 0) < 0 ? "▼" : "■"} {signedPct(move)}
              </span>
            </div>
            <dl className={styles.quotes}>
              <div>
                <dt>Bid / ask</dt>
                <dd>
                  {n2(asset.current_bid_price)} / {n2(asset.current_ask_price)}
                </dd>
              </div>
              <div>
                <dt>09:00 open</dt>
                <dd>{n2(asset.previous_settlement_mid_price)}</dd>
              </div>
              <div>
                <dt>15 days</dt>
                <dd className={styles[toneOf(d15)]}>{signedPct(d15, 1)}</dd>
              </div>
              <div>
                <dt>24h vol</dt>
                <dd>{(asset.volume_24h ?? 0).toLocaleString("en-US")} sh</dd>
              </div>
              <div>
                <dt>Float</dt>
                <dd>{float !== null ? `${Math.round(float * 100)}%` : "—"}</dd>
              </div>
              <div>
                <dt>Oshi&apos;d by</dt>
                <dd>{asset.oshicoin_users ?? "—"}</dd>
              </div>
            </dl>
            {heroRanks.length ? (
              <div className={styles.ranks}>
                {heroRanks.map((rank) => (
                  <span key={rank.label} className={`${styles.rchip} ${rank.rank === 1 ? styles.top : ""}`}>
                    <b>#{rank.rank}</b> {rank.label.toLowerCase()}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
          <ArtSlot kind="keyart" symbol={sym} icon={asset.icon} accent={accent} width={640} priority className={styles.heroArt} />
        </header>

        <nav className={styles.snav} aria-label="Sections">
          {SECTIONS.map(([id, label]) => (
            <a key={id} href={`#${id}`} aria-current={active === id}>
              {label}
            </a>
          ))}
        </nav>

        <div className={styles.grid}>
          <div className={styles.main}>
            <ChartSection asset={asset} accent={accent} avgCost={holding && holding.quantity > 0 ? holding.avg_cost_basis : null} />
            <TicksSection asset={asset} />
            <ChannelSection asset={asset} ranks={ranks} streams={streams} />
            <SuperchatSection asset={asset} superchats={superchats} hasChannel={Boolean(channelId)} />
            <StreamsSection asset={asset} channelId={channelId} streams={streams} onOpen={openStream} />
            <HoldersSection asset={asset} />
            <BoardSection asset={asset} />
            <NewsSection asset={asset} />
          </div>

          <aside className={styles.side} aria-label="Order ticket">
            <div className={styles.sideSticky}>
              <div className={styles.ticket}>
                <div className={styles.ticketTop}>
                  <ArtSlot kind="chibi" pose="idle" symbol={sym} icon={asset.icon} accent={accent} width={72} className={styles.ticketChibi} />
                  <div>
                    <h2>Trade {sym}</h2>
                    <p>Market order, filled at the next 10-minute batch.</p>
                  </div>
                </div>
                <TradeTicket asset={asset} />
              </div>
              <div className={`${styles.position} ${user ? "" : styles.anon}`}>
                <h3>Your position</h3>
                {!user ? (
                  <p className={styles.none}>
                    <Link href="/login">Sign in</Link> to trade. New accounts start with $10,000.
                  </p>
                ) : holding && holding.quantity > 0 ? (
                  <>
                    <div className={styles.posBig}>
                      {holding.quantity.toLocaleString("en-US")} {sym}{" "}
                      <small className={styles[toneOf(holding.avg_cost_basis ? (asset.current_mid_price ?? 0) / holding.avg_cost_basis - 1 : null)]}>
                        {signedPct(holding.avg_cost_basis ? (asset.current_mid_price ?? 0) / holding.avg_cost_basis - 1 : null)}
                      </small>
                    </div>
                    <dl className={styles.kv}>
                      <dt>Value</dt>
                      <dd>{money(holding.market_value)}</dd>
                      <dt>Avg cost</dt>
                      <dd>{n2(holding.avg_cost_basis)}</dd>
                      <dt>Unrealized</dt>
                      <dd className={styles[toneOf(holding.unrealized_pnl)]}>
                        {holding.unrealized_pnl >= 0 ? "+" : "−"}
                        {money(Math.abs(holding.unrealized_pnl))}
                      </dd>
                      <dt>Share of your book</dt>
                      <dd>{portfolio && portfolio.total_market_value > 0 ? `${((holding.market_value / portfolio.total_market_value) * 100).toFixed(1)}%` : "—"}</dd>
                    </dl>
                  </>
                ) : (
                  <p className={styles.none}>You don&apos;t hold any {sym}.</p>
                )}
                {pending.length ? (
                  <div className={styles.pending}>
                    {pending.map((order) => (
                      <div key={order.id}>
                        <span className={order.side === "buy" ? styles.up : styles.down}>
                          {order.side.toUpperCase()} {order.requested_quantity}
                        </span>
                        <span>queued</span>
                      </div>
                    ))}
                    <Link href="/market/activity">Manage pending orders →</Link>
                  </div>
                ) : null}
              </div>
            </div>
          </aside>
        </div>
      </div>

      <div className={styles.mobileBar} role="group" aria-label={`Trade ${sym}`}>
        <span>
          <b>{n2(asset.current_mid_price)}</b>
          <small className={styles[toneOf(move)]}>{signedPct(move)}</small>
        </span>
        <button type="button" className={styles.mBuy} onClick={() => openTrade(sym, "buy")}>
          BUY
        </button>
        <button type="button" className={styles.mSell} onClick={() => openTrade(sym, "sell")} disabled={Boolean(user) && !(holding && holding.quantity > 0)}>
          SELL
        </button>
      </div>

    </SiteShell>
  );
}
