"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { FaGavel, FaMagnifyingGlass, FaTag } from "react-icons/fa6";
import { TalentCard } from "@/app/components/games/cards/talent-card";
import { SignInToPlay } from "@/app/components/games/shell/games-frame";
import { cardPath, fetchListings, fetchOverview, type Listing, type Overview, type TapeEvent } from "@/app/lib/games/exchange";
import { gameErrorText } from "@/app/lib/games/errors";
import { RARITIES, RARITY_COLOR, RARITY_NAME } from "@/app/lib/games/rarity";
import type { Rarity, TalentCard as Card } from "@/app/lib/games/types";
import { useGamesEvents, type GamesPayload } from "@/app/lib/games/use-games-socket";
import { money } from "@/app/lib/time";
import { useAuth } from "@/app/providers/auth-provider";
import { useExchangeStore } from "@/app/stores/exchange-store";
import { useGamesStore } from "@/app/stores/games-store";
import { CardName, Dialog, ago } from "@/app/components/games/exchange/bits";
import { ExchangeFrame } from "@/app/components/games/exchange/exchange-frame";
import { ListingDialog } from "@/app/components/games/exchange/listing-dialog";
import { ListingTile } from "@/app/components/games/exchange/listing-tile";
import { SellDialog } from "@/app/components/games/exchange/sell-dialog";
import styles from "@/app/components/games/exchange/exchange.module.scss";

type Kind = "" | "fixed" | "auction";
type Sort = "ending" | "newest" | "price_asc" | "price_desc" | "bids";
const SORTS: { value: Sort; label: string }[] = [
  { value: "ending", label: "Ending soon" },
  { value: "newest", label: "Newest" },
  { value: "price_asc", label: "Price: low" },
  { value: "price_desc", label: "Price: high" },
  { value: "bids", label: "Most bids" },
];

/** Viewer-relative flags on a listing that came in over the public tape. */
function forViewer(listing: Listing, userId: number | null): Listing {
  return { ...listing, is_mine: userId !== null && listing.seller.id === userId, is_leading: userId !== null && listing.leader?.id === userId };
}

