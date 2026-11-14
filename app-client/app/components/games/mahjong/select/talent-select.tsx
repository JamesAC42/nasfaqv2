"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { ReactionFace } from "@/app/components/common/reaction-face";
import { CursorLayer, useCursorFeed, useCursorSender, type CursorLabel } from "@/app/components/games/mahjong/select/cursors";
import { apiErrorCode } from "@/app/lib/api";
import { gameErrorText } from "@/app/lib/games/errors";
import { mahjongChannels, selectMahjong } from "@/app/lib/games/mahjong/api";
import { motionOff } from "@/app/lib/games/mahjong/motion";
import { playCue } from "@/app/lib/games/mahjong/sound";
import { seatLabel } from "@/app/lib/games/mahjong/table-model";
import type { MahjongTable, SeatedTable, SeatIndex, SelectAction, TableSelect } from "@/app/lib/games/mahjong/types";
import { useRemaining } from "@/app/lib/games/use-remaining";
import { talentAccent } from "@/app/lib/talent-color";
import { useTheme } from "@/app/providers/theme-provider";
import { useMarketStore } from "@/app/stores/market-store";
import styles from "@/app/components/games/mahjong/select/talent-select.module.scss";

// The talent select before a table's first deal (api/src/services/games/mahjong/tables.js): every seat
// picks a talent nobody else has, readies up, and the table deals once all are ready or the clock runs
// out. Picks show at once and are taken back if the server says someone got there first.
//
// The stage (the talent grid) has the same shape at every width: a column count fixed by the roster's
// size, square cards and gaps measured in the stage's own width (container units). So a position given
// as a fraction of the stage lands on the same card for every viewer, which is what the live pointers
// (cursors.tsx) are sent in. Cards are laid out in the roster's order, which comes from the server.

const SEATS = [0, 1, 2, 3] as const;

/** Columns for a roster of `count`: about 1.4 times as wide as tall, whatever the screen. */
export function columnsFor(count: number) {
  return Math.min(12, Math.max(4, Math.round(Math.sqrt(count * 1.4))));
}

type TalentInfo = { name: string; color: string; group: string | null };

const clock = (ms: number | null) => (ms === null ? null : `${Math.ceil(ms / 1000)}`);

export type TalentSelectProps = {
  table: MahjongTable | SeatedTable;
  select: TableSelect;
  mySeat: SeatIndex | null;
  apply: (table: SeatedTable) => void;
  onLeave: () => void;
  leaving: boolean;
  /** Stands in for the API (the dev preview). */
  onAction?: (action: SelectAction) => Promise<{ table: SeatedTable }>;
};

