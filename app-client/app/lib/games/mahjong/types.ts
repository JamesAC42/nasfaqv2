// Payload types for the mahjong API (/api/games/mahjong) and its socket channels. Derived from
// api/src/services/games/mahjong/{tables,view,round,game,agari,records,tournaments,limits,settings}.js
// and api/src/routes/mahjong.js. Seats are 0-3 in turn order; seat 0 dealt the first hand.

import type { TileId, TileKind } from "@/app/lib/games/mahjong/tiles";

export type { TileId, TileKind };
export type SeatIndex = 0 | 1 | 2 | 3;

// ── Vocabulary ──────────────────────────────────────────────────────────────
export type TableKind = "tutorial" | "practice" | "friend" | "ranked" | "stakes" | "tournament";
/** "waiting" until it deals, "playing", then "done" or "cancelled". */
export type TableStatus = "waiting" | "playing" | "done" | "cancelled";
export type GameLength = "east" | "south";
export type Speed = "standard" | "relaxed" | "untimed";
/** What you pick for bots. "auto" is the autopilot / tutorial level, never offered. */
export type BotLevel = "easy" | "normal" | "hard";
export type SeatBotLevel = BotLevel | "auto";
export type RankKey = "unranked" | "bagholder" | "day-trader" | "floor-trader" | "broker" | "fund-manager" | "whale" | "market-maker";
export type MeldType = "chi" | "pon" | "minkan" | "kakan" | "ankan";
export type HandPhase = "turn" | "calls" | "over";
/** Under mangan is null. "kazoe" is 13+ han counted as a yakuman. */
export type LimitName = "mangan" | "haneman" | "baiman" | "sanbaiman" | "yakuman" | "kazoe";
export type WaitName = "ryanmen" | "kanchan" | "penchan" | "tanki" | "shanpon";
export type DrawReason = "exhaustive" | "nagashi" | "kyuushu" | "suufon" | "suucha" | "suukan";
export type FuritenReason = "discard" | "passed" | "riichi";
/** Why a tile that completes your hand can't be won on. */
export type NoWinReason = "no_yaku" | "furiten_discard" | "furiten_passed" | "furiten_riichi";
/** 0 none, 1 riichi, 2 double riichi. */
export type RiichiState = 0 | 1 | 2;

export type YakuKey =
  | "riichi" | "double-riichi" | "ippatsu" | "menzen-tsumo" | "pinfu" | "iipeikou" | "ryanpeikou" | "tanyao"
  | "yakuhai-white" | "yakuhai-green" | "yakuhai-red" | "yakuhai-seat" | "yakuhai-round"
  | "rinshan" | "chankan" | "haitei" | "houtei" | "chiitoitsu" | "sanshoku" | "ittsu" | "chanta" | "junchan"
  | "toitoi" | "sanankou" | "sanshoku-doukou" | "sankantsu" | "honroutou" | "shousangen" | "honitsu" | "chinitsu"
  | "kokushi" | "suuankou" | "daisangen" | "shousuushii" | "daisuushii" | "tsuuiisou" | "chinroutou" | "ryuuiisou"
  | "chuuren" | "suukantsu" | "tenhou" | "chiihou";

/** The keys of a fu breakdown (agari.js fuParts). `wait-*` is kanchan, penchan or tanki. */
export type FuPartKey =
  | "base" | "closed-ron" | "closed-kan" | "open-kan" | "closed-triplet" | "open-triplet" | "value-pair"
  | "wait-kanchan" | "wait-penchan" | "wait-tanki" | "tsumo" | "open-minimum" | "round-up" | "seven-pairs";

// ── Seats and hands on the table ────────────────────────────────────────────
/** One seat as everyone sees it (publicSeat). Null in `seats` while a seat is open. */
export type PublicSeat = {
  seat: SeatIndex;
  user_id: number | null;
  username: string;
  profile_color: string | null;
  profile_picture_url: string | null;
  /** A talent's ticker symbol: the seat's reaction portrait. Not a color: look it up. */
  talent: string | null;
  bot: SeatBotLevel | null;
  guest: boolean;
  rating: number | null;
  rank: RankKey | null;
  away: boolean;
  connected: boolean;
  ready: boolean;
};

