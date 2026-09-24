"use client";

/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Oshimark } from "@/app/components/common/oshimark";
import { PlayerAvatar } from "@/app/components/common/player-avatar";
import { Sparkline } from "@/app/components/common/sparkline";
import { PriceChart } from "@/app/components/stock/price-chart";
import { CHART_RANGES, useCandles, useChannelStreams, useTape, useTickHistory, type ChartRange } from "@/app/components/stock/use-stock-data";
import { TradeTicket } from "@/app/components/trade/trade-ticket";
import { formatCountdown, getMarketClock } from "@/app/lib/market-clock";
import { markSeries, unitName } from "@/app/lib/market-units";
import { talentAccent } from "@/app/lib/talent-color";
import { money, signedPct, timeAgo, toneOf } from "@/app/lib/time";
import type { MarketAsset, MarketHubTrade, MarketIndexBundle } from "@/app/lib/types";
import { useAuth } from "@/app/providers/auth-provider";
import { useTheme } from "@/app/providers/theme-provider";
import { useHubStore, useMarketHub } from "@/app/stores/hub-store";
import { useMarketStore } from "@/app/stores/market-store";
import { useProfileStore } from "@/app/stores/profile-store";
import styles from "@/app/components/chat/chat.module.scss";

export type RailRoom = { section: "global" | "unit" | "asset"; symbol: string | null; unit: string | null; label: string };
export type Voice = { id: number; username: string; color: string | null; picture: string | null; at: string; count: number };
export type Worth = { rank: number; total_equity: number };

const compact = (value: number) => (Math.abs(value) >= 1e6 ? `${(value / 1e6).toFixed(2)}M` : Math.abs(value) >= 1e4 ? `${(value / 1e3).toFixed(1)}k` : Math.round(value).toLocaleString("en-US"));

function useNow(ms: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(id);
  }, [ms]);
  return now;
}

/** Load the unit/market index bundles once if nothing else has. */
function useIndexes() {
  const indexes = useMarketStore((state) => state.marketIndexes);
  const fetchMarketIndexes = useMarketStore((state) => state.fetchMarketIndexes);
  useEffect(() => {
    if (!indexes.length) void fetchMarketIndexes({ silent: true });
  }, [fetchMarketIndexes, indexes.length]);
  return indexes;
}

function indexValues(bundle: MarketIndexBundle | undefined, days = 30) {
  return (bundle?.series ?? []).map((point) => point.value).filter((value): value is number => value !== null && Number.isFinite(value)).slice(-days);
}

/**
 * The room's side panel: what the room is about, live. A talent room gets its chart,
 * an order ticket and your position; the floor gets the whole market; a unit gets its
 * members. Docked at wide sizes, a drawer from the right below that.
 */
export function RoomRail({ room, voices, worth, open, onClose }: { room: RailRoom; voices: Voice[]; worth: Record<number, Worth>; open: boolean; onClose: () => void }) {
  const assets = useMarketStore((state) => state.assets);
  const asset = room.symbol ? assets.find((entry) => entry.symbol.toUpperCase() === room.symbol) : undefined;
  return (
    <aside className={`${styles.rail} ${room.section === "asset" ? styles.railWide : ""} ${open ? styles.railOpen : ""}`} aria-label="About this room">
      <div className={styles.railBar}>
        <b>{room.section === "asset" ? `${room.symbol} · chart & trade` : room.section === "unit" ? `${room.label} · stats` : "Market · stats"}</b>
        <button type="button" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>
      {asset ? <AssetPanel asset={asset} /> : room.section === "unit" ? <UnitPanel unit={room.unit} assets={assets} /> : <FloorPanel assets={assets} />}
      <Voices voices={voices} worth={worth} />
    </aside>
  );
}

