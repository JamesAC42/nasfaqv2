"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { Oshimark } from "@/app/components/common/oshimark";
import { Tile, TileMeld, type RowMeld } from "@/app/components/games/mahjong/tile";
import { fetchMahjongRules } from "@/app/lib/games/mahjong/api";
import { type TileId } from "@/app/lib/games/mahjong/tiles";
import type { HighlightHand, LimitName, MahjongRules, Meld, RankKey } from "@/app/lib/games/mahjong/types";
import { yakuName, scoreText } from "@/app/lib/games/mahjong/yaku";
import { talentAccent } from "@/app/lib/talent-color";
import { useMarketStore } from "@/app/stores/market-store";
import styles from "@/app/components/games/mahjong/records/records.module.scss";

// ── Rules: rank names and when a rank shows ─────────────────────────────────
const FALLBACK = (key: string) => key.split("-").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
let rulesRequest: Promise<MahjongRules | null> | null = null;

/** The rules (the API owns rank names and the games needed for a rank); null until they arrive. */
export function useMahjongRules() {
  const [rules, setRules] = useState<MahjongRules | null>(null);
  useEffect(() => {
    let cancelled = false;
    rulesRequest ??= fetchMahjongRules()
      .then((response) => response.rules)
      .catch(() => {
        rulesRequest = null;
        return null;
      });
    void rulesRequest.then((found) => !cancelled && setRules(found));
    return () => {
      cancelled = true;
    };
  }, []);
  const rankName = (key: RankKey | string) => (key === "unranked" ? "Unranked" : (rules?.ranks.find((rank) => rank.key === key)?.name ?? FALLBACK(key)));
  return { rules, rankName, rankedAfter: rules?.ranked_after_games ?? 3 };
}

// ── Small formatters ────────────────────────────────────────────────────────
export const rate = (part: number, whole: number) => (whole > 0 ? `${((part / whole) * 100).toFixed(1)}%` : "n/a");
export const signedPoints = (value: number) => `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value).toLocaleString("en-US")}`;
export const seasonLabel = (season: string) => {
  const [year, month] = season.split("-").map(Number);
  return Number.isFinite(year) && Number.isFinite(month) ? new Date(year, month - 1, 1).toLocaleString("en-US", { month: "long", year: "numeric" }) : season;
};
export const shortDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "");
export const ordinal = (n: number) => ["", "1st", "2nd", "3rd", "4th"][n] ?? `${n}th`;

/** First, second, third, fourth place counts as a thin bar. Place colors are rank, not up and down. */
export function PlaceBar({ places }: { places: readonly number[] }) {
  const total = places.reduce((sum, count) => sum + count, 0);
  if (!total) return <span className={styles.dim}>none yet</span>;
  return (
    <span className={styles.placeBar} role="img" aria-label={`Placed 1st ${places[0]}, 2nd ${places[1]}, 3rd ${places[2]}, 4th ${places[3]} times`} title={places.map((count, index) => `${ordinal(index + 1)} ${count}`).join(" · ")}>
      {places.map((count, index) => (count ? <i key={index} data-place={index + 1} style={{ flexGrow: count }} /> : null))}
    </span>
  );
}

// ── Oshi ────────────────────────────────────────────────────────────────────
export function OshiTag({ symbol, size = 14 }: { symbol: string | null | undefined; size?: number }) {
  const assets = useMarketStore((state) => state.assets);
  const asset = useMemo(() => (symbol ? assets.find((entry) => entry.symbol.toUpperCase() === symbol.toUpperCase()) : null), [assets, symbol]);
  if (!symbol) return null;
  return (
    <span className={styles.oshi} title={`Oshi: ${symbol}`}>
      <Oshimark icon={asset?.icon} symbol={symbol} size={size} />
      {symbol}
    </span>
  );
}

// ── Players ─────────────────────────────────────────────────────────────────
export function PlayerLink({ name, color, bot }: { name: string; color?: string | null; bot?: boolean }) {
  const style = { "--tal": talentAccent(color) } as CSSProperties;
  if (bot) return <span className={styles.player} style={style}>{name}</span>;
  return (
    <Link href={`/games/mahjong/player/${encodeURIComponent(name)}`} className={styles.player} style={style}>
      {name}
    </Link>
  );
}

// ── Hands ───────────────────────────────────────────────────────────────────
/** A meld from the API as a row meld: the taken tile sideways, a kan's added tile last. */
export function meldRow(meld: Meld): RowMeld {
  if (meld.type === "ankan" || meld.called === null) return { tiles: meld.tiles, type: meld.type };
  const base = meld.type === "kakan" && meld.added !== null ? meld.tiles.filter((id) => id !== meld.added) : meld.tiles;
  const tiles = meld.type === "kakan" && meld.added !== null ? [...base, meld.added] : base;
  return { tiles, type: meld.type, called: Math.max(0, base.indexOf(meld.called)) };
}

/** A winning hand face up: the concealed tiles, the called sets, the winning tile set apart. */
export function WinningHand({ hand, melds, tile, size = 26, highlight }: { hand: TileId[]; melds: Meld[]; tile: TileId; size?: number; highlight?: boolean }) {
  return (
    <span className={styles.hand}>
      <span className={styles.handRun}>
        {hand.map((id, index) => (
          <Tile key={index} id={id} size={size} />
        ))}
      </span>
      <span className={styles.handWin}>
        <Tile id={tile} size={size} highlight={highlight ?? true} />
      </span>
      {melds.map((meld, index) => (
        <TileMeld key={index} {...meldRow(meld)} size={size} />
      ))}
    </span>
  );
}

/** "Haneman", "Yakuman" or "3 han 30 fu" for a highlight. */
export function highlightScore(hand: Pick<HighlightHand, "han" | "fu" | "yakuman" | "limit">) {
  return scoreText({ han: hand.han ?? 0, fu: hand.fu ?? 0, yakuman: hand.yakuman, limit: (hand.limit ?? null) as LimitName | null });
}

/** One row of the biggest hands, the yakuman wall and the hand of the day. */
export function HighlightRow({ hand, rank, big }: { hand: HighlightHand; rank?: number; big?: boolean }) {
  const yaku = hand.win?.yaku ?? hand.yaku.map((key) => ({ key, han: 0 }));
  const names = yaku.map((entry) => yakuName(entry.key));
  return (
    <li className={styles.highlight} data-big={big || undefined} style={{ "--tal": talentAccent(hand.profile_color) } as CSSProperties}>
      <div className={styles.highlightHead}>
        {rank ? <b className={styles.rank}>{rank}</b> : null}
        <PlayerLink name={hand.username} color={hand.profile_color} />
        <strong className={styles.score}>{highlightScore(hand)}</strong>
        <span className={styles.points}>{hand.points.toLocaleString("en-US")} pts</span>
        <Link className={styles.replayLink} href={`/games/mahjong/replay/${hand.game_id}?hand=${hand.hand_index}`}>
          Replay this hand
        </Link>
      </div>
      {hand.win ? (
        <div className={styles.highlightTiles}>
          <WinningHand hand={hand.win.hand} melds={hand.win.melds} tile={hand.win.tile} size={big ? 30 : 24} />
        </div>
      ) : null}
      <p className={styles.highlightYaku}>
        {names.join(", ")}
        <span className={styles.dim}> · {shortDate(hand.at)}{hand.kind === "tournament" ? " · tournament" : ""}</span>
      </p>
    </li>
  );
}

