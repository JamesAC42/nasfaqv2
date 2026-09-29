// Who's on the site right now, across every API process. Every page keeps a market socket open, so
// each process lists the visitors on its market sockets in one Redis sorted set, scored by when it
// last saw them; "online" is how many were seen in the last minute. A signed-in player counts once
// however many tabs or devices they have open; each signed-out tab counts as one. Nothing is kept
// past the minute, and nothing new is stored in the browser.

const crypto = require("node:crypto");

const KEY = "nasfaq:online";
const WINDOW_MS = 60_000;
const TICK_MS = 20_000;
const EVENT = "site.online";

/** The presence member for a socket: the account when signed in, else one per connection. */
function visitorKey(user) {
  return user?.id ? `u:${user.id}` : `a:${crypto.randomUUID()}`;
}

/** Marks `members` as seen now, drops anyone not seen within the window, and returns the count. */
async function seen(redis, members, now = Date.now()) {
  const multi = redis.multi();
  if (members.length) multi.zAdd(KEY, members.map((value) => ({ score: now, value })));
  multi.zRemRangeByScore(KEY, 0, now - WINDOW_MS);
  multi.zCard(KEY);
  const replies = await multi.exec();
  return Number(replies[replies.length - 1]) || 0;
}

/** The count without marking anyone (for GET /api/site). */
async function count(redis, now = Date.now()) {
  return Number(await redis.zCount(KEY, now - WINDOW_MS, "+inf")) || 0;
}

const eventText = (online) => JSON.stringify({ type: EVENT, online, at: new Date().toISOString() });

/**
 * Keeps this process's market sockets counted and tells them the count when it changes. A new
 * socket hears the count straight away (`welcome`). Returns { welcome, stop }.
 */
function startPresence({ redis, wss, send, broadcast, intervalMs = TICK_MS, logger = console }) {
  let last = null;
  let failing = false;
  const members = () => {
    const out = new Set();
    wss.clients.forEach((ws) => {
      if (ws.visitor) out.add(ws.visitor);
    });
    return [...out];
  };
  const run = async (fn) => {
    try {
      await fn();
      failing = false;
    } catch (error) {
      if (!failing) logger.warn?.("presence update failed", String(error?.message || error));
      failing = true;
    }
  };
  const tick = () =>
    run(async () => {
      const online = await seen(redis, members());
      if (online !== last) {
        last = online;
        broadcast(eventText(online));
      }
    });
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  return {
    welcome: (ws) =>
      run(async () => {
        const online = await seen(redis, ws.visitor ? [ws.visitor] : []);
        send(ws, eventText(online));
      }),
    stop: () => clearInterval(timer),
  };
}

module.exports = { EVENT, KEY, WINDOW_MS, count, seen, startPresence, visitorKey };
