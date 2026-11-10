"use client";

import { useMemo, useState } from "react";
import { usePhone } from "@/app/components/games/arcade/use-media";
import { LearnFrame } from "@/app/components/games/mahjong/learn/learn-frame";
import { TileRow, rowFromExample } from "@/app/components/games/mahjong/tile";
import { YAKU, YAKU_GROUPS, yakuValueText, type YakuInfo } from "@/app/lib/games/mahjong/yaku";
import learn from "@/app/components/games/mahjong/learn/learn.module.scss";
import styles from "@/app/components/games/mahjong/learn/reference.module.scss";

type Filter = "all" | "closed" | "open" | "yakuman";

const FILTERS: { key: Filter; label: string; test: (info: YakuInfo) => boolean }[] = [
  { key: "all", label: "All", test: () => true },
  { key: "closed", label: "Closed only", test: (info) => info.open === null },
  { key: "open", label: "Works open", test: (info) => info.open !== null },
  { key: "yakuman", label: "Yakuman", test: (info) => info.yakuman },
];

/** The pictured example, or nothing if its notation can't be dealt from one set of tiles (never take the whole page down for one picture). */
function Example({ info }: { info: YakuInfo }) {
  const phone = usePhone();
  let row: ReturnType<typeof rowFromExample> | null = null;
  try {
    row = rowFromExample(info.example);
  } catch {
    row = null;
  }
  return (
    <div className={styles.example}>
      {row ? <TileRow {...row} size={phone ? 20 : 26} /> : null}
      <span>{info.example.caption}</span>
    </div>
  );
}

function Value({ info }: { info: YakuInfo }) {
  if (info.yakuman) return <span className={styles.value}>{info.open === null ? "Yakuman · closed only" : "Yakuman · open or closed"}</span>;
  return (
    <span className={styles.value}>
      {info.closed} han closed · {info.open === null ? "closed only" : info.open === info.closed ? "same open" : `${info.open} open`}
    </span>
  );
}

export function YakuPage() {
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");

  const groups = useMemo(() => {
    const test = FILTERS.find((entry) => entry.key === filter)?.test ?? (() => true);
    const needle = query.trim().toLowerCase();
    return YAKU_GROUPS.map((group) => ({
      title: group.title,
      items: group.keys
        .map((key) => YAKU[key])
        .filter((info) => test(info) && (!needle || [info.name, info.japanese, info.explain, info.example.caption, yakuValueText(info)].some((text) => text.toLowerCase().includes(needle)))),
    })).filter((group) => group.items.length > 0);
  }, [filter, query]);

  const shown = groups.reduce((sum, group) => sum + group.items.length, 0);

  return (
    <LearnFrame
      title="Yaku"
      blurb={
        <>
          Every pattern that lets a hand win, with its han and a hand that has it. A winning hand needs at least one; dora are not yaku.
        </>
      }
    >
      <div className={learn.prose} style={{ paddingTop: "1rem" }}>
        <p>
          An open hand (one with a called set) loses a han on the patterns marked, and can’t use the ones marked closed. Closed kans don’t open a hand. Every yakuman is worth one limit, different yakuman in one hand add
          up, and there are no double yakuman for special waits. A hand of 13 han or more from ordinary yaku and dora counts as a yakuman too.
        </p>
      </div>

      <div className={styles.controls}>
        <div className={styles.chips} role="group" aria-label="Filter yaku">
          {FILTERS.map((entry) => (
            <button key={entry.key} type="button" aria-pressed={filter === entry.key} onClick={() => setFilter(entry.key)}>
              {entry.label}
            </button>
          ))}
        </div>
        <label className={styles.search}>
          <span className={styles.sr}>Search the yaku</span>
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by name or what it needs…" />
        </label>
        <span className={styles.count} aria-live="polite">
          {shown} shown
        </span>
      </div>

      {groups.length === 0 ? (
        <p className={styles.empty}>Nothing matches. Try fewer words, or clear the filter.</p>
      ) : (
        groups.map((group) => (
          <section key={group.title} className={styles.group} aria-labelledby={`group-${group.title.replace(/\s+/g, "-")}`}>
            <h2 id={`group-${group.title.replace(/\s+/g, "-")}`} className={learn.headRow}>
              {group.title}
            </h2>
            <ul className={styles.yakuList}>
              {group.items.map((info) => (
                <li key={info.key} id={info.key} className={styles.yaku}>
                  <div className={styles.yakuHead}>
                    <h3>
                      <a href={`#${info.key}`}>{info.name}</a>
                    </h3>
                    <span className={styles.japanese}>{info.japanese}</span>
                    <Value info={info} />
                  </div>
                  <p>{info.explain}</p>
                  <Example info={info} />
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </LearnFrame>
  );
}
