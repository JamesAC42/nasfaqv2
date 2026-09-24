"use client";

import Link from "next/link";
import { useMemo } from "react";
import { FiArrowRight } from "react-icons/fi";
import { Oshimark } from "@/app/components/common/oshimark";
import { fmtCash, fmtStake } from "@/app/components/games/arcade/arcade-format";
import { PullFeed, SignedOutPanel, TapBoard, YourStuff } from "@/app/components/games/arcade/arcade-side";
import { callName, FeaturedHero } from "@/app/components/games/arcade/featured-hero";
import { GameTiles, type ArcadeTile } from "@/app/components/games/arcade/game-tiles";
import { LiveStrip } from "@/app/components/games/arcade/live-strip";
import {
  useBanners,
  useBlackjackLobby,
  useCatalog,
  useLobby,
  useMySeats,
  usePullFeed,
  useTapBoard,
  type MySeat,
} from "@/app/components/games/arcade/use-arcade-data";
import { usePhone } from "@/app/components/games/arcade/use-media";
import type { CardFace } from "@/app/components/games/cards/talent-card";
import { GamesFrame } from "@/app/components/games/shell/games-frame";
import type { GameEntry, GameTable, TableGame } from "@/app/lib/games/types";
import { useAuth } from "@/app/providers/auth-provider";
import { useGamesStore } from "@/app/stores/games-store";
import styles from "@/app/components/games/arcade/arcade.module.scss";

// Talents for tile art before the feed loads (or when nobody has pulled anything).
const FALLBACK_FACES: CardFace[] = [
  { symbol: "PEK", name: "Usada Pekora", icon: "pekora", color: "#cedcf5", unit: "hololive 3rd Generation", rarity: "UR" },
  { symbol: "MAR", name: "Houshou Marine", icon: "marine", color: "#bf4848", unit: "hololive 3rd Generation", rarity: "SR" },
  { symbol: "SUI", name: "Hoshimachi Suisei", icon: "suisei", color: "#9dc9f4", unit: "hololive Generation 0", rarity: "SSR" },
  { symbol: "GUR", name: "Gawr Gura", icon: "gura", color: "#3678a1", unit: "hololive English -Myth-", rarity: "SSR" },
  { symbol: "MIK", name: "Sakura Miko", icon: "miko", color: "#ff5286", unit: "hololive Generation 0", rarity: "SR" },
  { symbol: "FBK", name: "Shirakami Fubuki", icon: "fubuki", color: "#7cd2fe", unit: "hololive 1st Generation", rarity: "R" },
];

const GAME_NAME: Record<TableGame, string> = { "oshi-duel": "duel", "high-low": "high-low" };
const GAME_PATH: Record<TableGame, string> = { "oshi-duel": "/games/duel", "high-low": "/games/high-low" };

