import { kindName } from "@/app/lib/games/mahjong/tiles";
import type {
  BlockedCode,
  CallEffect,
  CallRecommend,
  CopyWhere,
  CoachSuggestion,
  EffectCode,
  HandForm,
  MomentCode,
  ReviewMoment,
  ReviewOutcome,
  SuggestionCode,
  WinBlock,
  WinPreview,
  YakuSight,
  YakuSightStatus,
} from "@/app/lib/games/mahjong/types";
import { scoreText, yakuInfo, yakuName } from "@/app/lib/games/mahjong/yaku";

// Plain-English wording for every code api/src/services/games/mahjong/coach.js can send. The server sends
// data and reason codes, never prose. Each table below is a Record over a union copied from coach.js, so
// `tsc` fails if a code is added there and listed here without text. An unknown code (a newer server)
// returns null and the caller shows nothing rather than a raw key.
//
// Talents never speak, and the coach is "the coach", not a talent: these lines are the coach's own.

export type Who = (seat: number) => string;

const num = (value: number) => value.toLocaleString("en-US");
const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
const kindsText = (kinds: readonly number[] | undefined) => (kinds ?? []).map(kindName).join(", ");
const yakuList = (yaku: string | readonly string[] | undefined) => (Array.isArray(yaku) ? yaku : yaku ? [yaku] : []).map(yakuName).join(", ");
const ORDINALS = ["", "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth"];
const ordinal = (n: number) => ORDINALS[n] || `#${n}`;

/** "ready (tenpai)", "2 from ready", "complete". */
export function shantenWord(shanten: number): string {
  if (shanten < 0) return "complete";
  if (shanten === 0) return "ready (tenpai)";
  return `${shanten} from ready`;
}

/** The meter's steps, in order. The last is a win. */
export const METER_STEPS = ["3+", "2", "1", "Ready", "Win"] as const;
/** Which step lights for a shanten number (3 or more all light the first). */
export const meterIndex = (shanten: number) => (shanten < 0 ? 4 : shanten === 0 ? 3 : Math.max(0, 3 - Math.min(3, shanten)));

export const meterHeadline = (shanten: number) =>
  shanten < 0 ? "You can win" : shanten === 0 ? "Ready: one tile from winning" : `${plural(shanten, "tile")} from ready`;

/** A short strip for the phone: "2 from ready". */
export const meterShort = (shanten: number) => (shanten < 0 ? "Win!" : shanten === 0 ? "Ready" : `${shanten} from ready`);

// ── The hand's form ─────────────────────────────────────────────────────────
export const FORM_TEXT: Record<HandForm, string | null> = {
  standard: null,
  seven_pairs: "Closest form: seven pairs (chiitoitsu), seven different pairs instead of four sets and a pair.",
  thirteen_orphans: "Closest form: thirteen orphans (kokushi), one of each 1, 9 and honor tile plus a spare.",
};

// ── Why throw this tile ─────────────────────────────────────────────────────
const SUGGESTION_TEXT: Record<SuggestionCode, (s: CoachSuggestion, who: Who) => string> = {
  win_now: (s) => `You can win right now by drawing it yourself (tsumo)${s.points ? `, worth about ${num(s.points)} points` : ""}.`,
  riichi_locked: () => "You’re in riichi, so the tile you draw is the one that goes. Your hand is already waiting.",
  safe_against_riichi: (s, who) => `${s.seat !== undefined ? who(s.seat) : "Someone"} declared riichi. This tile is certainly safe against it, so it can’t be the one they’re waiting on.`,
  least_risky_against_riichi: (s, who) => `${s.seat !== undefined ? who(s.seat) : "Someone"} declared riichi and you’re far from winning. No tile is certainly safe; this is the least risky.`,
  avoids_furiten: (s) => `Leaves you ready (tenpai) on ${plural(s.waits ?? 0, "kind")} of tile, ${s.left ?? 0} left, in a way that you can still win off a discard.`,
  ready_with_yaku: (s) => `Leaves you ready (tenpai) with a yaku, so a win really counts: ${s.left ?? 0} tiles left that win.`,
  makes_ready: (s) => `Leaves you ready (tenpai), waiting on ${plural(s.waits ?? 0, "kind")} of tile with ${s.left ?? 0} left.`,
  keeps_yaku: (s) =>
    s.yaku === "tanyao"
      ? "Keeps the all simples (tanyao) plan going: a 1, 9 or honor doesn’t fit it."
      : "Keeps your set of value honors (yakuhai), which is your yaku. This tile isn’t part of it.",
  isolated_honor: () => "A lone honor tile that goes with nothing in your hand.",
  isolated_terminal: () => "A lone 1 or 9 with no neighbors: hard to build a set around.",
  keeps_most_draws: (s) => `Keeps the most tiles that move your hand forward: ${s.count ?? 0} left that help.`,
  least_useful: () => "Nothing helps your hand right now, so this is the least useful tile.",
};