// ── Talent room ──────────────────────────────────────────────────────────
function AssetPanel({ asset }: { asset: MarketAsset }) {
  const { user } = useAuth();
  const { theme } = useTheme();
  const portfolio = useProfileStore((state) => state.portfolio);
  const [range, setRange] = useState<ChartRange>("1d");
  const candles = useCandles(asset.symbol, range);
  const ticks = useTickHistory(asset.symbol);
  const tape = useTape(asset.symbol);
  const channelId = asset.youtube_channel_id?.trim() || null;
  const streams = useChannelStreams(channelId);
  const live = streams.data?.live[0] ?? null;
  const sym = asset.symbol.toUpperCase();
  const accent = talentAccent(asset.color, theme);
  const holding = portfolio?.holdings.find((item) => item.symbol.toUpperCase() === sym) ?? null;
  const data = candles.data ?? [];
  const first = data.find((candle) => candle.close !== null)?.close ?? null;
  const last = range === "1d" ? asset.current_mid_price : data.at(-1)?.close ?? null;
  const change = first && last ? (last - first) / first : null;
  const high = Math.max(...data.map((candle) => candle.high ?? -Infinity));
  const low = Math.min(...data.map((candle) => candle.low ?? Infinity));
  const cap = (asset.current_mid_price ?? 0) * (asset.circulating_supply ?? 0);
  const spread = asset.current_ask_price && asset.current_bid_price ? asset.current_ask_price - asset.current_bid_price : null;
  const queued = (asset.pending_live_buy_quantity ?? 0) + (asset.pending_live_sell_quantity ?? 0);

  return (
    <>
      <section className={styles.railSec}>
        <div className={styles.pxHead}>
          <div>
            <b>{asset.current_mid_price?.toFixed(2) ?? "—"}</b>
            <span className={styles[toneOf(asset.move_24h_pct)]}>{signedPct(asset.move_24h_pct)} today</span>
          </div>
          <div className={styles.rangeSeg} role="tablist" aria-label="Chart range">
            {CHART_RANGES.slice(0, 4).map((entry) => (
              <button key={entry.value} type="button" role="tab" aria-selected={range === entry.value} onClick={() => setRange(entry.value)}>
                {entry.label}
              </button>
            ))}
          </div>
        </div>
        <div className={candles.loading && !data.length ? styles.chartLoading : undefined}>
          <PriceChart
            candles={data}
            range={range}
            overlays={{ mark: false, ticks: true, volume: true, mine: true }}
            ticks={ticks.data ?? []}
            latestMark={markSeries(asset).at(-1) ?? null}
            avgCost={holding && holding.quantity > 0 ? holding.avg_cost_basis : null}
            livePrice={asset.current_mid_price}
            accent={accent}
            height={190}
          />
        </div>
        <dl className={styles.statGrid}>
          <div>
            <dt>{CHART_RANGES.find((entry) => entry.value === range)?.label}</dt>
            <dd className={styles[toneOf(change)]}>{signedPct(change, 1)}</dd>
          </div>
          <div>
            <dt>High</dt>
            <dd>{Number.isFinite(high) ? high.toFixed(2) : "—"}</dd>
          </div>
          <div>
            <dt>Low</dt>
            <dd>{Number.isFinite(low) ? low.toFixed(2) : "—"}</dd>
          </div>
          <div>
            <dt>Bid / ask</dt>
            <dd>
              {asset.current_bid_price?.toFixed(2) ?? "—"}/{asset.current_ask_price?.toFixed(2) ?? "—"}
            </dd>
          </div>
          <div>
            <dt>Vol 24h</dt>
            <dd>{compact(asset.volume_24h ?? 0)} sh</dd>
          </div>
          <div>
            <dt>Mkt cap</dt>
            <dd>${compact(cap)}</dd>
          </div>
        </dl>
        {spread !== null || queued ? (
          <p className={styles.railNote}>
            {queued ? `${queued.toLocaleString("en-US")} shares queued for the next batch (${asset.pending_live_buy_quantity ?? 0} buy / ${asset.pending_live_sell_quantity ?? 0} sell). ` : "No orders queued for the next batch. "}
            <Link href={`/stocks/${encodeURIComponent(sym)}`}>Full dossier →</Link>
          </p>
        ) : null}
      </section>

      {live ? (
        <section className={styles.railSec}>
          <a className={`${styles.liveCard} ${live.thumbnail_url ? "" : styles.liveNoThumb}`} href={live.url || `https://www.youtube.com/watch?v=${encodeURIComponent(live.id)}`} target="_blank" rel="noreferrer noopener">
            {live.thumbnail_url ? <img src={live.thumbnail_url} alt="" /> : null}
            <span>
              <i>LIVE{live.viewer_count ? ` · ${compact(live.viewer_count)} watching` : ""}</i>
              <b>{live.title}</b>
            </span>
          </a>
        </section>
      ) : null}

      <section className={`${styles.railSec} ${styles.ticketSec}`}>
        <h2>Trade {sym}</h2>
        <TradeTicket asset={asset} />
      </section>

      {user ? (
        <section className={styles.railSec}>
          <h2>Your position</h2>
          {holding && holding.quantity > 0 ? (
            <dl className={styles.kv}>
              <dt>Shares</dt>
              <dd>{holding.quantity.toLocaleString("en-US")}</dd>
              <dt>Avg cost</dt>
              <dd>{holding.avg_cost_basis.toFixed(2)}</dd>
              <dt>Value</dt>
              <dd>{money(holding.market_value)}</dd>
              <dt>Unrealized</dt>
              <dd className={styles[toneOf(holding.unrealized_pnl)]}>
                {holding.unrealized_pnl >= 0 ? "+" : "−"}
                {money(Math.abs(holding.unrealized_pnl))}
              </dd>
            </dl>
          ) : (
            <p className={styles.dim}>You don&apos;t hold any {sym}.</p>
          )}
        </section>
      ) : null}

      <section className={styles.railSec}>
        <h2>Recent fills</h2>
        {tape.data?.length ? (
          <div className={styles.fills}>
            {tape.data.slice(0, 8).map((trade) => (
              <div key={trade.id}>
                <span className={trade.side === "buy" ? styles.up : styles.down}>{trade.side === "buy" ? "BUY" : "SELL"}</span>
                <b>{trade.quantity.toLocaleString("en-US")}</b>
                <span>@ {trade.price.toFixed(2)}</span>
                <time suppressHydrationWarning>{timeAgo(trade.ts).replace(" ago", "")}</time>
              </div>
            ))}
          </div>
        ) : (
          <p className={styles.dim}>{tape.loading ? "Loading…" : "No fills yet today."}</p>
        )}
      </section>
    </>
  );
}