export type Meld = {
  type: MeldType;
  /** Sorted. Four tiles for a kan. */
  tiles: TileId[];
  /** The tile taken from another player's discard (not for ankan). */
  called: TileId | null;
  /** The seat it was taken from. */
  from: SeatIndex | null;
  /** The tile added to a pon to make a kakan. */
  added: TileId | null;
};

export type PondEntry = {
  tile: TileId;
  tsumogiri: boolean;
  riichi: boolean;
  /** Taken by someone's chi, pon or kan: draw it grayed or leave a gap. */
  called: boolean;
  /** The number of the discard in the hand, in order. */
  n: number;
};

export type SeatHandPublic = {
  /** Tiles in their hand (13, or 14 when `has_drawn`), not counting melds. */
  count: number;
  has_drawn: boolean;
  melds: Meld[];
  pond: PondEntry[];
  riichi: RiichiState;
  /** Seat wind kind 27-30. */
  wind: TileKind;
};

// ── Log events (the replay) ─────────────────────────────────────────────────
export type LogEvent =
  | { t: "deal"; dealer: SeatIndex; hands: TileId[][]; dora: TileId }
  | { t: "draw"; s: SeatIndex; tile: TileId; rinshan?: boolean }
  | { t: "discard"; s: SeatIndex; tile: TileId; tsumogiri: boolean; riichi: boolean }
  | { t: "riichi"; s: SeatIndex; double: boolean }
  | { t: "chi" | "pon"; s: SeatIndex; from: SeatIndex; tile: TileId; tiles: [TileId, TileId] }
  | { t: "minkan"; s: SeatIndex; from: SeatIndex; tile: TileId; tiles: TileId[] }
  | { t: "ankan"; s: SeatIndex; tiles: TileId[] }
  | { t: "kakan"; s: SeatIndex; tile: TileId }
  | { t: "dora"; tile: TileId }
  | { t: "end"; result: HandResult };

/** `last` in a hand view: the last thing that happened as everyone saw it. A draw's tile is only there for the drawer's own view. */
export type LastEvent =
  | { t: "deal" }
  | { t: "end" }
  | { t: "draw"; s: SeatIndex; rinshan: boolean; tile?: TileId }
  | Exclude<LogEvent, { t: "deal" | "draw" | "end" }>;

// ── Results ─────────────────────────────────────────────────────────────────
export type FuPart = { key: FuPartKey; fu: number; /** the tile kind for triplets, kans and a value pair */ kind?: TileKind };
export type YakuLine = { key: YakuKey; /** 13 for a yakuman */ han: number };

/** One winner's hand (round.js winRecord). A ron adds `chankan`. */
export type WinEntry = {
  seat: SeatIndex;
  /** The seat that dealt in; null for a self-draw. */
  from: SeatIndex | null;
  /** The winning tile. */
  tile: TileId;
  tsumo: boolean;
  /** Concealed tiles, never including the winning tile (that is `tile`). */
  hand: TileId[];
  melds: Meld[];
  yaku: YakuLine[];
  /** Total han including dora; 13 per yakuman. */
  han: number;
  fu: number;
  fu_parts: FuPart[];
  /** How many yakuman (0 for an ordinary hand). */
  yakuman: number;
  limit: LimitName | null;
  /** Counts of dora, ura dora and red fives that scored. */
  dora: { dora: number; ura: number; red: number };
  /** Base points before the multiplier. */
  base: number;
  wait: WaitName;
  riichi: RiichiState;
  /** Points this winner gained, honba and sticks included. */
  gain: number;
  sticks: number;
  honba: number;
  /** The seat that pays for a visible big three dragons or big four winds it fed; null if none. */
  pao: SeatIndex | null;
  chankan?: boolean;
};

