"use client";

import { useDeferredValue, useMemo, useState, type CSSProperties } from "react";
import { FaMagnifyingGlass, FaXmark } from "react-icons/fa6";
import { TalentCard } from "@/app/components/games/cards/talent-card";
import { RARITIES, RARITY_COLOR, RARITY_NAME } from "@/app/lib/games/rarity";
import type { Rarity, TalentCard as Card } from "@/app/lib/games/types";
import { unitLabel } from "@/app/lib/market-units";
import { bestRarityRank, type CollectionModel, type Pocket } from "@/app/components/games/collection/collection-model";
import styles from "@/app/components/games/collection/binder.module.scss";

type Sort = "unit" | "rarity" | "power" | "name" | "newest";
type OwnedFilter = "all" | "owned" | "missing";

const SORTS: { key: Sort; label: string }[] = [
  { key: "unit", label: "Unit" },
  { key: "rarity", label: "Rarity" },
  { key: "power", label: "Power" },
  { key: "name", label: "Name" },
  { key: "newest", label: "Newest" },
];

type Props = {
  model: CollectionModel;
  pinned: string[];
  picking: boolean;
  onCancelPick: () => void;
  onPickCard: (card: Card) => void;
  onOpen: (symbol: string, rarity: Rarity) => void;
  width: number;
};