// ── Global room ──────────────────────────────────────────────────────────
function FloorPanel({ assets }: { assets: MarketAsset[] }) {
  useMarketHub();
  const hub = useHubStore((state) => state.hub);
  const trades = useHubStore((state) => state.trades);
  const liveOrders = useHubStore((state) => state.liveOrders);
  const marketStatus = useMarketStore((state) => state.marketStatus);
  const indexes = useIndexes();
  const all = indexes.find((bundle) => bundle.group === "all");
  const series = indexValues(all);
  const breadth = useMemo(() => {
    const moves = assets.map((asset) => asset.move_24h_pct ?? 0);
    return { up: moves.filter((move) => move > 0.00005).length, down: moves.filter((move) => move < -0.00005).length, total: moves.length };
  }, [assets]);
  const movers = useMemo(() => [...assets].sort((a, b) => (b.move_24h_pct ?? 0) - (a.move_24h_pct ?? 0)), [assets]);
  const windows = hub?.activity.windows;

  return (
    <>
      <MarketClock open={marketStatus?.is_trading_open ?? true} buyQty={liveOrders?.pending_buy_quantity ?? 0} sellQty={liveOrders?.pending_sell_quantity ?? 0} orders={liveOrders?.pending_count ?? 0} />

      <section className={styles.railSec}>
        <h2>All-market index</h2>
        <IndexBlock value={all?.summary?.index_value ?? null} dayReturn={all?.summary?.day_return_pct ?? null} series={series} />
        <Breadth up={all?.summary?.advancers ?? breadth.up} down={all?.summary?.decliners ?? breadth.down} total={breadth.total} />
      </section>

      {windows ? (
        <section className={styles.railSec}>
          <h2>Floor activity</h2>
          <table className={styles.actTable}>
            <thead>
              <tr>
                <th />
                <th>5m</th>
                <th>1h</th>
                <th>24h</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th>Trades</th>
                <td>{windows["5m"].trade_count}</td>
                <td>{windows["1h"].trade_count}</td>
                <td>{compact(windows["24h"].trade_count)}</td>
              </tr>
              <tr>
                <th>Traders</th>
                <td>{windows["5m"].trader_count}</td>
                <td>{windows["1h"].trader_count}</td>
                <td>{compact(windows["24h"].trader_count)}</td>
              </tr>
              <tr>
                <th>Volume</th>
                <td>${compact(windows["5m"].volume_cash)}</td>
                <td>${compact(windows["1h"].volume_cash)}</td>
                <td>${compact(windows["24h"].volume_cash)}</td>
              </tr>
            </tbody>
          </table>
        </section>
      ) : null}

      <section className={styles.railSec}>
        <h2>Movers today</h2>
        <div className={styles.moverCols}>
          <div>{movers.slice(0, 4).map((asset) => <MoverRow key={asset.symbol} asset={asset} />)}</div>
          <div>{movers.slice(-4).reverse().map((asset) => <MoverRow key={asset.symbol} asset={asset} />)}</div>
        </div>
      </section>

      <TapeSection trades={trades.slice(0, 8)} title="Latest fills" />

      {hub?.activity.most_active_traders_24h.length ? (
        <section className={styles.railSec}>
          <h2>Busiest traders · 24h</h2>
          {hub.activity.most_active_traders_24h.slice(0, 5).map((trader, index) => (
            <Link key={trader.user_id} href={`/profile/${encodeURIComponent(trader.username)}`} className={styles.voice}>
              <PlayerAvatar username={trader.username} pictureUrl={trader.profile_picture_url} color={trader.profile_color} size={20} />
              <b style={trader.profile_color ? { color: trader.profile_color } : undefined}>
                <small className={styles.pos}>{index + 1}</small> {trader.username}
              </b>
              <small>{trader.trade_count} trades</small>
            </Link>
          ))}
        </section>
      ) : null}
    </>
  );
}

