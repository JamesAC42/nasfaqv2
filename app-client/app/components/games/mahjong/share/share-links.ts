// Paths for mahjong replays, tournaments and their share cards. A shared link carries the sharer's
// referral code (?ref=), the way the moment links do (lib/games/moments.ts).

const withQuery = (path: string, parts: (string | null | undefined | false)[]) => {
  const query = parts.filter(Boolean).join("&");
  return query ? `${path}?${query}` : path;
};

const handPart = (hand?: number | null) => (hand === undefined || hand === null ? null : `hand=${hand}`);
const refPart = (code?: string | null) => (code ? `ref=${encodeURIComponent(code)}` : null);

/** The replay page, at a hand if given. */
export const replayPath = (gameId: number, hand?: number | null, referralCode?: string | null) => withQuery(`/games/mahjong/replay/${gameId}`, [handPart(hand), refPart(referralCode)]);
/** The replay's share card (1200x630 PNG): a winning hand, or the game's result without `hand`. */
export const replayCardPath = (gameId: number, hand?: number | null) => withQuery(`/games/mahjong/replay/${gameId}/card`, [handPart(hand)]);
export const tournamentPath = (id: number, referralCode?: string | null) => withQuery(`/games/mahjong/tournaments/${id}`, [refPart(referralCode)]);
export const tournamentCardPath = (id: number) => `/games/mahjong/tournaments/${id}/card`;
