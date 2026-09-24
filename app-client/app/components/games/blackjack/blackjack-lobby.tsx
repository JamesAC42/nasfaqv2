"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { FaEye } from "react-icons/fa6";
import { GamesFrame, SignInToPlay } from "@/app/components/games/shell/games-frame";
import { fmtInteger, fmtNumber } from "@/app/lib/format";
import { fetchBlackjackLobby, sitBlackjack } from "@/app/lib/games/api";
import { gameErrorText } from "@/app/lib/games/errors";
import type { BlackjackLobbyRow } from "@/app/lib/games/types";
import { primeChannel, useGamesChannel, useGamesConnected, useSeedChannel } from "@/app/lib/games/use-games-socket";
import { useAuth } from "@/app/providers/auth-provider";
import { Chip } from "@/app/components/games/blackjack/bj-parts";
import { HOUSE_RULES, chipsFor } from "@/app/components/games/blackjack/bj-utils";
import styles from "@/app/components/games/blackjack/blackjack-lobby.module.scss";

type LobbyPayload = { type: "lobby"; game: "blackjack"; tables: BlackjackLobbyRow[] };

const PHASE: Record<BlackjackLobbyRow["phase"], { label: string; live: boolean }> = {
  idle: { label: "Idle", live: false },
  betting: { label: "Betting", live: true },
  playing: { label: "Dealing", live: true },
  results: { label: "Results", live: true },
};

const FLAVOR: Record<string, string> = {
  low: "Warm up, learn the shoe.",
  mid: "Where the regulars sit.",
  high: "Whale tank. Bring a portfolio.",
};

// Seat dot positions along the arc, as % of the tile's felt.
const DOTS = [
  { x: 12, y: 30 },
  { x: 30, y: 62 },
  { x: 50, y: 74 },
  { x: 70, y: 62 },
  { x: 88, y: 30 },
];

export function BlackjackLobbyPage() {
  const channel = "lobby:blackjack";
  const { user } = useAuth();
  const connected = useGamesConnected();
  const router = useRouter();

  const [seed, setSeed] = useState<LobbyPayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchBlackjackLobby()
      .then((response) => {
        if (!cancelled) setSeed({ type: "lobby", game: "blackjack", tables: response.tables });
      })
      .catch((error) => {
        if (!cancelled) setLoadError(gameErrorText(error));
      });
    return () => {
      cancelled = true;
    };
  }, []);
  useSeedChannel(channel, seed);
  const live = useGamesChannel<LobbyPayload>(channel);
  const tables = live?.tables ?? seed?.tables ?? null;

  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const sit = async (key: string) => {
    setBusyKey(key);
    setErrors((current) => ({ ...current, [key]: "" }));
    try {
      const response = await sitBlackjack(key);
      primeChannel(`blackjack:${key}`, { type: "blackjack", table: response.table, server_time: response.table.server_time });
      router.push(`/games/blackjack/${key}`);
    } catch (error) {
      // Already at this table: just go there.
      if ((error as Error)?.message === "already_seated") {
        router.push(`/games/blackjack/${key}`);
        return;
      }
      setErrors((current) => ({ ...current, [key]: gameErrorText(error) }));
      setBusyKey(null);
    }
  };

  const seatedTotal = tables?.reduce((sum, table) => sum + table.seated, 0) ?? 0;
  const watching = tables?.reduce((sum, table) => sum + table.spectators, 0) ?? 0;

  return (
    <GamesFrame
      kicker="Blackjack · vs the house"
      title="Blackjack"
      live={connected}
      blurb={
        <>
          Three tables, five seats each. <b>{fmtInteger(seatedTotal)}</b> seated, <b>{fmtInteger(watching)}</b> watching.
        </>
      }
    >
      {!user ? <SignInToPlay what="take a seat. Watching is free" /> : null}
      {loadError && !tables ? <p className={styles.empty}>Couldn&apos;t reach the tables ({loadError}).</p> : null}

      <div className={styles.tables}>
        {(tables ?? []).map((table) => {
          const phase = PHASE[table.phase];
          const full = table.seated >= table.seats;
          return (
            <article key={table.key} className={styles.tile} data-key={table.key}>
              <Link href={`/games/blackjack/${table.key}`} className={styles.felt} aria-label={`Watch the ${table.name}`}>
                <span className={styles.phase} data-live={phase.live || undefined}>
                  {phase.live ? <i aria-hidden="true" /> : null}
                  {phase.label}
                </span>
                <span className={styles.watch}>
                  <FaEye aria-hidden="true" /> {fmtInteger(table.spectators)}
                </span>
                <span className={styles.chips} aria-hidden="true">
                  {chipsFor(table.min_bet, table.max_bet)
                    .slice(-3)
                    .map((value, index) => (
                      <span key={value} style={{ transform: `translate(${index * 14}px, ${index * -3}px) rotate(${index * 11 - 8}deg)` }}>
                        <Chip value={value} size={40} />
                      </span>
                    ))}
                </span>
                <span className={styles.arc} aria-hidden="true" />
                {DOTS.map((dot, index) => (
                  <span key={index} className={styles.dot} data-taken={index < table.seated || undefined} style={{ left: `${dot.x}%`, top: `${dot.y}%` }} aria-hidden="true" />
                ))}
              </Link>
              <div className={styles.info}>
                <div className={styles.nameRow}>
                  <h2>{table.name}</h2>
                  <span className={styles.seatCount}>
                    <b>{table.seated}</b>/{table.seats} seated
                  </span>
                </div>
                <p className={styles.limits}>
                  {fmtNumber(table.min_bet, "$")}
                  <span>–</span>
                  {fmtNumber(table.max_bet, "$")}
                </p>
                <p className={styles.flavor}>{FLAVOR[table.key] ?? "Five seats, one dealer."}</p>
                <div className={styles.buttons}>
                  {user ? (
                    <button type="button" className={styles.sit} onClick={() => void sit(table.key)} disabled={full || busyKey !== null}>
                      {busyKey === table.key ? "Sitting…" : full ? "Full" : "Sit"}
                    </button>
                  ) : null}
                  <Link href={`/games/blackjack/${table.key}`} className={styles.watchButton}>
                    Watch
                  </Link>
                </div>
                {errors[table.key] ? (
                  <p className={styles.error} role="alert">
                    {errors[table.key]}
                  </p>
                ) : null}
              </div>
            </article>
          );
        })}
        {!tables && !loadError ? [0, 1, 2].map((index) => <div key={index} className={styles.skeleton} aria-hidden="true" />) : null}
      </div>

      <section className={styles.rulesSection} aria-label="House rules">
        <h2 className={styles.secHead}>House rules</h2>
        <ul className={styles.rules}>
          {HOUSE_RULES.map((rule) => (
            <li key={rule.big}>
              <b>{rule.big}</b>
              <span>{rule.text}</span>
            </li>
          ))}
        </ul>
        <p className={styles.fine}>
          Bets come out of your cash the moment you place them; wins land when the dealer settles. Sit out three rounds in a row and the dealer gives your seat away.
        </p>
      </section>
    </GamesFrame>
  );
}
