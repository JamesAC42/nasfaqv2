"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { FaMinus, FaPlus, FaXmark } from "react-icons/fa6";
import { PlayerAvatar } from "@/app/components/common/player-avatar";
import { TalentCard } from "@/app/components/games/cards/talent-card";
import { SignInToPlay } from "@/app/components/games/shell/games-frame";
import { fetchMyItems, fetchTradeableCards, fetchTrades, proposeTrade, type ExchangeCard, type ExchangeItem, type Trade, type TradeDraftSide, type UserRef } from "@/app/lib/games/exchange";
import { gameErrorText } from "@/app/lib/games/errors";
import { fmtInteger } from "@/app/lib/format";
import { RARITIES } from "@/app/lib/games/rarity";
import type { Rarity } from "@/app/lib/games/types";
import { money } from "@/app/lib/time";
import { useAuth } from "@/app/providers/auth-provider";
import { useExchangeStore } from "@/app/stores/exchange-store";
import { useGamesStore } from "@/app/stores/games-store";
import { ExchangeFrame } from "@/app/components/games/exchange/exchange-frame";
import { ItemArt } from "@/app/components/games/exchange/item-art";
import { ValueMeter } from "@/app/components/games/exchange/trades-page";
import styles from "@/app/components/games/exchange/exchange.module.scss";

type Pool = (ExchangeCard & { tradeable: number })[];
/** Capsule items that can change hands (one of each per player). */
type ItemPool = ExchangeItem[];
type Draft = { picks: Map<string, number>; items: Set<string>; cash: string; shards: string };
const emptyDraft = (): Draft => ({ picks: new Map(), items: new Set(), cash: "", shards: "" });

