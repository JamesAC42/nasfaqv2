"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { FiSearch, FiX } from "react-icons/fi";
import { TalentCard } from "@/app/components/games/cards/talent-card";
import { RARITIES } from "@/app/lib/games/rarity";
import type { Rarity, TalentCard as TalentCardData } from "@/app/lib/games/types";
import { useGamesStore } from "@/app/stores/games-store";
import styles from "@/app/components/games/tables/duel-deck.module.scss";

// Deck builder for Oshi Card Duel: five cards, five different talents. Momentum is today's stock
// move in whole percent, capped at ±8, the same number the duel snapshots when the match starts.

export const DECK_SIZE = 5;
const MOMENTUM_CAP = 8;

export function momentumOf(movePct: number | null | undefined) {
  if (movePct === null || movePct === undefined || !Number.isFinite(movePct)) return 0;
  return Math.max(-MOMENTUM_CAP, Math.min(MOMENTUM_CAP, Math.round(movePct * 100)));
}

export function MomentumChip({ value, className }: { value: number; className?: string }) {
  const tone = value > 0 ? "up" : value < 0 ? "down" : "flat";
  const text = value > 0 ? `+${value}` : value < 0 ? `−${Math.abs(value)}` : "±0";
  return (
    <span className={`${styles.mom} ${className ?? ""}`} data-tone={tone} title={`Momentum ${text}: today's stock move`}>
      {tone === "up" ? "▲" : tone === "down" ? "▼" : "•"}
      {text}
    </span>
  );
}

type DeckCard = TalentCardData & { momentum: number };

function useDeckPool() {
  const collection = useGamesStore((state) => state.collection);
  return useMemo(() => {
    if (!collection) return null;
    const moves = new Map(collection.talents.map((talent) => [talent.symbol, talent.move_pct ?? null]));
    const cards: DeckCard[] = collection.cards.map((card) => ({ ...card, momentum: momentumOf(moves.get(card.symbol) ?? card.move_pct ?? null) }));
    cards.sort((a, b) => b.power + b.momentum - (a.power + a.momentum) || a.name.localeCompare(b.name));
    return { cards, byKey: new Map(cards.map((card) => [card.key, card])), talents: new Set(cards.map((card) => card.symbol)).size };
  }, [collection]);
}

function bestFive(cards: DeckCard[]) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const card of cards) {
    if (seen.has(card.symbol)) continue;
    seen.add(card.symbol);
    out.push(card.key);
    if (out.length === DECK_SIZE) break;
  }
  return out;
}

// The last deck survives route changes inside the session (lobby → table → lobby).
let rememberedDeck: string[] | null = null;

/** The player's current deck (defaults to their best five) and a setter. */
export function useDuelDeck() {
  const pool = useDeckPool();
  const [picked, setPicked] = useState<string[] | null>(rememberedDeck);
  const deck = useMemo(() => {
    if (!pool) return [];
    const owned = (picked ?? bestFive(pool.cards)).filter((key) => pool.byKey.has(key));
    return owned.slice(0, DECK_SIZE);
  }, [picked, pool]);
  const setDeck = (keys: string[]) => {
    rememberedDeck = keys;
    setPicked(keys);
  };
  const autoPick = () => {
    if (pool) setDeck(bestFive(pool.cards));
  };
  return { deck, setDeck, autoPick, ready: deck.length === DECK_SIZE, loaded: Boolean(pool), talents: pool?.talents ?? 0 };
}