export type WinResult = {
  type: "win";
  wins: WinEntry[];
  /** Ura indicators, shown when a riichi winner is among them. */
  ura: TileId[];
  /** Dora indicators at the end. */
  dora: TileId[];
  /** Points moved per seat. */
  deltas: [number, number, number, number];
  renchan: boolean;
  honba_next: number;
  /** Scores after the hand. */
  scores: [number, number, number, number];
};

export type DrawResult = {
  type: "draw";
  reason: DrawReason;
  tenpai: boolean[];
  /** Seats that scored nagashi mangan. */
  nagashi: SeatIndex[];
  /** Hands shown (tenpai at an exhaustive draw, or the seat that called kyuushu), keyed by seat. */
  hands: Record<string, TileId[]>;
  /** Waits of the shown hands, keyed by seat. */
  waits: Record<string, TileKind[]>;
  deltas: [number, number, number, number];
  renchan: boolean;
  honba_next: number;
  scores: [number, number, number, number];
  /** For kyuushu: who called it. */
  by?: SeatIndex;
};

export type HandResult = WinResult | DrawResult;

/** A finished hand in a line (game.history, tables.js briefResult). */
export type BriefResult =
  | { type: "draw"; reason: DrawReason; deltas: number[] }
  | { type: "win"; deltas: number[]; wins: { seat: SeatIndex; from: SeatIndex | null; han: number; fu: number; yakuman: number; limit: LimitName | null; gain: number }[] };

// ── What a seat may do ──────────────────────────────────────────────────────
export type TurnOptions = {
  phase: "turn";
  /** Tiles that may be discarded (the drawn tile only, in riichi). */
  discards: TileId[];
  /** Discards that declare riichi. */
  riichi: TileId[];
  tsumo: boolean;
  /** Kinds you can closed-kan. */
  ankan: TileKind[];
  /** Kinds you can add to a pon. */
  kakan: TileKind[];
  kyuushu: boolean;
};

/** Another player's discard (or an added kan) is on the table and you may answer. */
export type CallOptions = {
  phase: "calls";
  tile: TileId;
  from: SeatIndex;
  ron?: true;
  /** Each entry is the two tiles from your hand; more than one when red fives make different ways. */
  pon?: [TileId, TileId][];
  kan?: true;
  chi?: [TileId, TileId][];
};

export type Options = TurnOptions | CallOptions;

export type WinPreview = { ok: boolean; han: number; fu: number; yaku: YakuKey[]; limit: LimitName | null };
export type WaitInfo = {
  kind: TileKind;
  /** Copies you can't see yet. */
  left: number;
  ron: WinPreview | null;
  tsumo: WinPreview | null;
};

export type CoachDiscard = { kind: TileKind; shanten: number; useful: number; kinds: TileKind[] };
export type Coach = { shanten: number; discards: CoachDiscard[]; /** the kinds worth discarding */ best: TileKind[] };

export type Help = {
  waits: WaitInfo[];
  furiten: FuritenReason | null;
  /** Keyed by the kind you would discard (a string in JSON). */
  tenpai_discards: Record<string, WaitInfo[]>;
  no_win: { tile: TileId; reason: NoWinReason } | null;
  /** Only on tables with coaching (practice, tutorial, friend rooms with it on); can be null. */
  coach?: Coach | null;
};

// ── The hand ────────────────────────────────────────────────────────────────
export type PublicHand = {
  dealer: SeatIndex;
  /** Kind 27 East, 28 South, 29 West. */
  round_wind: TileKind;
  honba: number;
  sticks: number;
  scores: [number, number, number, number];
  /** Whose turn; null once the hand is over. */
  turn: SeatIndex | null;
  phase: HandPhase;
  /** Tiles left to draw. */
  remaining: number;
  seq: number;
  /** Dora indicators showing. */
  dora: TileId[];
  seats: SeatHandPublic[];
  last: LastEvent | null;
  last_discard: { seat: SeatIndex; tile: TileId } | null;
  result: HandResult | null;
};

