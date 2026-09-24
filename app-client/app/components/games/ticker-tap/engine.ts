import type { TapReplay, TapTarget } from "@/app/lib/games/types";

// Ticker Tap scoring, ported line for line from the server's `replay`
// (api/src/services/games/sessions.js, GAMES_DESIGN.md §6). The server is the authority; this copy
// exists so the number on screen during a run is the number the server will post. If the server
// rules change, change both. `LiveScorer` is the same rules run incrementally, one tap at a time.

export type Tap = { lane: number; t: number };

export const LANES = 5;
export const RUN_MS = 45_000;
export const MAX_TAPS = 600;
/** The server refuses a submit sooner than this after the session was created. */
export const MIN_REAL_MS = RUN_MS - 3_000;
export const POINTS = { up: 100, gold: 500, down: -150, miss: -25 } as const;
export const PAYOUT_SPLIT = [30, 20, 12, 9, 7, 6, 5, 4, 4, 3];

export function multiplierFor(combo: number) {
  return Math.min(3, 1 + Math.floor(combo / 5) * 0.5);
}

type ReplayEvent = { t: number; type: "tap"; lane: number; order: number } | { t: number; type: "expire"; target: TapTarget };

/** Replays a tap log against the timeline. Pure: the same inputs always score the same. */
export function replay(timeline: TapTarget[], taps: Tap[]): TapReplay {
  const events: ReplayEvent[] = [
    ...taps.map((tap, order): ReplayEvent => ({ t: tap.t, type: "tap", lane: tap.lane, order })),
    ...timeline.filter((target) => target.kind !== "down").map((target): ReplayEvent => ({ t: target.start_ms + target.life_ms, type: "expire", target })),
  ].sort((a, b) => a.t - b.t || (a.type === "tap" ? -1 : 1));

  const hit = new Set<number>();
  let score = 0;
  let combo = 0;
  let maxCombo = 0;
  const stats = { greens: 0, golds: 0, reds: 0, misses: 0, escaped: 0, taps: taps.length };
  for (const event of events) {
    if (event.type === "expire") {
      if (!hit.has(event.target.index)) {
        stats.escaped += 1;
        combo = 0;
      }
      continue;
    }
    const target = timeline
      .filter((candidate) => candidate.lane === event.lane && !hit.has(candidate.index) && candidate.start_ms <= event.t && event.t <= candidate.start_ms + candidate.life_ms)
      .sort((a, b) => a.start_ms - b.start_ms)[0];
    if (!target) {
      stats.misses += 1;
      score += POINTS.miss;
      combo = 0;
      continue;
    }
    hit.add(target.index);
    if (target.kind === "down") {
      stats.reds += 1;
      score += POINTS.down;
      combo = 0;
      continue;
    }
    combo += 1;
    maxCombo = Math.max(maxCombo, combo);
    score += Math.round(POINTS[target.kind] * multiplierFor(combo - 1));
    if (target.kind === "gold") stats.golds += 1;
    else stats.greens += 1;
  }
  const good = stats.greens + stats.golds;
  const total = timeline.filter((target) => target.kind !== "down").length;
  return {
    score: Math.max(0, score),
    max_combo: maxCombo,
    accuracy: stats.taps ? good / stats.taps : 0,
    catch_rate: total ? good / total : 0,
    ...stats,
  };
}

/** What the server does to a submitted log before replaying it (normalizeTaps, minus validation). */
export function scoreRun(timeline: TapTarget[], taps: Tap[]) {
  const normalized = taps.map((tap) => ({ lane: Number(tap.lane), t: Number(tap.t) })).sort((a, b) => a.t - b.t);
  return replay(timeline, normalized);
}

export type TapOutcome =
  | { type: "hit"; target: TapTarget; points: number; multiplier: number; combo: number }
  | { type: "red"; target: TapTarget; points: number; brokeCombo: number }
  | { type: "miss"; points: number; brokeCombo: number };

