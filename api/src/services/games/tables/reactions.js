// Floating emoji at a blackjack table. Pure decoration: nothing here reads or writes the database,
// and it never touches a seat, a bet or a wallet. An emoji comes from the fixed list below, so
// there's no text and nothing to moderate.
//
// A client sends { action: "react", table, counts: { fire: 2 } } on the games socket, at most twice a
// second. Three things keep one player, or a crowd, from flooding anyone:
// - each player has a token bucket (BURST, PER_SECOND), across all their tabs. Past it, taps vanish;
// - a table pushes at most one message per FLUSH_MS however many are reacting, and that message
//   holds a count per emoji and seat, so it stays small (8 emoji x 6 sources at the very most);
// - the socket cap (socketLimits.limitMessages) still closes a socket that ignores all of this.
// The client draws a limited number at a time, too (bj-reactions.tsx).
//
// They go out on their own channel, reactions:blackjack:{table}, and not on the table's. Someone with
// reactions hidden doesn't subscribe and gets none of this traffic, and a push here can't disturb
// the table state a page keeps for its own channel.

const socketLimits = require("../../../socketLimits");

/** The list a player can send. The client maps each id to its emoji (bj-reactions.tsx) and drops unknown ids. */
const REACTIONS = Object.freeze(["fire", "party", "clap", "lol", "cry", "dead", "money", "pray"]);

const BURST = 10;
const PER_SECOND = 4;
const FLUSH_MS = 200;
const SPECTATOR = -1;
const BUCKETS_BEFORE_SWEEP = 5000;

const channelOf = (tableKey) => `reactions:blackjack:${tableKey}`;

/**
 * publish(channel, payload) sends to the table; seatOf(tableKey, userId) is the player's seat, -1 if
 * they're watching, or null if there's no such table.
 */
function createReactions({ publish, seatOf, now = Date.now, burst = BURST, perSecond = PER_SECOND, flushMs = FLUSH_MS }) {
  const buckets = new Map(); // userId -> { tokens, at }
  const tables = new Map(); // tableKey -> { pending: Map<"id|seat", count>, flusher }

  /** Takes up to `wanted` tokens from the player's bucket and says how many it got. */
  function take(userId, wanted) {
    const at = now();
    let bucket = buckets.get(userId);
    if (!bucket) {
      if (buckets.size >= BUCKETS_BEFORE_SWEEP) {
        // A bucket that has had time to fill up is the same as no bucket.
        for (const [id, entry] of buckets) if (at - entry.at > (burst / perSecond) * 1000) buckets.delete(id);
      }
      bucket = { tokens: burst, at };
      buckets.set(userId, bucket);
    }
    bucket.tokens = Math.min(burst, bucket.tokens + ((at - bucket.at) / 1000) * perSecond);
    bucket.at = at;
    const granted = Math.min(wanted, Math.floor(bucket.tokens));
    bucket.tokens -= granted;
    return granted;
  }

  function tableOf(tableKey) {
    let table = tables.get(tableKey);
    if (!table) {
      const pending = new Map();
      table = {
        pending,
        flusher: socketLimits.coalesce(() => {
          if (!pending.size) return;
          const items = [...pending].map(([key, count]) => {
            const [id, seat] = key.split("|");
            return [id, Number(seat), count];
          });
          pending.clear();
          publish(channelOf(tableKey), { type: "reactions", items });
        }, flushMs),
      };
      tables.set(tableKey, table);
    }
    return table;
  }

  /** One `react` message from a socket. Anything it doesn't like, it ignores: there's nothing to report back. */
  function handle(ws, message) {
    if (!ws?.userId || !ws.canReact) return;
    const tableKey = String(message?.table ?? "");
    // You have to be at the table: the page holds this channel while it's open.
    if (!ws.gameChannels?.has(`blackjack:${tableKey}`)) return;
    const seat = seatOf(tableKey, ws.userId);
    if (seat === null || seat === undefined) return;
    const counts = message?.counts;
    if (!counts || typeof counts !== "object") return;

    let added = false;
    // Over the fixed list, not over what was sent, so a stuffed message costs no more than a short one.
    for (const id of REACTIONS) {
      const asked = counts[id];
      if (!Number.isInteger(asked) || asked <= 0) continue;
      const granted = take(ws.userId, asked);
      if (!granted) break;
      const table = tableOf(tableKey);
      const key = `${id}|${seat}`;
      table.pending.set(key, (table.pending.get(key) ?? 0) + granted);
      added = true;
    }
    if (added) tableOf(tableKey).flusher.schedule();
  }

  /** Sends whatever is waiting right now (tests). */
  function flushAll() {
    for (const table of tables.values()) table.flusher.flush();
  }

  return { handle, flushAll };
}

module.exports = { BURST, FLUSH_MS, PER_SECOND, REACTIONS, SPECTATOR, channelOf, createReactions };