// ── Unit room ────────────────────────────────────────────────────────────
function UnitPanel({ unit, assets }: { unit: string | null; assets: MarketAsset[] }) {
  useMarketHub();
  const trades = useHubStore((state) => state.trades);
  const liveOrders = useHubStore((state) => state.liveOrders);
  const indexes = useIndexes();
  const name = unitName(unit);
  const members = useMemo(() => assets.filter((asset) => asset.unit && unitName(asset.unit) === name).sort((a, b) => (b.move_24h_pct ?? 0) - (a.move_24h_pct ?? 0)), [assets, name]);
  const symbols = useMemo(() => new Set(members.map((asset) => asset.symbol.toUpperCase())), [members]);
  const bundle = indexes.find((entry) => unitName(entry.group) === name);
  const series = indexValues(bundle);
  const allSeries = indexValues(indexes.find((entry) => entry.group === "all"));
  const avgMove = members.length ? members.reduce((sum, asset) => sum + (asset.move_24h_pct ?? 0), 0) / members.length : null;
  const cap = members.reduce((sum, asset) => sum + (asset.current_mid_price ?? 0) * (asset.circulating_supply ?? 0), 0);
  const volume = members.reduce((sum, asset) => sum + (asset.volume_24h ?? 0) * (asset.current_mid_price ?? 0), 0);
  const queued = (liveOrders?.assets ?? []).filter((row) => symbols.has(row.symbol.toUpperCase()));
  const queuedBuy = queued.reduce((sum, row) => sum + row.pending_buy_quantity, 0);
  const queuedSell = queued.reduce((sum, row) => sum + row.pending_sell_quantity, 0);
  const vsMarket = series.length > 1 && allSeries.length > 1 ? series.at(-1)! / series[0] - allSeries.at(-1)! / allSeries[0] : null;

  return (
    <>
      <section className={styles.railSec}>
        <h2>{name} index</h2>
        <IndexBlock value={bundle?.summary?.index_value ?? null} dayReturn={bundle?.summary?.day_return_pct ?? avgMove} series={series} />
        <Breadth up={members.filter((asset) => (asset.move_24h_pct ?? 0) > 0.00005).length} down={members.filter((asset) => (asset.move_24h_pct ?? 0) < -0.00005).length} total={members.length} />
        <dl className={styles.statGrid}>
          <div>
            <dt>Mkt cap</dt>
            <dd>${compact(cap)}</dd>
          </div>
          <div>
            <dt>Vol 24h</dt>
            <dd>${compact(volume)}</dd>
          </div>
          {vsMarket !== null ? (
            <div>
              <dt>30d vs mkt</dt>
              <dd className={styles[toneOf(vsMarket)]}>{signedPct(vsMarket, 1)}</dd>
            </div>
          ) : null}
        </dl>
        <p className={styles.railNote}>
          {queuedBuy + queuedSell ? `${(queuedBuy + queuedSell).toLocaleString("en-US")} shares queued across the unit (${queuedBuy} buy / ${queuedSell} sell).` : "Nothing queued for the next batch."}{" "}
          <Link href={`/market/indexes?index=${encodeURIComponent(name)}`}>Index page →</Link>
        </p>
      </section>

      <section className={styles.railSec}>
        <h2>Members · {members.length}</h2>
        <div className={styles.members}>
          {members.map((asset) => (
            <Link key={asset.symbol} href={`/chat?channel=${encodeURIComponent(`asset:${asset.id}`)}`} className={styles.member} data-peek-stock={asset.symbol} title={`${asset.display_name} chat`}>
              <Oshimark icon={asset.icon} symbol={asset.symbol} size={18} />
              <b>{asset.symbol}</b>
              <Sparkline values={markSeries(asset)} tone={toneOf(asset.move_24h_pct) === "down" ? "down" : "up"} width={44} height={16} />
              <span>{asset.current_mid_price?.toFixed(2) ?? "—"}</span>
              <span className={styles[toneOf(asset.move_24h_pct)]}>{signedPct(asset.move_24h_pct, 1)}</span>
            </Link>
          ))}
        </div>
      </section>

      <TapeSection trades={trades.filter((trade) => symbols.has(trade.symbol.toUpperCase())).slice(0, 8)} title="Latest fills in the unit" />
    </>
  );
}

