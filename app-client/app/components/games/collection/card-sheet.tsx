"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { FaThumbtack, FaXmark } from "react-icons/fa6";
import { Oshimark } from "@/app/components/common/oshimark";
import { TalentCard } from "@/app/components/games/cards/talent-card";
import { fmtInteger } from "@/app/lib/format";
import { craftCard } from "@/app/lib/games/api";
import { gameErrorText } from "@/app/lib/games/errors";
import { MAX_STARS, RARITIES, RARITY_COLOR, RARITY_NAME } from "@/app/lib/games/rarity";
import type { Rarity } from "@/app/lib/games/types";
import { unitLabel } from "@/app/lib/market-units";
import { talentAccent } from "@/app/lib/talent-color";
import { useGamesStore } from "@/app/stores/games-store";
import type { CollectionModel } from "@/app/components/games/collection/collection-model";
import { SHOWCASE_SLOTS, type ShowcaseControls } from "@/app/components/games/collection/use-showcase";
import styles from "@/app/components/games/collection/card-sheet.module.scss";

type Props = {
  model: CollectionModel;
  symbol: string;
  rarity: Rarity;
  onRarity: (rarity: Rarity) => void;
  shards: number;
  showcase: ShowcaseControls;
  onClose: () => void;
};

type Moment = { id: number; text: string; rarity: Rarity };

