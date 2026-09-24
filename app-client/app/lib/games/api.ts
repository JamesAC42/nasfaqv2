import { apiFetch } from "@/app/lib/api";
import type {
  BannersResponse,
  BlackjackLobbyRow,
  BlackjackTable,
  ClaimResponse,
  CollectionResponse,
  CraftResponse,
  FeedPull,
  GameEntry,
  GameTable,
  HighLowCall,
  LobbyMessage,
  PublicCollection,
  PullResponse,
  TableGame,
  TickerTapBoard,
  TickerTapSession,
  TickerTapSubmitResponse,
} from "@/app/lib/games/types";

// Typed client for the games API. Money moves only through these POSTs; live state arrives on
// the games socket (use-games-socket.ts).

const post = <T>(path: string, body?: unknown) =>
  apiFetch<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });

// Catalog
export const fetchCatalog = () => apiFetch<{ games: GameEntry[] }>("/api/games/catalog", { cache: "no-store" });

// Talent cards
export const fetchBanners = () => apiFetch<BannersResponse>("/api/games/cards/banners", { cache: "no-store" });
export const fetchCollection = () => apiFetch<CollectionResponse>("/api/games/cards/collection", { cache: "no-store" });
export const pullCards = (banner: string, count: 1 | 10) => post<PullResponse>("/api/games/cards/pull", { banner, count });
export const craftCard = (cardKey: string) => post<CraftResponse>("/api/games/cards/craft", { card_key: cardKey });
export const claimReward = (rewardKey: string) => post<ClaimResponse>("/api/games/cards/claim", { reward_key: rewardKey });
export const saveShowcase = (cardKeys: string[]) =>
  apiFetch<{ showcase: { slot: number; card_key: string }[] }>("/api/games/cards/showcase", { method: "PUT", body: JSON.stringify({ card_keys: cardKeys }) });
export const fetchPullFeed = (limit = 16) => apiFetch<{ pulls: FeedPull[] }>(`/api/games/cards/feed?limit=${limit}`, { cache: "no-store" });
export const fetchPublicCollection = (username: string) =>
  apiFetch<PublicCollection>(`/api/games/cards/profile/${encodeURIComponent(username)}`, { cache: "no-store" });

// Two-player tables (duel, high-low)
export const fetchTables = (game: TableGame) => apiFetch<LobbyMessage>(`/api/games/tables?game=${game}`, { cache: "no-store" });
export const fetchMyTables = () => apiFetch<{ tables: GameTable[] }>("/api/games/tables/mine", { cache: "no-store" });
export const fetchTable = (id: number) => apiFetch<{ table: GameTable }>(`/api/games/tables/${id}`, { cache: "no-store" });
export const createTable = (game: TableGame, stake: number, deck?: string[]) => post<{ table: GameTable }>("/api/games/tables", { game, stake, deck });
export const joinTable = (id: number, deck?: string[]) => post<{ table: GameTable }>(`/api/games/tables/${id}/join`, { deck });
export const cancelTable = (id: number) => post<{ table?: GameTable }>(`/api/games/tables/${id}/cancel`);
export const pickCard = (id: number, card: number) => post<{ table: GameTable }>(`/api/games/tables/${id}/action`, { type: "pick", card });
export const callNext = (id: number, dir: "higher" | "lower", double: boolean) =>
  post<{ table: GameTable & { my_call?: HighLowCall } }>(`/api/games/tables/${id}/action`, { type: "call", dir, double });
export const forfeitTable = (id: number) => post<{ table: GameTable }>(`/api/games/tables/${id}/action`, { type: "forfeit" });

// Blackjack
export const fetchBlackjackLobby = () => apiFetch<{ tables: BlackjackLobbyRow[] }>("/api/games/blackjack", { cache: "no-store" });
export const fetchBlackjackTable = (key: string) => apiFetch<{ table: BlackjackTable }>(`/api/games/blackjack/${key}`, { cache: "no-store" });
export const sitBlackjack = (key: string, seat?: number) => post<{ table: BlackjackTable }>(`/api/games/blackjack/${key}/sit`, { seat });
export const leaveBlackjack = (key: string) => post<{ table: BlackjackTable }>(`/api/games/blackjack/${key}/leave`);
export const betBlackjack = (key: string, amount: number) => post<{ table: BlackjackTable }>(`/api/games/blackjack/${key}/bet`, { amount });
export const actBlackjack = (key: string, action: "hit" | "stand" | "double") => post<{ table: BlackjackTable }>(`/api/games/blackjack/${key}/action`, { action });

// Ticker Tap
export const startTickerTap = () =>
  post<{ session: TickerTapSession; wallet: { cash_balance_after: number | null } }>("/api/games/ticker-tap/sessions");
export const submitTickerTap = (sessionId: number, taps: { lane: number; t: number }[]) =>
  post<TickerTapSubmitResponse>(`/api/games/ticker-tap/sessions/${sessionId}/submit`, { taps });
export const fetchTickerTapBoard = () => apiFetch<TickerTapBoard>("/api/games/ticker-tap/leaderboard", { cache: "no-store" });