// ── Shared pieces ────────────────────────────────────────────────────────
function MarketClock({ open, buyQty, sellQty, orders }: { open: boolean; buyQty: number; sellQty: number; orders: number }) {
  const now = useNow(1000);
  const clock = getMarketClock(now);
  const total = buyQty + sellQty;
  return (
    <section className={styles.railSec}>
      <div className={styles.clockHead}>
        <h2>Market clock</h2>
        <span className={`${styles.live} ${open ? styles.open : styles.closed}`}>{open ? "TRADING" : "CLOSED"}</span>
      </div>
      <div className={styles.clock}>
        <div>
          <small>Next batch</small>
          <b suppressHydrationWarning>{formatCountdown(clock.secondsToNextBatch, { withHours: false })}</b>
        </div>
        <div>
          <small>{clock.nextTick.label} tick in</small>
          <b suppressHydrationWarning>{formatCountdown(clock.secondsToNextTick)}</b>
        </div>
      </div>
      <div className={styles.flow} aria-label={`${buyQty} shares to buy, ${sellQty} to sell`}>
        <i className={styles.flowBuy} style={{ flexGrow: total ? buyQty : 1 }} />
        <i className={styles.flowSell} style={{ flexGrow: total ? sellQty : 1 }} />
      </div>
      <p className={styles.railNote}>
        {orders ? (
          <>
            <b>{orders}</b> orders queued · <span className={styles.up}>{buyQty.toLocaleString("en-US")} buy</span> / <span className={styles.down}>{sellQty.toLocaleString("en-US")} sell</span> shares
          </>
        ) : (
          "No orders queued for the next batch yet."
        )}
      </p>
    </section>
  );
}