export function TalentSelect({ table, select, mySeat, apply, onLeave, leaving, onAction }: TalentSelectProps) {
  const assets = useMarketStore((state) => state.assets);
  const { theme } = useTheme();
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [pending, setPending] = useState<{ talent: string; seq: number } | null>(null);
  const [readyBusy, setReadyBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [popped, setPopped] = useState<string | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const seq = useRef(0);

  const info = useMemo(() => {
    const map = new Map<string, TalentInfo>();
    for (const symbol of select.roster) {
      const asset = assets.find((entry) => entry.symbol === symbol);
      map.set(symbol, { name: asset?.display_name ?? symbol, color: talentAccent(asset?.color, theme), group: asset?.unit ?? null });
    }
    return map;
  }, [assets, select.roster, theme]);

  const seated = mySeat !== null;
  const mine = seated ? select.picks[mySeat] : null;
  const myPick = pending?.talent ?? mine?.talent ?? null;
  const imReady = Boolean(mine?.ready);
  // Everyone is set (or the clock ran out): the deal is a beat away and nothing changes now.
  const closed = select.starts_at !== null;

  // Who holds which talent, with your pending pick in place of your confirmed one.
  const holders = useMemo(() => {
    const map = new Map<string, number>();
    for (const entry of select.picks) {
      if (entry.talent && !(seated && entry.seat === mySeat)) map.set(entry.talent, entry.seat);
    }
    if (seated && myPick) map.set(myPick, mySeat);
    return map;
  }, [myPick, mySeat, seated, select.picks]);

  // ── Pointers ──────────────────────────────────────────────────────────
  const streaming = select.cursors;
  // The preview (onAction) has no table on the server to send a pointer to.
  const { hover, handlers } = useCursorSender(table.id, streaming && seated && !closed && !onAction, stageRef);
  const feed = useCursorFeed(streaming ? mahjongChannels.cursors(table.id) : null, mySeat);
  const labels: CursorLabel[] = useMemo(
    () => feed.seats.filter((seat) => table.seats[seat] && !table.seats[seat]?.bot).map((seat) => ({ seat, name: seatLabel(table.seats[seat]) })),
    [feed.seats, table.seats],
  );
  const hoveredBy = useMemo(() => {
    const map = new Map<string, number[]>();
    for (const [seat, symbol] of Object.entries(feed.hovers)) {
      if (!symbol) continue;
      map.set(symbol, [...(map.get(symbol) ?? []), Number(seat)]);
    }
    return map;
  }, [feed.hovers]);

  // ── Clock and the start ───────────────────────────────────────────────
  const left = useRemaining(select.deadline, 250);
  const startIn = useRemaining(select.starts_at, 100);
  const startingRef = useRef(select.starts_at);
  useEffect(() => {
    if (select.starts_at && !startingRef.current) playCue("game_start");
    startingRef.current = select.starts_at;
  }, [select.starts_at]);
  const seconds = left === null ? null : Math.ceil(left / 1000);
  useEffect(() => {
    if (seated && !imReady && seconds !== null && seconds > 0 && seconds <= 5) playCue("clock_low");
  }, [imReady, seated, seconds]);

  useEffect(() => {
    if (!popped) return;
    const timer = window.setTimeout(() => setPopped(null), 650);
    return () => window.clearTimeout(timer);
  }, [popped]);

  // ── Moves ─────────────────────────────────────────────────────────────
  const send = (action: SelectAction) => (onAction ? onAction(action) : selectMahjong(table.id, action));

  const pick = (talent: string) => {
    if (!seated || imReady || closed || talent === myPick) return;
    const holder = holders.get(talent);
    if (holder !== undefined && holder !== mySeat) return;
    playCue("ui_click");
    if (!motionOff()) setPopped(talent);
    seq.current += 1;
    const mineSeq = seq.current;
    setPending({ talent, seq: mineSeq });
    setMessage(null);
    send({ action: "mj-pick-talent", talent })
      .then((response) => {
        apply(response.table);
      })
      .catch((error: unknown) => {
        if (apiErrorCode(error) === "talent_taken") {
          const by = (error as { body?: { seat?: unknown } })?.body?.seat;
          const who = typeof by === "number" ? seatLabel(table.seats[by]) : "someone else";
          setMessage(`${info.get(talent)?.name ?? talent} was just taken by ${who}.`);
        } else {
          setMessage(gameErrorText(error));
        }
      })
      .finally(() => {
        setPending((current) => (current?.seq === mineSeq ? null : current));
      });
  };

  const toggleReady = () => {
    if (!seated || readyBusy || closed) return;
    if (!imReady && !myPick) return;
    playCue("ui_click");
    setReadyBusy(true);
    setMessage(null);
    send({ action: "mj-ready", ready: !imReady })
      .then((response) => apply(response.table))
      .catch((error: unknown) => setMessage(gameErrorText(error)))
      .finally(() => setReadyBusy(false));
  };

  // ── Layout ────────────────────────────────────────────────────────────
  const columns = columnsFor(select.roster.length);
  const focus = hover ?? myPick;
  const focusInfo = focus ? info.get(focus) : null;
  const waitingOn = SEATS.filter((seat) => table.seats[seat] && !table.seats[seat]?.bot && !select.picks[seat]?.ready).length;

  let headline: string;
  if (startIn !== null) headline = startIn > 0 ? "Everyone’s set. Dealing…" : "Dealing…";
  else if (!seated) headline = "Players are choosing their talents";
  else if (imReady) headline = waitingOn ? `Ready. Waiting on ${waitingOn === 1 ? "one more player" : `${waitingOn} players`}…` : "Ready.";
  else if (myPick) headline = "Happy with that? Lock it in.";
  else headline = "Choose who you play as";

  return (
    <section className={styles.root} aria-label="Talent select">
      <header className={styles.head}>
        <div>
          <small className={styles.kicker}>Before the deal</small>
          <h2>{headline}</h2>
        </div>
        {select.deadline !== null && startIn === null ? (
          <div className={styles.timer} role="timer" aria-label={`${seconds ?? 0} seconds left`} data-urgent={(seconds ?? 99) <= 5 || undefined}>
            <b>{clock(left)}</b>
            <small>sec</small>
          </div>
        ) : startIn !== null ? (
          <div className={styles.timer} data-go="">
            <b>Go</b>
          </div>
        ) : null}
      </header>

      <ol className={styles.seats}>
        {SEATS.map((index) => {
          const seat = table.seats[index];
          const entry = select.picks[index];
          const talent = index === mySeat ? myPick : (entry?.talent ?? null);
          const talentInfo = talent ? info.get(talent) : null;
          const status = !seat ? "" : seat.bot ? (talent ? "Bot · set" : "Bot · picks last") : entry?.ready ? "Ready" : !seat.connected ? "Away" : talent ? "Picked" : "Choosing…";
          return (
            <li key={index} data-seat={index} data-me={index === mySeat || undefined} data-ready={entry?.ready || undefined} style={{ "--tal": talentInfo?.color ?? "var(--rule-2)" } as CSSProperties}>
              <span className={styles.seatFace}>
                {talent ? <ReactionFace key={talent} symbol={talent} pose={entry?.ready ? "hype" : "idle"} size={44} crop="face" /> : <i aria-hidden="true">?</i>}
              </span>
              <span className={styles.seatText}>
                <b>
                  {seatLabel(seat)}
                  {index === mySeat ? <em> (you)</em> : null}
                </b>
                <span className={styles.seatTalent}>{talentInfo ? talentInfo.name : seat?.bot ? "—" : "No pick yet"}</span>
                <small className={styles.seatStatus}>{status}</small>
              </span>
            </li>
          );
        })}
      </ol>

      <div className={styles.stageWrap} style={{ "--cols": columns, "--rows": Math.ceil(select.roster.length / columns) } as CSSProperties} {...handlers}>
        <div ref={stageRef} className={styles.stage} data-locked={!seated || imReady || closed || undefined}>
          {select.roster.map((symbol) => {
            const talentInfo = info.get(symbol);
            const holder = holders.get(symbol);
            const isMine = seated && holder === mySeat;
            const taken = holder !== undefined && !isMine;
            const over = hoveredBy.get(symbol) ?? [];
            const label = `${talentInfo?.name ?? symbol}${taken ? `, taken by ${seatLabel(table.seats[holder])}` : isMine ? ", your pick" : ""}`;
            return (
              <button
                key={symbol}
                type="button"
                className={styles.card}
                data-talent={symbol}
                data-taken={taken || undefined}
                data-mine={isMine || undefined}
                data-holder={holder}
                data-pop={popped === symbol || undefined}
                data-over={over.length ? over[0] : undefined}
                style={{ "--tal": talentInfo?.color } as CSSProperties}
                aria-label={label}
                aria-pressed={seated ? isMine : undefined}
                disabled={!seated || taken || imReady || closed}
                onClick={() => pick(symbol)}
              >
                <span className={styles.cardFace}>
                  <ReactionFace symbol={symbol} pose="idle" size={88} crop="face" />
                </span>
                <span className={styles.cardName}>{talentInfo?.name ?? symbol}</span>
                {holder !== undefined ? (
                  <span className={styles.cardTag} data-seat={holder}>
                    {isMine ? "You" : seatLabel(table.seats[holder])}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
        {streaming ? <CursorLayer remotes={feed.remotes} labels={labels} /> : null}
      </div>

      <p className={styles.focus} aria-live="polite">
        {focusInfo ? (
          <>
            <b style={{ color: focusInfo.color }}>{focusInfo.name}</b>
            {focusInfo.group ? <small>{focusInfo.group}</small> : null}
          </>
        ) : (
          <small>{seated ? "Tap a talent to pick. Each one can be played by one seat only." : "You’re watching. The game starts once everyone is ready."}</small>
        )}
      </p>

      {message ? <p className={styles.error}>{message}</p> : null}

      <div className={styles.actions}>
        {seated ? (
          <button type="button" className={styles.ready} data-on={imReady || undefined} onClick={toggleReady} disabled={readyBusy || closed || (!imReady && (!myPick || pending !== null))}>
            {imReady ? (
              <>
                Ready <small>{closed ? "locked in" : "tap to change your pick"}</small>
              </>
            ) : (
              <>
                Ready <small>{myPick ? "lock in your pick" : "pick a talent first"}</small>
              </>
            )}
          </button>
        ) : null}
        <div className={styles.minor}>
          {seated && !confirmLeave ? (
            <button type="button" className={styles.plain} onClick={() => setConfirmLeave(true)} disabled={leaving}>
              Leave
            </button>
          ) : null}
          {seated && confirmLeave ? (
            <span className={styles.confirm}>
              {table.kind === "practice" ? "Close this table?" : "Leave? You’ll be picked for and autopilot plays your seat."}
              <button type="button" className={styles.plain} onClick={onLeave} disabled={leaving}>
                Yes
              </button>
              <button type="button" className={styles.plain} onClick={() => setConfirmLeave(false)}>
                No
              </button>
            </span>
          ) : null}
          <Link href="/games/mahjong" className={styles.plain}>
            Lobby
          </Link>
        </div>
      </div>
      {select.deadline !== null && seated && !imReady ? <p className={styles.fine}>When the clock runs out, anyone without a pick gets a free talent and the game starts.</p> : null}
    </section>
  );
}
