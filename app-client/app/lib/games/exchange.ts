import { apiFetch } from "@/app/lib/api";
import type { Rarity, TalentCard } from "@/app/lib/games/types";

// Typed client for the card exchange (api/src/services/games/exchange.js). Live changes arrive
// on the games socket: `exchange` (the public tape) and `me` (your alerts).

export type ExchangeCard = TalentCard & { qty?: number };
export type UserRef = { id?: number; username: string; profile_color?: string | null };

export type Listing = {
  id: number;
  card: ExchangeCard;
  card_key: string;
  kind: "fixed" | "auction";
  status: "active" | "sold" | "cancelled" | "expired";
  seller: UserRef;
  price: number | null;
  start_price: number | null;
  current_bid: number | null;
  bid_count: number;
  leader: UserRef | null;
  min_bid: number | null;
  buy_now: number | null;
  ask: number | null;
  extensions: number;
  created_at: string;
  ends_at: string;
  closed_at: string | null;
  sale_price: number | null;
  fee: number | null;
  buyer: UserRef | null;
  is_mine: boolean;
  is_leading: boolean;
  my_top_bid?: number | null;
};

export type Sale = { id: number; listing_id: number | null; card: ExchangeCard; card_key: string; kind: string; price: number; seller: UserRef | null; buyer: UserRef | null; at: string };

export type Floor = { rarity: Rarity; floor: number | null; listed: number; avg7d: number | null; sales7d: number; last: number | null };

export type TapeEvent =
  | { seq: number; at: string; type: "sale"; listing_id: number; card: ExchangeCard; card_key: string; price: number; kind: string; buyer: UserRef; seller: UserRef }
  | { seq: number; at: string; type: "bid"; listing: Listing; amount: number; bidder: UserRef | null; extended: boolean }
  | { seq: number; at: string; type: "listed"; listing: Listing }
  | { seq: number; at: string; type: "delisted"; listing_id: number; card_key: string }
  | { seq: number; at: string; type: "trade"; from: string; to: string; cards: number };

export type ExchangeRules = {
  fee_rate: number;
  auction_hours: number[];
  fixed_listing_days: number;
  snipe_window_seconds: number;
  trade_hours: number;
  min_account_age_hours: number;
};

export type Overview = {
  floors: Floor[];
  ending_soon: Listing[];
  hot: Listing[];
  recent_sales: Sale[];
  biggest_sales: Sale[];
  stats: { volume_24h: number; sales_24h: number; buy_now: number; auctions: number; trades_24h: number };
  tape: TapeEvent[];
  rules: ExchangeRules;
};

export type PriceEntry = { floor: number | null; listed: number; last: number | null; last_at: string | null; avg7d: number | null; sales7d: number; value: number | null };
export type PriceBook = Record<string, PriceEntry>;

export type CardDetail = {
  card: ExchangeCard;
  card_key: string;
  history: { price: number; kind: string; at: string; seller: string | null; buyer: string | null }[];
  listings: Listing[];
  stats: { last: number | null; floor: number | null; high30d: number | null; low30d: number | null; sales30d: number; owners: number; in_circulation: number; in_escrow: number };
  mine: { stars: number; copies: number; tradeable: number } | null;
};

export type Desk = {
  eligibility: { eligible: boolean; reason: string | null; available_at: string | null };
  limits: { active_listings: number; max_active_listings: number; open_offers: number; max_open_offers: number; daily_actions: number; max_daily_actions: number };
  incoming_offers: number;
  listings: Listing[];
  closed: Listing[];
  bids: Listing[];
  won: Listing[];
};

export type TradeSide = { cards: ExchangeCard[]; cash: number; shards: number };
export type Trade = {
  id: number;
  status: "pending" | "accepted" | "declined" | "cancelled" | "expired" | "countered";
  from: UserRef;
  to: UserRef;
  give: TradeSide;
  ask: TradeSide;
  message: string | null;
  counter_of: number | null;
  created_at: string;
  expires_at: string;
  responded_at: string | null;
  direction: "incoming" | "outgoing";
};
export type TradesResponse = { incoming: Trade[]; outgoing: Trade[]; history: Trade[] };