/** The hand as a seated player sees it. */
export type SeatHand = PublicHand & {
  seat: SeatIndex;
  /** Your concealed tiles, sorted, without the one you just drew. */
  hand: TileId[];
  /** The tile you just drew, on your turn. */
  drawn: TileId | null;
  options: Options | null;
  help: Help;
};

export const isSeatHand = (hand: PublicHand | SeatHand | null | undefined): hand is SeatHand => Boolean(hand && "hand" in hand);

export type FinalStanding = { seat: SeatIndex; place: number; points: number; /** The game score: (points - 30000) / 1000 plus placement bonus */ score: number };
export type FinalLine = FinalStanding & {
  user_id: number | null;
  rating_before: number | null;
  rating_after: number | null;
  /** Prize paid, in dollars of Cash. */
  payout: number;
};

export type GameView = {
  /** 0 East, 1 South, 2 West. */
  wind: number;
  /** 0-3: which seat deals within the wind. */
  number: number;
  /** "East 1". */
  label: string;
  honba: number;
  sticks: number;
  scores: number[];
  hand_index: number;
  length: GameLength;
  /** SHA-256 of the seed, published at the start. */
  seed_hash: string;
  /** The hand in play; null once the game is over. */
  hand: PublicHand | SeatHand | null;
  history: { index: number; label: string; honba: number; result: BriefResult }[];
  over: boolean;
  final: { standings: FinalStanding[]; scores: number[]; sticks: number } | null;
};

export type TableClock = {
  phase: HandPhase | "between" | null;
  /** Epoch ms the current wait ends. */
  until: number;
  /** Seats being waited on with their deadlines (only during a turn). */
  seats: { seat: SeatIndex; deadline: number }[];
};

export type TournamentTag = { id: number; name: string; round: number; table: number; final: boolean; round_name: string };

export type TableResult =
  | { standings: FinalLine[]; seed: string; seed_hash: string; /** the game id for the replay, null if not recorded */ replay: number | null }
  | { cancelled: string };

/** Your own state at a table you sit at (only in seat views). */
export type TableMe = {
  seat: SeatIndex;
  away: boolean;
  bank: number;
  /** Epoch ms your clock runs out. */
  deadline: number | null;
  turn_ms: number;
  ready: boolean;
  /** Autopilot has the seat. */
  auto: boolean;
};

/** A table as the public channel and GET /tables/:id send it (publicTable). */
export type MahjongTable = {
  id: number;
  kind: TableKind;
  status: TableStatus;
  length: GameLength;
  speed: Speed;
  level: SeatBotLevel;
  coach: boolean;
  /** Entry fee in Credit; 0 for free tables. */
  fee: number;
  /** Prize for first to fourth, null if there is no fee. */
  prizes: number[] | null;
  rated: boolean;
  recorded: boolean;
  room_code: string | null;
  host_user_id: number | null;
  seats: (PublicSeat | null)[];
  game: GameView | null;
  clock: TableClock | null;
  /** Epoch ms a waiting table deals (bots fill, stakes start). */
  starts_at: number | null;
  expires_at: number | null;
  created_at: number;
  tournament: TournamentTag | null;
  lesson: { key: string; step: number; steps: number } | null;
  /** Spectator picks per seat. */
  picks: number[];
  picks_open: boolean;
  cheers: number[];
  spectators: number;
  result: TableResult | null;
  server_time: number;
};

/** A seated player's table: the public table plus `me`. */
export type SeatedTable = MahjongTable & { me: TableMe };
export const isSeatedTable = (table: MahjongTable | SeatedTable | null | undefined): table is SeatedTable => Boolean(table && "me" in table);

/** What `mahjong:{id}` and `mj-seat:{token}` push. */
export type MahjongPush = { type: "mahjong"; table: MahjongTable | SeatedTable };

export type SeatGrant = {
  index: SeatIndex;
  /** The socket channel for your seat's view: use as given. */
  channel: string;
  /** Only for signed-out guests: keep it and send it as X-Mahjong-Seat. */
  token?: string;
};

