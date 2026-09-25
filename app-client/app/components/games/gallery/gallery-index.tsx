"use client";

import Link from "next/link";
import { useDeferredValue, useMemo, useState, type CSSProperties } from "react";
import { FaMagnifyingGlass, FaXmark } from "react-icons/fa6";
import { Oshimark } from "@/app/components/common/oshimark";
import { SceneArt } from "@/app/components/common/scene-art";
import type { CollectionModel, Pocket } from "@/app/components/games/collection/collection-model";
import { KeyArt, RarityPips } from "@/app/components/games/gallery/gallery-art";
import { collectionOrder, galleryTotals, isComplete, ownedCount, useGallery, type GalleryTotals } from "@/app/components/games/gallery/gallery-model";
import { GamesFrame, SignInToPlay } from "@/app/components/games/shell/games-frame";
import { fmtInteger } from "@/app/lib/format";
import { gameErrorText } from "@/app/lib/games/errors";
import { RARITIES, RARITY_COLOR, RARITY_NAME } from "@/app/lib/games/rarity";
import { unitLabel } from "@/app/lib/market-units";
import { talentAccent } from "@/app/lib/talent-color";
import { useGamesStore } from "@/app/stores/games-store";
import styles from "@/app/components/games/gallery/gallery.module.scss";

type Sort = "collection" | "complete" | "name";
type Show = "all" | "complete" | "missing";

const SORTS: { key: Sort; label: string }[] = [
  { key: "collection", label: "Collection order" },
  { key: "complete", label: "Most complete" },
  { key: "name", label: "Name" },
];

const SHOWS: { key: Show; label: string }[] = [
  { key: "all", label: "All" },
  { key: "complete", label: "Complete" },
  { key: "missing", label: "Missing art" },
];

export function GalleryIndex() {
  const { model, signedIn, ready, error } = useGallery();
  const totals = useMemo(() => (model ? galleryTotals(model) : null), [model]);

  const aside = (
    <div className={styles.links}>
      <Link href="/games/collection" className={styles.link}>
        Binder
      </Link>
      <Link href="/games/cards" className={styles.linkPrimary}>
        Pull cards
      </Link>
    </div>
  );

  const blurb = totals ? (
    <>
      <b>{fmtInteger(totals.unlocked)}</b> of <b>{fmtInteger(totals.total)}</b> illustrations unlocked. Pull a card, hang its art.
    </>
  ) : (
    "Every talent, five illustrations each. Pull a card, hang its art."
  );

  return (
    <GamesFrame kicker="Talent cards" title="Gallery" blurb={blurb} aside={aside}>
      <ProgressHero totals={totals} signedIn={signedIn} ready={ready} />
      {model ? (
        <Wall model={model} signedIn={signedIn} />
      ) : error ? (
        <p className={styles.error} role="alert">
          {gameErrorText(new Error(error))}{" "}
          <button type="button" onClick={() => void useGamesStore.getState().loadCollection()}>
            Retry
          </button>
        </p>
      ) : (
        <div className={styles.skeleton} aria-busy="true" aria-label="Loading the gallery">
          {Array.from({ length: 12 }, (_, index) => (
            <span key={index} />
          ))}
        </div>
      )}
    </GamesFrame>
  );
}

