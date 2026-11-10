import { apiFetch } from "@/app/lib/api";
import { seatHeaders, saveSeatToken } from "@/app/lib/games/mahjong/seat-token";
import type {
  ActionResponse,
  CreateTableBody,
  CreateTournamentBody,
  GameRecord,
  HighlightsResponse,
  LeaderboardResponse,
  LobbyResponse,
  MahjongAction,
  MeResponse,
  PairRow,
  PlayerRecord,
  RulesResponse,
  SeatedResponse,
  TableResponse,
  TournamentResponse,
  TournamentsResponse,
} from "@/app/lib/games/mahjong/types";

// Typed client for /api/games/mahjong (api/src/routes/mahjong.js). Same fetch helper and error type
// as lib/games/api.ts: a failed call throws what apiFetch throws (message = the API's error code,
// `.body` the details); gameErrorText() words it. Moves go over HTTP; the table itself arrives on
// the games socket (channels in lib/games/mahjong/channels below).

const BASE = "/api/games/mahjong";

const get = <T>(path: string, headers?: Record<string, string>) => apiFetch<T>(`${BASE}${path}`, { cache: "no-store", headers });
const post = <T>(path: string, body?: unknown, headers?: Record<string, string>) =>
  apiFetch<T>(`${BASE}${path}`, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body), headers });

/** Socket channel names. A seated player's channel comes from the API (`seat.channel`): use it as given. */
export const mahjongChannels = {
  lobby: "lobby:mahjong",
  table: (id: number | string) => `mahjong:${id}`,
  reactions: (id: number | string) => `reactions:mahjong:${id}`,
  tournament: (id: number | string) => `mahjong-tournament:${id}`,
} as const;

// ── Lobby and rules ─────────────────────────────────────────────────────────
export const fetchMahjongLobby = () => get<LobbyResponse>("/");
export const fetchMahjongRules = () => get<RulesResponse>("/rules");
/** Signed in: this season's rating and the paid-game limits. */
export const fetchMahjongMe = () => get<MeResponse>("/me");

// ── Tables ──────────────────────────────────────────────────────────────────
/** Opens (or joins, for quick match and stakes) a table. Practice and the tutorial need an account; other kinds a verified one. */
export const createMahjongTable = (body: CreateTableBody) => post<SeatedResponse>("/tables", body);
/** A signed-out visitor's practice hand or guided lesson. Saves the seat token for the table. */
export async function createGuestTable(options: { lesson?: string; level?: "easy" | "normal" } = {}) {
  const response = await post<SeatedResponse>("/guest", options);
  if (response.seat.token) saveSeatToken(response.table.id, response.seat.token);
  return response;
}
export const fetchMahjongTable = (id: number) => get<TableResponse>(`/tables/${id}`, seatHeaders(id));
/** { table_id } for a friend room code. */
export const fetchRoom = (code: string) => get<{ table_id: number }>(`/rooms/${encodeURIComponent(code)}`);
export const sitMahjongTable = (id: number) => post<SeatedResponse>(`/tables/${id}/sit`);
export const leaveMahjongTable = (id: number) => post<{ ok: true }>(`/tables/${id}/leave`, undefined, seatHeaders(id));
/** A friend room's host deals; bots take empty seats. */
export const startMahjongTable = (id: number) => post<TableResponse>(`/tables/${id}/start`);
export const backToSeat = (id: number) => post<ActionResponse>(`/tables/${id}/back`, undefined, seatHeaders(id));
/** "Next hand": skip the rest of the pause between hands. */
export const readyForNext = (id: number) => post<ActionResponse>(`/tables/${id}/ready`, undefined, seatHeaders(id));
export const actMahjong = (id: number, action: MahjongAction) => post<ActionResponse>(`/tables/${id}/action`, { action }, seatHeaders(id));
/** A spectator's free pick of who wins the game (before the second hand). */
export const pickGameWinner = (id: number, seat: number) => post<{ pick: { seat: number; name: string } }>(`/tables/${id}/pick`, { seat });

// ── Records ─────────────────────────────────────────────────────────────────
export const fetchMahjongGame = (id: number) => get<GameRecord>(`/games/${id}`);
export const fetchMahjongLeaderboard = (season?: string) => get<LeaderboardResponse>(`/leaderboard${season ? `?season=${encodeURIComponent(season)}` : ""}`);
export const fetchMahjongHighlights = () => get<HighlightsResponse>("/highlights");
export const fetchMahjongPlayer = (username: string) => get<PlayerRecord>(`/players/${encodeURIComponent(username)}`);

// ── Tournaments ─────────────────────────────────────────────────────────────
export const fetchTournaments = () => get<TournamentsResponse>("/tournaments");
export const fetchTournament = (id: number) => get<TournamentResponse>(`/tournaments/${id}`);
export const registerTournament = (id: number) => post<TournamentResponse>(`/tournaments/${id}/register`);
export const withdrawTournament = (id: number) => post<TournamentResponse>(`/tournaments/${id}/withdraw`);
export const pickTournamentWinner = (id: number, userId: number) => post<{ pick: { user_id: number; name: string } }>(`/tournaments/${id}/pick`, { user_id: userId });
/** Staff. */
export const createTournament = (body: CreateTournamentBody) => post<{ tournament: TournamentResponse["tournament"] }>("/tournaments", body);
export const cancelTournament = (id: number) => post<{ ok: true }>(`/tournaments/${id}/cancel`);
export const fetchPairReport = (days?: number) => get<{ pairs: PairRow[]; linking: boolean }>(`/admin/pairs${days ? `?days=${days}` : ""}`);
