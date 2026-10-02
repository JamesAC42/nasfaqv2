"use client";

import Link from "next/link";
import { useMemo, useState, type CSSProperties } from "react";
import { ArtSlot } from "@/app/components/common/art-slot";
import { Oshimark } from "@/app/components/common/oshimark";
import { TalentCard } from "@/app/components/games/cards/talent-card";
import { RARITIES, RARITY_COLOR, RARITY_NAME } from "@/app/lib/games/rarity";
import { formatCountdown, formatEtTime, getMarketClock, TICKS } from "@/app/lib/market-clock";
import { talentAccent } from "@/app/lib/talent-color";
import { money, signedPct, toneOf } from "@/app/lib/time";
import type { MarketAsset } from "@/app/lib/types";
import { useNow } from "@/app/lib/use-now";
import { useTheme } from "@/app/providers/theme-provider";
import { useMarketStore } from "@/app/stores/market-store";
import { TRADE_FEE } from "@/app/components/how-to-play/content";
import styles from "@/app/components/how-to-play/demos.module.scss";

// ── Data helpers ───────────────────────────────────────────────────────────

/** Listed talents, busiest first. Empty until the market store loads. */
export function useBusiestTalents(limit = 8) {
  const assets = useMarketStore((state) => state.assets);
  return useMemo(
    () =>
      assets
        .filter((asset) => (asset.current_mid_price ?? 0) > 0)
        .sort((a, b) => (b.volume_24h ?? 0) - (a.volume_24h ?? 0) || a.symbol.localeCompare(b.symbol))
        .slice(0, limit),
    [assets, limit],
  );
}

/** Today's biggest gainer and loser, for the up/down chibis. */
export function useMovers() {
  const assets = useMarketStore((state) => state.assets);
  return useMemo(() => {
    const moved = assets.filter((asset) => Number.isFinite(asset.move_24h_pct ?? Number.NaN));
    if (!moved.length) return { up: null, down: null };
    const sorted = [...moved].sort((a, b) => (b.move_24h_pct ?? 0) - (a.move_24h_pct ?? 0));
    const up = sorted[0];
    const down = sorted[sorted.length - 1];
    return { up: (up.move_24h_pct ?? 0) > 0 ? up : null, down: (down.move_24h_pct ?? 0) < 0 && down !== up ? down : null };
  }, [assets]);
}

function useAccent(color: string | null | undefined) {
  const { theme } = useTheme();
  return talentAccent(color, theme);
}

// ── Talent chibi with a price tag ──────────────────────────────────────────

/** `framed`: the chibi in a frame washed with their colour, like the fill popup's (the hero pair). */
export function ChibiTag({
  asset,
  pose,
  width = 160,
  caption,
  framed = false,
}: {
  asset: MarketAsset;
  pose: "hype" | "cope" | "moon" | "shock" | "smug" | "idle";
  width?: number;
  caption?: string;
  framed?: boolean;
}) {
  const accent = useAccent(asset.color);
  const move = asset.move_24h_pct;
  return (
    <Link href={`/stocks/${encodeURIComponent(asset.symbol)}`} className={`${styles.chibi} ${framed ? styles.framed : ""}`} style={{ "--tal": accent } as CSSProperties} prefetch={false}>
      {framed ? (
        <span className={styles.chibiFrame}>
          <ArtSlot kind="chibi" pose={pose} symbol={asset.symbol} icon={asset.icon} accent={accent} width={width} vignette fadeLength={0.3} className={styles.chibiArt} />
        </span>
      ) : (
        <ArtSlot kind="chibi" pose={pose} symbol={asset.symbol} icon={asset.icon} accent={accent} width={width} className={styles.chibiArt} />
      )}
      <span className={styles.chibiTag}>
        <Oshimark icon={asset.icon} symbol={asset.symbol} size={14} />
        <b>{asset.symbol}</b>
        <span className={styles[toneOf(move)]}>{signedPct(move)}</span>
      </span>
      {caption ? <small className={styles.chibiCaption}>{caption}</small> : null}
    </Link>
  );
}

// ── Market: a live strip of real talents ──────────────────────────────────

export function TalentStrip() {
  const talents = useBusiestTalents(8);
  if (!talents.length) {
    return (
      <div className={styles.strip} aria-busy="true">
        {Array.from({ length: 8 }, (_, index) => (
          <span key={index} className={styles.stripSkeleton} />
        ))}
      </div>
    );
  }
  return (
    <div className={styles.strip}>
      {talents.map((asset) => (
        <StripItem key={asset.symbol} asset={asset} />
      ))}
    </div>
  );
}