// ── Requests and responses ──────────────────────────────────────────────────
export type CreateTableBody =
  | { kind: "practice"; length?: GameLength; speed?: Speed; level?: BotLevel }
  | { kind: "tutorial"; lesson: string }
  | { kind: "friend"; length?: GameLength; speed?: "standard" | "relaxed"; level?: BotLevel; coach?: boolean }
  | { kind: "ranked"; length?: GameLength }
  | { kind: "stakes"; length?: GameLength; tier: number };

export type SeatedResponse = { table: SeatedTable; seat: SeatGrant };
export type TableResponse = { table: MahjongTable | SeatedTable; seat?: SeatGrant; my_pick?: { seat: number } | null };
export type ActionResponse = { table: SeatedTable };

export type MahjongAction =
  | { type: "discard"; tile: TileId; riichi?: boolean }
  | { type: "tsumo" }
  | { type: "ron" }
  | { type: "pass" }
  | { type: "kan" }
  | { type: "pon" | "chi"; tiles?: [TileId, TileId] }
  | { type: "ankan" | "kakan"; kind: TileKind }
  | { type: "kyuushu" };

// ── Lobby ───────────────────────────────────────────────────────────────────
export type LobbySeat = { seat: SeatIndex; username: string; profile_color: string | null; talent: string | null; bot: SeatBotLevel | null; rank: RankKey | null };
export type LobbyEntry = {
  id: number;
  kind: TableKind;
  status: TableStatus;
  length: GameLength;
  speed: Speed;
  fee: number;
  seats: (LobbySeat | null)[];
  /** "East 3", null while waiting. */
  label: string | null;
  scores: number[] | null;
  starts_at: number | null;
  tournament: TournamentTag | null;
  spectators: number;
};

/** What `lobby:mahjong` pushes. */
export type LobbyPush = { type: "lobby"; game: "mahjong"; tables: LobbyEntry[]; server_time: number };

export type StakeTier = {
  fee: number;
  pot: number;
  /** First to fourth. */
  prizes: number[];
  /** What leaves circulation. */
  cut: number;
  /** First prize less the fee. */
  top_net: number;
};

export type Rank = { key: Exclude<RankKey, "unranked">; name: string; min: number };

export type MahjongRules = {
  stakes: StakeTier[];
  paid_games_per_day: number;
  weekly_rate: number;
  weekly_minimum: number;
  min_net_worth: number;
  bot_fill_seconds: number;
  speeds: Record<Speed, { turn: number; bank: number }>;
  ranks: Rank[];
  ranked_after_games: number;
  bot_ratings: Record<SeatBotLevel, number>;
  tournament_rake_bps: number;
  tournament_prize_shares: number[];
};

export type LobbyResponse = {
  type: "lobby";
  game: "mahjong";
  tables: LobbyEntry[];
  server_time: number;
  rules: MahjongRules;
  /** "2026-11". */
  season: string;
  my_table: { id: number; kind: TableKind; status: TableStatus } | null;
};

export type RulesResponse = { rules: MahjongRules; season: string };

/** Why no paid game is open to the player right now. */
export type LimitBlock = "net_worth" | "in_the_red" | "weekly_limit" | "daily_limit";
export type MahjongLimits = {
  blocked: LimitBlock | null;
  weekly_limit: number;
  week_net: number;
  open_fees: number;
  /** How much more they could lose / win this week. */
  loss_room: number;
  win_room: number;
  games_today: number;
  games_per_day: number;
  net_worth: number;
  min_net_worth: number;
  credit: number;
  week_resets_at: string;
  day_resets_at: string;
};

export type MeResponse = { rating: { season: string; rating: number; games: number; rank: RankKey }; limits: MahjongLimits };

// ── Tournaments ─────────────────────────────────────────────────────────────
export type TournamentStatus = "signup" | "running" | "completed" | "cancelled";
export type PrizeTable = { fee: number; pot: number; pool: number; prizes: number[]; cut: number; top_net: number };