export function ArcadePage() {
  const { user, initialized } = useAuth();
  const signedIn = Boolean(user);
  const me = user ? String(user.id) : null;
  const phone = usePhone();

  const collection = useGamesStore((state) => state.collection);
  const collectionLoading = useGamesStore((state) => state.loading);

  const banners = useBanners();
  const catalog = useCatalog();
  const feed = usePullFeed();
  const board = useTapBoard();
  const duel = useLobby("oshi-duel");
  const highLow = useLobby("high-low");
  const blackjack = useBlackjackLobby();
  const seats = useMySeats(me, [duel.tables, highLow.tables], blackjack);

  const featured = banners?.banners.find((banner) => banner.kind === "featured" && banner.featured)?.featured ?? null;

  const faces = useMemo(() => {
    const list: CardFace[] = [];
    const seen = new Set<string>();
    const add = (face: CardFace) => {
      if (seen.has(face.symbol)) return;
      seen.add(face.symbol);
      list.push(face);
    };
    if (featured) add({ ...featured, rarity: "UR" });
    for (const pull of feed?.pulls ?? []) add({ symbol: pull.symbol, name: pull.name, icon: pull.icon, color: pull.color, unit: pull.unit, rarity: pull.rarity });
    for (const face of FALLBACK_FACES) add(face);
    return list;
  }, [featured, feed]);

  const recent = useMemo(
    () =>
      [
        ...duel.recent.map((match) => ({ ...match, game: "oshi-duel" as const })),
        ...highLow.recent.map((match) => ({ ...match, game: "high-low" as const })),
      ].sort((a, b) => new Date(b.completed_at).getTime() - new Date(a.completed_at).getTime()),
    [duel.recent, highLow.recent],
  );

  const tiles = buildTiles({
    catalog: catalog?.games ?? null,
    featured,
    pullCost: banners?.pull_cost_cash ?? 100,
    tenCost: banners?.ten_pull_cost_cash ?? 900,
    duel: duel.tables,
    highLow: highLow.tables,
    blackjack,
    pool: board?.week.pool ?? null,
    tapFee: board?.game?.entry_fee_cash ?? null,
    // The collection's capsule pity reports card-style counters; the capsule's hard pity is 60.
    capsuleIn: signedIn && collection?.pity.capsule ? Math.max(1, 60 - collection.pity.capsule.pulls_since_ssr) : null,
  });

  return (
    <GamesFrame
      kicker="NASFAQ arcade"
      title="Arcade"
      live
      blurb={<>Every game here spends real cash. Pull cards, stake a duel, take the house for a ride.</>}
    >
      <div className={styles.page}>
        {seats.length ? <SeatBanner seats={seats} me={me} /> : null}

        <FeaturedHero banners={banners} signedIn={signedIn} pity={collection?.pity.featured ?? null} owned={collection?.cards ?? null} />

        <LiveStrip duel={duel.tables} highLow={highLow.tables} blackjack={blackjack} recent={recent} me={me} signedIn={signedIn} />

        <div className={styles.layout}>
          <div className={styles.main}>
            <GameTiles tiles={tiles} faces={faces} phone={phone} />
          </div>
          <aside className={styles.side} aria-label="Your stuff and the feeds">
            {!initialized ? null : signedIn ? <YourStuff collection={collection} loading={collectionLoading || !collection} /> : <SignedOutPanel />}
            <PullFeed pulls={feed?.pulls ?? null} />
            <TapBoard board={board} me={me} />
          </aside>
        </div>
      </div>
    </GamesFrame>
  );
}

// ── "Back to your table" ─────────────────────────────────────────────────
function SeatBanner({ seats, me }: { seats: MySeat[]; me: string | null }) {
  return (
    <section className={styles.seats} aria-label="Tables you're at">
      {seats.map((seat) => {
        if (seat.kind === "blackjack") {
          return (
            <Link key={`bj${seat.key}`} href={`/games/blackjack/${seat.key}`} className={styles.seat}>
              <span className={styles.seatTag}>
                <i aria-hidden="true" />
                You&apos;re seated
              </span>
              <span className={styles.seatText}>
                Blackjack, {seat.name}
                {seat.bet > 0 ? <> · <b>{fmtCash(seat.bet)}</b> on the felt</> : null}
              </span>
              <span className={styles.seatGo}>
                Back to your table <FiArrowRight aria-hidden="true" />
              </span>
            </Link>
          );
        }
        return <TableSeat key={`t${seat.table.id}`} table={seat.table} me={me} />;
      })}
    </section>
  );
}

function TableSeat({ table, me }: { table: GameTable; me: string | null }) {
  const opponent = table.players.find((player) => String(player.user_id) !== me);
  const waiting = table.status === "open";
  return (
    <Link href={`${GAME_PATH[table.game]}/${table.id}`} className={styles.seat}>
      <span className={styles.seatTag}>
        <i aria-hidden="true" />
        {waiting ? "Your table" : "Your match"}
      </span>
      <span className={styles.seatText}>
        {waiting ? (
          <>
            Your {GAME_NAME[table.game]} is open, waiting on a challenger · <b>{fmtStake(table.stake)}</b>
          </>
        ) : (
          <>
            {table.game === "oshi-duel" ? "Duel" : "High-low"} vs {opponent?.username ?? "someone"} · <b>{fmtStake(table.stake)}</b>
          </>
        )}
      </span>
      <span className={styles.seatGo}>
        {waiting ? "Back to your table" : "Back to your match"} <FiArrowRight aria-hidden="true" />
      </span>
    </Link>
  );
}

// ── Tiles ────────────────────────────────────────────────────────────────
function range(entry: GameEntry | undefined, fallback: [number, number]) {
  const min = entry?.min_stake_cash ?? fallback[0];
  const max = entry?.max_stake_cash ?? fallback[1];
  return `${fmtCash(min)}–${fmtCash(max)}`;
}

