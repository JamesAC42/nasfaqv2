// The client's table of yaku (hand patterns), fu parts, limits, wait names and draw reasons. Keys
// are the ones in api/src/services/games/mahjong/names.js and agari.js; han values follow the rule
// sheet (docs/games/MAHJONG_DESIGN.md §1). Every example hand is checked against the server's
// scorer in a test run, so the explanation and the hand agree.

import type { DrawReason, FuPartKey, LimitName, MeldType, NoWinReason, WaitName, YakuKey } from "@/app/lib/games/mahjong/types";

/** One called set in an example: notation for its tiles, and which tile (by index) was taken from another player. */
export type ExampleCall = { type: MeldType; tiles: string; /** Index of the sideways tile; omit for a closed kan. */ called?: number };

/** The facts about the moment of winning that the pattern needs. */
export type ExampleSituation = {
  /** Declared riichi (1) or double riichi (2). */
  riichi?: 0 | 1 | 2;
  ippatsu?: boolean;
  rinshan?: boolean;
  chankan?: boolean;
  haitei?: boolean;
  houtei?: boolean;
  tenhou?: boolean;
  chiihou?: boolean;
  /** Seat wind kind (27-30); South if absent. */
  seat?: 27 | 28 | 29 | 30;
  /** Round wind kind; East if absent. */
  round?: 27 | 28 | 29 | 30;
};

export type YakuExample = {
  /** The concealed tiles in notation, not counting the winning tile or called sets. */
  hand: string;
  /** The winning tile in notation. */
  win: string;
  /** Called sets (and closed kans), shown beside the hand. */
  calls?: ExampleCall[];
  /** Won by self-draw; otherwise on someone's discard. */
  tsumo?: boolean;
  situation?: ExampleSituation;
  /** One line under the hand: what to look at. */
  caption: string;
};

export type YakuInfo = {
  key: YakuKey;
  name: string;
  /** Japanese name in romaji. */
  japanese: string;
  /** Han when the hand is closed, or "yakuman". */
  closed: number | "yakuman";
  /** Han when the hand has called sets; null if open hands can't use it. */
  open: number | "yakuman" | null;
  yakuman: boolean;
  /** One plain-English sentence a beginner can follow. */
  explain: string;
  example: YakuExample;
};

type Row = Omit<YakuInfo, "yakuman">;