export type TournamentSummary = {
  id: number;
  name: string;
  status: TournamentStatus;
  /** 4, 8 or 16. */
  seats: number;
  length: GameLength;
  final_length: GameLength;
  speed: Speed;
  entry_fee: number;
  /** False once a bot had to sit in (or no fee). */
  paid: boolean;
  prizes: PrizeTable | null;
  starts_at: string;
  repeat_weekly: boolean;
  started_at: string | null;
  completed_at: string | null;
  entrants?: number;
  result: { places?: TournamentPlace[]; champion?: TournamentPlace; cancelled?: string } | null;
};

export type TournamentPlace = { place: number; user_id: number | null; name: string; bot: SeatBotLevel | null; payout: number };

export type TournamentEntrant = {
  user_id: number;
  username: string;
  profile_color: string | null;
  oshi: string | null;
  status: "registered" | "playing" | "out" | "finished" | "withdrawn";
  place: number | null;
  payout: number;
  /** Spectator picks on them. */
  picks: number;
};

export type BracketPlayer = { user_id: number | null; name: string; bot: SeatBotLevel | null };
export type BracketTable = {
  table: number;
  status: "pending" | "playing" | "done";
  game_id: number | null;
  players: BracketPlayer[];
  result: { place: number; user_id: number | null; name: string; bot: SeatBotLevel | null; points: number; score: number }[] | null;
};
export type BracketRound = { round: number; name: string; tables: BracketTable[] };
export type Bracket = { rounds: BracketRound[]; /** epoch ms the next round deals */ next_round_at: number | null };

export type TournamentResponse = {
  tournament: TournamentSummary;
  entrants: TournamentEntrant[];
  bracket: Bracket | null;
  server_time: number;
  /** Only when signed in. */
  me?: { entered: boolean; pick: { seat: number | null; user_id: number | null; name: string; correct: boolean | null } | null };
};

/** What `mahjong-tournament:{id}` pushes. */
export type TournamentPush = TournamentResponse & { type: "mahjong-tournament" };
export type TournamentsResponse = { tournaments: TournamentSummary[]; server_time: number };

export type CreateTournamentBody = {
  name: string;
  seats: 4 | 8 | 16;
  length?: GameLength;
  final_length?: GameLength;
  speed?: "standard" | "relaxed";
  entry_fee?: number;
  starts_at: string;
  repeat_weekly?: boolean;
};

export type PairRow = {
  a: { user_id: number; username: string; net: number };
  b: { user_id: number; username: string; net: number };
  games: number;
  a_above: number;
};

// ── Records ─────────────────────────────────────────────────────────────────
export type GamePlayer = {
  seat: SeatIndex;
  user_id: number | null;
  username: string;
  profile_color: string | null;
  profile_picture_url: string | null;
  bot: SeatBotLevel | null;
  talent: string | null;
  place: number | null;
  points: number | null;
  score: number | null;
  rating_before: number | null;
  rating_after: number | null;
  payout: number;
};

export type GameRow = {
  id: number;
  kind: TableKind;
  status: "playing" | "completed" | "cancelled";
  length: GameLength;
  speed: Speed;
  entry_fee: number;
  rated: boolean;
  humans: number;
  tournament_id: number | null;
  tournament_round: number | null;
  tournament_name: string | null;
  seed_hash: string;
  /** Only once the game is completed. */
  seed: string | null;
  started_at: string | null;
  completed_at: string | null;
};

export type RecordedHand = {
  index: number;
  /** 0 East, 1 South, 2 West. */
  wind: number;
  number: number;
  honba: number;
  dealer: SeatIndex;
  start_scores: number[];
  result: HandResult;
  /** Only for a completed game: every event, the replay. */
  log?: LogEvent[];
};

/** GET /games/:id. `result` is { standings, lines } once the game is over, else null. */
export type GameRecord = {
  game: GameRow;
  players: GamePlayer[];
  hands: RecordedHand[];
  result: { standings: FinalStanding[]; lines: FinalLine[] } | null;
};

/** A finished game in a list (seed left out). */
export type RecentGame = Omit<GameRow, "seed"> & { seed?: undefined; players: GamePlayer[] };