function tableStat(tables: GameTable[] | null) {
  if (!tables) return null;
  const open = tables.filter((table) => table.status === "open").length;
  const playing = tables.filter((table) => table.status === "playing").length;
  if (open)
    return {
      live: true,
      text: (
        <>
          <b>{open}</b> open{playing ? <> · <b>{playing}</b> live</> : null}
        </>
      ),
    };
  if (playing) return { live: true, text: <><b>{playing}</b> live now</> };
  return { text: "No open tables" };
}

function buildTiles({
  catalog,
  featured,
  pullCost,
  tenCost,
  duel,
  highLow,
  blackjack,
  pool,
  tapFee,
  capsuleIn,
}: {
  catalog: GameEntry[] | null;
  featured: { symbol: string; name: string; icon: string | null } | null;
  pullCost: number;
  tenCost: number;
  duel: GameTable[] | null;
  highLow: GameTable[] | null;
  blackjack: { seated: number; seats: number }[] | null;
  pool: number | null;
  tapFee: number | null;
  capsuleIn: number | null;
}): ArcadeTile[] {
  const entry = (key: string) => catalog?.find((game) => game.key === key);
  const capsule = entry("capsule-gacha");
  const capsuleOne = Number(capsule?.config?.pull_cost_cash ?? capsule?.entry_fee_cash ?? 50);
  const capsuleTen = Number(capsule?.config?.ten_pull_cost_cash ?? 450);
  const seated = blackjack?.reduce((sum, row) => sum + row.seated, 0) ?? null;
  const seatsTotal = blackjack?.reduce((sum, row) => sum + row.seats, 0) ?? 15;

  return [
    {
      key: "cards",
      href: "/games/cards",
      name: "Card gacha",
      hook: featured ? `Pull talents, chase the holo, pray you win the 50/50 on ${callName(featured.name)}.` : "Pull talents, chase the holo, show off the UR.",
      price: `${fmtCash(pullCost)} · ×10 ${fmtCash(tenCost)}`,
      stat: featured
        ? {
            text: (
              <>
                Rate up <Oshimark icon={featured.icon} symbol={featured.symbol} size={14} /> <b>{featured.symbol}</b>
              </>
            ),
          }
        : null,
    },
    {
      key: "duel",
      href: "/games/duel",
      name: "Oshi duel",
      hook: "Five cards each, open decks, and the market twists every round. Winner takes the pot.",
      price: `Stake ${range(entry("oshi-duel"), [0, 5000])}`,
      stat: tableStat(duel),
    },
    {
      key: "blackjack",
      href: "/games/blackjack",
      name: "Blackjack",
      hook: "Three tables, six decks, dealer hits soft 16. Blackjack pays 3:2.",
      price: `Bets ${range(entry("blackjack"), [10, 10000])}`,
      stat:
        seated === null
          ? null
          : {
              live: seated > 0,
              text: (
                <>
                  <b>{seated}</b>/{seatsTotal} seated
                </>
              ),
            },
    },
    {
      key: "high-low",
      href: "/games/high-low",
      name: "High-low",
      hook: "Higher or lower, nine calls, one double-down. Read the deck, rob a friend.",
      price: `Stake ${range(entry("high-low"), [0, 5000])}`,
      stat: tableStat(highLow),
    },
    {
      key: "ticker-tap",
      href: "/games/ticker-tap",
      name: "Ticker Tap",
      hook: "Tap green, dodge red, chase gold. The week's top ten split the pool.",
      price: `${fmtCash(tapFee ?? entry("ticker-tap")?.entry_fee_cash ?? 100)} a run`,
      stat:
        pool === null
          ? null
          : {
              text: (
                <>
                  Pool <b>{fmtCash(pool)}</b>
                </>
              ),
            },
    },
    {
      key: "capsule",
      href: "/games/capsule",
      name: "Capsule",
      hook: "Hats, frames and flair for your profile. Dupes pay shards now.",
      price: `${fmtCash(capsuleOne)} · ×10 ${fmtCash(capsuleTen)}`,
      stat: {
        text:
          capsuleIn !== null ? (
            <>
              Legendary in <b>{capsuleIn}</b>
            </>
          ) : (
            <>
              Epic+ every <b>10</b>
            </>
          ),
      },
    },
  ];
}