const ROWS: Row[] = [
  // ── One han ───────────────────────────────────────────────────────────────
  {
    key: "riichi",
    name: "Riichi",
    japanese: "Riichi",
    closed: 1,
    open: null,
    explain: "Your hand is one tile from done and has no called sets: say \"riichi\", pay a 1,000-point stick, and from then on you can only discard what you draw.",
    example: { hand: "123m456m789s24p55s", win: "3p", situation: { riichi: 1 }, caption: "Waiting on 3 of circles to fill the gap in 2-4." },
  },
  {
    key: "ippatsu",
    name: "Ippatsu",
    japanese: "Ippatsu",
    closed: 1,
    open: null,
    explain: "Win within one go-around of declaring riichi, before your next discard and with nobody calling a tile in between.",
    example: { hand: "123m456m789s24p55s", win: "3p", tsumo: true, situation: { riichi: 1, ippatsu: true }, caption: "Riichi last turn, and the very next draw wins." },
  },
  {
    key: "menzen-tsumo",
    name: "Fully concealed hand",
    japanese: "Menzen tsumo",
    closed: 1,
    open: null,
    explain: "Win by drawing the last tile yourself while your hand has no called sets.",
    example: { hand: "123m456m789s24p55s", win: "3p", tsumo: true, caption: "Same hand as riichi, won on your own draw." },
  },
  {
    key: "pinfu",
    name: "Pinfu",
    japanese: "Pinfu",
    closed: 1,
    open: null,
    explain: "A closed hand of four runs and a plain pair, won on a two-sided wait: no triplets, no value-tile pair, nothing awkward.",
    example: { hand: "123m456m789s23p55s", win: "4p", caption: "2-3 of circles waits on 1 or 4: a two-sided wait." },
  },
  {
    key: "iipeikou",
    name: "Pure double sequence",
    japanese: "Iipeikou",
    closed: 1,
    open: null,
    explain: "Two identical runs in the same suit, like 2-3-4 of characters twice, in a closed hand.",
    example: { hand: "223344m567p79s99p", win: "8s", caption: "Two copies of 2-3-4 of characters." },
  },
  {
    key: "tanyao",
    name: "All simples",
    japanese: "Tanyao",
    closed: 1,
    open: 1,
    explain: "Every tile is a 2 through 8: no ones, nines or honors. Open hands can score it too.",
    example: { hand: "234m46m567p345s66p", win: "5m", caption: "Nothing but 2s through 8s." },
  },
  {
    key: "yakuhai-white",
    name: "White dragon",
    japanese: "Haku",
    closed: 1,
    open: 1,
    explain: "A set of three white dragons (the blank tile). Pon one from anyone and you have a yaku.",
    example: { hand: "123m456p78s99p", win: "9s", calls: [{ type: "pon", tiles: "555z", called: 0 }], caption: "A called pon of white dragons." },
  },
  {
    key: "yakuhai-green",
    name: "Green dragon",
    japanese: "Hatsu",
    closed: 1,
    open: 1,
    explain: "A set of three green dragons. Each dragon is a yaku all game, whoever you are.",
    example: { hand: "123m456p78s99p", win: "9s", calls: [{ type: "pon", tiles: "666z", called: 0 }], caption: "A called pon of green dragons." },
  },
  {
    key: "yakuhai-red",
    name: "Red dragon",
    japanese: "Chun",
    closed: 1,
    open: 1,
    explain: "A set of three red dragons. Not to be confused with the red fives, which are only bonus points.",
    example: { hand: "123m456p78s99p", win: "9s", calls: [{ type: "pon", tiles: "777z", called: 0 }], caption: "A called pon of red dragons." },
  },
  {
    key: "yakuhai-seat",
    name: "Seat wind",
    japanese: "Jikaze",
    closed: 1,
    open: 1,
    explain: "A set of the wind that matches your seat: East if you deal, then South, West, North around the table.",
    example: { hand: "123m456p78s99p", win: "9s", calls: [{ type: "pon", tiles: "333z", called: 0 }], situation: { seat: 29 }, caption: "You sit West, so a set of West winds scores." },
  },
  {
    key: "yakuhai-round",
    name: "Round wind",
    japanese: "Bakaze",
    closed: 1,
    open: 1,
    explain: "A set of the wind of the current round: East in the first round of a game, South in the second.",
    example: { hand: "123m456p78s99p", win: "9s", calls: [{ type: "pon", tiles: "111z", called: 0 }], situation: { seat: 29 }, caption: "East round, so a set of East winds scores for everyone." },
  },
  {
    key: "rinshan",
    name: "After a kan",
    japanese: "Rinshan kaihou",
    closed: 1,
    open: 1,
    explain: "Win on the extra tile you draw right after declaring a kan.",
    example: { hand: "345m678p55s12s", win: "3s", tsumo: true, calls: [{ type: "ankan", tiles: "1111p" }], situation: { rinshan: true }, caption: "Four 1s of circles declared, then the replacement tile wins." },
  },
  {
    key: "chankan",
    name: "Robbing a kan",
    japanese: "Chankan",
    closed: 1,
    open: 1,
    explain: "Win on the tile another player adds to their pon to make a kan, before it is theirs.",
    example: { hand: "123m456m789s24p55s", win: "3p", situation: { chankan: true }, caption: "Someone adds their 3 of circles to a pon: you take it." },
  },
  {
    key: "haitei",
    name: "Under the sea",
    japanese: "Haitei raoyue",
    closed: 1,
    open: 1,
    explain: "Win by self-draw on the very last tile of the wall.",
    example: { hand: "123m456m789s24p55s", win: "3p", tsumo: true, situation: { haitei: true }, caption: "The last tile in the wall completes the hand." },
  },
  {
    key: "houtei",
    name: "Under the river",
    japanese: "Houtei raoyui",
    closed: 1,
    open: 1,
    explain: "Win on the very last discard of the hand, after the wall has run out.",
    example: { hand: "123m456m789s24p55s", win: "3p", situation: { houtei: true }, caption: "The final discard of the hand is your tile." },
  },
  // ── Two han ───────────────────────────────────────────────────────────────
  {
    key: "double-riichi",
    name: "Double riichi",
    japanese: "Daburu riichi",
    closed: 2,
    open: null,
    explain: "Declare riichi on your very first discard, before anyone has called a tile: it counts for two han instead of one.",
    example: { hand: "123m456m789s24p55s", win: "3p", situation: { riichi: 2 }, caption: "Tenpai from the deal, riichi on turn one." },
  },
  {
    key: "chiitoitsu",
    name: "Seven pairs",
    japanese: "Chiitoitsu",
    closed: 2,
    open: null,
    explain: "A closed hand of seven different pairs instead of four sets and a pair. It is always worth 25 fu.",
    example: { hand: "1133m5577p2244s4z", win: "4z", caption: "Six pairs and a lone North wind waiting for its twin." },
  },
  {
    key: "sanshoku",
    name: "Mixed triple sequence",
    japanese: "Sanshoku doujun",
    closed: 2,
    open: 1,
    explain: "The same run in all three suits, like 1-2-3 of characters, circles and bamboo. One han less if you called something.",
    example: { hand: "123m123p123s46s99m", win: "5s", caption: "1-2-3 in every suit." },
  },
  {
    key: "ittsu",
    name: "Pure straight",
    japanese: "Ittsu",
    closed: 2,
    open: 1,
    explain: "1-2-3, 4-5-6 and 7-8-9 in one suit. One han less if you called something.",
    example: { hand: "123456789m24p55s", win: "3p", caption: "A full 1 to 9 in characters." },
  },
  {
    key: "chanta",
    name: "Half outside hand",
    japanese: "Chanta",
    closed: 2,
    open: 1,
    explain: "Every set and the pair contains a 1, a 9 or an honor, with at least one run and one honor. One han less if open.",
    example: { hand: "123m789m99p444z11s", win: "9p", caption: "Each group touches an edge or is an honor." },
  },
  {
    key: "toitoi",
    name: "All triplets",
    japanese: "Toitoi",
    closed: 2,
    open: 2,
    explain: "Four sets of three of a kind and a pair, no runs at all. Pons are fine.",
    example: { hand: "222m888s44p55m", win: "5m", calls: [{ type: "pon", tiles: "777p", called: 0 }], caption: "Every set is three of a kind." },
  },
  {
    key: "sanankou",
    name: "Three concealed triplets",
    japanese: "Sanankou",
    closed: 2,
    open: 2,
    explain: "Three sets of three of a kind that you drew yourself, not called. A triplet finished on someone's discard doesn't count.",
    example: { hand: "222m555p888s78p33m", win: "9p", caption: "Three closed triplets and a run." },
  },
  {
    key: "sanshoku-doukou",
    name: "Triple triplets",
    japanese: "Sanshoku doukou",
    closed: 2,
    open: 2,
    explain: "Three of a kind of the same number in all three suits, like three 2s of each.",
    example: { hand: "222s46m99p", win: "5m", calls: [{ type: "pon", tiles: "222m", called: 0 }, { type: "pon", tiles: "222p", called: 0 }], caption: "2s of characters, circles and bamboo." },
  },
  {
    key: "sankantsu",
    name: "Three kans",
    japanese: "Sankantsu",
    closed: 2,
    open: 2,
    explain: "Three kans (four of a kind) in one hand, open or closed.",
    example: { hand: "34s99m", win: "5s", calls: [{ type: "ankan", tiles: "2222m" }, { type: "ankan", tiles: "6666p" }, { type: "minkan", tiles: "8888s", called: 0 }], caption: "Three sets of four." },
  },
  {
    key: "honroutou",
    name: "All terminals and honors",
    japanese: "Honroutou",
    closed: 2,
    open: 2,
    explain: "Every tile is a 1, a 9 or an honor, and there are no runs (which means triplets or seven pairs).",
    example: { hand: "111m999p111s44z77z", win: "7z", caption: "Not one tile from 2 to 8." },
  },
  {
    key: "shousangen",
    name: "Little three dragons",
    japanese: "Shousangen",
    closed: 2,
    open: 2,
    explain: "Sets of two of the three dragons and a pair of the third. The two sets also score as value tiles, so this is worth a lot.",
    example: { hand: "555z666z77z123m45p", win: "6p", caption: "White and green sets, red pair." },
  },
  // ── Three and six han ─────────────────────────────────────────────────────
  {
    key: "honitsu",
    name: "Half flush",
    japanese: "Honitsu",
    closed: 3,
    open: 2,
    explain: "Only one suit plus honors. Two han if you called something.",
    example: { hand: "234567m46m99m333z", win: "5m", caption: "Characters and a set of West winds, nothing else." },
  },
  {
    key: "junchan",
    name: "Fully outside hand",
    japanese: "Junchan",
    closed: 3,
    open: 2,
    explain: "Every set and the pair contains a 1 or a 9, with no honors at all and at least one run. Two han if open.",
    example: { hand: "123m789m99p123s11s", win: "9p", caption: "Every group touches a 1 or a 9." },
  },
  {
    key: "ryanpeikou",
    name: "Twice pure double sequence",
    japanese: "Ryanpeikou",
    closed: 3,
    open: null,
    explain: "Two pairs of identical runs, like 2-3-4 twice and 5-6-7 twice, in a closed hand.",
    example: { hand: "223344m556677p9s", win: "9s", caption: "Two doubled runs and a pair." },
  },
  {
    key: "chinitsu",
    name: "Full flush",
    japanese: "Chinitsu",
    closed: 6,
    open: 5,
    explain: "Every tile is from one suit and no honors. Five han if you called something.",
    example: { hand: "123345567789m5m", win: "5m", caption: "Characters, wall to wall." },
  },
  // ── Yakuman ───────────────────────────────────────────────────────────────
  {
    key: "kokushi",
    name: "Thirteen orphans",
    japanese: "Kokushi musou",
    closed: "yakuman",
    open: null,
    explain: "One of each terminal and honor (1 and 9 of every suit and all seven honors) plus a second copy of any of them.",
    example: { hand: "19m19p19s1234567z", win: "1m", caption: "Thirteen different edge tiles and a twin." },
  },
  {
    key: "suuankou",
    name: "Four concealed triplets",
    japanese: "Suuankou",
    closed: "yakuman",
    open: null,
    explain: "Four sets of three of a kind that you drew yourself, and a pair.",
    example: { hand: "111m444p777s555z9m", win: "9m", tsumo: true, caption: "Four closed triplets, waiting on the pair." },
  },
  {
    key: "daisangen",
    name: "Big three dragons",
    japanese: "Daisangen",
    closed: "yakuman",
    open: "yakuman",
    explain: "Sets of all three dragons. If you feed someone their last dragon set, you pay for the whole hand.",
    example: { hand: "555z666z777z234m5s", win: "5s", caption: "White, green and red, all as sets." },
  },
  {
    key: "shousuushii",
    name: "Little four winds",
    japanese: "Shousuushii",
    closed: "yakuman",
    open: "yakuman",
    explain: "Sets of three of the four winds and a pair of the fourth.",
    example: { hand: "111z222z333z44z12m", win: "3m", caption: "East, South and West sets, North pair." },
  },
  {
    key: "daisuushii",
    name: "Big four winds",
    japanese: "Daisuushii",
    closed: "yakuman",
    open: "yakuman",
    explain: "Sets of all four winds. If you feed someone their last wind set, you pay for the whole hand.",
    example: { hand: "222z333z444z5p", win: "5p", calls: [{ type: "pon", tiles: "111z", called: 0 }], caption: "All four winds as sets." },
  },
  {
    key: "tsuuiisou",
    name: "All honors",
    japanese: "Tsuuiisou",
    closed: "yakuman",
    open: "yakuman",
    explain: "Every tile is a wind or a dragon.",
    example: { hand: "333z555z777z2z", win: "2z", calls: [{ type: "pon", tiles: "111z", called: 0 }], caption: "Not a single numbered tile." },
  },
  {
    key: "chinroutou",
    name: "All terminals",
    japanese: "Chinroutou",
    closed: "yakuman",
    open: "yakuman",
    explain: "Every tile is a 1 or a 9, and nothing else.",
    example: { hand: "999m111p999p1s", win: "1s", calls: [{ type: "pon", tiles: "111m", called: 0 }], caption: "Only ones and nines." },
  },
  {
    key: "ryuuiisou",
    name: "All green",
    japanese: "Ryuuiisou",
    closed: "yakuman",
    open: "yakuman",
    explain: "Only the green tiles: 2, 3, 4, 6 and 8 of bamboo, and the green dragon.",
    example: { hand: "234s234s666s88s66z", win: "8s", caption: "Everything on the tiles is green." },
  },
  {
    key: "chuuren",
    name: "Nine gates",
    japanese: "Chuuren poutou",
    closed: "yakuman",
    open: null,
    explain: "One suit, closed: 1-1-1, 2 through 8, and 9-9-9, plus any one more tile of that suit.",
    example: { hand: "1112345678999m", win: "5m", caption: "The nine gates plus one more." },
  },
  {
    key: "suukantsu",
    name: "Four kans",
    japanese: "Suukantsu",
    closed: "yakuman",
    open: "yakuman",
    explain: "Four kans in one hand, and a pair.",
    example: { hand: "5m", win: "5m", calls: [{ type: "ankan", tiles: "2222m" }, { type: "ankan", tiles: "4444p" }, { type: "minkan", tiles: "6666s", called: 0 }, { type: "minkan", tiles: "8888p", called: 0 }], caption: "Four sets of four and a pair." },
  },
  {
    key: "tenhou",
    name: "Blessing of heaven",
    japanese: "Tenhou",
    closed: "yakuman",
    open: null,
    explain: "The dealer wins on their very first draw, before anyone has discarded.",
    example: { hand: "123m456m789s24p55s", win: "3p", tsumo: true, situation: { tenhou: true, seat: 27 }, caption: "Dealt a winning hand." },
  },
  {
    key: "chiihou",
    name: "Blessing of earth",
    japanese: "Chiihou",
    closed: "yakuman",
    open: null,
    explain: "A non-dealer wins on their very first draw, with nobody having called a tile.",
    example: { hand: "123m456m789s24p55s", win: "3p", tsumo: true, situation: { chiihou: true }, caption: "First draw of the hand completes it." },
  },
];