function IndexBlock({ value, dayReturn, series }: { value: number | null; dayReturn: number | null; series: number[] }) {
  const month = series.length > 1 ? series.at(-1)! / series[0] - 1 : null;
  return (
    <div className={styles.indexBlock}>
      <div className={styles.indexTop}>
        {value !== null ? (
          <>
            <b>{value.toFixed(1)}</b>
            <span className={styles[toneOf(dayReturn)]}>{signedPct(dayReturn)} today</span>
          </>
        ) : (
          <>
            <b className={styles[toneOf(dayReturn)]}>{signedPct(dayReturn)}</b>
            <span>avg move today</span>
          </>
        )}
        {month !== null ? (
          <small>
            30d <span className={styles[toneOf(month)]}>{signedPct(month, 1)}</span>
          </small>
        ) : null}
      </div>
      {series.length > 1 ? (
        <div className={styles.indexSpark}>
          <Sparkline values={series} tone={toneOf(month) === "down" ? "down" : "up"} width={300} height={44} fill />
        </div>
      ) : null}
    </div>
  );
}

function Breadth({ up, down, total }: { up: number; down: number; total: number }) {
  const flat = Math.max(0, total - up - down);
  return (
    <div className={styles.breadth}>
      <div className={styles.flow}>
        <i className={styles.flowBuy} style={{ flexGrow: up }} />
        <i className={styles.flowFlat} style={{ flexGrow: flat }} />
        <i className={styles.flowSell} style={{ flexGrow: down }} />
      </div>
      <p>
        <span className={styles.up}>{up} up</span> · {flat} flat · <span className={styles.down}>{down} down</span>
      </p>
    </div>
  );
}

function MoverRow({ asset }: { asset: MarketAsset }) {
  return (
    <Link href={`/chat?channel=${encodeURIComponent(`asset:${asset.id}`)}`} className={styles.moverMini} data-peek-stock={asset.symbol} title={`${asset.display_name} chat`}>
      <Oshimark icon={asset.icon} symbol={asset.symbol} size={16} />
      <b>{asset.symbol}</b>
      <span className={styles[toneOf(asset.move_24h_pct)]}>{signedPct(asset.move_24h_pct, 1)}</span>
    </Link>
  );
}

function TapeSection({ trades, title }: { trades: MarketHubTrade[]; title: string }) {
  return (
    <section className={styles.railSec}>
      <h2>{title}</h2>
      {trades.length ? (
        <div className={styles.fills}>
          {trades.map((trade) => (
            <div key={trade.id} className={styles.fillWide}>
              <Oshimark icon={trade.icon} symbol={trade.symbol} size={14} />
              <span className={trade.side === "buy" ? styles.up : styles.down}>{trade.side === "buy" ? "BUY" : "SELL"}</span>
              <b>
                {trade.quantity.toLocaleString("en-US")} {trade.symbol}
              </b>
              <span className={styles.fillWho} style={trade.profile_color ? { color: trade.profile_color } : undefined}>
                {trade.username ?? "anon"}
              </span>
              <time suppressHydrationWarning>{timeAgo(trade.ts).replace(" ago", "")}</time>
            </div>
          ))}
        </div>
      ) : (
        <p className={styles.dim}>No fills yet.</p>
      )}
    </section>
  );
}

function Voices({ voices, worth }: { voices: Voice[]; worth: Record<number, Worth> }) {
  return (
    <section className={styles.railSec}>
      <h2>Talking here</h2>
      {voices.length ? (
        voices.map((voice) => {
          const rank = worth[voice.id];
          return (
            <Link key={voice.id} href={`/profile/${encodeURIComponent(voice.username)}`} className={styles.voice}>
              <PlayerAvatar username={voice.username} pictureUrl={voice.picture} color={voice.color} size={20} />
              <b style={voice.color ? { color: voice.color } : undefined}>{voice.username}</b>
              <small>{rank?.rank ? `#${rank.rank.toLocaleString("en-US")}` : ""}</small>
            </Link>
          );
        })
      ) : (
        <p className={styles.dim}>Nobody yet.</p>
      )}
    </section>
  );
}