export function Binder({ model, pinned, picking, onCancelPick, onPickCard, onOpen, width }: Props) {
  const [query, setQuery] = useState("");
  const [unit, setUnit] = useState<string | null>(null);
  const [rarity, setRarity] = useState<Rarity | null>(null);
  const [owned, setOwned] = useState<OwnedFilter>("all");
  const [sort, setSort] = useState<Sort>("unit");
  const search = useDeferredValue(query.trim().toLowerCase());

  const pinnedSet = useMemo(() => new Set(pinned), [pinned]);

  const groups = useMemo(() => {
    const has = (pocket: Pocket) => (rarity ? Boolean(pocket.owned[rarity]) : Boolean(pocket.best));
    const power = (pocket: Pocket) => (rarity ? pocket.owned[rarity]?.power ?? 0 : pocket.best?.power ?? 0);
    const list = model.pockets.filter((pocket) => {
      if (unit && pocket.unit !== unit) return false;
      if (owned === "owned" && !has(pocket)) return false;
      if (owned === "missing" && has(pocket)) return false;
      if (search && !pocket.talent.name.toLowerCase().includes(search) && !pocket.talent.symbol.toLowerCase().includes(search)) return false;
      return true;
    });
    const byName = (a: Pocket, b: Pocket) => a.talent.name.localeCompare(b.talent.name);
    if (sort === "unit") {
      return model.units
        .map((name) => ({ unit: name, pockets: list.filter((pocket) => pocket.unit === name) }))
        .filter((group) => group.pockets.length);
    }
    const sorted = [...list].sort((a, b) => {
      if (sort === "rarity") return (rarity ? power(b) - power(a) : bestRarityRank(b) - bestRarityRank(a) || power(b) - power(a)) || byName(a, b);
      if (sort === "power") return power(b) - power(a) || byName(a, b);
      if (sort === "newest") return b.newest - a.newest || byName(a, b);
      return byName(a, b);
    });
    return [{ unit: null as string | null, pockets: sorted }];
  }, [model, unit, owned, rarity, search, sort]);

  const shown = groups.reduce((sum, group) => sum + group.pockets.length, 0);
  const filtered = Boolean(unit || rarity || owned !== "all" || search);

  function reset() {
    setQuery("");
    setUnit(null);
    setRarity(null);
    setOwned("all");
  }

  return (
    <section className={styles.wrap} aria-labelledby="binder-title">
      <div className={styles.head}>
        <h2 id="binder-title" className={styles.heading}>
          Binder <small>{shown === model.pockets.length ? `${shown} talents` : `${shown} of ${model.pockets.length}`}</small>
        </h2>
      </div>

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

        <div className={styles.seg} role="group" aria-label="Rarity">
          <button type="button" aria-pressed={rarity === null} onClick={() => setRarity(null)}>
            Best
          </button>
          {RARITIES.map((entry) => (
            <button
              key={entry}
              type="button"
              aria-pressed={rarity === entry}
              onClick={() => setRarity(rarity === entry ? null : entry)}
              style={{ "--rc": RARITY_COLOR[entry] } as CSSProperties}
              data-rarity={entry}
              title={RARITY_NAME[entry]}
            >
              {entry}
            </button>
          ))}
        </div>

        <div className={styles.seg} role="group" aria-label="Owned">
          {(["all", "owned", "missing"] as OwnedFilter[]).map((entry) => (
            <button key={entry} type="button" aria-pressed={owned === entry} onClick={() => setOwned(entry)}>
              {entry}
            </button>
          ))}
        </div>

        <label className={styles.sort}>
          <span>Sort</span>
          <select value={sort} onChange={(event) => setSort(event.target.value as Sort)}>
            {SORTS.map((entry) => (
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

      {picking ? (
        <div className={styles.picking} role="status">
          <span>Tap a card you own to pin it to your showcase.</span>
          <button type="button" onClick={onCancelPick}>
            Cancel
          </button>
        </div>
      ) : null}

      {shown === 0 ? (
        <div className={styles.empty}>
          <p>Nothing in the binder matches that.</p>
          {filtered ? (
            <button type="button" onClick={reset}>
              Clear filters
            </button>
          ) : null}
        </div>
      ) : (
        groups.map((group) => {
          const have = group.pockets.filter((pocket) => pocket.best).length;
          return (
            <div key={group.unit ?? "all"} className={styles.group}>
              {group.unit ? (
                <h3 className={styles.groupHead}>
                  <span>{unitLabel(group.unit)}</span>
                  <small>
                    {have}/{group.pockets.length}
                  </small>
                </h3>
              ) : null}
              <ul className={styles.grid} style={{ "--pw": `${width}px` } as CSSProperties}>
                {group.pockets.map((pocket) => (
                  <PocketTile
                    key={pocket.talent.symbol}
                    pocket={pocket}
                    rarity={rarity}
                    model={model}
                    width={width}
                    pinned={pinnedSet}
                    picking={picking}
                    onOpen={onOpen}
                    onPickCard={onPickCard}
                  />
                ))}
              </ul>
            </div>
          );
        })
      )}
    </section>
  );
}

function PocketTile({
  pocket,
  rarity,
  model,
  width,
  pinned,
  picking,
  onOpen,
  onPickCard,
}: {
  pocket: Pocket;
  rarity: Rarity | null;
  model: CollectionModel;
  width: number;
  pinned: Set<string>;
  picking: boolean;
  onOpen: Props["onOpen"];
  onPickCard: Props["onPickCard"];
}) {
  const shownRarity: Rarity = rarity ?? pocket.best?.rarity ?? "C";
  const card = pocket.owned[shownRarity];
  const face = card ?? { ...pocket.talent, rarity: shownRarity, power: model.basePower[shownRarity], stars: 0 };
  const isPinned = card ? pinned.has(card.key) : false;
  const pickable = picking && card && !isPinned;
  const ownedCount = RARITIES.filter((entry) => pocket.owned[entry]).length;

  return (
    <li className={styles.pocket} data-pickable={pickable || undefined} data-glow={card && (shownRarity === "SSR" || shownRarity === "UR") ? shownRarity : undefined}>
      <TalentCard
        card={face}
        owned={Boolean(card)}
        width={width}
        ribbon={isPinned ? "PINNED" : null}
        onClick={() => (pickable ? onPickCard(card) : onOpen(pocket.talent.symbol, shownRarity))}
        title={`${pocket.talent.name} ${shownRarity}${card ? "" : ", not owned"}${pickable ? ". Pin to showcase" : ""}`}
        className={styles.card}
      />
      <span className={styles.pips} aria-label={`${ownedCount} of 5 rarities owned`}>
        {RARITIES.map((entry) => (
          <i
            key={entry}
            data-rarity={entry}
            data-on={Boolean(pocket.owned[entry]) || undefined}
            data-shown={entry === shownRarity || undefined}
            style={{ "--rc": RARITY_COLOR[entry] } as CSSProperties}
            title={`${entry}${pocket.owned[entry] ? ` ★${pocket.owned[entry]?.stars}` : " missing"}`}
          />
        ))}
      </span>
    </li>
  );
}

