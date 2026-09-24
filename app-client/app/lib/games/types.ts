// Shapes returned by the games API (api/src/routes/games.js, gameTables.js).
// Spec: docs/games/GAMES_DESIGN.md.

export type Rarity = "C" | "R" | "SR" | "SSR" | "UR";

export type Talent = {
  symbol: string;
  name: string;
  unit: string | null;
  icon: string | null;
  color: string | null;
  move_pct?: number | null;
  price?: number | null;
};

/** A card as the collection, pulls and showcases return it. */
export type TalentCard = Talent & {
  key: string;
  rarity: Rarity;
  rarity_name?: string;
  power: number;
  stars: number;
  copies?: number;
  obtained_at?: string | null;
};

export type PulledCard = TalentCard & {
  was_new: boolean;
  was_featured: boolean;
  copies: number;
  shards: number;
};

export type Banner = {
  key: string;
  pool_key: "standard" | "featured";
  kind: "standard" | "featured";
  name: string;
  featured: Talent | null;
  starts_at: string | null;
  ends_at: string | null;
};

export type BannersResponse = {
  banners: Banner[];
  pull_cost_cash: number;
  ten_pull_cost_cash: number;
};

export type Pity = {
  pulls_since_sr: number;
  pulls_since_ssr: number;
  next_sr_guaranteed_in: number;
  ssr_guaranteed_in: number;
  soft_pity_active: boolean;
  next_ssr_rate_bps: number;
  featured_guaranteed: boolean;
  total_pulls: number;
};

export type RarityRate = {
  rarity: Rarity;
  name: string;
  rate_bps: number;
  power: number;
  duplicate_shards: number;
  craft_shards: number;
};

export type SetProgress = {
  have: number;
  complete: boolean;
  claimed: boolean;
  reward_shards: number;
};

export type UnitSet = {
  key: string;
  label: string;
  total: number;
  members: { symbol: string; best: Rarity | null }[];
  roster: SetProgress;
  spotlight: SetProgress;
};

export type ShowcaseSlot = { slot: number; card_key: string };

export type CollectionResponse = {
  shards: number;
  talents: Talent[];
  cards: TalentCard[];
  total_cards: number;
  showcase: ShowcaseSlot[];
  sets: UnitSet[];
  starter_claimed: boolean;
  banners: Banner[];
  rates: RarityRate[];
  pity: Record<"standard" | "featured" | "capsule", Pity>;
};

export type PullResponse = {
  batch_id: string;
  banner: { key: string; kind: string; name: string };
  cost_cash: number;
  cash_balance: number;
  shards: number;
  shards_awarded: number;
  cards: PulledCard[];
  pity: Pity;
};

export type CraftResponse = { card: TalentCard & { was_new?: boolean }; shards: number; cost_shards?: number };

export type ClaimResponse = {
  reward_key: string;
  reward: { shards: number; cards?: (TalentCard & { was_new?: boolean })[]; cosmetic?: unknown };
  shards: number;
};

export type FeedPull = {
  id: number;
  card_key: string;
  rarity: Rarity;
  was_featured: boolean;
  created_at: string;
  username: string;
  profile_color: string | null;
  symbol: string;
  name: string;
  icon: string | null;
  color: string | null;
  unit: string | null;
};

export type PublicCollection = {
  username: string;
  unique_cards: number;
  total_cards: number;
  by_rarity: Partial<Record<Rarity, number>>;
  showcase: (TalentCard & { slot: number })[];
};

// ── Tables ─────────────────────────────────────────────────────────────────
export type TableGame = "oshi-duel" | "high-low";

export type TablePlayer = {
  seat: number;
  user_id: number | string;
  username: string;
  profile_color: string | null;
  profile_picture_url?: string | null;
  deck_size?: number;
};

/** A deck card as the duel snapshots it when the match starts. */
export type DuelCard = {
  key: string;
  symbol: string;
  name: string;
  unit: string | null;
  icon: string | null;
  color: string | null;
  rarity: Rarity;
  stars: number;
  base: number;
  momentum: number;
  move_pct: number | null;
  price: number | null;
};

export type DuelCondition = { key: string; label: string; text: string; unit?: string | null };

export type PowerBreakdown = { base: number; momentum: number; bonus: number; total: number };

export type DuelState = {
  phase: "starting" | "picking" | "reveal" | "done";
  round: number;
  max_rounds: number;
  wins_needed: number;
  deadline: number | null;
  decks: DuelCard[][];
  used: boolean[][];
  wins: number[];
  picked: boolean[];
  condition: DuelCondition | null;
  upcoming_conditions: number;
  history: { round: number; condition: DuelCondition; picks: number[]; auto: boolean[]; powers: PowerBreakdown[]; winner: number | null }[];
  winner: number | null;
  done_reason: "wins" | "rounds" | "forfeit" | null;
};

export type PlayingCard = { rank: number | string; suit: "S" | "H" | "D" | "C" };

export type HighLowCall = { dir: "higher" | "lower" | "pass"; double: boolean } | null;

