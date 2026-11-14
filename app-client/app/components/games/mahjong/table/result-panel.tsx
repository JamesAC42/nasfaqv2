"use client";

import { useEffect, type CSSProperties } from "react";
import { PublicMeld, Tile } from "@/app/components/games/mahjong/tile";
import { useElementWidth } from "@/app/components/games/mahjong/table/board";
import type { SeatStyle } from "@/app/components/games/mahjong/table/seat-portrait";
import { useRemaining } from "@/app/lib/games/use-remaining";
import { kindName } from "@/app/lib/games/mahjong/tiles";
import { points, seatLabel, signed, winWord } from "@/app/lib/games/mahjong/table-model";
import type { DrawResult, HandResult, MahjongTable, SeatIndex, WinEntry, WinResult } from "@/app/lib/games/mahjong/types";
import { DRAW_REASONS, LIMITS, fuPartText, scoreText, waitName, yakuName } from "@/app/lib/games/mahjong/yaku";
import styles from "@/app/components/games/mahjong/table/table-panels.module.scss";

type Names = { table: MahjongTable; seatStyles: SeatStyle[] };

const nameOf = (table: MahjongTable, seat: SeatIndex | null) => (seat === null ? "" : seatLabel(table.seats[seat]));

function Delta({ value }: { value: number }) {
  return (
    <b className={styles.delta} data-dir={value > 0 ? "up" : value < 0 ? "down" : undefined}>
      {signed(value)}
    </b>
  );
}

function Payments({ result, table, seatStyles, me }: { result: HandResult; me: SeatIndex | null } & Names) {
  return (
    <ol className={styles.payments} aria-label="Points">
      {([0, 1, 2, 3] as SeatIndex[]).map((seat) => (
        <li key={seat} data-me={me === seat || undefined} style={{ "--tal": seatStyles[seat]?.color } as CSSProperties}>
          <i aria-hidden="true" />
          <span>{nameOf(table, seat)}</span>
          <Delta value={result.deltas[seat]} />
          <em>{points(result.scores[seat])}</em>
        </li>
      ))}
    </ol>
  );
}

function WinHand({ win }: { win: WinEntry }) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const meldTiles = win.melds.reduce((sum, meld) => sum + meld.tiles.length, 0);
  const units = win.hand.length + 1 + meldTiles + 1.5;
  const size = width ? Math.max(16, Math.min(34, Math.floor((width - 4 * (win.melds.length + 2)) / units))) : 24;
  return (
    <div ref={ref} className={styles.winHand}>
      <span className={styles.winTiles}>
        {win.hand.map((id) => (
          <Tile key={id} id={id} size={size} />
        ))}
      </span>
      <span className={styles.winTile} title={win.tsumo ? "The tile you drew" : "The winning discard"}>
        <Tile id={win.tile} size={size} highlight />
      </span>
      {win.melds.map((meld, index) => (
        <span key={index} className={styles.winMeld}>
          <PublicMeld meld={meld} owner={win.seat} size={size} />
        </span>
      ))}
    </div>
  );
}

