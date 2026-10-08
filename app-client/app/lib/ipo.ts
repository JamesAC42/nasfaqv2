import { apiFetch } from "@/app/lib/api";

// IPOs (api/src/services/ipo.js, docs/market/ipo.md): new talents tracked before they list, a window
// to subscribe at the IPO price, then listing at the 09:00 settlement.

export type IpoStatus = "announced" | "open" | "listed" | "cancelled";

export type ChannelDay = { day: string; subscribers: number | null; views: number | null; videos: number | null };

export type ChannelSummary = {
  days_tracked: number;
  tracked_since: string | null;
  latest: ChannelDay | null;
  week: { days: number; subscribers: number; views: number; videos: number } | null;
};

export type IpoSubscription = {
  requested_shares: number;
  price: number;
  held_cash: number;
  status: "pending" | "allocated" | "cancelled" | "refunded";
  allocated_shares: number;
  refunded_cash: number;
  updated_at: string;
};

export type IpoTalent = {
  listing_id: number;
  symbol: string;
  display_name: string;
  name_short: string;
  name_english: string | null;
  name_japanese: string | null;
  unit: string | null;
  icon: string | null;
  color: string | null;
  twitter_id: string | null;
  /** "MM-DD" */
  birthday: string | null;
  youtube_channel_id: string;
  youtube_channel_icon_url: string | null;
  /** Her oshimark emoji (from her X name) and its Twemoji SVG. */
  oshimark_emoji: string | null;
  oshimark_url: string | null;
  status: "pending" | "listed" | "cancelled";
  channel: ChannelSummary;
  series: ChannelDay[];
  /** Set when the window opens. */
  ipo_price: number | null;
  shares_offered: number | null;
  starting_max_supply: number | null;
  player_cap: number | null;
  subscribed_shares: number;
  subscribers: number;
  shares_allocated: number | null;
  mine: IpoSubscription | null;
  // Admin only
  asset_status?: string;
  is_active?: boolean;
  current_fair_value?: number | null;
  debut_fair_value?: number | null;
  fair_value_series?: { day: string; fair_value: number }[];
};

export type IpoEvent = {
  id: number;
  title: string;
  status: IpoStatus;
  listing_date: string;
  window_opens_at: string;
  window_closes_at: string;
  window_open: boolean;
  discount_pct: number;
  offering_pct: number;
  player_cap_pct: number;
  opened_at: string | null;
  listed_at: string | null;
  cancelled_at: string | null;
  talents: IpoTalent[];
  // Admin only
  last_error?: string | null;
  created_at?: string;
};

export const fetchIpos = () => apiFetch<{ events: IpoEvent[]; server_time: string }>("/api/market/ipo", { cache: "no-store" });

export const subscribeIpo = (symbol: string, shares: number) =>
  apiFetch<{ symbol: string; requested_shares: number; price: number; held_cash: number; cash_balance: number }>("/api/market/ipo/subscribe", {
    method: "POST",
    body: JSON.stringify({ symbol, shares }),
  });

export const cancelIpoSubscription = (symbol: string) =>
  apiFetch<{ symbol: string; released_cash: number }>("/api/market/ipo/cancel", { method: "POST", body: JSON.stringify({ symbol }) });

// ── Admin ────────────────────────────────────────────────────────────────

export type DetectedTalent = {
  youtube_channel_id: string;
  name_short: string;
  name_english: string | null;
  name_japanese: string | null;
  twitter_id: string | null;
  profile_id: string | null;
  birthday: string | null;
  height: string | null;
  unit: string | null;
  icon: string | null;
  reference_image_url: string | null;
  profile_url: string;
  symbol: string | null;
  youtube_channel_url: string;
  youtube_avatar_url: string | null;
  /** Her X display name and the emoji in it: the oshimark is one of these. */
  x_name: string | null;
  oshimark_candidates: string[];
};

export type UnassignedTalent = {
  asset_id: number;
  symbol: string;
  display_name: string;
  youtube_channel_id: string;
  unit: string | null;
  color: string | null;
  is_active: boolean;
  oshimark_url: string | null;
  youtube_channel_icon_url: string | null;
  channel: ChannelSummary;
};

