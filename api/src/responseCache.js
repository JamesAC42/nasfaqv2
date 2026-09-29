// Read-through cache for hot public JSON (the asset board, the daily report, the hub).
//
// One serialized body per key: kept in Redis for ttlSeconds (shared by every API pod), and in this
// pod's memory for memoMs so a burst of requests doesn't even go to Redis. A missing body is built
// once per pod at a time (single-flight), not once per request. It's sent as-is (no parse and
// re-stringify per request), gzipped once when a client accepts gzip, with a strong ETag so a
// client that already has it gets a 304.
//
// Only for payloads that are the same for every viewer.

const crypto = require("crypto");
const zlib = require("zlib");

const PREFIX = "resp:v1:";
const memo = new Map(); // key -> { body, etag, gz, until }
const MEMO_MAX = 2_000;
const inflight = new Map(); // key -> Promise<entry>

async function build(redis, key, ttlSeconds, load) {
  let body = null;
  if (redis) body = await redis.get(PREFIX + key).catch(() => null);
  if (!body) {
    body = JSON.stringify(await load());
    if (redis) await redis.set(PREFIX + key, body, { EX: ttlSeconds }).catch(() => {});
  }
  const etag = `"${crypto.createHash("sha1").update(body).digest("base64url")}"`;
  return { body, etag, gz: null };
}

async function getEntry(redis, key, { ttlSeconds, memoMs, load }) {
  const cached = memo.get(key);
  if (cached && cached.until > Date.now()) return cached;
  let pending = inflight.get(key);
  if (!pending) {
    pending = build(redis, key, ttlSeconds, load)
      .then((entry) => {
        const withExpiry = { ...entry, until: Date.now() + memoMs };
        // Keys come partly from query strings, so keep the memory copy bounded.
        if (memo.size >= MEMO_MAX) {
          const now = Date.now();
          for (const [k, v] of memo) if (v.until <= now) memo.delete(k);
          if (memo.size >= MEMO_MAX) memo.clear();
        }
        memo.set(key, withExpiry);
        return withExpiry;
      })
      .finally(() => inflight.delete(key));
    inflight.set(key, pending);
  }
  return pending;
}

function send(req, res, entry) {
  res.setHeader("ETag", entry.etag);
  res.setHeader("Cache-Control", "no-cache");
  res.vary("Accept-Encoding");
  const ifNoneMatch = req.headers["if-none-match"];
  if (ifNoneMatch && ifNoneMatch.split(/\s*,\s*/).includes(entry.etag)) {
    res.status(304).end();
    return;
  }
  res.type("application/json");
  if (/\bgzip\b/.test(String(req.headers["accept-encoding"] || "")) && entry.body.length > 1024) {
    if (!entry.gz) entry.gz = zlib.gzipSync(entry.body, { level: 6 });
    res.setHeader("Content-Encoding", "gzip");
    res.end(entry.gz);
    return;
  }
  res.end(entry.body);
}

/** Sends the cached JSON for `key`, building it with `load()` when Redis doesn't have it. */
async function sendCachedJson(req, res, key, { ttlSeconds = 5, memoMs = 1000, load, notFound = "not_found" }) {
  const entry = await getEntry(req.ctx?.redis ?? null, key, { ttlSeconds, memoMs, load });
  if (entry.body === "null") {
    res.status(404).json({ error: notFound });
    return;
  }
  send(req, res, entry);
}

/** The cached JSON text for `key` (for embedding in another message, e.g. a socket snapshot). */
async function getCachedBody(redis, key, { ttlSeconds = 5, memoMs = 1000, load }) {
  return (await getEntry(redis, key, { ttlSeconds, memoMs, load })).body;
}

/** Drops keys everywhere this pod can (Redis for every pod; other pods' memory expires in memoMs). */
async function invalidateCachedJson(redis, keys) {
  for (const key of keys) memo.delete(key);
  if (redis && keys.length) await redis.del(keys.map((key) => PREFIX + key)).catch(() => {});
}

module.exports = { sendCachedJson, getCachedBody, invalidateCachedJson };