/** Every yaku, in the order a guide would list them (by han, then yakuman). */
export const YAKU_LIST: YakuInfo[] = ROWS.map((row) => ({ ...row, yakuman: row.closed === "yakuman" }));

export const YAKU: Record<YakuKey, YakuInfo> = Object.fromEntries(YAKU_LIST.map((info) => [info.key, info])) as Record<YakuKey, YakuInfo>;

export const yakuInfo = (key: string): YakuInfo | null => (key in YAKU ? YAKU[key as YakuKey] : null);
/** The English name for a key; the key itself if unknown. */
export const yakuName = (key: string) => yakuInfo(key)?.name ?? key;

/** "1 han", "2 han (1 open)", "closed only: 2 han", "yakuman". */
export function yakuValueText(info: YakuInfo): string {
  if (info.yakuman) return info.open === null ? "Yakuman, closed hands only" : "Yakuman";
  const closed = info.closed as number;
  if (info.open === null) return `${closed} han, closed hands only`;
  if (info.open === closed) return `${closed} han`;
  return `${closed} han closed, ${info.open} open`;
}

/** Groups for a guide page. */
export const YAKU_GROUPS: { title: string; keys: YakuKey[] }[] = [
  { title: "One han", keys: ["riichi", "ippatsu", "menzen-tsumo", "pinfu", "iipeikou", "tanyao", "yakuhai-white", "yakuhai-green", "yakuhai-red", "yakuhai-seat", "yakuhai-round", "rinshan", "chankan", "haitei", "houtei"] },
  { title: "Two han", keys: ["double-riichi", "chiitoitsu", "sanshoku", "ittsu", "chanta", "toitoi", "sanankou", "sanshoku-doukou", "sankantsu", "honroutou", "shousangen"] },
  { title: "Three to six han", keys: ["honitsu", "junchan", "ryanpeikou", "chinitsu"] },
  { title: "Yakuman", keys: ["kokushi", "suuankou", "daisangen", "shousuushii", "daisuushii", "tsuuiisou", "chinroutou", "ryuuiisou", "chuuren", "suukantsu", "tenhou", "chiihou"] },
];