/** Build (or counter) an offer: pick from your tradeable cards and theirs, add cash or shards, see the value meter, send. */
export function TradeBuilder() {
  const { user, initialized } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const counterId = Number(params.get("counter") || 0) || null;
  const collection = useGamesStore((state) => state.collection);
  const prices = useExchangeStore((state) => state.prices);

  const [partnerInput, setPartnerInput] = useState(params.get("to") ?? "");
  const [partner, setPartner] = useState<UserRef | null>(null);
  const [theirPool, setTheirPool] = useState<Pool | null>(null);
  const [theirItems, setTheirItems] = useState<ItemPool>([]);
  const [myItems, setMyItems] = useState<ItemPool | null>(null);
  const [counter, setCounter] = useState<Trade | null>(null);
  const [give, setGive] = useState<Draft>(emptyDraft);
  const [ask, setAsk] = useState<Draft>(emptyDraft);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (user && !collection) void useGamesStore.getState().loadCollection({ quiet: true });
  }, [user, collection]);

  useEffect(() => {
    if (!user) return;
    fetchMyItems()
      .then((result) => setMyItems(result.items.filter((item) => item.tradable)))
      .catch(() => setMyItems([]));
  }, [user]);

  const loadPartner = async (username: string) => {
    setError(null);
    try {
      const result = await fetchTradeableCards(username);
      if (user && result.user.username.toLowerCase() === user.username.toLowerCase()) {
        setError("That's you. Pick someone else to trade with.");
        return;
      }
      setPartner(result.user);
      setTheirPool(result.cards);
      setTheirItems(result.items ?? []);
    } catch (reason) {
      setError(gameErrorText(reason) === "trade partner not found" ? `No player called “${username}”.` : gameErrorText(reason));
    }
  };

  // Countering: your side is what they asked of you, theirs is what they offered; edit from there.
  useEffect(() => {
    if (!user || !counterId) return;
    fetchTrades()
      .then((all) => {
        const original = all.incoming.find((trade) => trade.id === counterId) ?? null;
        if (!original) {
          setError("That offer isn't open any more.");
          return;
        }
        setCounter(original);
        setPartnerInput(original.from.username);
        void loadPartner(original.from.username);
        const toDraft = (side: Trade["give"]): Draft => ({
          picks: new Map(side.cards.map((card) => [card.key, card.qty ?? 1])),
          items: new Set((side.items ?? []).map((item) => item.key)),
          cash: side.cash ? String(side.cash) : "",
          shards: side.shards ? String(side.shards) : "",
        });
        setGive(toDraft(original.ask));
        setAsk(toDraft(original.give));
      })
      .catch((reason) => setError(gameErrorText(reason)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, counterId]);

  useEffect(() => {
    const initial = params.get("to");
    if (user && initial && !counterId) void loadPartner(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const myPool: Pool = useMemo(
    () => (collection?.cards ?? []).filter((card) => (card.tradeable ?? 0) > 0).map((card) => ({ ...card, tradeable: card.tradeable ?? 0 })),
    [collection],
  );

  const toSide = (draft: Draft, pool: Pool | null) => ({
    cards: [...draft.picks.entries()].map(([key, qty]) => ({ key, card_key: key, qty, card: pool?.find((card) => card.key === key) })),
    items: [...draft.items].map((key) => ({ key })),
    cash: Number(draft.cash) || 0,
    shards: Number(draft.shards) || 0,
  });
  const giveSide = toSide(give, myPool);
  const askSide = toSide(ask, theirPool);
  const sideEmpty = (side: ReturnType<typeof toSide>) => !side.cards.length && !side.items.length && !side.cash && !side.shards;
  const ready = partner && !sideEmpty(giveSide) && !sideEmpty(askSide);

  const send = async () => {
    if (!partner) return;
    setBusy(true);
    setError(null);
    const payload = (side: ReturnType<typeof toSide>): TradeDraftSide => ({
      cards: side.cards.map((entry) => ({ card_key: entry.key, qty: entry.qty })),
      cosmetics: side.items.map((entry) => entry.key),
      cash: side.cash,
      shards: side.shards,
    });
    try {
      await proposeTrade({
        ...(counter ? { counter_of: counter.id } : { to_username: partner.username }),
        give: payload(giveSide),
        ask: payload(askSide),
        message: message.trim() || undefined,
      });
      void useGamesStore.getState().loadCollection({ quiet: true });
      router.push("/games/exchange/trades");
    } catch (reason) {
      setError(gameErrorText(reason));
    } finally {
      setBusy(false);
    }
  };

  if (initialized && !user) {
    return (
      <ExchangeFrame title="New trade">
        <SignInToPlay what="trade cards" />
      </ExchangeFrame>
    );
  }

  return (
    <ExchangeFrame title={counter ? "Counter-offer" : "New trade"} blurb={<>Pick what you&apos;ll give and what you want back. Your side is held in escrow until they answer (48 hours).</>}>
      <Link href="/games/exchange/trades" className={styles.backLink}>
        ← Trades
      </Link>

      {!counter ? (
        <form
          className={styles.partnerBar}
          onSubmit={(event) => {
            event.preventDefault();
            if (partnerInput.trim()) void loadPartner(partnerInput.trim());
          }}
        >
          <label className={styles.field}>
            <span>Trade with</span>
            <input className={styles.input} value={partnerInput} placeholder="username" onChange={(event) => setPartnerInput(event.target.value)} />
          </label>
          <button type="submit" className={styles.btnSecondary} disabled={!partnerInput.trim()}>
            Load their cards
          </button>
          {partner ? (
            <span className={styles.partnerChip}>
              <PlayerAvatar username={partner.username} color={partner.profile_color} size={22} />
              {partner.username}
            </span>
          ) : null}
        </form>
      ) : (
        <p className={styles.note}>
          Countering <b>{counter.from.username}</b>&apos;s offer. Sending this closes theirs and refunds it.
        </p>
      )}

      <div className={styles.builder}>
        <BuilderSide
          title="You give"
          draft={give}
          setDraft={setGive}
          pool={myPool}
          items={myItems ?? []}
          shardsAvailable={collection?.shards ?? 0}
          emptyPool={collection ? "Nothing tradeable in your binder (starter cards stay with you)." : "Loading your binder…"}
          escrow
        />
        <BuilderSide
          title={partner ? `You get from ${partner.username}` : "You get"}
          draft={ask}
          setDraft={setAsk}
          pool={theirPool ?? []}
          items={theirItems}
          shardsAvailable={null}
          emptyPool={partner ? `${partner.username} has nothing tradeable. You can still ask for cash or shards.` : "Load a player to see their cards."}
        />
      </div>

      <ValueMeter give={giveSide} get={askSide} prices={prices} />

      <label className={styles.field}>
        <span>Message (optional)</span>
        <input className={styles.input} value={message} maxLength={200} placeholder="Need her for my Myth set. Deal?" onChange={(event) => setMessage(event.target.value)} />
      </label>
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
      <div className={styles.dealActions}>
        <button type="button" className={styles.btnPrimary} disabled={!ready || busy} onClick={() => void send()}>
          {busy ? "Sending…" : counter ? "Send counter-offer" : "Send offer"}
        </button>
        {!ready ? <small className={styles.note}>Both sides need something: cards, items, cash or shards.</small> : null}
      </div>
    </ExchangeFrame>
  );
}

function BuilderSide({
  title,
  draft,
  setDraft,
  pool,
  items,
  shardsAvailable,
  emptyPool,
  escrow = false,
}: {
  title: string;
  draft: Draft;
  setDraft: (next: Draft) => void;
  pool: Pool;
  items: ItemPool;
  shardsAvailable: number | null;
  emptyPool: string;
  escrow?: boolean;
}) {
  const [filter, setFilter] = useState<Rarity | "">("");
  const [q, setQ] = useState("");
  const set = (key: string, qty: number) => {
    const picks = new Map(draft.picks);
    if (qty <= 0) picks.delete(key);
    else picks.set(key, qty);
    setDraft({ ...draft, picks });
  };
  const shown = pool
    .filter((card) => (!filter || card.rarity === filter) && (!q || `${card.symbol} ${card.name}`.toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => RARITIES.indexOf(b.rarity) - RARITIES.indexOf(a.rarity) || a.symbol.localeCompare(b.symbol));
  const byKey = new Map(pool.map((card) => [card.key, card]));
  const itemByKey = new Map(items.map((item) => [item.key, item]));
  const toggleItem = (key: string) => {
    const next = new Set(draft.items);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setDraft({ ...draft, items: next });
  };

  return (
    <section className={styles.builderSide} aria-label={title}>
      <h2 className={styles.sectionTitle}>{title}</h2>
      <div className={styles.picked}>
        {draft.picks.size ? (
          [...draft.picks.entries()].map(([key, qty]) => {
            const card = byKey.get(key);
            if (!card) return null;
            return (
              <span key={key} className={styles.pickedCard}>
                <TalentCard card={card} width={72} compact tilt={false} />
                <span className={styles.stepper}>
                  <button type="button" aria-label="One fewer" onClick={() => set(key, qty - 1)}>
                    {qty > 1 ? <FaMinus /> : <FaXmark />}
                  </button>
                  <b>{qty}</b>
                  <button type="button" aria-label="One more" disabled={qty >= card.tradeable} onClick={() => set(key, qty + 1)}>
                    <FaPlus />
                  </button>
                </span>
              </span>
            );
          })
        ) : null}
        {[...draft.items].map((key) => {
          const item = itemByKey.get(key);
          if (!item) return null;
          return (
            <span key={`item-${key}`} className={styles.pickedCard}>
              <ItemArt item={item} width={72} compact />
              <span className={styles.stepper}>
                <button type="button" aria-label={`Take ${item.name} out`} onClick={() => toggleItem(key)}>
                  <FaXmark />
                </button>
              </span>
            </span>
          );
        })}
        {!draft.picks.size && !draft.items.size ? <p className={styles.note}>Nothing yet. Pick from below.</p> : null}
      </div>
      <div className={styles.fieldRow}>
        <label className={styles.field}>
          <span>Cash</span>
          <span className={styles.moneyInput}>
            <i>$</i>
            <input inputMode="decimal" value={draft.cash} placeholder="0" onChange={(event) => setDraft({ ...draft, cash: event.target.value.replace(/[^0-9.]/g, "") })} />
          </span>
        </label>
        <label className={styles.field}>
          <span>Shards{shardsAvailable !== null ? ` · you have ${fmtInteger(shardsAvailable)}` : ""}</span>
          <input className={styles.input} inputMode="numeric" value={draft.shards} placeholder="0" onChange={(event) => setDraft({ ...draft, shards: event.target.value.replace(/[^0-9]/g, "") })} />
        </label>
      </div>
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
        <input className={styles.input} value={q} placeholder="Filter" aria-label="Filter cards" onChange={(event) => setQ(event.target.value)} />
      </div>
      {pool.length ? (
        <div className={styles.pickGrid} data-compact="">
          {shown.map((card) => {
            const qty = draft.picks.get(card.key) ?? 0;
            return (
              <button key={card.key} type="button" className={styles.pickCard} data-picked={qty > 0 || undefined} disabled={qty >= card.tradeable} onClick={() => set(card.key, qty + 1)}>
                <TalentCard card={card} width={84} compact tilt={false} />
                <small>
                  {card.tradeable - qty} left{qty ? ` · ${qty} in` : ""}
                </small>
              </button>
            );
          })}
        </div>
      ) : (
        <p className={styles.note}>{emptyPool}</p>
      )}
      {items.length ? (
        <>
          <h3 className={styles.pickerHeading}>Capsule items</h3>
          <div className={styles.pickGrid} data-compact="">
            {items.map((item) => (
              <button key={item.key} type="button" className={styles.pickCard} data-picked={draft.items.has(item.key) || undefined} onClick={() => toggleItem(item.key)} aria-pressed={draft.items.has(item.key)}>
                <ItemArt item={item} width={84} compact />
                <small>{draft.items.has(item.key) ? "in" : item.name}</small>
              </button>
            ))}
          </div>
        </>
      ) : null}
      {escrow ? (
        <small className={styles.note}>
          Your cards{draft.items.size ? " and items" : ""}
          {Number(draft.cash) ? `, ${money(Number(draft.cash))}` : ""}
          {Number(draft.shards) ? ` and shards` : ""} are held in escrow when you send, and come back if they decline.
        </small>
      ) : null}
    </section>
  );
}