export type AdminIpoOverview = {
  events: IpoEvent[];
  unassigned: UnassignedTalent[];
  used_symbols: string[];
  defaults: { windowHours: number; discountPct: number; offeringPct: number; playerCapPct: number; listing_date: string };
  settlement: { hour: number; minute: number; time_zone: string };
  server_time: string;
};

export type NewIpoTalent = Pick<
  DetectedTalent,
  "youtube_channel_id" | "name_short" | "name_english" | "name_japanese" | "twitter_id" | "profile_id" | "birthday" | "height" | "icon" | "reference_image_url" | "youtube_avatar_url"
> & {
  symbol: string;
  color: string;
  unit: string;
  oshimark_emoji: string | null;
};

export type IpoSettings = {
  title: string;
  listing_date: string;
  window_hours: number;
  discount_pct: number;
  offering_pct: number;
  player_cap_pct: number;
};

export const fetchAdminIpo = () => apiFetch<AdminIpoOverview>("/api/admin/ipo", { cache: "no-store" });

export const detectTalents = () =>
  apiFetch<{ talents: DetectedTalent[]; errors: { url: string; error: string }[]; profiles_checked: number; checked_at: string }>("/api/admin/ipo/detect", { method: "POST" });

export const createIpo = (body: IpoSettings & { talents: NewIpoTalent[]; asset_ids: number[] }) =>
  apiFetch<{ event_id: number; reference_images: { symbol: string; uploaded: boolean; url?: string | null; error?: string }[] }>("/api/admin/ipo/events", {
    method: "POST",
    body: JSON.stringify(body),
  });

export const updateIpo = (id: number, body: Partial<IpoSettings>) => apiFetch<{ ok: true }>(`/api/admin/ipo/events/${id}`, { method: "PATCH", body: JSON.stringify(body) });

export const openIpoWindow = (id: number) => apiFetch<{ status: string }>(`/api/admin/ipo/events/${id}/open`, { method: "POST" });

export const listIpoNow = (id: number) =>
  apiFetch<{ listed: { symbol: string; price: number; allocated: number; offered: number; subscribers: number }[] }>(`/api/admin/ipo/events/${id}/list`, { method: "POST" });

export const cancelIpo = (id: number) => apiFetch<{ refunded: number }>(`/api/admin/ipo/events/${id}/cancel`, { method: "POST" });

/** Re-reads her YouTube avatar and X name and sets her oshimark (the given emoji, or keeps hers). */
export const refreshIpoTalent = (listingId: number, oshimark_emoji?: string | null) =>
  apiFetch<{ youtube_avatar_url: string | null; x_name: string | null; oshimark_candidates: string[]; oshimark_emoji: string | null; oshimark_icon: { uploaded: boolean; reason?: string }; errors: string[] }>(
    `/api/admin/ipo/listings/${listingId}/profile`,
    { method: "POST", body: JSON.stringify({ oshimark_emoji: oshimark_emoji ?? null }) },
  );

export const removeIpoTalent = (id: number, listingId: number) => apiFetch<{ ok: true }>(`/api/admin/ipo/events/${id}/listings/${listingId}`, { method: "DELETE" });

// ── Shared helpers ───────────────────────────────────────────────────────

/** Twemoji's SVG for an emoji (same as the API's twemojiUrl). */
export function twemojiUrl(emoji: string) {
  const chars = emoji.includes("\u200D") ? emoji : emoji.replace(/\uFE0F/g, "");
  return `https://cdn.jsdelivr.net/gh/jdecked/twemoji@16.0.1/assets/svg/${[...chars].map((char) => char.codePointAt(0)!.toString(16)).join("-")}.svg`;
}