export function suggestionText(suggestion: CoachSuggestion | null | undefined, who: Who): string | null {
  if (!suggestion) return null;
  const make = SUGGESTION_TEXT[suggestion.code] as ((s: CoachSuggestion, who: Who) => string) | undefined;
  return make ? make(suggestion, who) : null;
}

/** What a single discard does, for the "tap another tile" exploration. */
export function discardText(kind: number, shanten: number, left: number): string {
  const name = kindName(kind);
  if (shanten < 0) return `Throw ${name}: that keeps your complete hand.`;
  if (shanten === 0) return `Throw ${name} and you’re ready (tenpai).`;
  return `Throw ${name} and you’re ${shantenWord(shanten)}${left > 0 ? `, with ${left} tiles that would help` : ", and nothing left would help"}.`;
}

// ── Why a hand can't win ────────────────────────────────────────────────────
const BLOCKED_TEXT: Record<BlockedCode, (b: WinBlock) => string> = {
  furiten_own_discard: (b) => `Furiten: you wait on ${kindsText(b.kinds)}, and you’ve thrown that already. You can’t win off a discard, only by drawing it yourself.`,
  furiten_passed: () => "Furiten for now: you let a winning tile go by. Until your next turn you can’t win off a discard, but drawing it yourself still wins.",
  furiten_riichi: () => "Furiten for the rest of the hand: you let a winning tile go by after riichi, so only a self-draw (tsumo) can win.",
  no_yaku_open_hand: () => "No yaku: you’ve called a tile, so riichi is gone, and nothing you wait on scores. A complete hand with no yaku can’t win. Aim for all simples (tanyao) or a dragon triplet.",
  no_tiles_left: () => "Every tile you wait on is already showing, so none can come.",
  no_yaku_in_sight: () => "No yaku in sight yet. Since you’ve called a tile, you need one to win: all simples (tanyao), or a triplet of dragons or your wind, are the easy ones.",
};

export function blockedText(block: WinBlock): string | null {
  const make = BLOCKED_TEXT[block.code] as ((b: WinBlock) => string) | undefined;
  return make ? make(block) : null;
}

// ── Ways to win you're near ─────────────────────────────────────────────────
export const SIGHT_STATUS: Record<YakuSightStatus, string> = { met: "you have it", near: "close", available: "available" };

/** One chip: "All simples (tanyao): 2 tiles to swap out". */
export function sightLabel(entry: YakuSight): { name: string; note: string } | null {
  if (!yakuInfo(entry.key)) return null;
  const name = yakuName(entry.key);
  if (entry.status === "met") return { name, note: "you have it" };
  if (entry.status === "available") return { name, note: entry.key === "riichi" ? "available" : "comes with a win by self-draw" };
  if (entry.status === "near") {
    if (entry.key === "tanyao") return { name, note: `${plural(entry.off ?? 0, "tile")} to swap out` };
    if (entry.key.startsWith("yakuhai")) return { name, note: "one more makes a triplet" };
    if (entry.key === "honitsu" || entry.key === "chinitsu") return { name, note: `${plural(entry.off ?? 0, "off-suit tile")} to replace` };
    if (entry.key === "chiitoitsu") return { name, note: `${plural(entry.pairs ?? 0, "pair")} so far, needs seven` };
    if (entry.key === "toitoi") return { name, note: `${plural(entry.triplets ?? 0, "triplet")} so far` };
    return { name, note: SIGHT_STATUS.near };
  }
  return null;
}

