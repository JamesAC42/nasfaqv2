// Linking alts without keeping anyone's IP address. Sign-up stores a salted hash of the address
// (market.users.signup_ip_hash) and every session the hash of the last one it was used from
// (market.user_sessions.last_ip_hash). Admins see which accounts share one, on the People page and
// in exchange review; never an address, and never a hash either.
//
// The salt is IP_HASH_SALT, a secret. Without it nothing is stored and the admin pages say linking
// is off. Changing it starts over: old hashes stop matching new ones.
//
// An IPv6 address is hashed by its /64 (one home or phone line; the rest of the address rotates).
// Shared hashes are a lead, not proof: a household, a school or a mobile carrier shares addresses.

const crypto = require("node:crypto");
const { clientIp } = require("../rateLimit");
const { activeSuspensionSql } = require("./moderation");

function ipHashingEnabled() {
  return Boolean(process.env.IP_HASH_SALT);
}

/** The part of an address that stays put: IPv4 as is, IPv6 by its first four groups. */
function ipKey(ip) {
  let value = String(ip ?? "").trim().toLowerCase();
  if (!value || value === "unknown") return null;
  value = value.replace(/^\[([^\]]+)\](?::\d+)?$/, "$1").split("%")[0];
  if (value.startsWith("::ffff:") && value.includes(".")) value = value.slice(7);
  const v4 = value.match(/^(\d{1,3}(?:\.\d{1,3}){3})(?::\d+)?$/);
  if (v4) return v4[1];
  const halves = value.split("::");
  if (!value.includes(":") || halves.length > 2) return value;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  const groups = [...head, ...Array(Math.max(0, fill)).fill("0"), ...tail];
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return value;
  return `${groups.slice(0, 4).map((group) => group.replace(/^0+(?=.)/, "")).join(":")}::/64`;
}

/** The salted hash stored for an address, or null (no salt, or no address). */
function hashIp(ip, salt = process.env.IP_HASH_SALT) {
  const key = ipKey(ip);
  if (!salt || !key) return null;
  return crypto.createHmac("sha256", salt).update(key).digest("hex").slice(0, 32);
}

/** The hash of the address a request came from (clientIp: Cloudflare's header, else the proxy's). */
function requestIpHash(req) {
  return req ? hashIp(clientIp(req)) : null;
}

// Every (user, hash) pair: the sign-up address and each session's last one.
const USER_HASHES = `
  SELECT id AS user_id, signup_ip_hash AS ip_hash, created_at AS seen_at FROM market.users WHERE signup_ip_hash IS NOT NULL
  UNION ALL
  SELECT user_id, last_ip_hash, last_seen_at FROM market.user_sessions WHERE last_ip_hash IS NOT NULL
`;

const accountJson = (alias) => `json_build_object(
  'id', ${alias}.id,
  'username', ${alias}.username,
  'created_at', ${alias}.created_at,
  'email_verified', ${alias}.email_verified,
  'suspended', ${activeSuspensionSql(alias)}
)`;

const toAccount = (row) => ({
  id: Number(row.id),
  username: row.username,
  created_at: row.created_at,
  email_verified: Boolean(row.email_verified),
  suspended: Boolean(row.suspended),
});

/**
 * For each of `userIds`, the other accounts that have shared an IP hash with it (at sign-up or in
 * any session), oldest account first. Returns a Map of user id -> [{ id, username, created_at,
 * email_verified, suspended }]; ids with none are left out.
 */
async function sharedIpAccounts(db, userIds) {
  const ids = [...new Set((userIds || []).map(Number).filter((id) => Number.isInteger(id) && id > 0))];
  if (!ids.length) return new Map();
  const { rows } = await db.query(
    `
    WITH mine AS (
      SELECT id AS user_id, signup_ip_hash AS ip_hash FROM market.users WHERE id = ANY($1::bigint[]) AND signup_ip_hash IS NOT NULL
      UNION
      SELECT user_id, last_ip_hash FROM market.user_sessions WHERE user_id = ANY($1::bigint[]) AND last_ip_hash IS NOT NULL
    ),
    linked AS (
      SELECT m.user_id, o.id AS other_id FROM mine m JOIN market.users o ON o.signup_ip_hash = m.ip_hash AND o.id <> m.user_id
      UNION
      SELECT m.user_id, s.user_id FROM mine m JOIN market.user_sessions s ON s.last_ip_hash = m.ip_hash AND s.user_id <> m.user_id
    )
    SELECT l.user_id, json_agg(${accountJson("o")} ORDER BY o.created_at, o.id) AS accounts
    FROM linked l
    JOIN market.users o ON o.id = l.other_id
    GROUP BY l.user_id
  `,
    [ids]
  );
  return new Map(rows.map((row) => [Number(row.user_id), (row.accounts || []).map(toAccount)]));
}

/**
 * Groups of accounts tied together by shared IP hashes (A and B share one, B and C another: one
 * group of three), where a shared hash was used in the last `days` days. Biggest first.
 */
async function ipClusters(db, { days = 14, limit = 50 } = {}) {
  const { rows } = await db.query(
    `
    WITH seen AS (${USER_HASHES})
    SELECT array_agg(DISTINCT user_id) AS user_ids, max(seen_at) AS last_at
    FROM seen
    GROUP BY ip_hash
    HAVING count(DISTINCT user_id) >= 2 AND max(seen_at) > now() - make_interval(days => $1)
  `,
    [days]
  );
  // Union-find over the shared hashes.
  const parent = new Map();
  const find = (id) => {
    while (parent.get(id) !== id) {
      parent.set(id, parent.get(parent.get(id)));
      id = parent.get(id);
    }
    return id;
  };
  const lastAt = new Map();
  for (const row of rows) {
    const ids = row.user_ids.map(Number);
    for (const id of ids) if (!parent.has(id)) parent.set(id, id);
    for (const id of ids.slice(1)) parent.set(find(id), find(ids[0]));
    for (const id of ids) lastAt.set(id, Math.max(lastAt.get(id) ?? 0, Date.parse(row.last_at)));
  }
  const groups = new Map();
  for (const id of parent.keys()) {
    const root = find(id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(id);
  }
  if (!groups.size) return [];
  const { rows: users } = await db.query(
    `SELECT u.id, u.username, u.created_at, u.email_verified, ${activeSuspensionSql("u")} AS suspended FROM market.users u WHERE u.id = ANY($1::bigint[])`,
    [[...parent.keys()]]
  );
  const byId = new Map(users.map((row) => [Number(row.id), toAccount(row)]));
  return [...groups.values()]
    .map((ids) => ({
      accounts: ids
        .map((id) => byId.get(id))
        .filter(Boolean)
        .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || a.id - b.id),
      last_at: new Date(Math.max(...ids.map((id) => lastAt.get(id) ?? 0))).toISOString(),
    }))
    .filter((group) => group.accounts.length >= 2)
    .sort((a, b) => b.accounts.length - a.accounts.length || Date.parse(b.last_at) - Date.parse(a.last_at))
    .slice(0, limit);
}

module.exports = { hashIp, ipClusters, ipHashingEnabled, ipKey, requestIpHash, sharedIpAccounts };