export type HighLowState = {
  phase: "starting" | "calling" | "reveal" | "done";
  round: number;
  rounds: number;
  deadline: number | null;
  current: PlayingCard;
  cards_left: number;
  called: boolean[];
  scores: number[];
  doubles_used: boolean[];
  history: { round: number; from: PlayingCard; to: PlayingCard; calls: HighLowCall[]; deltas: number[] }[];
  winner: number | null;
  done_reason: "rounds" | "forfeit" | null;
};

export type TableResult = {
  winner_seat?: number | null;
  winner_username?: string | null;
  payout?: number;
  rake?: number;
  reason?: string | null;
  cancelled?: string;
} | null;

export type GameTable<S = DuelState | HighLowState> = {
  id: number;
  game: TableGame;
  status: "open" | "playing" | "done" | "completed" | "cancelled";
  stake: number;
  pot: number;
  rake_bps: number;
  payout_if_win: number;
  created_at: string | number;
  expires_at: string | number | null;
  host_user_id: number | string | null;
  players: TablePlayer[];
  spectators: number;
  state: S | null;
  result: TableResult;
  server_time: number;
  /** Only on the acting player's own response. */
  my_pick?: number | null;
  my_call?: HighLowCall;
};

export type RecentMatch = {
  id: number;
  stake: number;
  completed_at: string;
  result: TableResult;
  players: { seat: number; username: string; profile_color: string | null; outcome: string | null; payout: number }[];
};

export type LobbyMessage = { type: "lobby"; game: string; tables: GameTable[]; recent?: RecentMatch[]; channel?: string };

// ── Blackjack ──────────────────────────────────────────────────────────────
export type BlackjackCard = { rank: string; suit: "S" | "H" | "D" | "C" } | null;

export type BlackjackSeat = {
  seat: number;
  user_id: number | string;
  username: string;
  profile_color: string | null;
  bet: number;
  doubled: boolean;
  hand: BlackjackCard[];
  value: number | null;
  status: "waiting" | "betting" | "playing" | "stood" | "bust" | "blackjack" | "done";
  outcome: "win" | "loss" | "push" | "bust" | "blackjack" | null;
  payout: number;
} | null;

export type BlackjackTable = {
  key: string;
  name: string;
  min_bet: number;
  max_bet: number;
  phase: "idle" | "betting" | "playing" | "results";
  deadline: number | null;
  turn: number | null;
  round_id: number | null;
  dealer: { hand: BlackjackCard[]; value: number | null; hidden: boolean };
  seats: BlackjackSeat[];
  shoe_remaining: number;
  shoe_size: number;
  history: { round_id: number; dealer: number; results: { username: string; outcome: string; payout: number; bet: number }[] }[];
  spectators: number;
  server_time: number;
};

export type BlackjackLobbyRow = {
  key: string;
  name: string;
  min_bet: number;
  max_bet: number;
  seated: number;
  seats: number;
  phase: BlackjackTable["phase"];
  spectators: number;
};

// ── Ticker Tap ─────────────────────────────────────────────────────────────
export type TapTarget = {
  index: number;
  lane: number;
  start_ms: number;
  life_ms: number;
  kind: "up" | "down" | "gold";
  symbol: string | null;
};

export type TickerTapSession = {
  id: number;
  status: string;
  entry_fee_cash: number;
  started_at: string;
  config: { version: number; lanes: number; run_ms: number; points: Record<"up" | "gold" | "down" | "miss", number>; timeline: TapTarget[] };
};

export type TapReplay = {
  score: number;
  max_combo: number;
  accuracy: number;
  catch_rate: number;
  greens: number;
  golds: number;
  reds: number;
  misses: number;
  escaped: number;
  taps: number;
};

export type TickerTapSubmitResponse = {
  session: { id: number; status: string; score: number; payout_cash: number; completed_at: string };
  result: { replay: TapReplay; personal_best: boolean; previous_best: number | null };
};

export type TickerTapLeader = {
  rank: number;
  session_id: number;
  user_id: number;
  username: string;
  profile_color: string | null;
  score: number;
  completed_at: string;
  stats: TapReplay | null;
  projected_payout?: number;
};

export type TickerTapBoard = {
  game: { entry_fee_cash: number; name: string; description: string } | null;
  week: { week_start: string; starts_at: string; ends_at: string; runs: number; fees: number; pool: number; share_bps: number; split: number[] };
  leaderboard: TickerTapLeader[];
  me: TickerTapLeader | null;
  last_week: { rank: number; score: number; payout: number; username: string; profile_color: string | null; week_start: string }[];
};

// ── Catalog ────────────────────────────────────────────────────────────────
export type GameEntry = {
  id: number;
  key: string;
  name: string;
  description: string;
  game_type: "gacha" | "single_player" | "pvp" | "table" | "idle";
  status: "active" | "draft" | "disabled";
  entry_fee_cash: number;
  min_stake_cash: number | null;
  max_stake_cash: number | null;
  sort_order: number;
  config: Record<string, unknown>;
};