function WinCard({ win, result, table, seatStyles }: { win: WinEntry; result: WinResult } & Names) {
  const dora = win.dora;
  const lines: { label: string; han: string }[] = win.yaku.map((entry) => ({ label: yakuName(entry.key), han: entry.han >= 13 ? "Yakuman" : `${entry.han} han` }));
  if (dora.dora) lines.push({ label: `Dora ×${dora.dora}`, han: `${dora.dora} han` });
  if (dora.ura) lines.push({ label: `Ura dora ×${dora.ura}`, han: `${dora.ura} han` });
  if (dora.red) lines.push({ label: `Red five ×${dora.red}`, han: `${dora.red} han` });
  const limit = win.limit ? LIMITS[win.limit] : null;
  return (
    <article className={styles.win} style={{ "--tal": seatStyles[win.seat]?.color } as CSSProperties} data-big={limit ? "" : undefined}>
      <header>
        <h3>
          <span className={styles.winWord}>{winWord(win)}</span> {nameOf(table, win.seat)}
          {win.from !== null ? <small> off {nameOf(table, win.from)}</small> : null}
        </h3>
        <span className={styles.score}>
          <b>{scoreText(win)}</b>
          {win.yakuman === 0 && limit ? <small>{win.han} han {win.fu} fu</small> : null}
        </span>
        <Delta value={win.gain} />
      </header>
      <WinHand win={win} />
      <ul className={styles.yaku}>
        {lines.map((line, index) => (
          <li key={index}>
            <span>{line.label}</span>
            <b>{line.han}</b>
          </li>
        ))}
      </ul>
      <p className={styles.waitLine}>
        {waitName(win.wait)}
        {win.riichi ? (win.riichi === 2 ? " · double riichi" : " · riichi") : ""}
        {win.sticks ? ` · +${points(win.sticks)} riichi sticks` : ""}
        {win.honba ? ` · +${points(win.honba)} honba` : ""}
        {win.pao !== null ? ` · ${nameOf(table, win.pao)} pays for feeding the big set` : ""}
      </p>
      {win.yakuman === 0 && win.fu_parts.length ? (
        <details className={styles.fu}>
          <summary>
            Fu: {win.fu} <small>how that adds up</small>
          </summary>
          <ul>
            {win.fu_parts.map((part, index) => (
              <li key={index}>
                <span>{fuPartText(part, kindName)}</span>
                <b>{part.fu > 0 ? `+${part.fu}` : part.fu}</b>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {result.wins.length === 1 && limit ? <p className={styles.limitNote}>{limit.name}: {limit.when}.</p> : null}
    </article>
  );
}

function Indicators({ label, tiles }: { label: string; tiles: number[] }) {
  if (!tiles.length) return null;
  return (
    <span className={styles.indicators}>
      <small>{label}</small>
      {tiles.map((id, index) => (
        <Tile key={index} id={id} size={20} labels={false} />
      ))}
    </span>
  );
}

function DrawBody({ result, table, seatStyles }: { result: DrawResult } & Names) {
  const reason = DRAW_REASONS[result.reason];
  const shown = Object.keys(result.hands);
  return (
    <div className={styles.drawBody}>
      <p>{reason.text}</p>
      {result.reason === "exhaustive" || result.reason === "nagashi" ? (
        <ul className={styles.tenpai}>
          {([0, 1, 2, 3] as SeatIndex[]).map((seat) => (
            <li key={seat} data-ready={result.tenpai[seat] || undefined} style={{ "--tal": seatStyles[seat]?.color } as CSSProperties}>
              <span>{nameOf(table, seat)}</span>
              <b>{result.nagashi.includes(seat) ? "Nagashi mangan" : result.tenpai[seat] ? "Ready" : "Not ready"}</b>
              {result.hands[String(seat)] ? (
                <span className={styles.shownHand}>
                  {result.hands[String(seat)].map((id) => (
                    <Tile key={id} id={id} size={18} labels={false} />
                  ))}
                  {result.waits[String(seat)]?.length ? <small>waits {result.waits[String(seat)].map(kindName).join(", ")}</small> : null}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : result.by !== undefined && shown.length ? (
        <p>
          {nameOf(table, result.by)} showed:{" "}
          <span className={styles.shownHand}>
            {result.hands[String(result.by)]?.map((id) => <Tile key={id} id={id} size={18} labels={false} />)}
          </span>
        </p>
      ) : null}
    </div>
  );
}

export type ResultPanelProps = Names & {
  result: HandResult;
  label: string;
  dora: number[];
  me: SeatIndex | null;
  /** Epoch ms the next hand deals. */
  until: number | null;
  ready: boolean;
  busy: boolean;
  lesson: boolean;
  onNext: () => void;
  collapsed: boolean;
  onCollapse: (collapsed: boolean) => void;
};

/** The panel after every hand: who won what, the hand, yaku, fu, and where the points went. */
export function ResultPanel({ result, table, seatStyles, label, dora, me, until, ready, busy, lesson, onNext, collapsed, onCollapse }: ResultPanelProps) {
  const left = useRemaining(until, 500);
  const big = result.type === "win" && result.wins.some((win) => win.yakuman > 0 || win.limit !== null);
  const top = result.type === "win" ? result.wins.reduce((best, win) => (win.han > best.han ? win : best), result.wins[0]) : null;
  const headline =
    result.type === "win"
      ? top && (top.yakuman > 0 || top.limit)
        ? scoreText(top)
        : result.wins.length > 1
          ? "Double win"
          : winWord(result.wins[0])
      : DRAW_REASONS[result.reason].name;

  useEffect(() => {
    if (collapsed) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCollapse(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [collapsed, onCollapse]);

  const seconds = left === null ? null : Math.ceil(left / 1000);
  const control =
    me === null ? (
      seconds !== null ? <span className={styles.countdown}>Next hand in {seconds}s</span> : null
    ) : (
      <button type="button" className={styles.next} onClick={onNext} disabled={busy || ready}>
        {ready ? "Waiting for the others…" : lesson ? "Finish the lesson" : "Next hand"}
        {!ready && seconds !== null ? <small>{lesson ? "or wait" : "in"} {seconds}s</small> : null}
      </button>
    );

  if (collapsed) {
    return (
      <div className={styles.resultBar} role="status">
        <span>
          <b>{headline}</b> · {label}
        </span>
        <button type="button" className={styles.plain} onClick={() => onCollapse(false)}>
          Show result
        </button>
        {control}
      </div>
    );
  }

  return (
    <div className={styles.scrim} data-big={big || undefined}>
      <section className={styles.result} role="dialog" aria-modal="false" aria-label={`Result of ${label}`} data-big={big || undefined} data-kind={result.type}>
        <header className={styles.resultHead}>
          <small>{label}</small>
          <h2 data-big={big || undefined}>{headline}</h2>
          <button type="button" className={styles.plain} onClick={() => onCollapse(true)}>
            Look at the table
          </button>
        </header>
        <div className={styles.resultBody}>
          {result.type === "win" ? (
            <>
              {result.wins.map((win) => (
                <WinCard key={win.seat} win={win} result={result} table={table} seatStyles={seatStyles} />
              ))}
              <div className={styles.indicatorRow}>
                <Indicators label="Dora" tiles={result.dora} />
                <Indicators label="Ura" tiles={result.ura} />
              </div>
            </>
          ) : (
            <>
              <DrawBody result={result} table={table} seatStyles={seatStyles} />
              <div className={styles.indicatorRow}>
                <Indicators label="Dora" tiles={dora} />
              </div>
            </>
          )}
          <Payments result={result} table={table} seatStyles={seatStyles} me={me} />
          <p className={styles.footnote}>
            {result.renchan ? "The dealer stays." : "The deal passes."} Honba {result.honba_next}.
          </p>
        </div>
        <footer className={styles.resultFoot}>{control}</footer>
      </section>
    </div>
  );
}
