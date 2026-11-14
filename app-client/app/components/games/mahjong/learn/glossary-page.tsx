"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { LearnFrame } from "@/app/components/games/mahjong/learn/learn-frame";
import { MAHJONG_TERMS, termAnchor } from "@/app/lib/games/mahjong/terms";
import { YAKU_LIST } from "@/app/lib/games/mahjong/yaku";
import styles from "@/app/components/games/mahjong/learn/reference.module.scss";
import learn from "@/app/components/games/mahjong/learn/learn.module.scss";

const YAKU_BY_JAPANESE = new Map(YAKU_LIST.map((info) => [info.japanese.toLowerCase(), info.key]));
const SORTED = [...MAHJONG_TERMS].sort((a, b) => a.term.localeCompare(b.term, "en", { sensitivity: "base" }));

export function GlossaryPage() {
  const [query, setQuery] = useState("");

  const letters = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matches = needle ? SORTED.filter((entry) => [entry.term, entry.english, entry.explain, entry.reading ?? ""].some((text) => text.toLowerCase().includes(needle))) : SORTED;
    const byLetter = new Map<string, typeof SORTED>();
    for (const entry of matches) {
      const letter = entry.term[0].toUpperCase();
      byLetter.set(letter, [...(byLetter.get(letter) ?? []), entry]);
    }
    return [...byLetter.entries()];
  }, [query]);

  const total = letters.reduce((sum, [, items]) => sum + items.length, 0);
  const present = new Set(SORTED.map((entry) => entry.term[0].toUpperCase()));
  const shownLetters = new Set(letters.map(([letter]) => letter));

  return (
    <LearnFrame
      title="Glossary"
      blurb={
        <>
          The Japanese words you’ll hear at a mahjong table, in plain English. <b>{MAHJONG_TERMS.length}</b> terms.
        </>
      }
    >
      <div className={styles.controls}>
        <label className={styles.search}>
          <span className={styles.sr}>Search the glossary</span>
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search a word or what it means…" />
        </label>
        <span className={styles.count} aria-live="polite">
          {total} shown
        </span>
      </div>
      <nav className={styles.letters} aria-label="Jump to a letter">
        {[...present].sort().map((letter) =>
          shownLetters.has(letter) ? (
            <a key={letter} href={`#letter-${letter}`}>
              {letter}
            </a>
          ) : (
            <span key={letter} aria-hidden="true">
              {letter}
            </span>
          ),
        )}
      </nav>
      {letters.length === 0 ? (
        <p className={styles.empty}>No such word. Try the English: “wait”, “fold”, “dealer”.</p>
      ) : (
        letters.map(([letter, items]) => (
          <section key={letter} id={`letter-${letter}`} className={styles.group}>
            <h2 className={learn.headRow}>{letter}</h2>
            <dl className={styles.terms}>
              {items.map((entry) => {
                const yaku = YAKU_BY_JAPANESE.get(entry.term.toLowerCase());
                return (
                  <div key={entry.term} id={termAnchor(entry.term)} className={styles.entry}>
                    <dt>
                      {entry.term}
                      {entry.reading ? <small>{entry.reading}</small> : null}
                    </dt>
                    <dd>
                      <b>{entry.english}</b>
                      <span>
                        {entry.explain}
                        {yaku ? (
                          <>
                            {" "}
                            <Link href={`/games/mahjong/learn/yaku#${yaku}`}>See the pictured hand →</Link>
                          </>
                        ) : null}
                      </span>
                    </dd>
                  </div>
                );
              })}
            </dl>
          </section>
        ))
      )}
    </LearnFrame>
  );
}
