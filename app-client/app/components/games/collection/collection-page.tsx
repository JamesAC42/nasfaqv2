"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { GamesFrame, SignInToPlay } from "@/app/components/games/shell/games-frame";
import { fmtInteger } from "@/app/lib/format";
import { gameErrorText } from "@/app/lib/games/errors";
import type { Rarity, TalentCard as Card } from "@/app/lib/games/types";
import { useAuth } from "@/app/providers/auth-provider";
import { useGamesStore } from "@/app/stores/games-store";
import { Binder } from "@/app/components/games/collection/binder";
import { CardSheet } from "@/app/components/games/collection/card-sheet";
import { buildModel, orderedSets } from "@/app/components/games/collection/collection-model";
import { CollectionStats } from "@/app/components/games/collection/collection-stats";
import { PullTeaser } from "@/app/components/games/collection/pull-teaser";
import { ShowcaseEditor } from "@/app/components/games/collection/showcase-editor";
import { StarterPack } from "@/app/components/games/collection/starter-pack";
import { UnitSets } from "@/app/components/games/collection/unit-sets";
import { useShowcase } from "@/app/components/games/collection/use-showcase";
import styles from "@/app/components/games/collection/collection.module.scss";

export function CollectionPage() {
  const { user, initialized } = useAuth();
  const collection = useGamesStore((state) => state.collection);
  const loading = useGamesStore((state) => state.loading);
  const error = useGamesStore((state) => state.error);

  useEffect(() => {
    if (user) void useGamesStore.getState().loadCollection({ quiet: true });
  }, [user]);

  const aside = (
    <div className={styles.links}>
      <Link href="/games/cards" className={styles.linkPrimary}>
        Pull cards
      </Link>
      <Link href="/games/item-locker" className={styles.link}>
        My locker
      </Link>
    </div>
  );

  if (initialized && !user) {
    return (
      <GamesFrame kicker="Talent cards" title="Collection" blurb="Every talent, five rarities. Fill the binder." aside={aside}>
        <PullTeaser>
          <h2>Start a binder</h2>
          <p>
            Every talent has a card at C, R, SR, SSR and UR. Pull them, craft the ones you&apos;re missing, finish unit sets for badges and frames, and pin
            your best five to your profile.
          </p>
          <SignInToPlay what="start collecting" />
        </PullTeaser>
      </GamesFrame>
    );
  }

  if (!collection) {
    return (
      <GamesFrame kicker="Talent cards" title="Collection" aside={aside}>
        {error && !loading ? (
          <p className={styles.error} role="alert">
            {gameErrorText(new Error(error))}{" "}
            <button type="button" onClick={() => void useGamesStore.getState().loadCollection()}>
              Retry
            </button>
          </p>
        ) : (
          <div className={styles.skeleton} aria-busy="true" aria-label="Loading your binder">
            {Array.from({ length: 12 }, (_, index) => (
              <span key={index} />
            ))}
          </div>
        )}
      </GamesFrame>
    );
  }

  return <Loaded aside={aside} />;
}

function Loaded({ aside }: { aside: React.ReactNode }) {
  const collection = useGamesStore((state) => state.collection)!;
  const model = useMemo(() => buildModel(collection), [collection]);
  const sets = useMemo(() => orderedSets(collection.sets, model), [collection.sets, model]);
  const showcase = useShowcase(collection.showcase);
  const [starter, setStarter] = useState(() => !collection.starter_claimed);
  const [sheet, setSheet] = useState<{ symbol: string; rarity: Rarity } | null>(null);
  const [picking, setPicking] = useState<number | null>(null);
  const [cardWidth, setCardWidth] = useState(148);

  useEffect(() => {
    const query = window.matchMedia("(max-width: 720px)");
    const apply = () => setCardWidth(query.matches ? 116 : 148);
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, []);

  const cardFor = useCallback((key: string) => model.ownedByKey.get(key), [model]);
  const closeSheet = useCallback(() => setSheet(null), []);
  const openCard = useCallback((card: Card) => setSheet({ symbol: card.symbol, rarity: card.rarity }), []);

  function pickCard(card: Card) {
    showcase.pin(card.key);
    setPicking(null);
  }

  function startPick(slot: number | null) {
    setPicking(slot);
    if (slot !== null) document.getElementById("binder")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const blurb = (
    <>
      <b>{fmtInteger(model.unique)}</b> of <b>{fmtInteger(model.total)}</b> cards. Pin your best five, finish units for badges and frames.
    </>
  );

  return (
    <GamesFrame kicker="Talent cards" title="Collection" blurb={blurb} aside={aside}>
      <CollectionStats unique={model.unique} total={model.total} counts={model.counts} perRarity={collection.talents.length} shards={collection.shards} />

      {starter ? <StarterPack onDone={() => setStarter(false)} /> : null}

      <ShowcaseEditor showcase={showcase} cardFor={cardFor} picking={picking} onPick={startPick} onOpen={openCard} />

      <UnitSets sets={sets} model={model} />

      <div id="binder" className={styles.anchor}>
        <Binder
          model={model}
          pinned={showcase.keys}
          picking={picking !== null && !showcase.full}
          onCancelPick={() => setPicking(null)}
          onPickCard={pickCard}
          onOpen={(symbol, rarity) => setSheet({ symbol, rarity })}
          width={cardWidth}
        />
      </div>

      {sheet ? (
        <CardSheet
          model={model}
          symbol={sheet.symbol}
          rarity={sheet.rarity}
          onRarity={(rarity) => setSheet({ symbol: sheet.symbol, rarity })}
          shards={collection.shards}
          showcase={showcase}
          onClose={closeSheet}
        />
      ) : null}
    </GamesFrame>
  );
}
