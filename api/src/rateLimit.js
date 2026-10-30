// Fixed-window rate limits, counted in Redis so every API pod shares them (in this process's
// memory when there's no Redis, e.g. tests). Used on every signed-in write (writeLimit), with
// tighter rules on sign-in, sign-up, verification emails, the places people post (chat, comments,
// articles, friend requests) and the things worth spamming (trades, pulls, table actions, votes).

const memory = new Map(); // key -> { count, resetAt }

/** The caller's IP: Cloudflare's header, else the first X-Forwarded-For hop, else the socket. */
function clientIp(req) {
  const cf = req.headers["cf-connecting-ip"];
  if (typeof cf === "string" && cf) return cf.trim();
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded) return forwarded.split(",")[0].trim();
  return req.socket?.remoteAddress || "unknown";
}

function windowOf(name, id, windowSeconds) {
  const windowIndex = Math.floor(Date.now() / 1000 / windowSeconds);
  return {
    key: `rl:${name}:${String(id).toLowerCase().slice(0, 200)}:${windowIndex}`,
    retryAfter: (windowIndex + 1) * windowSeconds - Math.floor(Date.now() / 1000),
  };
}

/**
 * Counts one hit for `id` under `name`. Returns { ok, count, retryAfter } where ok is false once
 * more than `limit` hits land inside the current `windowSeconds` window.
 */
async function hit(redis, name, id, { limit, windowSeconds }) {
  const { key, retryAfter } = windowOf(name, id, windowSeconds);
  let count;
  if (redis) {
    try {
      count = await redis.incr(key);
      if (count === 1) await redis.expire(key, windowSeconds + 5);
    } catch {
      return { ok: true, count: 0, retryAfter: 0 }; // a Redis hiccup never locks people out
    }
  } else {
    const entry = memory.get(key);
    if (!entry || entry.resetAt < Date.now()) memory.set(key, { count: 1, resetAt: Date.now() + windowSeconds * 1000 });
    else entry.count += 1;
    count = memory.get(key).count;
    if (memory.size > 10_000) for (const [k, v] of memory) if (v.resetAt < Date.now()) memory.delete(k);
  }
  return { ok: count <= limit, count, retryAfter };
}

/** How many hits `id` has under `name` in the current window, without counting one. */
async function peek(redis, name, id, { windowSeconds }) {
  const { key, retryAfter } = windowOf(name, id, windowSeconds);
  if (redis) {
    try {
      return { count: Number(await redis.get(key)) || 0, retryAfter };
    } catch {
      return { count: 0, retryAfter: 0 };
    }
  }
  const entry = memory.get(key);
  return { count: entry && entry.resetAt >= Date.now() ? entry.count : 0, retryAfter };
}

/** Forgets `id`'s hits under `name` in the current window. */
async function clear(redis, name, id, { windowSeconds }) {
  const { key } = windowOf(name, id, windowSeconds);
  if (redis) await redis.del(key).catch(() => {});
  else memory.delete(key);
}

function tooMany(res, retryAfter) {
  res.setHeader("Retry-After", String(Math.max(1, retryAfter)));
  return res.status(429).json({ error: "rate_limited", retry_after: Math.max(1, retryAfter) });
}

/**
 * Express middleware. `rules` is one or more { name, limit, windowSeconds, key(req) } where key
 * returns the id to count (defaults to the IP); a rule whose key returns null is skipped.
 */
function rateLimit(...rules) {
  return async (req, res, next) => {
    try {
      for (const rule of rules) {
        const id = rule.key ? rule.key(req) : clientIp(req);
        if (id === null || id === undefined || id === "") continue;
        const result = await hit(req.ctx?.redis ?? null, rule.name, id, rule);
        if (!result.ok) return tooMany(res, result.retryAfter);
      }
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

const byIp = (name, limit, windowSeconds) => ({ name: `${name}:ip`, limit, windowSeconds, key: clientIp });
const byUser = (name, limit, windowSeconds) => ({ name: `${name}:user`, limit, windowSeconds, key: (req) => req.ctx?.user?.id ?? null });

/** Likes, saves and votes, wherever they are (articles, stock comments, drafts): one budget per player. */
const voteLimit = rateLimit(byUser("vote", 30, 60));

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const WRITES_PER_MINUTE = Number(process.env.WRITES_PER_MINUTE) || 60;

/**
 * Middleware for /api: every POST, PUT, PATCH and DELETE a signed-in player makes counts against
 * one budget (60 a minute), on top of any tighter rule on the route itself. Signed-out writes
 * (sign-in, sign-up, resets) have per-address limits of their own. `skip` lists paths (relative to
 * the mount) that stay out of the budget: signing out, and requests the browser makes by itself.
 */
function writeLimit({ limit = WRITES_PER_MINUTE, windowSeconds = 60, skip = [] } = {}) {
  const limiter = rateLimit(byUser("write", limit, windowSeconds));
  return (req, res, next) => {
    if (!WRITE_METHODS.has(req.method) || !req.ctx?.user || skip.some((pattern) => pattern.test(req.path))) return next();
    return limiter(req, res, next);
  };
}

module.exports = { rateLimit, hit, peek, clear, tooMany, clientIp, byIp, byUser, voteLimit, writeLimit };
