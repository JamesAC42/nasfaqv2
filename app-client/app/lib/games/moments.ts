// Shareable game moments (a settled blackjack hand, a card-pull batch): the API's shape, where the
// share card and the moment page live, and the words both of them use. No server-only imports, so
// the Share button and the share card agree on every line of text.

export type MomentKind = "blackjack" | "cards";

export type MomentPlayer = {
  username: string;
  profile_color: string | null;
  oshi: { symbol: string; display_name: string; color: string | null } | null;
};

export type BlackjackMoment = {
  kind: "blackjack";
  id: string;
  at: string | null;
  player: MomentPlayer;
  table: { key: string; name: string };
  round_id: number;
  outcome: "blackjack" | "win" | "push" | "loss" | "bust";
  wager: number;
  doubled: boolean;
  payout: number;
  net: number;
  hand: Array<{ rank: string | number; suit: "S" | "H" | "D" | "C" }>;
  dealer: { hand: Array<{ rank: string | number; suit: "S" | "H" | "D" | "C" }>; value: number | null };
  others: number;
};

export type MomentCard = {
  key: string;
  symbol: string;
  name: string;
  color: string | null;
  rarity: "C" | "R" | "SR" | "SSR" | "UR";
  rarity_name: string;
  was_new: boolean;
  was_featured: boolean;
  stars: number;
};

export type CardsMoment = {
  kind: "cards";
  id: string;
  at: string | null;
  player: MomentPlayer;
  banner: string;
  count: number;
  best: MomentCard;
  cards: MomentCard[];
};

export type Moment = BlackjackMoment | CardsMoment;

export const MOMENT_KINDS: MomentKind[] = ["blackjack", "cards"];

export const isMomentKind = (value: string): value is MomentKind => (MOMENT_KINDS as string[]).includes(value);

/** A talent symbol as the URL carries it (`?t=PEK`), or null. */
export function cleanSymbol(value: string | null | undefined) {
  const text = String(value ?? "").trim().toUpperCase();
  return /^[A-Z0-9_]{2,8}$/.test(text) ? text : null;
}

const withTalent = (path: string, talent?: string | null, extra: string[] = []) => {
  const symbol = cleanSymbol(talent);
  const query = [...(symbol ? [`t=${symbol}`] : []), ...extra];
  return query.length ? `${path}?${query.join("&")}` : path;
};

/** Bump when the card's design changes: cards are cached for a day, and link previews longer. */
export const MOMENT_CARD_VERSION = 1;

/** The public page for a moment (its link unfurls with the share card). */
export const momentPath = (kind: MomentKind, id: string, talent?: string | null) => withTalent(`/games/moments/${kind}/${encodeURIComponent(id)}`, talent);

/** The share card itself, 1200×630 PNG. */
export const momentCardPath = (kind: MomentKind, id: string, talent?: string | null) =>
  withTalent(`/games/moments/${kind}/${encodeURIComponent(id)}/card`, talent, [`v=${MOMENT_CARD_VERSION}`]);

/** A blackjack hand's moment id. */
export const blackjackMomentId = (roundId: number, seat: number) => `${roundId}-${seat}`;

export type Tone = "gold" | "up" | "down" | "plain" | "rainbow";

/** "+$1,250" / "-$500" with plain ASCII signs (the display font has no minus sign). */
export function signedMoney(value: number) {
  const abs = Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: Number.isInteger(value) ? 0 : 2, maximumFractionDigits: 2 });
  return `${value > 0 ? "+" : value < 0 ? "-" : ""}$${abs}`;
}

/** The big line, its color and the talent's pose for a blackjack hand. */
export function blackjackHeadline(moment: Pick<BlackjackMoment, "outcome" | "doubled" | "dealer">) {
  const dealerBust = (moment.dealer.value ?? 0) > 21;
  switch (moment.outcome) {
    case "blackjack":
      return { head: "BLACKJACK!", tone: "gold" as Tone, pose: "hype" as const };
    case "win":
      return moment.doubled
        ? { head: "DOUBLED & WON", tone: "up" as Tone, pose: "hype" as const }
        : { head: dealerBust ? "DEALER BUSTS" : "BEAT THE HOUSE", tone: "up" as Tone, pose: "smug" as const };
    case "push":
      return { head: "PUSH", tone: "plain" as Tone, pose: "idle" as const };
    case "bust":
      return { head: "BUST", tone: "down" as Tone, pose: "cope" as const };
    default:
      return { head: "HOUSE WINS", tone: "down" as Tone, pose: "cope" as const };
  }
}

/** The big line and its color for a card pull, by the best card in the batch. */
export function cardsHeadline(best: Pick<MomentCard, "rarity" | "was_new">) {
  switch (best.rarity) {
    case "UR":
      return { head: "UR PULLED!!", tone: "rainbow" as Tone };
    case "SSR":
      return { head: "SSR PULL!", tone: "gold" as Tone };
    case "SR":
      return { head: "SR PULL", tone: "up" as Tone };
    default:
      return { head: best.was_new ? "NEW CARD" : "CARD PULL", tone: "plain" as Tone };
  }
}

/** A stable pick from a list by a seed string (the same on the server and in the browser). */
export function seededPick<T>(list: T[], seed: string): T | null {
  if (!list.length) return null;
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return list[(h >>> 0) % list.length];
}

/** The post text for a blackjack hand, from what the table shows. */
export function blackjackShareText(hand: Pick<BlackjackMoment, "outcome" | "doubled" | "net"> & { dealerValue: number | null; tableName: string }) {
  const { head } = blackjackHeadline({ outcome: hand.outcome, doubled: hand.doubled, dealer: { hand: [], value: hand.dealerValue } });
  const money = hand.net === 0 ? "bet back" : signedMoney(hand.net);
  return `${head.toLowerCase().replace(/^./, (c) => c.toUpperCase())} ${money} at the ${hand.tableName.toLowerCase()} on NASFAQ #hololive`;
}

/** One sentence for link previews and the post text. */
export function momentSummary(moment: Moment) {
  if (moment.kind === "blackjack") {
    const { head } = blackjackHeadline(moment);
    const money = moment.net === 0 ? "bet back" : signedMoney(moment.net);
    return `${moment.player.username}: ${head.toLowerCase().replace(/^./, (c) => c.toUpperCase())} at the ${moment.table.name.toLowerCase()}, ${money}.`;
  }
  const { best } = moment;
  return `${moment.player.username} pulled ${best.name} ${best.rarity} (${best.rarity_name})${moment.count > 1 ? ` in a ${moment.count}-pull` : ""}.`;
}