// ── Progress header ────────────────────────────────────────────────────────
function ProgressHero({ totals, signedIn, ready }: { totals: GalleryTotals | null; signedIn: boolean; ready: boolean }) {
  const pct = totals && totals.total ? (totals.unlocked / totals.total) * 100 : 0;
  return (
    <section className={styles.hero} aria-labelledby="gallery-progress">
      <div className={styles.heroBg} aria-hidden="true">
        <SceneArt slot="gallery-hero" fill position="75% 50%" width={1400} priority />
        <span className={styles.heroShade} />
      </div>
      <div className={styles.heroMain}>
        <h2 id="gallery-progress" className={styles.heroLabel}>
          Illustrations unlocked
        </h2>
        <p className={styles.heroCount}>
          <b>{totals ? fmtInteger(totals.unlocked) : "—"}</b>
          <span>/ {totals ? fmtInteger(totals.total) : "—"}</span>
          <small>{totals ? `${pct.toFixed(pct > 0 && pct < 1 ? 1 : 0)}%` : ""}</small>
        </p>
        <div className={styles.bar} role="img" aria-label={totals ? RARITIES.map((rarity) => `${rarity} ${totals.byRarity[rarity]} of ${totals.talents}`).join(", ") : "Loading"}>
          {RARITIES.map((rarity) => (
            <span key={rarity} style={{ "--rc": RARITY_COLOR[rarity], "--fill": totals && totals.talents ? totals.byRarity[rarity] / totals.talents : 0 } as CSSProperties} data-rarity={rarity}>
              <i />
            </span>
          ))}
        </div>
        <ul className={styles.barKey}>
          {RARITIES.map((rarity) => (
            <li key={rarity} style={{ "--rc": RARITY_COLOR[rarity] } as CSSProperties}>
              <b>{rarity}</b>
              <span>{RARITY_NAME[rarity]}</span>
              <em>
                {totals ? fmtInteger(totals.byRarity[rarity]) : "—"}
                <small>/{totals ? totals.talents : "—"}</small>
              </em>
            </li>
          ))}
        </ul>
      </div>
      <div className={styles.heroSide}>
        {ready && !signedIn ? (
          <div className={styles.heroSignIn}>
            <p>Every wall starts empty. Pull or craft a card and its illustration goes up.</p>
            <SignInToPlay what="start unlocking art" />
          </div>
        ) : (
          <dl className={styles.heroStats}>
            <div>
              <dt>Full sets</dt>
              <dd>
                {totals ? fmtInteger(totals.complete) : "—"}
                <small>/{totals?.talents ?? "—"}</small>
              </dd>
            </div>
            <div>
              <dt>Banners</dt>
              <dd>
                {totals ? fmtInteger(totals.banners) : "—"}
                <small>/{totals?.talents ?? "—"}</small>
              </dd>
            </div>
            <div>
              <dt>Reactions</dt>
              <dd>
                {totals ? fmtInteger(totals.reactions) : "—"}
                <small>/{totals?.talents ?? "—"}</small>
              </dd>
            </div>
          </dl>
        )}
      </div>
    </section>
  );
}