/** One talent's cards, big: flip through rarities, craft, pin. Side sheet on desktop, bottom sheet on phone. */
export function CardSheet({ model, symbol, rarity, onRarity, shards, showcase, onClose }: Props) {
  const pocket = model.bySymbol.get(symbol);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [moment, setMoment] = useState<Moment | null>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, [onClose]);

  useEffect(() => {
    if (!moment) return;
    const timer = window.setTimeout(() => setMoment(null), 2200);
    return () => window.clearTimeout(timer);
  }, [moment]);

  if (!pocket) return null;
  const { talent } = pocket;
  const card = pocket.owned[rarity];
  const owned = Boolean(card);
  const stars = card?.stars ?? 0;
  const base = model.basePower[rarity];
  const power = card?.power ?? base;
  const cost = model.craftCost[rarity];
  const maxed = stars >= MAX_STARS;
  const short = Math.max(0, cost - shards);
  const pinnedAt = card ? showcase.keys.indexOf(card.key) : -1;

  async function craft() {
    setBusy(true);
    setError(null);
    try {
      const result = await craftCard(`card:${symbol}:${rarity}`);
      useGamesStore.getState().setShards(result.shards);
      await useGamesStore.getState().loadCollection({ quiet: true });
      const isNew = result.card.was_new ?? !owned;
      setMoment({ id: Date.now(), rarity, text: isNew ? "NEW!" : `★${result.card.stars}` });
    } catch (err) {
      setError(gameErrorText(err));
    } finally {
      setBusy(false);
    }
  }

  const craftLabel = maxed ? `Maxed at ★${MAX_STARS}` : owned ? `Craft a copy · +★` : `Craft ${rarity}`;
  const craftReason = maxed ? "More copies would only cost shards." : short > 0 ? `Need ${fmtInteger(short)} more shards.` : null;

  return (
    <>
      <div className={styles.scrim} onClick={onClose} aria-hidden="true" />
      <aside
        className={styles.sheet}
        role="dialog"
        aria-modal="true"
        aria-label={`${talent.name} cards`}
        style={{ "--tal": talentAccent(talent.color), "--rc": RARITY_COLOR[rarity] } as CSSProperties}
        data-rarity={rarity}
      >
        <div className={styles.top}>
          <span className={styles.who}>
            <Oshimark icon={talent.icon} symbol={talent.symbol} size={18} />
            <b>{talent.symbol}</b>
            {talent.unit ? <span>{unitLabel(talent.unit)}</span> : null}
          </span>
          <button ref={closeRef} type="button" className={styles.close} onClick={onClose} aria-label="Close">
            <FaXmark aria-hidden="true" />
          </button>
        </div>

        <div className={styles.stage}>
          <span className={styles.glow} aria-hidden="true" />
          <div className={styles.cardBox} key={rarity}>
            <TalentCard card={card ?? { ...talent, rarity, power: base, stars: 0 }} owned={owned} width={300} tilt={owned} />
            {moment ? (
              <span key={moment.id} className={styles.moment} data-rarity={moment.rarity} aria-hidden="true">
                {moment.text}
              </span>
            ) : null}
          </div>
          <h2 className={styles.name}>{talent.name}</h2>
          <p className={styles.rarityName}>
            {RARITY_NAME[rarity]} <span>· {rarity}</span>
          </p>
        </div>

        <div className={styles.tabs} role="tablist" aria-label="Rarity">
          {RARITIES.map((entry) => {
            const has = Boolean(pocket.owned[entry]);
            return (
              <button
                key={entry}
                type="button"
                role="tab"
                aria-selected={entry === rarity}
                data-rarity={entry}
                data-owned={has || undefined}
                style={{ "--rc": RARITY_COLOR[entry] } as CSSProperties}
                onClick={() => {
                  setError(null);
                  onRarity(entry);
                }}
                aria-label={`${entry} ${RARITY_NAME[entry]}${has ? `, owned ★${pocket.owned[entry]?.stars}` : ", not owned"}`}
              >
                <b>{entry}</b>
                <small>{has ? `★${pocket.owned[entry]?.stars}` : "—"}</small>
              </button>
            );
          })}
        </div>

        <p className={styles.live} aria-live="polite">
          {moment ? `Crafted ${talent.name} ${rarity}: ${moment.text === "NEW!" ? "new card" : `now ${moment.text}`}.` : ""}
        </p>

        <dl className={styles.facts}>
          <div>
            <dt>In binder</dt>
            <dd>
              {owned ? (
                <>
                  <span className={styles.stars} aria-label={`${stars} of ${MAX_STARS} stars`}>
                    {Array.from({ length: MAX_STARS }, (_, index) => (
                      <i key={index} data-on={index < stars || undefined} />
                    ))}
                  </span>
                  <small>
                    {fmtInteger(card?.copies ?? 1)} cop{(card?.copies ?? 1) === 1 ? "y" : "ies"}
                  </small>
                </>
              ) : (
                <span className={styles.missing}>Not yet</span>
              )}
            </dd>
          </div>
          <div>
            <dt>Duel power</dt>
            <dd>
              <b>{power}</b>
              <small>{owned && stars > 1 ? `${base} + ${stars - 1}★` : `base ${base}`}</small>
            </dd>
          </div>
          <div>
            <dt>Drop rate</dt>
            <dd>
              <b>{(model.dropBps[rarity] / 100).toFixed(model.dropBps[rarity] < 100 ? 1 : 0)}%</b>
              <small>per pull</small>
            </dd>
          </div>
          <div>
            <dt>Dupe value</dt>
            <dd>
              <b>{fmtInteger(model.dupShards[rarity])}</b>
              <small>shards</small>
            </dd>
          </div>
        </dl>

        <div className={styles.actions}>
          <div className={styles.action}>
            <button type="button" className={styles.craft} onClick={() => void craft()} disabled={busy || maxed || short > 0}>
              {busy ? (
                "Crafting…"
              ) : (
                <>
                  {craftLabel}
                  {maxed ? null : (
                    <span className={styles.cost}>
                      <i aria-hidden="true" />
                      {fmtInteger(cost)}
                    </span>
                  )}
                </>
              )}
            </button>
            {error ? (
              <p className={styles.error} role="alert">
                {error}
              </p>
            ) : craftReason ? (
              <p className={styles.reason}>{craftReason}</p>
            ) : (
              <p className={styles.reason}>
                You have {fmtInteger(shards)} shards{owned ? "; a copy adds a star." : "."}
              </p>
            )}
          </div>

          <div className={styles.action}>
            {card ? (
              pinnedAt >= 0 ? (
                <button type="button" className={styles.pin} data-pinned onClick={() => showcase.unpin(card.key)}>
                  <FaThumbtack aria-hidden="true" /> Pinned · slot {pinnedAt + 1} · unpin
                </button>
              ) : (
                <button type="button" className={styles.pin} onClick={() => showcase.pin(card.key)} disabled={showcase.full}>
                  <FaThumbtack aria-hidden="true" /> Pin to showcase
                </button>
              )
            ) : (
              <button type="button" className={styles.pin} disabled>
                <FaThumbtack aria-hidden="true" /> Pin to showcase
              </button>
            )}
            <p className={styles.reason}>
              {!card
                ? "Own it to pin it."
                : pinnedAt >= 0
                  ? "On your profile and locker."
                  : showcase.full
                    ? `Showcase is full (${SHOWCASE_SLOTS}). Unpin one first.`
                    : `${showcase.keys.length}/${SHOWCASE_SLOTS} pinned.`}
            </p>
          </div>
        </div>

        <div className={styles.foot}>
          <span>{owned ? "Dupes from pulls add stars too." : "Or pull for it and save the shards."}</span>
          <Link href="/games/cards">Pull cards →</Link>
        </div>
      </aside>
    </>
  );
}