// ── Fu ──────────────────────────────────────────────────────────────────────
export const FU_PARTS: Record<FuPartKey, string> = {
  base: "Base for any hand",
  "closed-ron": "Closed hand won on a discard",
  "closed-kan": "Closed kan",
  "open-kan": "Open kan",
  "closed-triplet": "Closed triplet",
  "open-triplet": "Open triplet",
  "value-pair": "Pair of value tiles",
  "wait-kanchan": "Middle wait",
  "wait-penchan": "Edge wait",
  "wait-tanki": "Single-tile wait",
  tsumo: "Self-draw",
  "open-minimum": "Open hand minimum (30)",
  "round-up": "Rounded up to the next 10",
  "seven-pairs": "Seven pairs (fixed)",
};

/** A fu line as text. Triplets and pairs name their tile through `tileName` (from tiles.ts) when you pass it a kind. */
export function fuPartText(part: { key: string; fu: number; kind?: number }, nameOf?: (kind: number) => string): string {
  const label = FU_PARTS[part.key as FuPartKey] ?? part.key;
  return part.kind !== undefined && nameOf ? `${label}: ${nameOf(part.kind)}` : label;
}

// ── Limits ──────────────────────────────────────────────────────────────────
export type LimitInfo = { key: LimitName; name: string; short: string; /** Han needed (and fu for the edge cases). */ when: string; /** Base points. */ base: number };
export const LIMITS: Record<LimitName, LimitInfo> = {
  mangan: { key: "mangan", name: "Mangan", short: "Mangan", when: "5 han, or 4 han at 40 fu, or 3 han at 70 fu", base: 2000 },
  haneman: { key: "haneman", name: "Haneman", short: "Haneman", when: "6 or 7 han", base: 3000 },
  baiman: { key: "baiman", name: "Baiman", short: "Baiman", when: "8 to 10 han", base: 4000 },
  sanbaiman: { key: "sanbaiman", name: "Sanbaiman", short: "Sanbaiman", when: "11 or 12 han", base: 6000 },
  yakuman: { key: "yakuman", name: "Yakuman", short: "Yakuman", when: "A yakuman hand", base: 8000 },
  kazoe: { key: "kazoe", name: "Counted yakuman", short: "Kazoe", when: "13 han or more from ordinary yaku and dora", base: 8000 },
};
export const LIMIT_ORDER: LimitName[] = ["mangan", "haneman", "baiman", "sanbaiman", "kazoe", "yakuman"];
export const limitName = (limit: LimitName | null | undefined) => (limit ? LIMITS[limit].name : null);