// ── Win previews ────────────────────────────────────────────────────────────
/** "2 han 30 fu, about 2,000 points". */
export function previewScore(preview: WinPreview): string {
  const base = scoreText({ han: preview.han, fu: preview.fu, limit: preview.limit, yakuman: 0 });
  return preview.points ? `${base}, about ${num(preview.points)} points` : base;
}

// ── What a call or turn option does ─────────────────────────────────────────
const EFFECT_TEXT: Record<EffectCode, (e: CallEffect) => string> = {
  opens_hand_no_riichi: () => "Opens your hand, so no riichi after this.",
  shanten_change: (e) => {
    const from = e.from ?? 0;
    const to = e.to ?? 0;
    if (to < from) return `Moves you closer: ${shantenWord(to)}.`;
    if (to === from) return `Doesn’t change how close you are: still ${shantenWord(to)}.`;
    return `Sets you back: ${shantenWord(to)}, from ${shantenWord(from)}.`;
  },
  gives_yaku: (e) => `Gives you a yaku: ${yakuList(e.yaku)}.`,
  keeps_yaku: (e) => `Keeps your ${yakuList(e.yaku)}.`,
  loses_yaku: (e) => `Gives up ${yakuList(e.yaku)}.`,
  no_yaku_in_sight: () => "An open hand needs a yaku to win, and this doesn’t give you one yet.",
  adds_dora_indicator: () => "Shows a new dora indicator (bonus tiles).",
  meld_has_dora: (e) => `The set holds ${plural(e.count ?? 1, "bonus tile")} (dora or red five).`,
  uses_red_five: () => "Uses your red five, a bonus tile.",
  wins_hand: (e) => {
    const how = e.tsumo ? "You win by drawing it (tsumo)" : "You win on that discard (ron)";
    const score = e.limit || e.han ? scoreText({ han: e.han ?? 0, fu: e.fu ?? 0, limit: e.limit ?? null, yakuman: 0 }) : "";
    const names = Array.isArray(e.yaku) ? e.yaku.map(yakuName).join(", ") : "";
    return `${how}${score ? `: ${score}` : ""}${e.points ? `, about ${num(e.points)} points` : ""}${names ? `. Yaku: ${names}` : ""}.`;
  },
  adds_yaku: () => "Adds the riichi yaku.",
  locks_hand: () => "Locks your hand: from then on you only throw the tile you draw.",
  costs_stick: (e) => `Costs ${num(e.points ?? 1000)} points, set down as a riichi stick.`,
  waits_left: (e) => `You’d wait on ${plural(e.waits ?? 0, "kind")} of tile, ${e.left ?? 0} left.`,
  already_has_yaku: () => "You already have a yaku, so riichi isn’t needed to win off a discard.",
  furiten_wait: (e) => (e.kind === "riichi" ? "Careful: you’d be furiten, so only a self-draw could win." : "Careful: you’d wait on a tile you’ve already thrown (furiten), so only a self-draw could win."),
  tsumo_available: () => "You can already win by self-draw, so riichi isn’t needed.",
  keeps_closed: () => "Keeps your hand closed, so riichi stays possible.",
};

export function effectText(effect: CallEffect): string | null {
  const make = EFFECT_TEXT[effect.code] as ((e: CallEffect) => string) | undefined;
  return make ? make(effect) : null;
}

export const RECOMMEND_TEXT: Record<CallRecommend, string> = { take: "coach: take", skip: "coach: skip", either: "your call" };

// ── After the hand ──────────────────────────────────────────────────────────
export const OUTCOME_TEXT: Record<ReviewOutcome, string> = {
  won_tsumo: "You won by drawing the winning tile yourself (tsumo). Nicely done.",
  won_ron: "You won on another player’s discard (ron). Nicely done.",
  dealt_in: "Someone won on a tile you threw. It happens to everyone, and the notes below show what to look for.",
  lost_to_tsumo: "Another player won by drawing their own winning tile (tsumo).",
  lost_to_ron: "Another player won on a discard (ron). It wasn’t your tile.",
  draw_ready: "The tiles ran out while you were ready (tenpai), which earns a small payment.",
  draw_not_ready: "The tiles ran out before you were ready, so nobody won.",
  aborted: "The hand was called off.",
};

