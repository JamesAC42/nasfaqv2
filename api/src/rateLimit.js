// Fixed-window rate limits, counted in Redis so every API pod shares them (in this process's
// memory when there's no Redis, e.g. tests). Used on sign-in, sign-up, verification emails and the
// places people post (chat, comments, articles, friend requests).

const memory = new Map(); // key -> { count, resetAt }

/** The caller's IP: Cloudflare's header, else the first X-Forwarded-For hop, else the socket. */
function clientIp(req) {
  const cf = req.headers["cf-connecting-ip"];
  if (typeof cf === "string" && cf) return cf.trim();
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded) return forwarded.split(",")[0].trim();
  return req.socket?.remoteAddress || "unknown";
}

/**
 * Counts one hit for `id` under `name`. Returns { ok, retryAfter } where ok is false once more
 * than `limit` hits land inside the current `windowSeconds` window.
 */
async function hit(redis, name, id, { limit, windowSeconds }) {
  const windowIndex = Math.floor(Date.now() / 1000 / windowSeconds);
  const retryAfter = (windowIndex + 1) * windowSeconds - Math.floor(Date.now() / 1000);
  const key = `rl:${name}:${id}:${windowIndex}`;
  let count;
  if (redis) {
    try {
      count = await redis.incr(key);
      if (count === 1) await redis.expire(key, windowSeconds + 5);
    } catch {
      return { ok: true, retryAfter: 0 }; // a Redis hiccup never locks people out
    }
  } else {
    const entry = memory.get(key);
    if (!entry || entry.resetAt < Date.now()) memory.set(key, { count: 1, resetAt: Date.now() + windowSeconds * 1000 });
    else entry.count += 1;
    count = memory.get(key).count;
    if (memory.size > 10_000) for (const [k, v] of memory) if (v.resetAt < Date.now()) memory.delete(k);
  }
  return { ok: count <= limit, retryAfter };
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
        const result = await hit(req.ctx?.redis ?? null, rule.name, String(id).toLowerCase().slice(0, 200), rule);
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

module.exports = { rateLimit, hit, clientIp, byIp, byUser };