/** A score line: "Haneman", "Double yakuman", "3 han 30 fu". */
export function scoreText(win: { han: number; fu: number; limit: LimitName | null; yakuman: number }): string {
  if (win.yakuman > 1) return win.yakuman === 2 ? "Double yakuman" : win.yakuman === 3 ? "Triple yakuman" : `${win.yakuman}x yakuman`;
  if (win.limit) return LIMITS[win.limit].name;
  return `${win.han} han ${win.fu} fu`;
}

// ── Waits ───────────────────────────────────────────────────────────────────
export const WAITS: Record<WaitName, { name: string; explain: string }> = {
  ryanmen: { name: "Two-sided wait", explain: "A run missing an end, like 4-5 waiting on 3 or 6." },
  kanchan: { name: "Middle wait", explain: "A run missing its middle tile, like 4-6 waiting on 5." },
  penchan: { name: "Edge wait", explain: "1-2 waiting on 3, or 8-9 waiting on 7." },
  tanki: { name: "Single-tile wait", explain: "Everything is done but the pair: one tile waits for its twin." },
  shanpon: { name: "Double-pair wait", explain: "Two pairs, and either can become a triplet." },
};
export const waitName = (wait: WaitName) => WAITS[wait].name;

// ── Draws and why you can't win ─────────────────────────────────────────────
export const DRAW_REASONS: Record<DrawReason, { name: string; text: string }> = {
  exhaustive: { name: "Exhaustive draw", text: "The wall ran out. Players waiting on a win are paid by those who aren't." },
  nagashi: { name: "Nagashi mangan", text: "Every discard was a terminal or an honor and none was called: paid as a mangan." },
  kyuushu: { name: "Nine terminals and honors", text: "A player had nine different terminals and honors on their first draw and called the hand off." },
  suufon: { name: "Four winds", text: "The same wind was the first discard of all four players." },
  suucha: { name: "Four riichi", text: "All four players declared riichi." },
  suukan: { name: "Four kans", text: "Four kans were made by more than one player." },
};

export const NO_WIN_REASONS: Record<NoWinReason, string> = {
  no_yaku: "That tile completes your hand, but it has no yaku, so it can't win.",
  furiten_discard: "You can't win on a discard: one of the tiles you're waiting on is in your own discards (furiten).",
  furiten_passed: "You passed on a winning tile this go-around, so you can't win on a discard until your next turn (furiten).",
  furiten_riichi: "You passed on a winning tile after riichi, so you can only win by self-draw for the rest of the hand (furiten).",
};