// ── The wall ───────────────────────────────────────────────────────────────
function Wall({ model, signedIn }: { model: CollectionModel; signedIn: boolean }) {
  const [query, setQuery] = useState("");
  const [unit, setUnit] = useState<string | null>(null);
  const [show, setShow] = useState<Show>("all");
  const [sort, setSort] = useState<Sort>("collection");
  const search = useDeferredValue(query.trim().toLowerCase());
  const ordered = useMemo(() => collectionOrder(model), [model]);

  const groups = useMemo(() => {
    const list = ordered.filter((pocket) => {
      if (unit && pocket.unit !== unit) return false;
      if (show === "complete" && !isComplete(pocket)) return false;
      if (show === "missing" && isComplete(pocket)) return false;
      if (search && !pocket.talent.name.toLowerCase().includes(search) && !pocket.talent.symbol.toLowerCase().includes(search)) return false;
      return true;
    });
    if (sort === "collection") {
      return model.units.map((name) => ({ unit: name as string | null, pockets: list.filter((pocket) => pocket.unit === name) })).filter((group) => group.pockets.length);
    }
    const byName = (a: Pocket, b: Pocket) => a.talent.name.localeCompare(b.talent.name);
    const sorted = [...list].sort((a, b) => (sort === "complete" ? ownedCount(b) - ownedCount(a) || byName(a, b) : byName(a, b)));
    return [{ unit: null as string | null, pockets: sorted }];
  }, [ordered, model.units, unit, show, search, sort]);

  const shown = groups.reduce((sum, group) => sum + group.pockets.length, 0);
  const filtered = Boolean(unit || show !== "all" || search);

  return (
    <section className={styles.wall} aria-labelledby="wall-title">
      <h2 id="wall-title" className={styles.heading}>
        Talents <small>{shown === model.pockets.length ? `${shown}` : `${shown} of ${model.pockets.length}`}</small>
      </h2>

      <div className={styles.filters}>
        <label className={styles.search}>
          <FaMagnifyingGlass aria-hidden="true" />
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name or ticker" aria-label="Search by name or ticker" />
          {query ? (
            <button type="button" onClick={() => setQuery("")} aria-label="Clear search">
              <FaXmark aria-hidden="true" />
            </button>
          ) : null}
        </label>

        {signedIn ? (
          <div className={styles.seg} role="group" aria-label="Show">
            {SHOWS.map((entry) => (
              <button key={entry.key} type="button" aria-pressed={show === entry.key} onClick={() => setShow(entry.key)}>
                {entry.label}
              </button>
            ))}
          </div>
        ) : null}

        <label className={styles.sort}>
          <span>Sort</span>
          <select value={sort} onChange={(event) => setSort(event.target.value as Sort)}>
            {SORTS.filter((entry) => signedIn || entry.key !== "complete").map((entry) => (
              <option key={entry.key} value={entry.key}>
                {entry.label}
              </option>
            ))}
          </select>
        </label>

        <div className={styles.units} role="group" aria-label="Unit">
          <button type="button" className={styles.chip} aria-pressed={unit === null} onClick={() => setUnit(null)}>
            All units
          </button>
          {model.units.map((name) => (
            <button key={name} type="button" className={styles.chip} aria-pressed={unit === name} onClick={() => setUnit(unit === name ? null : name)}>
              {unitLabel(name)}
            </button>
          ))}
        </div>
      </div>

      {shown === 0 ? (
        <div className={styles.empty}>
          <p>{show === "complete" && !search && !unit ? "No full sets yet. Five rarities of one talent hangs a set." : "Nothing on the wall matches that."}</p>
          {filtered ? (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                setUnit(null);
                setShow("all");
              }}
            >
              Clear filters
            </button>
          ) : null}
        </div>
      ) : (
        groups.map((group) => {
          const have = group.pockets.reduce((sum, pocket) => sum + ownedCount(pocket), 0);
          return (
            <div key={group.unit ?? "all"} className={styles.group}>
              {group.unit ? (
                <h3 className={styles.groupHead}>
                  <span>{unitLabel(group.unit)}</span>
                  <small>
                    {have}/{group.pockets.length * RARITIES.length}
                  </small>
                </h3>
              ) : null}
              <ul className={styles.grid}>
                {group.pockets.map((pocket) => (
                  <Tile key={pocket.talent.symbol} pocket={pocket} />
                ))}
              </ul>
            </div>
          );
        })
      )}
    </section>
  );
}

function Tile({ pocket }: { pocket: Pocket }) {
  const { talent } = pocket;
  const count = ownedCount(pocket);
  const complete = count === RARITIES.length;
  return (
    <li className={styles.tile} data-state={complete ? "complete" : count ? "started" : "empty"} style={{ "--tal": talentAccent(talent.color) } as CSSProperties}>
      <Link href={`/games/cards/gallery/${encodeURIComponent(talent.symbol)}`} className={styles.tileLink} aria-label={`${talent.name}: ${count} of 5 illustrations${complete ? ", complete" : ""}`}>
        <span className={styles.tileArt}>
          <KeyArt talent={talent} width={200} plain className={styles.tileKeyart} />
          {complete ? <span className={styles.complete}>Full set</span> : null}
        </span>
        <span className={styles.tilePlate}>
          <span className={styles.tileName}>
            <Oshimark icon={talent.icon} symbol={talent.symbol} size={16} />
            <b>{talent.name}</b>
          </span>
          <span className={styles.tileMeta}>
            <RarityPips owned={pocket.owned} />
            <em>
              {count}/{RARITIES.length}
            </em>
          </span>
        </span>
      </Link>
    </li>
  );
}