/**
 * The same rules as `replay`, fed live. Taps must arrive in strictly increasing `t` (the stage
 * guarantees it), and `advance(t)` retires expiries strictly before `t`, so a tap landing on the
 * exact expiry millisecond still counts, as it does on the server (taps sort before expiries).
 */
export class LiveScorer {
  readonly hit = new Set<number>();
  score = 0;
  combo = 0;
  maxCombo = 0;
  stats = { greens: 0, golds: 0, reds: 0, misses: 0, escaped: 0, taps: 0 };
  private readonly timeline: TapTarget[];
  private readonly expiries: TapTarget[];
  private cursor = 0;

  constructor(timeline: TapTarget[]) {
    this.timeline = timeline;
    this.expiries = timeline.filter((target) => target.kind !== "down").sort((a, b) => a.start_ms + a.life_ms - (b.start_ms + b.life_ms));
  }

  get multiplier() {
    return multiplierFor(this.combo);
  }

  /** Retires every green/gold whose life ended before `t`. Returns the ones that escaped unhit. */
  advance(t: number) {
    const escaped: { target: TapTarget; brokeCombo: number }[] = [];
    while (this.cursor < this.expiries.length) {
      const target = this.expiries[this.cursor];
      if (!(target.start_ms + target.life_ms < t)) break;
      this.cursor += 1;
      if (this.hit.has(target.index)) continue;
      this.stats.escaped += 1;
      escaped.push({ target, brokeCombo: this.combo });
      this.combo = 0;
    }
    return escaped;
  }

  tap(lane: number, t: number): { outcome: TapOutcome; escaped: ReturnType<LiveScorer["advance"]> } {
    const escaped = this.advance(t);
    this.stats.taps += 1;
    const target = this.timeline
      .filter((candidate) => candidate.lane === lane && !this.hit.has(candidate.index) && candidate.start_ms <= t && t <= candidate.start_ms + candidate.life_ms)
      .sort((a, b) => a.start_ms - b.start_ms)[0];
    if (!target) {
      const brokeCombo = this.combo;
      this.stats.misses += 1;
      this.score += POINTS.miss;
      this.combo = 0;
      return { outcome: { type: "miss", points: POINTS.miss, brokeCombo }, escaped };
    }
    this.hit.add(target.index);
    if (target.kind === "down") {
      const brokeCombo = this.combo;
      this.stats.reds += 1;
      this.score += POINTS.down;
      this.combo = 0;
      return { outcome: { type: "red", target, points: POINTS.down, brokeCombo }, escaped };
    }
    const multiplier = multiplierFor(this.combo);
    this.combo += 1;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    const points = Math.round(POINTS[target.kind] * multiplier);
    this.score += points;
    if (target.kind === "gold") this.stats.golds += 1;
    else this.stats.greens += 1;
    return { outcome: { type: "hit", target, points, multiplier, combo: this.combo }, escaped };
  }

  /** Final tally, identical to `replay(timeline, taps)` once every tap has been fed in. */
  finish(): TapReplay {
    this.advance(Infinity);
    const good = this.stats.greens + this.stats.golds;
    const total = this.timeline.filter((target) => target.kind !== "down").length;
    return {
      score: Math.max(0, this.score),
      max_combo: this.maxCombo,
      accuracy: this.stats.taps ? good / this.stats.taps : 0,
      catch_rate: total ? good / total : 0,
      ...this.stats,
    };
  }
}

/** The pool split over however many winners there are (fewer than ten rescales the shares). */
export function splitPool(pool: number, winners: number) {
  const shares = PAYOUT_SPLIT.slice(0, winners);
  const total = shares.reduce((sum, share) => sum + share, 0);
  return shares.map((share) => Math.floor((pool * share * 100) / total) / 100);
}

/** When the run is over on screen: the last target's expiry, inside the server's tap window. */
export function runEndMs(timeline: TapTarget[]) {
  const last = timeline.reduce((max, target) => Math.max(max, target.start_ms + target.life_ms), RUN_MS);
  return Math.min(last + 60, RUN_MS + 900);
}