export type Alert = {
  kind: "sold" | "bought" | "won" | "outbid" | "auction_lost" | "expired" | "bid_received" | "trade_offer" | "trade_countered" | "trade_accepted" | "trade_declined" | "trade_cancelled" | "trade_expired";
  at: string;
  listing_id?: number;
  card?: ExchangeCard;
  price?: number;
  proceeds?: number;
  amount?: number | null;
  your_bid?: number;
  buyer?: UserRef;
  seller?: UserRef;
  bidder?: UserRef | null;
  trade?: Trade;
};

export type TradeDraftSide = { cards: { card_key: string; qty: number }[]; cash: number; shards: number };

const post = <T>(path: string, body?: unknown) => apiFetch<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });
const noStore = { cache: "no-store" as const };

export const fetchOverview = () => apiFetch<Overview>("/api/games/exchange/overview", noStore);
export const fetchPriceBook = () => apiFetch<{ prices: PriceBook }>("/api/games/exchange/prices", noStore).then((res) => res.prices ?? {});
export const fetchListings = (params: Record<string, string | number | undefined>) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== "") search.set(key, String(value));
  return apiFetch<{ listings: Listing[]; total: number; page: number; limit: number }>(`/api/games/exchange/listings?${search}`, noStore);
};
export const fetchCardDetail = (symbol: string, rarity: string) => apiFetch<CardDetail>(`/api/games/exchange/cards/${encodeURIComponent(symbol)}/${encodeURIComponent(rarity)}`, noStore);
export const fetchDesk = () => apiFetch<Desk>("/api/games/exchange/me", noStore);
export const fetchTrades = () => apiFetch<TradesResponse>("/api/games/exchange/trades", noStore);
export const fetchTradeableCards = (username: string) =>
  apiFetch<{ user: UserRef; cards: (ExchangeCard & { copies: number; tradeable: number })[] }>(`/api/games/exchange/players/${encodeURIComponent(username)}/cards`, noStore);

export const createListing = (body: { card_key: string; kind: "fixed" | "auction"; price?: number; start_price?: number; buy_now?: number | null; duration_hours?: number }) =>
  post<{ listing: Listing }>("/api/games/exchange/listings", body);
export const cancelListing = (id: number) => apiFetch<{ listing: Listing }>(`/api/games/exchange/listings/${id}`, { method: "DELETE" });
export const buyListing = (id: number) => post<{ listing: Listing; price: number; fee: number }>(`/api/games/exchange/listings/${id}/buy`);
export const placeBid = (id: number, amount: number) => post<{ listing: Listing; extended?: boolean; bought?: boolean; price?: number }>(`/api/games/exchange/listings/${id}/bids`, { amount });
export const proposeTrade = (body: { to_username?: string; counter_of?: number; give: TradeDraftSide; ask: TradeDraftSide; message?: string }) =>
  post<{ trade: Trade }>("/api/games/exchange/trades", body);
export const respondTrade = (id: number, action: "accept" | "decline" | "cancel") => post<{ trade: Trade }>(`/api/games/exchange/trades/${id}/${action}`);

export const cardPath = (cardKey: string) => {
  const [, symbol, rarity] = cardKey.split(":");
  return `/games/exchange/card/${symbol}/${rarity}`;
};

/** What a card is worth for meters and binder value: last sale, else 7-day average, else floor. */
export const cardValue = (prices: PriceBook | null, cardKey: string) => prices?.[cardKey]?.value ?? null;

export function sideValue(prices: PriceBook | null, side: { cards: { card_key?: string; key?: string; qty?: number }[]; cash: number }) {
  let value = side.cash || 0;
  let unpriced = 0;
  for (const entry of side.cards) {
    const key = entry.card_key ?? entry.key ?? "";
    const price = cardValue(prices, key);
    if (price === null) unpriced += entry.qty ?? 1;
    else value += price * (entry.qty ?? 1);
  }
  return { value, unpriced };
}