/** The outcome as a short title for the card. */
export const OUTCOME_TITLE: Record<ReviewOutcome, string> = {
  won_tsumo: "You won",
  won_ron: "You won",
  dealt_in: "You threw the winning tile",
  lost_to_tsumo: "Another player won",
  lost_to_ron: "Another player won",
  draw_ready: "Draw, and you were ready",
  draw_not_ready: "Draw",
  aborted: "Hand called off",
};

const MOMENT_TEXT: Record<MomentCode, (m: ReviewMoment, who: Who) => string> = {
  discarded_winning_shape: (m) => {
    const better = (m.better ?? []).map(kindName).join(" or ");
    return `On your ${ordinal(m.turn ?? 0)} throw, ${kindName(m.discard ?? 0)} left you ${shantenWord(m.to ?? 0)}. Throwing ${better || "another tile"} would have kept you ${shantenWord(m.from ?? 0)}.`;
  },
  dealt_in_after_riichi: (m, who) => `${m.riichi_seat !== undefined ? who(m.riichi_seat) : "Someone"} had declared riichi, and the ${kindName(m.tile ?? 0)} you threw finished ${m.to !== undefined ? `${who(m.to)}’s` : "their"} hand. Against a riichi, the coach marks the tiles that are certainly safe.`,
  dealt_in: (m, who) => `The ${kindName(m.tile ?? 0)} you threw finished ${m.to !== undefined ? `${who(m.to)}’s` : "their"} hand.`,
  ready_but_furiten: (m) => `You were ready, but waiting on ${kindsText(m.kinds)}, which you had thrown yourself (furiten), so only drawing it could win.`,
  folded_safely: (m) => `After the riichi you threw only certainly-safe tiles, ${plural(m.discards ?? 0, "time")}. That’s good defense.`,
  waited_on_dead_tiles: (m) => `You were ready, but no copy of ${kindsText(m.kinds)} was left to draw. Next time, a wait with more tiles left gives you better odds.`,
  won_by_draw_with_n_left: (m) => `You drew the winning tile with ${plural(m.left ?? 0, "tile")} left in the wall.`,
};

export function momentText(moment: ReviewMoment, who: Who): string | null {
  const make = MOMENT_TEXT[moment.code] as ((m: ReviewMoment, who: Who) => string) | undefined;
  return make ? make(moment, who) : null;
}

/** The tile shown with a moment: the one it is about. */
export function momentKind(moment: ReviewMoment): number | null {
  if (moment.discard !== undefined) return moment.discard;
  if (moment.tile !== undefined) return moment.tile;
  return moment.kinds?.[0] ?? null;
}

const COPY_PHRASE: Record<keyof CopyWhere, (n: number) => string> = {
  own_hand: (n) => `${n} in your hand`,
  own_melds: (n) => `${n} in your called sets`,
  own_discards: (n) => `${n} in your discards`,
  other_discards: (n) => `${n} in others’ discards`,
  other_melds: (n) => `${n} in called sets`,
  other_hands: (n) => `${n} in other hands`,
  dora_indicators: (n) => `${n} under a dora indicator`,
  wall: (n) => `${n} left in the wall`,
  dead_wall: (n) => `${n} in the dead wall`,
  unseen: (n) => `${n} not seen`,
};
const COPY_ORDER: (keyof CopyWhere)[] = ["own_hand", "own_melds", "own_discards", "other_discards", "other_melds", "other_hands", "dora_indicators", "wall", "dead_wall"];

/** "1 in your discards, 2 in other hands, 1 left in the wall". */
export function copiesText(copies: CopyWhere): string {
  const parts = COPY_ORDER.flatMap((key) => {
    const value = copies[key];
    return typeof value === "number" && value > 0 ? [COPY_PHRASE[key](value)] : [];
  });
  // Without the wall's contents, say what is simply unseen.
  if (copies.wall === null && copies.unseen > 0) parts.push(COPY_PHRASE.unseen(copies.unseen));
  return parts.length ? parts.join(", ") : "none of them";
}