export type SeasonStats = {
  season: string;
  rating: number;
  peak: number;
  rank: RankKey;
  games: number;
  /** Firsts, seconds, thirds, fourths. */
  places: [number, number, number, number];
  total_score: number;
  hands: number;
  wins: number;
  tsumo: number;
  deal_ins: number;
  riichi: number;
  calls: number;
  yakuman: number;
  best_points: number;
  best_game_id: number | null;
  best_hand_index: number | null;
};

export type LadderRow = SeasonStats & {
  place: number;
  user_id: number;
  username: string;
  profile_color: string | null;
  profile_picture_url: string | null;
  oshi: string | null;
};

export type OshiStanding = { symbol: string; players: number; rating: number; firsts: number; games: number; yakuman: number };
export type PickLeader = { user_id: number; username: string; profile_color: string | null; correct: number; total: number };

/** A big win on the highlights page. `win` has what a share card needs to draw the hand. */
export type HighlightHand = {
  game_id: number;
  hand_index: number;
  wind: number;
  number: number;
  han: number | null;
  fu: number | null;
  yakuman: number;
  points: number;
  limit: LimitName | null;
  yaku: YakuKey[];
  at: string;
  kind: TableKind;
  user_id: number;
  username: string;
  profile_color: string | null;
  talent: string | null;
  win: { hand: TileId[]; melds: Meld[]; tile: TileId; tsumo: boolean; yaku: YakuLine[]; dora: WinEntry["dora"] } | null;
};

export type HighlightsPart = { hand_of_the_day: HighlightHand | null; biggest: HighlightHand[]; yakuman: HighlightHand[] };

export type LeaderboardResponse = HighlightsPart & {
  season: string;
  current_season: string;
  ladder: LadderRow[];
  oshi: OshiStanding[];
  picks: PickLeader[];
};

export type HighlightsResponse = HighlightsPart & { season: string; recent: RecentGame[] };

export type PlayerTotals = {
  games: number;
  firsts: number;
  seconds: number;
  thirds: number;
  fourths: number;
  hands: number;
  wins: number;
  tsumo: number;
  deal_ins: number;
  riichi: number;
  calls: number;
  yakuman: number;
  best_points: number;
  peak: number;
};

export type PlayerRecord = {
  user: { user_id: number; username: string; profile_color: string | null; profile_picture_url: string | null; oshi: string | null };
  season: string;
  /** 1500 if they haven't played this season. */
  rating: number;
  rank: RankKey;
  current: SeasonStats | null;
  seasons: SeasonStats[];
  totals: PlayerTotals;
  tournaments_won: { id: number; name: string; at: string }[];
  picks: { correct: number; total: number };
  recent: RecentGame[];
};

// ── Reactions (reactions:mahjong:{id}) ──────────────────────────────────────
export const STAMP_POSES = ["hype", "smug", "cope", "shock", "moon", "idle"] as const;
export type StampPose = (typeof STAMP_POSES)[number];
export const EMOJI_REACTIONS = ["fire", "party", "clap", "lol", "cry", "dead", "money", "pray"] as const;
export type EmojiReaction = (typeof EMOJI_REACTIONS)[number];
/** An id you may send: an emoji, `stamp-<pose>` (players), `cheer-<seat>` (spectators). */
export type MahjongReactionId = EmojiReaction | `stamp-${StampPose}` | `cheer-${SeatIndex}`;
/** How a push carries reactions: [id, seat (-1 = spectator), count]. */
export type ReactionItem = [string, number, number];

// ── Small pure helpers ──────────────────────────────────────────────────────
export const seatsFilled = (seats: readonly (unknown | null)[]) => seats.filter(Boolean).length;
export const humanSeats = (seats: readonly (PublicSeat | null)[]) => seats.filter((seat): seat is PublicSeat => Boolean(seat && !seat.bot));
/** Whether a table is one nobody else sits at (practice, tutorial). */
export const isSoloKind = (kind: TableKind) => kind === "practice" || kind === "tutorial";
/** Whether money rides on the table. */
export const isPaid = (table: { fee: number }) => table.fee > 0;
