"use client";

import Link from "next/link";
import { countdown } from "@/app/components/games/mahjong/tournaments/tournament-parts";
import type { Bracket as BracketData, BracketTable } from "@/app/lib/games/mahjong/types";
import styles from "@/app/components/games/mahjong/tournaments/tournaments.module.scss";

const ROUND_NAMES: Record<number, string> = { 1: "Final table", 2: "Semifinals", 4: "First round" };

function TableCard({ table, final }: { table: BracketTable; final: boolean }) {
  const results = table.result ? [...table.result].sort((a, b) => a.place - b.place) : null;
  return (
    <li className={styles.bracketTable} data-status={table.status} data-final={final || undefined}>
      <div className={styles.tableHead}>
        <b>{final ? "Final table" : `Table ${table.table + 1}`}</b>
        <span className={styles.tableStatus}>{table.status === "playing" ? "In play" : table.status === "done" ? "Done" : "Waiting"}</span>
      </div>
      <ol>
        {results
          ? results.map((row, index) => (
              <li key={index} data-through={!final && row.place <= 2 ? "" : undefined}>
                <span className={styles.place}>{row.place}</span>
                <span className={styles.name}>{row.name}</span>
                <span className={styles.pts}>{row.points.toLocaleString("en-US")}</span>
              </li>
            ))
          : table.players.map((player, index) => (
              <li key={index}>
                <span className={styles.place}>·</span>
                <span className={styles.name} data-bot={player.bot ? "" : undefined}>
                  {player.name}
                </span>
              </li>
            ))}
      </ol>
      {table.status === "playing" && table.game_id ? (
        <Link className={styles.secondary} href={`/games/mahjong/table/${table.game_id}`}>
          Watch
        </Link>
      ) : null}
      {table.status === "done" && table.game_id ? (
        <Link className={styles.tableLink} href={`/games/mahjong/replay/${table.game_id}`}>
          Replay
        </Link>
      ) : null}
    </li>
  );
}

/** The bracket as rounds of tables, left to right on a wide screen. Rounds not dealt yet show as waiting. */
export function Bracket({ bracket, shape, now }: { bracket: BracketData; shape: number[]; now: number | null }) {
  const dealt = bracket.rounds.length;
  const waiting = shape.slice(dealt);
  return (
    <div className={styles.bracket}>
      {bracket.rounds.map((round) => {
        const final = round.tables.length === 1;
        return (
          <section key={round.round} className={styles.round} aria-label={round.name}>
            <h3>{final ? "Final table" : round.name}</h3>
            <ul>
              {round.tables.map((table) => (
                <TableCard key={table.table} table={table} final={final} />
              ))}
            </ul>
          </section>
        );
      })}
      {waiting.map((tables, index) => (
        <section key={`w${index}`} className={styles.round} aria-label="Coming up" data-waiting>
          <h3>{ROUND_NAMES[tables] ?? `Round ${dealt + index + 1}`}</h3>
          <p className={styles.note}>
            {tables} {tables === 1 ? "table" : "tables"}, once the round before it finishes.
            {index === 0 && bracket.next_round_at && now !== null ? ` Deals in ${countdown(bracket.next_round_at, now)}.` : ""}
          </p>
        </section>
      ))}
    </div>
  );
}
