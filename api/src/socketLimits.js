// Abuse limits for the WebSocket endpoints (server.js):
// - connections per IP, counted in Redis so the cap holds across every API pod;
// - messages per socket;
// - broadcasts that would otherwise go to everyone on every connect, coalesced.
//
// Real client IPs: the load balancer only accepts Cloudflare, so CF-Connecting-IP (rateLimit.clientIp)
// is the visitor's address.

const crypto = require("node:crypto");

// Every tab keeps a market socket open, plus chat, games, predictions or streams on those pages, so
// one person can hold a dozen; a household or a phone carrier's shared address several times that.
const CONNECTIONS_PER_IP = Number(process.env.WS_MAX_CONNECTIONS_PER_IP) || 60;
// Clients send a handful of control messages (subscribe, hello, ping) per page; this is far above that.
const MESSAGES_PER_WINDOW = Number(process.env.WS_MAX_MESSAGES_PER_10S) || 30;
const MESSAGE_WINDOW_MS = 10_000;

/**
 * Open sockets per IP, across processes. Each IP is a Redis sorted set of this process's socket
 * ids (and every other process's), scored by when their process last vouched for them; a process
 * re-vouches for its open sockets every `refreshMs`, so a pod that dies without closing its sockets
 * stops counting after `ttlMs`. Without Redis (tests, a Redis outage) it counts this process only.
 * Returns { admit(ip) → Promise<{ ok, release }>, refresh(), stop(), size() }.
 */
function createConnectionCap({ redis, limit = CONNECTIONS_PER_IP, ttlMs = 90_000, refreshMs = 30_000, processId = crypto.randomUUID(), logger = console } = {}) {
  const open = new Map(); // member -> ip (this process's sockets)
  const localCounts = new Map(); // ip -> count, for when Redis isn't there
  let seq = 0;
  let failing = false;
  const keyFor = (ip) => `ws:ip:${String(ip).slice(0, 64)}`;
  const warn = (error) => {
    if (!failing) logger.warn?.("socket connection cap: Redis unavailable, counting this process only:", String(error?.message || error));
    failing = true;
  };

  const countLocally = (ip, member) => {
    const count = (localCounts.get(ip) || 0) + 1;
    if (count > limit) return false;
    localCounts.set(ip, count);
    open.set(member, ip);
    return true;
  };

  async function admit(ip) {
    const member = `${processId}:${(seq += 1)}`;
    let ok;
    let counted = "local";
    if (redis) {
      try {
        const now = Date.now();
        const key = keyFor(ip);
        const replies = await redis
          .multi()
          .zRemRangeByScore(key, 0, now - ttlMs)
          .zAdd(key, { score: now, value: member })
          .zCard(key)
          .pExpire(key, ttlMs)
          .exec();
        failing = false;
        ok = Number(replies[2]) <= limit;
        if (ok) open.set(member, ip);
        else await redis.zRem(key, member).catch(() => {});
        counted = "redis";
      } catch (error) {
        warn(error);
        ok = countLocally(ip, member);
      }
    } else {
      ok = countLocally(ip, member);
    }
    let released = !ok;
    const release = () => {
      if (released) return;
      released = true;
      open.delete(member);
      if (counted === "redis") {
        redis.zRem(keyFor(ip), member).catch(() => {});
      } else {
        const count = (localCounts.get(ip) || 1) - 1;
        if (count > 0) localCounts.set(ip, count);
        else localCounts.delete(ip);
      }
    };
    return { ok, release };
  }

  async function refresh() {
    if (!redis || !open.size) return;
    const byIp = new Map();
    for (const [member, ip] of open) {
      if (!byIp.has(ip)) byIp.set(ip, []);
      byIp.get(ip).push(member);
    }
    const now = Date.now();
    const multi = redis.multi();
    for (const [ip, members] of byIp) {
      multi.zAdd(keyFor(ip), members.map((value) => ({ score: now, value })));
      multi.pExpire(keyFor(ip), ttlMs);
    }
    try {
      await multi.exec();
      failing = false;
    } catch (error) {
      warn(error);
    }
  }

  const timer = setInterval(() => void refresh(), refreshMs);
  timer.unref?.();
  return { admit, refresh, stop: () => clearInterval(timer), size: () => open.size };
}

/**
 * Caps the messages one socket may send: past `limit` in `windowMs` it's closed with 1008 (policy
 * violation). Install it before the socket's own message handlers; they should ignore a message
 * once the socket isn't open (ws.readyState !== 1), which is what a closed one is.
 */
function limitMessages(ws, { limit = MESSAGES_PER_WINDOW, windowMs = MESSAGE_WINDOW_MS, now = Date.now } = {}) {
  let windowStart = now();
  let count = 0;
  ws.on("message", () => {
    const at = now();
    if (at - windowStart >= windowMs) {
      windowStart = at;
      count = 0;
    }
    count += 1;
    if (count > limit && ws.readyState === 1) ws.close(1008, "too many messages");
  });
}

/**
 * Runs `fn` at most once per `delayMs`, however many times it's asked for in between: the first
 * ask starts the wait, the rest ride along. Returns { schedule, flush, stop }.
 */
function coalesce(fn, delayMs) {
  let timer = null;
  const flush = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    fn();
  };
  return {
    schedule: () => {
      if (!timer) {
        timer = setTimeout(flush, delayMs);
        timer.unref?.();
      }
    },
    flush,
    stop: () => {
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}

/** Closes every socket signed in as `userId` (they reconnect as whoever the browser now is). */
function closeUserSockets(servers, userId, { code = 4001, reason = "signed out" } = {}) {
  const id = Number(userId);
  if (!id) return 0;
  let closed = 0;
  for (const server of servers) {
    server.clients.forEach((ws) => {
      const owner = ws.socketUserId ?? null;
      if (owner === id && ws.readyState === 1) {
        ws.close(code, reason);
        closed += 1;
      }
    });
  }
  return closed;
}

module.exports = { CONNECTIONS_PER_IP, MESSAGES_PER_WINDOW, closeUserSockets, coalesce, createConnectionCap, limitMessages };