/** The window for a listing date, matching the API: closes at that day's 09:00 New York settlement. */
export function ipoWindow(listingDate: string, hours: number, settlementHour = 9) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(listingDate)) return null;
  const [year, month, day] = listingDate.split("-").map(Number);
  const desired = Date.UTC(year, month - 1, day, settlementHour, 0, 0);
  let guess = new Date(desired);
  for (let i = 0; i < 4; i += 1) {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
        .formatToParts(guess)
        .filter((part) => part.type !== "literal")
        .map((part) => [part.type, Number(part.value)]),
    );
    const diff = desired - Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
    if (!diff) break;
    guess = new Date(guess.getTime() + diff);
  }
  return { opens: new Date(guess.getTime() - hours * 3_600_000), closes: guess };
}

/** "Mon, Oct 19" for a YYYY-MM-DD market date. */
export function listingDay(dateKey: string) {
  const date = new Date(`${dateKey}T12:00:00Z`);
  return Number.isNaN(date.getTime()) ? dateKey : date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}

/** "Sat, Oct 17, 09:00 ET" */
export function etMoment(value: string | number | Date) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return `${date.toLocaleString("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })} ET`;
}

export function compactCount(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  const sign = value < 0 ? "−" : "";
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 1 : 2).replace(/\.?0+$/, "")}M`;
  if (abs >= 10_000) return `${sign}${(abs / 1_000).toFixed(abs >= 100_000 ? 0 : 1).replace(/\.0$/, "")}K`;
  return `${sign}${Math.round(abs).toLocaleString("en-US")}`;
}

/** Where an IPO is in its life, for headers and countdowns. */
export function ipoStage(event: IpoEvent, now: number) {
  if (event.status === "listed") return { label: "Listed", tone: "dim" as const, next: null };
  if (event.status === "cancelled") return { label: "Called off", tone: "dim" as const, next: null };
  if (event.status === "open" && now < Date.parse(event.window_closes_at)) return { label: "Subscriptions open", tone: "blue" as const, next: { label: "Closes", at: event.window_closes_at } };
  if (event.status === "open") return { label: "Listing at settlement", tone: "blue" as const, next: null };
  return { label: "Coming to market", tone: "warn" as const, next: { label: "Window opens", at: event.window_opens_at } };
}

const IPO_ERRORS: Record<string, string> = {
  insufficient_cash: "Not enough Cash for that many shares.",
  over_player_cap: "That's over the per-player limit for this IPO.",
  ipo_window_closed: "The window isn't open.",
  ipo_not_found: "That IPO isn't there any more.",
  subscription_not_found: "You don't have a subscription to cancel.",
  invalid_quantity: "Ask for a whole number of shares.",
  no_fair_value: "A talent has no fair value yet (no stats collected). Wait for her first scrape.",
  waiting_for_stats: "A talent has no settled snapshot for the listing day yet.",
  symbol_taken: "That ticker is taken.",
  invalid_symbol: "Tickers are 2–5 letters.",
  invalid_color: "Colours are #rrggbb.",
  invalid_oshimark: "An oshimark is a single emoji.",
  listing_date_past: "The listing date has to be after today.",
  invalid_listing_date: "That listing date isn't valid.",
  invalid_title: "Give the IPO a title.",
  invalid_setting: "One of the percentages is out of range.",
  no_talents: "Pick at least one talent.",
  already_in_ipo: "A talent is already in another IPO.",
  already_listed: "A talent is already listed.",
  ipo_not_editable: "Only an IPO that hasn't opened can be changed.",
  ipo_not_announced: "The window is already open.",
  ipo_not_open: "The window isn't open yet.",
  ipo_window_passed: "The window would already be over. Move the listing date.",
  detect_failed: "Couldn't read hololive's site. Try again in a minute.",
  unauthenticated: "Sign in first.",
  forbidden: "Admins only.",
};

export function ipoErrorText(error: unknown) {
  const err = error as { message?: string; body?: { field?: string; limit?: number } | null };
  const code = err?.message || String(error ?? "");
  const base = IPO_ERRORS[code] ?? (code || "Something went wrong.");
  if (code === "over_player_cap" && err?.body?.limit) return `The limit is ${err.body.limit.toLocaleString("en-US")} shares per player.`;
  return err?.body?.field ? `${base} (${err.body.field})` : base;
}
