// The notification bell: a per-player inbox of things that happened to them while they were
// looking elsewhere (or offline). Features call notify() where the event commits; the row is
// pushed to the player's open games sockets (`me` feed) and read back through /api/notifications.
//
// notify(db, userId, { kind, title, body, href, actorUserId, data }) inserts one row. `db` can be
// a transaction client: pass `{ publish: false }` and call publish(rows) after COMMIT, or leave it
// and the push goes out a moment later (a rolled-back row then shows until the next refresh).
// In title/body, "{actor}" becomes the actor's username.

const hub = require("./games/tables/hub");

const KEEP_PER_USER = 300;
const KINDS = new Set([
  "friend_request",
  "friend_accepted",
  "mention",
  "reply",
  "achievement",
  "prediction_won",
  "prediction_lost",
  "prediction_void",
  "proposal_approved",
  "exchange",
  "wishlist",
  "dividend",
  "buyback",
]);

function money(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "$—";
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function clip(text, max) {
  const value = String(text ?? "").replace(/\s+/g, " ").trim();
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function toView(row) {
  return {
    id: Number(row.id),
    kind: row.kind,
    title: row.title,
    body: row.body || "",
    href: row.href || null,
    actor: row.actor_user_id ? { id: Number(row.actor_user_id), username: row.actor_username || null } : null,
    data: row.data || {},
    created_at: row.created_at,
    read: Boolean(row.read_at),
  };
}

async function notify(db, userId, { kind, title, body = "", href = null, actorUserId = null, data = {} }, { publish: publishNow = true } = {}) {
  const safeUserId = Number(userId);
  if (!Number.isInteger(safeUserId) || safeUserId <= 0) return null;
  if (actorUserId && Number(actorUserId) === safeUserId) return null; // never about your own doing
  if (!KINDS.has(kind)) throw new Error(`unknown notification kind ${kind}`);
  let actorName = null;
  if (actorUserId && (String(title).includes("{actor}") || String(body).includes("{actor}"))) {
    const { rows } = await db.query(`SELECT username FROM market.users WHERE id = $1`, [actorUserId]);
    actorName = rows[0]?.username ?? "someone";
  }
  const fill = (text) => clip(actorName ? String(text).split("{actor}").join(actorName) : text, 300);
  const { rows } = await db.query(
    `
    INSERT INTO market.notifications (user_id, kind, title, body, href, actor_user_id, data)
    VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
    RETURNING *, (SELECT username FROM market.users WHERE id = $6) AS actor_username
  `,
    [safeUserId, kind, clip(fill(title), 140), fill(body), href, actorUserId || null, JSON.stringify(data || {})]
  );
  const row = { ...rows[0], user_id: safeUserId };
  if (publishNow) setTimeout(() => publish([row]), 400);
  // Keep the inbox bounded; cheap enough to do on a small fraction of inserts.
  if (Math.random() < 0.05) {
    await db.query(
      `DELETE FROM market.notifications WHERE user_id = $1 AND id < (
         SELECT id FROM market.notifications WHERE user_id = $1 ORDER BY id DESC OFFSET $2 LIMIT 1)`,
      [safeUserId, KEEP_PER_USER]
    );
  }
  return row;
}

/** Push rows (from notify with publish: false) to their owners' open sockets. */
function publish(rows) {
  for (const row of rows || []) {
    if (!row) continue;
    hub.publishToUser(Number(row.user_id), { type: "notification", notification: toView(row), server_time: Date.now() });
  }
}

async function list(pool, userId, { limit = 30, before = null } = {}) {
  const safeLimit = Math.min(100, Math.max(1, Number(limit) || 30));
  const params = [userId, safeLimit];
  let where = "n.user_id = $1";
  if (before) {
    params.push(Number(before));
    where += ` AND n.id < $${params.length}`;
  }
  const [{ rows }, unread] = await Promise.all([
    pool.query(
      `
      SELECT n.*, u.username AS actor_username
      FROM market.notifications n
      LEFT JOIN market.users u ON u.id = n.actor_user_id
      WHERE ${where}
      ORDER BY n.id DESC
      LIMIT $2
    `,
      params
    ),
    unreadCount(pool, userId),
  ]);
  return { notifications: rows.map(toView), unread, has_more: rows.length === safeLimit };
}

async function unreadCount(pool, userId) {
  const { rows } = await pool.query(`SELECT count(*)::int AS n FROM market.notifications WHERE user_id = $1 AND read_at IS NULL`, [userId]);
  return rows[0]?.n ?? 0;
}

/** Marks some (ids) or all of a player's notifications read. */
async function markRead(pool, userId, { ids = null, all = false } = {}) {
  if (all) {
    await pool.query(`UPDATE market.notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL`, [userId]);
  } else {
    const list = (Array.isArray(ids) ? ids : []).map(Number).filter((id) => Number.isInteger(id) && id > 0).slice(0, 200);
    if (list.length) await pool.query(`UPDATE market.notifications SET read_at = now() WHERE user_id = $1 AND id = ANY($2::bigint[]) AND read_at IS NULL`, [userId, list]);
  }
  return unreadCount(pool, userId);
}

// ── Exchange alerts → notification text (mirrors the client's toasts) ────────
function exchangeText(alert) {
  const card = alert.card ? `${alert.card.name} ${alert.card.rarity}` : "a card";
  const trader = alert.trade ? (alert.trade.direction === "incoming" ? alert.trade.from?.username : alert.trade.to?.username) || "Someone" : "Someone";
  const [, symbol, rarity] = String(alert.card?.key || "").split(":");
  const cardHref = symbol && rarity ? `/games/exchange/card/${symbol}/${rarity}` : "/games/exchange/desk";
  switch (alert.kind) {
    case "sold":
      return { title: "Sold!", body: `${card} went to ${alert.buyer?.username ?? "someone"} for ${money(alert.price)}. You got ${money(alert.proceeds)}.`, href: "/games/exchange/desk" };
    case "won":
      return { title: "You won the auction", body: `${card} is yours for ${money(alert.price)}.`, href: "/games/collection" };
    case "bought":
      return { title: "It's yours", body: `${card} for ${money(alert.price)}.`, href: "/games/collection" };
    case "outbid":
      return { title: "You've been outbid", body: `${card} is at ${money(alert.amount)}. Your ${money(alert.your_bid)} is back in your cash.`, href: cardHref };
    case "auction_lost":
      return { title: "Bought out", body: `Someone paid the buy-now on ${card}. Your ${money(alert.your_bid)} is back.`, href: "/games/exchange/desk" };
    case "bid_received":
      return { title: "New bid", body: `${alert.bidder?.username ?? "Someone"} bid ${money(alert.amount)} on your ${card}.`, href: "/games/exchange/desk" };
    case "expired":
      return { title: "Listing ended", body: `${card} didn't sell. It's back in your binder.`, href: "/games/exchange/desk" };
    case "trade_offer":
      return { title: "Trade offer", body: `${trader} wants to trade with you.`, href: "/games/exchange/trades" };
    case "trade_countered":
      return { title: "Counter-offer", body: `${trader} countered your offer.`, href: "/games/exchange/trades" };
    case "trade_accepted":
      return { title: "Trade done", body: `${trader} accepted your offer.`, href: "/games/collection" };
    case "trade_declined":
      return { title: "Offer declined", body: `${trader} passed. Your side is back with you.`, href: "/games/exchange/trades" };
    case "trade_cancelled":
      return { title: "Offer withdrawn", body: `${trader} withdrew their offer.`, href: "/games/exchange/trades" };
    case "trade_expired":
      return { title: "Offer expired", body: `Your offer to ${trader} ran out. Your side is back with you.`, href: "/games/exchange/trades" };
    default:
      return null;
  }
}

/** Records exchange alerts (inside the exchange transaction); returns rows to publish after COMMIT. */
async function recordExchangeAlerts(client, items) {
  const rows = [];
  for (const { userId, alert } of items) {
    const text = exchangeText(alert);
    if (!text) continue;
    rows.push(
      await notify(
        client,
        userId,
        { kind: "exchange", ...text, data: { alert_kind: alert.kind, card_key: alert.card?.key ?? null, symbol: alert.card?.symbol ?? null } },
        { publish: false }
      )
    );
  }
  return rows.filter(Boolean);
}

// ── Chat mentions ───────────────────────────────────────────────────────────
// Usernames can hold single spaces, so for each "@" try the next one to four words and keep the
// longest that is a real player.
function mentionCandidates(body) {
  const out = new Map(); // position → candidates (longest first)
  const re = /(^|[^A-Za-z0-9_@])@([A-Za-z0-9_]+(?: [A-Za-z0-9_]+){0,3})/g;
  let match;
  while ((match = re.exec(String(body || ""))) && out.size < 8) {
    const words = match[2].split(" ");
    const candidates = [];
    for (let n = words.length; n >= 1; n -= 1) {
      const name = words.slice(0, n).join(" ");
      if (name.length >= 3 && name.length <= 32) candidates.push(name.toLowerCase());
    }
    if (candidates.length) out.set(match.index, candidates);
  }
  return [...out.values()];
}

async function notifyChatMessage(pool, { message, channel, author }) {
  const authorId = Number(author?.id);
  if (!authorId || !message) return;
  const groups = mentionCandidates(message.body);
  const recipients = new Map(); // userId → kind
  if (groups.length) {
    const all = [...new Set(groups.flat())];
    const { rows } = await pool.query(`SELECT id, username_normalized FROM market.users WHERE username_normalized = ANY($1::text[])`, [all]);
    const byName = new Map(rows.map((row) => [row.username_normalized, Number(row.id)]));
    for (const candidates of groups) {
      const hit = candidates.find((name) => byName.has(name));
      if (hit) recipients.set(byName.get(hit), "mention");
      if (recipients.size >= 5) break;
    }
  }
  if (message.reply_to_message_id) {
    const { rows } = await pool.query(`SELECT author_id FROM chat.messages WHERE id = $1`, [message.reply_to_message_id]);
    const replyTo = Number(rows[0]?.author_id);
    if (replyTo && !recipients.has(replyTo)) recipients.set(replyTo, "reply");
  }
  recipients.delete(authorId);
  const room = channel?.display_name || "chat";
  const href = channel?.channel_key ? `/chat?channel=${encodeURIComponent(channel.channel_key)}` : "/chat";
  for (const [userId, kind] of recipients) {
    await notify(pool, userId, {
      kind,
      title: kind === "mention" ? `{actor} mentioned you in ${room}` : `{actor} replied to you in ${room}`,
      body: /^\[\[sticker:[^\]]+\]\]$/.test(String(message.body || "").trim()) ? "(a sticker)" : message.body,
      href,
      actorUserId: authorId,
      data: { message_id: message.id, channel_key: channel?.channel_key ?? null },
    });
  }
}

module.exports = { notify, publish, list, unreadCount, markRead, recordExchangeAlerts, notifyChatMessage, mentionCandidates, exchangeText, money };
