"use client";

import Link from "next/link";
import { useEffect } from "react";
import { Tile, TileRow } from "@/app/components/games/mahjong/tile";
import { kindName, kindOf, type TileId } from "@/app/lib/games/mahjong/tiles";
import type { FuritenReason, SeatHand, WaitInfo, WinPreview } from "@/app/lib/games/mahjong/types";
import { NO_WIN_REASONS, scoreText, yakuName } from "@/app/lib/games/mahjong/yaku";
import styles from "@/app/components/games/mahjong/table/table-panels.module.scss";

const FURITEN_TEXT: Record<FuritenReason, string> = {
  discard: "Furiten: a tile you are waiting on is in your own discards, so you can only win by drawing it yourself, never off someone’s discard.",
  passed: "Furiten for now: you let a winning tile go by. Until your next turn you can’t win off a discard (a self-draw still counts).",
  riichi: "Furiten for the rest of the hand: you let a winning tile go by after riichi, so only a self-draw can win.",
};

function previewText(label: string, preview: WinPreview | null) {
  if (!preview) return `${label}: –`;
  if (!preview.ok) return `${label}: needs a yaku`;
  return `${label}: ${scoreText({ han: preview.han, fu: preview.fu, limit: preview.limit, yakuman: 0 })}`;
}

function Waits({ waits }: { waits: WaitInfo[] }) {
  return (
    <ul className={styles.waits}>
      {waits.map((wait) => (
        <li key={wait.kind}>
          <Tile kind={wait.kind} size={26} />
          <span>
            <b>{kindName(wait.kind)}</b>
            <small>
              {wait.left} left · {previewText("Ron", wait.ron)} · {previewText("Tsumo", wait.tsumo)}
            </small>
            {wait.ron?.ok ? <small>{wait.ron.yaku.map(yakuName).join(", ")}</small> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

const awayText = (shanten: number) => (shanten < 0 ? "Complete: you can win" : shanten === 0 ? "Ready: one tile from winning" : `${shanten} away from ready`);

/** Beginner help for your seat: what you wait on, what a discard does, furiten, why you can't win. */
export function HelpPanel({ hand, selected, myTurn, inRiichi }: { hand: SeatHand; selected: TileId | null; myTurn: boolean; inRiichi: boolean }) {
  const help = hand.help;
  const coach = help.coach ?? null;
  const selectedKind = selected === null ? null : kindOf(selected);
  const afterPick = selectedKind === null ? null : (help.tenpai_discards[String(selectedKind)] ?? null);
  const coachPick = selectedKind === null || !coach ? null : (coach.discards.find((entry) => entry.kind === selectedKind) ?? null);
  const readyChoices = Object.keys(help.tenpai_discards).length;
  const showWaits = help.waits.length > 0 && (!hand.drawn || inRiichi) && selected === null;

  const lines: React.ReactNode[] = [];
  if (coach) {
    lines.push(
      <p key="coach" className={styles.helpLine}>
        <b>Coach.</b> {awayText(coach.shanten)}.{" "}
        {coach.best.length && myTurn ? (
          <>
            Best throw: <span className={styles.inlineTiles}>{coach.best.map((kind) => <Tile key={kind} kind={kind} size={18} />)}</span> (marked on your hand).
          </>
        ) : null}
      </p>,
    );
  }
  if (afterPick) {
    lines.push(
      <div key="after" className={styles.helpBlock}>
        <p className={styles.helpLine}>
          <b>Throw this and you’re ready.</b> You would be waiting on:
        </p>
        <Waits waits={afterPick} />
      </div>,
    );
  } else if (selectedKind !== null) {
    lines.push(
      <p key="not-ready" className={styles.helpLine}>
        {coachPick ? `Throw this and you’re ${coachPick.shanten <= 0 ? "ready" : `${coachPick.shanten} away from ready`}${coachPick.useful ? `, with ${coachPick.useful} tiles that help` : ""}.` : "Throw this and you’re still not ready."}
      </p>,
    );
  } else if (myTurn && readyChoices) {
    lines.push(
      <p key="ready-tip" className={styles.helpLine}>
        Tiles with a blue dot leave you ready to win. Lift one to see what you would wait on.
      </p>,
    );
  }
  if (showWaits) {
    lines.push(
      <div key="waits" className={styles.helpBlock}>
        <p className={styles.helpLine}>
          <b>{inRiichi ? "You’re in riichi, waiting on:" : "You’re ready, waiting on:"}</b>
        </p>
        <Waits waits={help.waits} />
      </div>,
    );
  }
  if (help.furiten && help.waits.length) {
    lines.push(
      <p key="furiten" className={styles.helpWarn}>
        {FURITEN_TEXT[help.furiten]}
      </p>,
    );
  }
  if (help.no_win) {
    lines.push(
      <p key="nowin" className={styles.helpWarn}>
        <span className={styles.inlineTiles}>
          <Tile id={help.no_win.tile} size={18} />
        </span>{" "}
        {NO_WIN_REASONS[help.no_win.reason]}
      </p>,
    );
  }
  if (!lines.length) return null;
  return (
    <aside className={styles.help} aria-label="Help">
      {lines}
    </aside>
  );
}

/** The "?": a compact cheat sheet over the table. */
export function CheatSheet({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className={styles.sheetScrim} onClick={onClose}>
      <div className={styles.sheet} role="dialog" aria-modal="true" aria-label="Cheat sheet" onClick={(event) => event.stopPropagation()}>
        <header>
          <h2>Cheat sheet</h2>
          <button type="button" className={styles.close} onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>
        <section>
          <h3>The goal</h3>
          <p>Build four sets and one pair from 14 tiles. A set is three in a row of one suit (a run) or three identical tiles (a triplet).</p>
          <TileRow notation="234m456p789s111z22z" gapAfter={[2, 5, 8, 11]} size={22} className={styles.sheetRow} />
          <p className={styles.fine}>Here: three runs, a triplet of East winds and a pair of South winds. Winds and dragons can only make triplets or pairs.</p>
        </section>
        <section>
          <h3>You need a yaku</h3>
          <p>A yaku is a scoring pattern. No yaku, no win, however complete the hand looks. The easy ones: riichi (closed hand, one tile from winning), all simples (no 1s, 9s or honors), and a triplet of dragons or your wind.</p>
        </section>
        <section>
          <h3>The buttons</h3>
          <ul>
            <li><b>Riichi.</b> Announce you’re one tile from winning. Costs 1,000, locks your hand, closed hands only.</li>
            <li><b>Tsumo.</b> Win with the tile you just drew.</li>
            <li><b>Ron.</b> Win with someone’s discard.</li>
            <li><b>Pon.</b> Take a discard to make a triplet. Opens your hand.</li>
            <li><b>Chi.</b> Take the left player’s discard to make a run. Opens your hand.</li>
            <li><b>Kan.</b> A set of four: bonus draw, new dora.</li>
            <li><b>Pass.</b> Let it go.</li>
          </ul>
        </section>
        <section>
          <h3>Furiten</h3>
          <p>If a tile that would win for you is in your own discards, you can’t win off anyone else’s discard (you can still draw it yourself).</p>
        </section>
        <section>
          <h3>On your hand</h3>
          <p>Tap a tile to lift it, tap it again to throw it. A blue dot means that throw leaves you ready. On a keyboard: arrows move, Enter lifts or throws, Esc puts it back, D throws the tile you drew, and the letter on each button is its key.</p>
        </section>
        <Link href="/games/mahjong/learn" className={styles.more}>
          Learn the whole game
        </Link>
      </div>
    </div>
  );
}