function StripItem({ asset }: { asset: MarketAsset }) {
  const accent = useAccent(asset.color);
  return (
    <Link href={`/stocks/${encodeURIComponent(asset.symbol)}`} className={styles.stripItem} style={{ "--tal": accent } as CSSProperties} prefetch={false} data-peek-stock={asset.symbol}>
      <Oshimark icon={asset.icon} symbol={asset.symbol} size={22} />
      <span className={styles.stripText}>
        <b>{asset.symbol}</b>
        <small>{asset.display_name}</small>
      </span>
      <span className={styles.stripNums}>
        <b>{asset.current_mid_price?.toFixed(2) ?? "—"}</b>
        <small className={styles[toneOf(asset.move_24h_pct)]}>{signedPct(asset.move_24h_pct)}</small>
      </span>
    </Link>
  );
}

// ── Trading: example ticket (sends nothing) ────────────────────────────────

const PRESETS = [1, 10, 25, 50, 100];

export function TicketDemo() {
  const talents = useBusiestTalents(4);
  const [picked, setPicked] = useState<string | null>(null);
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [qty, setQty] = useState(25);
  const now = useNow();
  const asset = talents.find((entry) => entry.symbol === picked) ?? talents[0] ?? null;
  const accent = useAccent(asset?.color);

  const mid = asset?.current_mid_price ?? 12.5;
  const price = side === "buy" ? asset?.current_ask_price ?? mid : asset?.current_bid_price ?? mid;
  const gross = price * qty;
  const fee = gross * TRADE_FEE;
  const total = side === "buy" ? gross + fee : gross - fee;
  const clock = now ? getMarketClock(now) : null;
  const symbol = asset?.symbol ?? "PEK";

  return (
    <div className={styles.ticket} style={{ "--tal": accent } as CSSProperties}>
      <div className={styles.ticketHead}>
        <span className={styles.demoTag}>Example ticket</span>
        {talents.length > 1 ? (
          <div className={styles.pickRow} role="group" aria-label="Talent">
            {talents.map((entry) => (
              <button key={entry.symbol} type="button" aria-pressed={entry.symbol === symbol} onClick={() => setPicked(entry.symbol)}>
                <Oshimark icon={entry.icon} symbol={entry.symbol} size={14} />
                {entry.symbol}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div className={styles.ticketBody}>
        <div className={styles.seg} role="group" aria-label="Side">
          <button type="button" data-side="buy" aria-pressed={side === "buy"} onClick={() => setSide("buy")}>
            BUY
          </button>
          <button type="button" data-side="sell" aria-pressed={side === "sell"} onClick={() => setSide("sell")}>
            SELL
          </button>
        </div>
        <label className={styles.qty}>
          <span>Shares</span>
          <input inputMode="numeric" value={qty} onChange={(event) => setQty(Math.min(180, Math.max(0, Number(event.target.value.replace(/[^\d]/g, "")) || 0)))} aria-label="Shares" />
        </label>
        <div className={styles.presets}>
          {PRESETS.map((value) => (
            <button key={value} type="button" aria-pressed={qty === value} onClick={() => setQty(value)}>
              {value}
            </button>
          ))}
        </div>
        <dl className={styles.est}>
          <dt>{side === "buy" ? "Ask" : "Bid"}</dt>
          <dd>{price.toFixed(2)}</dd>
          <dt>Fee 1%</dt>
          <dd>{money(fee)}</dd>
          <dt className={styles.total}>{side === "buy" ? "You pay" : "You get"}</dt>
          <dd className={styles.total}>{money(total)}</dd>
        </dl>
        <p className={styles.batch} suppressHydrationWarning>
          {clock ? (
            <>
              Joins the <b>{formatEtTime(clock.nextBatchAt)} ET</b>{" "}batch · <span className={styles.count}>{formatCountdown(clock.secondsToNextBatch, { withHours: false })}</span>
            </>
          ) : (
            <>Joins the next 10-minute batch</>
          )}
        </p>
        <Link href={`/stocks/${encodeURIComponent(symbol)}`} className={`${styles.submit} ${side === "sell" ? styles.sell : ""}`} prefetch={false}>
          {side.toUpperCase()} {qty} {symbol} for real →
        </Link>
      </div>
      <p className={styles.demoNote}>Live prices. This one sends nothing.</p>
    </div>
  );
}

// ── Ticks: the day's four ticks on the real clock ─────────────────────────

const DAY = 86_400;
let localFormat: Intl.DateTimeFormat | null = null;

/** Each tick's next occurrence in the viewer's own time zone. */
function localTickTimes(now: number, et: { hour: number; minute: number; second: number }) {
  localFormat ??= new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
  const dayPosition = (et.hour * 3600 + et.minute * 60 + et.second - 9 * 3600 + DAY) % DAY;
  return TICKS.map((_, index) => {
    const until = (index * 6 * 3600 - dayPosition + DAY) % DAY;
    return localFormat!.format(new Date(now + until * 1000));
  });
}

export function TickTimeline() {
  const now = useNow();
  const clock = now ? getMarketClock(now) : null;
  const localTimes = now && clock ? localTickTimes(now, clock.et) : null;
  const progress = clock ? clock.dayProgress : 0;
  const waiting = clock ? clock.nextTickIndex === 0 : false;

  return (
    <div className={styles.timeline}>
      <div className={styles.timelineHead}>
        <span className={styles.demoTag}>
          <i className={styles.liveDot} aria-hidden="true" />
          Today on the market clock
        </span>
        <span className={styles.timelineNow} suppressHydrationWarning>
          {clock ? (
            <>
              {String(clock.et.hour).padStart(2, "0")}:{String(clock.et.minute).padStart(2, "0")} ET · next <b>{clock.nextTick.label}</b>{" "}in{" "}
              <span className={styles.count} role="timer" aria-live="off">
                {formatCountdown(clock.secondsToNextTick)}
              </span>
            </>
          ) : (
            "--:-- ET"
          )}
        </span>
      </div>
      <div className={styles.track} style={{ "--p": String(progress) } as CSSProperties}>
        <span className={styles.trackRail} aria-hidden="true" />
        <span className={styles.trackFill} aria-hidden="true" />
        <ol className={styles.stops}>
          {TICKS.map((tick, index) => {
            const isNext = clock ? clock.nextTickIndex === index : false;
            const landed = clock ? (waiting ? index > 0 : index < clock.nextTickIndex) : false;
            const state = isNext ? "next" : landed ? "landed" : "later";
            return (
              <li key={tick.key} className={styles.stop} data-state={state} aria-current={isNext ? "time" : undefined}>
                <span className={styles.stopDot} aria-hidden="true" />
                <b>{tick.label}</b>
                <span className={styles.stopEt}>{String(tick.hour).padStart(2, "0")}:00 ET</span>
                <small suppressHydrationWarning>{localTimes ? `${localTimes[index]} yours` : " "}</small>
                <em>{isNext ? "Next" : landed ? "Landed" : "Later"}</em>
              </li>
            );
          })}
        </ol>
      </div>
      {waiting && clock ? <p className={styles.timelineNote}>Overnight has landed. Settlement and the Open tick start the next market day at 09:00 ET.</p> : null}
    </div>
  );
}

/** A tiny drawing of one tick: the price steps toward the dashed fair-value line. */
export function PullDiagram({ direction }: { direction: "up" | "down" }) {
  const up = direction === "up";
  const fairY = up ? 16 : 44;
  const start = up ? 50 : 10;
  const after = up ? 26 : 34;
  return (
    <svg className={styles.pull} viewBox="0 0 160 60" aria-hidden="true" data-tone={up ? "up" : "down"}>
      <line x1="0" x2="160" y1={fairY} y2={fairY} className={styles.pullFair} />
      <polyline points={`0,${start} 30,${start + (up ? -3 : 2)} 60,${start + (up ? 2 : -2)} 88,${start}`} className={styles.pullBefore} />
      <polyline points={`88,${start} 92,${after} 160,${after + (up ? 2 : -2)}`} className={styles.pullAfter} />
      <line x1="88" x2="88" y1="0" y2="60" className={styles.pullTick} />
    </svg>
  );
}

// ── Games: one talent at every rarity ─────────────────────────────────────

const BASE_POWER = { C: 10, R: 14, SR: 19, SSR: 25, UR: 32 } as const;
const DROP = { C: "55%", R: "30%", SR: "11%", SSR: "3.5%", UR: "0.5%" } as const;

export function RarityFan() {
  const talents = useBusiestTalents(1);
  const asset = talents[0] ?? null;
  return (
    <div className={styles.fan}>
      <div className={styles.fanCards}>
        {RARITIES.map((rarity, index) => (
          <div key={rarity} className={styles.fanCard} style={{ "--i": index, "--d": Math.abs(index - 2) } as CSSProperties}>
            {asset ? (
              <TalentCard
                card={{ symbol: asset.symbol, name: asset.display_name, rarity, unit: asset.unit, icon: asset.icon, color: asset.color, stars: 1, power: BASE_POWER[rarity] }}
                width={150}
                compact
                tilt={false}
              />
            ) : (
              <span className={styles.fanSkeleton} />
            )}
          </div>
        ))}
      </div>
      <ul className={styles.rates}>
        {RARITIES.map((rarity) => (
          <li key={rarity} style={{ "--r": RARITY_COLOR[rarity] } as CSSProperties}>
            <b>{rarity}</b>
            <span>{RARITY_NAME[rarity]}</span>
            <em>{DROP[rarity]}</em>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Predictions: price = chance, on the real market-maker math ────────────

const SPENDS = [10, 50, 200];
const B = 400; // auto tick-direction markets (PREDICTIONS_DESIGN §2)
const PRED_FEE = 0.01;

/** Binary LMSR buy by cash (fee included), with the 99¢ rail. Mirrors api/src/services/predictions/trading.js priceBuy. */
function quoteBuy(price: number, spend: number) {
  const curveBudget = spend / (1 + PRED_FEE);
  let shares = B * Math.log(1 + Math.expm1(curveBudget / B) / price);
  const cap = B * Math.log((0.99 * (1 - price)) / (0.01 * price));
  if (shares > cap) shares = Math.max(0, cap);
  const curve = B * Math.log(price * Math.exp(shares / B) + (1 - price));
  const after = (price * Math.exp(shares / B)) / (price * Math.exp(shares / B) + 1 - price);
  return { shares, cost: curve * (1 + PRED_FEE), avg: shares > 0 ? curve / shares : price, after };
}

export function ChanceDemo() {
  const now = useNow();
  const talents = useBusiestTalents(1);
  const symbol = talents[0]?.symbol ?? "PEK";
  const nextTick = now ? getMarketClock(now).nextTick.label : "Late";
  const [yes, setYes] = useState(62);
  const [side, setSide] = useState<"yes" | "no">("yes");
  const [spend, setSpend] = useState(50);

  const price = (side === "yes" ? yes : 100 - yes) / 100;
  const quote = quoteBuy(price, spend);
  const profit = quote.shares - quote.cost;
  const afterYes = side === "yes" ? quote.after : 1 - quote.after;

  return (
    <div className={styles.chance}>
      <div className={styles.chanceHead}>
        <span className={styles.demoTag}>Try it</span>
        <p className={styles.chanceQ}>
          {symbol} up on the {nextTick} tick?
        </p>
      </div>

      <div className={styles.chanceBig} aria-live="polite">
        <span className={styles.cents}>
          {yes}
          <small>¢</small>
        </span>
        <span className={styles.equals}>=</span>
        <span className={styles.pct}>
          {yes}% <small>chance of YES</small>
        </span>
      </div>

      <label className={styles.slider}>
        <span className={styles.sr}>YES price in cents</span>
        <input type="range" min={3} max={97} value={yes} onChange={(event) => setYes(Number(event.target.value))} style={{ "--v": `${((yes - 3) / 94) * 100}%` } as CSSProperties} />
      </label>
      <div className={styles.sliderEnds} aria-hidden="true">
        <span>YES {yes}¢</span>
        <span>NO {100 - yes}¢</span>
      </div>

      <div className={styles.chanceTicket}>
        <div className={styles.yesNo} role="group" aria-label="Outcome">
          <button type="button" data-o="yes" aria-pressed={side === "yes"} onClick={() => setSide("yes")}>
            YES {yes}¢
          </button>
          <button type="button" data-o="no" aria-pressed={side === "no"} onClick={() => setSide("no")}>
            NO {100 - yes}¢
          </button>
        </div>
        <div className={styles.spends} role="group" aria-label="Spend">
          {SPENDS.map((value) => (
            <button key={value} type="button" aria-pressed={spend === value} onClick={() => setSpend(value)}>
              ${value}
            </button>
          ))}
        </div>
        <dl className={styles.est}>
          <dt>You get</dt>
          <dd>{quote.shares.toFixed(1)} shares</dd>
          <dt>Avg price</dt>
          <dd>{(quote.avg * 100).toFixed(1)}¢</dd>
          <dt>YES after</dt>
          <dd>{(afterYes * 100).toFixed(0)}¢</dd>
          <dt className={styles.total}>Pays if right</dt>
          <dd className={styles.total}>
            {money(quote.shares)} <small className={styles.up}>+{money(profit)}</small>
          </dd>
        </dl>
      </div>
      <p className={styles.demoNote}>Real market-maker math at an auto market&apos;s depth, 1% fee in. Your buy moves the price.</p>
    </div>
  );
}