export function DuelDeckBuilder({
  deck,
  setDeck,
  autoPick,
  startOpen = false,
  heading = "Your deck",
}: {
  deck: string[];
  setDeck: (keys: string[]) => void;
  autoPick: () => void;
  startOpen?: boolean;
  heading?: string;
}) {
  const pool = useDeckPool();
  const loading = useGamesStore((state) => state.loading);
  const [open, setOpen] = useState(startOpen);
  const [query, setQuery] = useState("");
  const [rarity, setRarity] = useState<Rarity | "all">("all");
  const [hint, setHint] = useState<string | null>(null);

  const chosen = deck.map((key) => pool?.byKey.get(key)).filter(Boolean) as DeckCard[];
  const total = chosen.reduce((sum, card) => sum + card.power + card.momentum, 0);
  const deckSymbols = new Set(chosen.map((card) => card.symbol));

  const visible = useMemo(() => {
    if (!pool) return [];
    const q = query.trim().toLowerCase();
    return pool.cards.filter(
      (card) => (rarity === "all" || card.rarity === rarity) && (!q || card.name.toLowerCase().includes(q) || card.symbol.toLowerCase().includes(q) || (card.unit ?? "").toLowerCase().includes(q)),
    );
  }, [pool, query, rarity]);

  if (!pool) {
    return <div className={styles.loading}>{loading ? "Loading your cards…" : "Your cards aren't loaded yet."}</div>;
  }

  if (pool.talents < DECK_SIZE) {
    return (
      <div className={styles.short}>
        <strong>You need five different talents to duel.</strong>
        <p>
          You&apos;ve got {pool.talents}. Grab the free starter pack on <Link href="/games/collection">your collection</Link>, or pull a few on the{" "}
          <Link href="/games/cards">card gacha</Link>.
        </p>
      </div>
    );
  }

  function toggle(card: DeckCard) {
    setHint(null);
    if (deck.includes(card.key)) {
      setDeck(deck.filter((key) => key !== card.key));
      return;
    }
    const clash = chosen.find((entry) => entry.symbol === card.symbol);
    if (clash) {
      setDeck(deck.map((key) => (key === clash.key ? card.key : key)));
      return;
    }
    if (deck.length >= DECK_SIZE) {
      setHint("Deck's full. Drop a card first.");
      return;
    }
    setDeck([...deck, card.key]);
  }

  return (
    <section className={styles.builder} aria-label={heading}>
      <div className={styles.head}>
        <h2>{heading}</h2>
        <span className={styles.total}>
          <small>Deck power</small>
          <b>{total}</b>
        </span>
        <div className={styles.headActions}>
          <button type="button" className={styles.ghost} onClick={autoPick}>
            Best five
          </button>
          <button type="button" className={styles.ghost} onClick={() => setOpen((value) => !value)} aria-expanded={open}>
            {open ? "Done" : "Edit deck"}
          </button>
        </div>
      </div>

      <ol className={styles.slots}>
        {Array.from({ length: DECK_SIZE }, (_, index) => {
          const card = chosen[index];
          return (
            <li key={card?.key ?? `empty-${index}`} className={styles.slot}>
              {card ? (
                <>
                  <TalentCard
                    card={card}
                    width={112}
                    compact
                    tilt={false}
                    className={styles.slotCard}
                    onClick={open ? () => toggle(card) : () => setOpen(true)}
                    title={open ? `Remove ${card.name}` : `${card.name}: edit deck`}
                  />
                  <span className={styles.slotMeta}>
                    <MomentumChip value={card.momentum} />
                  </span>
                </>
              ) : (
                <button type="button" className={styles.emptySlot} onClick={() => setOpen(true)}>
                  <span>+</span>
                  Pick a talent
                </button>
              )}
            </li>
          );
        })}
      </ol>
      {deck.length < DECK_SIZE ? <p className={styles.need}>{DECK_SIZE - deck.length} more to go. Five different talents.</p> : null}

      {open ? (
        <div className={styles.picker}>
          <div className={styles.filters}>
            <label className={styles.search}>
              <FiSearch aria-hidden="true" />
              <span className={styles.srOnly}>Search your cards</span>
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search talent, ticker, unit" />
              {query ? (
                <button type="button" onClick={() => setQuery("")} aria-label="Clear search">
                  <FiX aria-hidden="true" />
                </button>
              ) : null}
            </label>
            <div className={styles.rarityTabs} role="group" aria-label="Filter by rarity">
              {(["all", ...RARITIES] as const).map((value) => (
                <button key={value} type="button" aria-pressed={rarity === value} onClick={() => setRarity(value)}>
                  {value === "all" ? "All" : value}
                </button>
              ))}
            </div>
          </div>
          {hint ? (
            <p className={styles.hint} role="status">
              {hint}
            </p>
          ) : null}
          <div className={styles.grid}>
            {visible.length ? (
              visible.map((card) => {
                const inDeck = deck.includes(card.key);
                const swaps = !inDeck && deckSymbols.has(card.symbol);
                return (
                  <div key={card.key} className={styles.pick}>
                    <TalentCard
                      card={card}
                      width={96}
                      compact
                      tilt={false}
                      selected={inDeck}
                      muted={!inDeck && !swaps && deck.length >= DECK_SIZE}
                      onClick={() => toggle(card)}
                      title={inDeck ? `Remove ${card.name}` : swaps ? `Swap in ${card.name} ${card.rarity}` : `Add ${card.name} ${card.rarity}`}
                      ribbon={swaps ? "SWAP" : null}
                    />
                    <MomentumChip value={card.momentum} />
                  </div>
                );
              })
            ) : (
              <p className={styles.none}>No cards match.</p>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}