export function MarketPage() {
  const { user } = useAuth();
  const userId = user ? Number(user.id) : null;
  const [overview, setOverview] = useState<Overview | null>(null);
  const [tape, setTape] = useState<TapeEvent[]>([]);
  const [listings, setListings] = useState<Listing[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<Kind>("");
  const [rarities, setRarities] = useState<Rarity[]>([]);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("ending");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<Listing | null>(null);
  const [selling, setSelling] = useState(false);
  const [fresh, setFresh] = useState(0);
  const [flashing, setFlashing] = useState<Set<number>>(new Set());
  const flashTimers = useRef(new Map<number, number>());

  const loadOverview = useCallback(() => {
    fetchOverview()
      .then((next) => {
        setOverview(next);
        setTape((current) => (current.length ? current : next.tape));
      })
      .catch((reason) => setError(gameErrorText(reason)));
  }, []);

  const loadListings = useCallback(() => {
    fetchListings({ kind: kind || undefined, rarity: rarities.join(",") || undefined, q: query.trim() || undefined, sort, page })
      .then((result) => {
        setListings(result.listings);
        setTotal(result.total);
        setFresh(0);
      })
      .catch((reason) => setError(gameErrorText(reason)));
  }, [kind, rarities, query, sort, page]);

  useEffect(() => {
    loadOverview();
  }, [loadOverview]);

  useEffect(() => {
    const timer = window.setTimeout(loadListings, query ? 250 : 0);
    return () => window.clearTimeout(timer);
  }, [loadListings, query]);

  const flash = useCallback((id: number) => {
    setFlashing((current) => new Set(current).add(id));
    const previous = flashTimers.current.get(id);
    if (previous) window.clearTimeout(previous);
    flashTimers.current.set(
      id,
      window.setTimeout(() => {
        setFlashing((current) => {
          const next = new Set(current);
          next.delete(id);
          return next;
        });
      }, 1400),
    );
  }, []);

  // The live tape: patch bids in place, drop what sold, count new listings.
  const onEvent = useCallback(
    (payload: GamesPayload) => {
      if (payload.type === "tape") {
        setTape((payload.events as TapeEvent[]) ?? []);
        return;
      }
      if (payload.type !== "event") return;
      const event = payload.event as TapeEvent;
      setTape((current) => [event, ...current.filter((entry) => entry.seq !== event.seq)].slice(0, 40));
      const patch = (list: Listing[] | null) => {
        if (!list) return list;
        if (event.type === "bid") return list.map((listing) => (listing.id === event.listing.id ? forViewer(event.listing, userId) : listing));
        if (event.type === "sale" || event.type === "delisted") return list.filter((listing) => listing.id !== event.listing_id);
        return list;
      };
      setListings(patch);
      setOverview((current) => (current ? { ...current, ending_soon: patch(current.ending_soon) ?? [], hot: patch(current.hot) ?? [] } : current));
      if (event.type === "bid") flash(event.listing.id);
      if (event.type === "listed" && event.listing.seller.id !== userId) setFresh((count) => count + 1);
      if (event.type === "sale") {
        setOverview((current) =>
          current ? { ...current, stats: { ...current.stats, sales_24h: current.stats.sales_24h + 1, volume_24h: current.stats.volume_24h + event.price } } : current,
        );
      }
    },
    [flash, userId],
  );
  useGamesEvents("exchange", onEvent);

  const replace = (next: Listing) => {
    setListings((current) => (current ? (next.status === "active" ? current.map((entry) => (entry.id === next.id ? next : entry)) : current.filter((entry) => entry.id !== next.id)) : current));
  };

  const toggleRarity = (rarity: Rarity) => {
    setPage(1);
    setRarities((current) => (current.includes(rarity) ? current.filter((entry) => entry !== rarity) : [...current, rarity]));
  };

  const stats = overview?.stats;
  const pages = Math.max(1, Math.ceil(total / 36));

  return (
    <ExchangeFrame>
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}

      <section className={styles.ticker} aria-label="Exchange today">
        <div>
          <small>24h volume</small>
          <b>{stats ? money(stats.volume_24h, { compact: true }) : "…"}</b>
        </div>
        <div>
          <small>Sales 24h</small>
          <b>{stats?.sales_24h ?? "…"}</b>
        </div>
        <div>
          <small>Live auctions</small>
          <b>{stats?.auctions ?? "…"}</b>
        </div>
        <div>
          <small>Buy now</small>
          <b>{stats?.buy_now ?? "…"}</b>
        </div>
        <div>
          <small>Trades 24h</small>
          <b>{stats?.trades_24h ?? "…"}</b>
        </div>
        {user ? (
          <button type="button" className={styles.sellButton} onClick={() => setSelling(true)}>
            <FaTag aria-hidden="true" /> Sell a card
          </button>
        ) : null}
      </section>

      <section className={styles.floors} aria-label="Floor prices by rarity">
        {(overview?.floors ?? RARITIES.map((rarity) => ({ rarity, floor: null, listed: 0, avg7d: null, sales7d: 0, last: null }))).map((floor) => (
          <button
            key={floor.rarity}
            type="button"
            className={styles.floor}
            style={{ "--r": RARITY_COLOR[floor.rarity] } as CSSProperties}
            aria-pressed={rarities.includes(floor.rarity)}
            onClick={() => toggleRarity(floor.rarity)}
            title={`Show only ${floor.rarity}`}
          >
            <span className={styles.floorHead}>
              <b>{floor.rarity}</b>
              <small>{RARITY_NAME[floor.rarity]}</small>
            </span>
            <span className={styles.floorPrice}>{floor.floor !== null ? money(floor.floor) : "—"}</span>
            <small>
              floor · {floor.listed} listed
              {floor.avg7d !== null ? ` · 7d avg ${money(floor.avg7d, { compact: true })}` : ""}
            </small>
          </button>
        ))}
      </section>

      {overview?.ending_soon.length ? (
        <section className={styles.rail} aria-label="Auctions ending soon">
          <h2 className={styles.sectionTitle}>
            <FaGavel aria-hidden="true" /> Ending soon
          </h2>
          <div className={styles.railScroll}>
            {overview.ending_soon.map((listing) => (
              <ListingTile key={listing.id} listing={forViewer(listing, userId)} onOpen={setOpen} width={132} flash={flashing.has(listing.id)} />
            ))}
          </div>
        </section>
      ) : null}

      <div className={styles.marketLayout}>
        <div className={styles.marketMain}>
          <div className={styles.filters}>
            <div className={styles.segment} role="radiogroup" aria-label="Listing type">
              {(
                [
                  ["", "All"],
                  ["fixed", "Buy now"],
                  ["auction", "Auctions"],
                ] as [Kind, string][]
              ).map(([value, label]) => (
                <button
                  key={label}
                  type="button"
                  role="radio"
                  aria-checked={kind === value}
                  onClick={() => {
                    setPage(1);
                    setKind(value);
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            <label className={styles.search}>
              <FaMagnifyingGlass aria-hidden="true" />
              <input
                value={query}
                placeholder="Talent or ticker"
                aria-label="Search talents"
                onChange={(event) => {
                  setPage(1);
                  setQuery(event.target.value);
                }}
              />
            </label>
            <select
              className={styles.select}
              value={sort}
              aria-label="Sort"
              onChange={(event) => {
                setPage(1);
                setSort(event.target.value as Sort);
              }}
            >
              {SORTS.map((entry) => (
                <option key={entry.value} value={entry.value}>
                  {entry.label}
                </option>
              ))}
            </select>
          </div>

          {fresh > 0 ? (
            <button type="button" className={styles.freshPill} onClick={loadListings}>
              {fresh} new listing{fresh === 1 ? "" : "s"} · show
            </button>
          ) : null}

          {listings === null ? (
            <div className={styles.grid} aria-busy="true">
              {Array.from({ length: 8 }, (_, index) => (
                <span key={index} className={styles.ghostTile} />
              ))}
            </div>
          ) : listings.length ? (
            <div className={styles.grid}>
              {listings.map((listing) => (
                <ListingTile key={listing.id} listing={listing} onOpen={setOpen} flash={flashing.has(listing.id)} />
              ))}
            </div>
          ) : (
            <div className={styles.empty}>
              <b>Nothing listed{kind || rarities.length || query ? " that matches" : " yet"}.</b>
              <p>
                {user ? (
                  <>
                    Be the first:{" "}
                    <button type="button" className={styles.inlineButton} onClick={() => setSelling(true)}>
                      sell a card
                    </button>{" "}
                    and set the price everyone else trades against.
                  </>
                ) : (
                  "Cards listed by players show up here."
                )}
              </p>
            </div>
          )}

          {pages > 1 ? (
            <nav className={styles.pager} aria-label="Pages">
              <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                ← Prev
              </button>
              <span>
                {page} / {pages}
              </span>
              <button type="button" disabled={page >= pages} onClick={() => setPage(page + 1)}>
                Next →
              </button>
            </nav>
          ) : null}
          {!user ? <SignInToPlay what="buy, sell and trade cards" /> : null}
        </div>

        <aside className={styles.marketAside}>
          <LiveTape events={tape} />
          {overview?.biggest_sales.length ? (
            <section className={styles.panel} aria-label="Biggest sales this week">
              <h2 className={styles.sectionTitle}>Biggest sales · 7d</h2>
              <ol className={styles.bigSales}>
                {overview.biggest_sales.map((sale, index) => (
                  <li key={sale.id}>
                    <span className={styles.rank}>{index + 1}</span>
                    <CardName card={sale.card} href={cardPath(sale.card_key)} />
                    <b className={styles.cash}>{money(sale.price)}</b>
                  </li>
                ))}
              </ol>
            </section>
          ) : null}
          <section className={styles.panel}>
            <h2 className={styles.sectionTitle}>How it works</h2>
            <ul className={styles.rules}>
              <li>Buy-now listings sell instantly. Auctions go to the top bid when the clock runs out.</li>
              <li>A bid in the last two minutes adds two minutes. No sniping.</li>
              <li>Outbid? Your cash comes straight back.</li>
              <li>Sellers pay a 5% fee. Direct trades are free.</li>
              <li>Stars follow copies: sell a duplicate and that card loses a star.</li>
              <li>Starter-pack cards stay with you.</li>
            </ul>
          </section>
        </aside>
      </div>

      {open ? <ListingDialog listing={open} onClose={() => setOpen(null)} onChanged={replace} /> : null}
      {selling ? <SellPicker onClose={() => setSelling(false)} onListed={() => loadListings()} /> : null}
    </ExchangeFrame>
  );
}

/** Scrolling feed of what's happening: sales, bids, new listings, trades. */
export function LiveTape({ events }: { events: TapeEvent[] }) {
  return (
    <section className={styles.panel} aria-label="Live tape">
      <h2 className={styles.sectionTitle}>
        <i className={styles.liveDot} aria-hidden="true" /> Live tape
      </h2>
      {events.length ? (
        <ol className={styles.tape}>
          {events.slice(0, 18).map((event) => (
            <TapeRow key={event.seq} event={event} />
          ))}
        </ol>
      ) : (
        <p className={styles.note}>Quiet so far. Sales, bids and new listings stream in here.</p>
      )}
    </section>
  );
}

function TapeRow({ event }: { event: TapeEvent }) {
  if (event.type === "sale") {
    const big = event.card.rarity === "SSR" || event.card.rarity === "UR";
    return (
      <li data-type="sale" data-big={big || undefined}>
        <span className={styles.tapeTag}>SOLD</span>
        <CardName card={event.card} href={cardPath(event.card_key)} />
        <b className={styles.cash}>{money(event.price)}</b>
        <small>
          {event.buyer.username} {event.kind === "auction" ? "won it" : "bought"} · {ago(event.at)}
        </small>
      </li>
    );
  }
  if (event.type === "bid") {
    return (
      <li data-type="bid">
        <span className={styles.tapeTag}>BID</span>
        <CardName card={event.listing.card} href={cardPath(event.listing.card_key)} />
        <b className={styles.cash}>{money(event.amount)}</b>
        <small>
          {event.bidder?.username ?? "someone"}
          {event.extended ? " · +2:00 on the clock" : ""} · {ago(event.at)}
        </small>
      </li>
    );
  }
  if (event.type === "listed") {
    return (
      <li data-type="listed">
        <span className={styles.tapeTag}>NEW</span>
        <CardName card={event.listing.card} href={cardPath(event.listing.card_key)} />
        <b className={styles.cash}>{money(event.listing.ask)}</b>
        <small>
          {event.listing.kind === "auction" ? "auction" : "buy now"} · {ago(event.at)}
        </small>
      </li>
    );
  }
  if (event.type === "trade") {
    return (
      <li data-type="trade">
        <span className={styles.tapeTag}>SWAP</span>
        <span className={styles.cardName}>
          {event.from} ⇄ {event.to}
        </span>
        <small>
          {event.cards} card{event.cards === 1 ? "" : "s"} changed hands · {ago(event.at)}
        </small>
      </li>
    );
  }
  return null;
}

/** Pick one of your tradeable cards to sell. */
export function SellPicker({ onClose, onListed }: { onClose: () => void; onListed?: () => void }) {
  const collection = useGamesStore((state) => state.collection);
  const prices = useExchangeStore((state) => state.prices);
  const [card, setCard] = useState<Card | null>(null);
  const [filter, setFilter] = useState<Rarity | "">("");

  useEffect(() => {
    if (!collection) void useGamesStore.getState().loadCollection({ quiet: true });
  }, [collection]);

  const cards = useMemo(
    () =>
      (collection?.cards ?? [])
        .filter((entry) => (entry.tradeable ?? 0) > 0 && (!filter || entry.rarity === filter))
        .sort((a, b) => RARITIES.indexOf(b.rarity) - RARITIES.indexOf(a.rarity) || a.symbol.localeCompare(b.symbol)),
    [collection, filter],
  );

  if (card) {
    return (
      <SellDialog
        card={card}
        tradeable={card.tradeable ?? 0}
        price={prices?.[card.key] ?? null}
        onClose={onClose}
        onListed={() => {
          onListed?.();
        }}
      />
    );
  }

  return (
    <Dialog title="Sell a card" onClose={onClose} wide>
      <div className={styles.pickerBar}>
        <div className={styles.chips}>
          <button type="button" aria-pressed={filter === ""} onClick={() => setFilter("")}>
            All
          </button>
          {RARITIES.map((rarity) => (
            <button key={rarity} type="button" aria-pressed={filter === rarity} onClick={() => setFilter(rarity)}>
              {rarity}
            </button>
          ))}
        </div>
      </div>
      {collection === null ? (
        <p className={styles.note}>Loading your binder…</p>
      ) : cards.length ? (
        <div className={styles.pickGrid}>
          {cards.map((entry) => (
            <button key={entry.key} type="button" className={styles.pickCard} onClick={() => setCard(entry)}>
              <TalentCard card={entry} width={112} compact tilt={false} />
              <small>
                {entry.tradeable} to sell
                {prices?.[entry.key]?.value ? ` · ~${money(prices[entry.key].value, { compact: true })}` : ""}
              </small>
            </button>
          ))}
        </div>
      ) : (
        <p className={styles.note}>
          Nothing to sell{filter ? ` at ${filter}` : ""} yet. Starter-pack cards stay with you; <Link href="/games/cards">pull some cards</Link> to get started.
        </p>
      )}
    </Dialog>
  );
}
