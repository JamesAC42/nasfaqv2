import type { TickerTapBoard } from "@/app/lib/games/types";
import { splitPool } from "@/app/components/games/ticker-tap/engine";

export type Placement = { rank: number; payout: number; inMoney: boolean; approx: boolean };

/**
 * Where a score would land on this week's board if it were your best, and what that rank pays
 * right now. Ties go to the run posted first, so an equal score sits below the one already there.
 */
export function placementFor(board: TickerTapBoard | null, score: number, userId: string | number | null | undefined, extraPool = 0): Placement {
  if (!board) return { rank: 1, payout: 0, inMoney: true, approx: true };
  const others = board.leaderboard.filter((row) => userId === null || userId === undefined || String(row.user_id) !== String(userId));
  const ahead = others.filter((row) => row.score >= score).length;
  const rank = ahead + 1;
  const players = others.length + 1;
  const payouts = splitPool(board.week.pool + extraPool, Math.min(10, players));
  const inMoney = rank <= 10;
  return { rank, payout: inMoney ? (payouts[rank - 1] ?? 0) : 0, inMoney, approx: others.length >= 25 && ahead >= 25 };
}

/** The next rung up the ladder from a score: who to beat and what that rank pays. */
export function nextRung(board: TickerTapBoard | null, score: number | null, userId: string | number | null | undefined) {
  if (!board) return null;
  const others = board.leaderboard.filter((row) => String(row.user_id) !== String(userId));
  const above = others.filter((row) => score === null || row.score >= score);
  const target = above[above.length - 1];
  if (!target) return null;
  const rank = others.indexOf(target) + 1;
  if (rank > 10) {
    const cut = others[9];
    return cut ? { rank: 10, beat: cut.score, username: cut.username } : null;
  }
  return { rank, beat: target.score, username: target.username };
}

export function fmtCountdown(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return days > 0 ? `${days}d ${pad(hours)}:${pad(minutes)}:${pad(seconds)}` : `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

const cents = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const whole = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

/** Payout money: whole dollars stay whole, anything with cents shows both digits ($127.50). */
export function fmtPayout(value: number | null | undefined) {
  const amount = Number(value ?? 0);
  return `$${Number.isInteger(amount) ? whole.format(amount) : cents.format(amount)}`;
}
