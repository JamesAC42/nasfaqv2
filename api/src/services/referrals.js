// Referral links. Every player has a link (holo.nasfaq.biz/?ref=<code>), and the share cards for
// game moments carry it too. Someone who signs up through one is recorded in market.referrals.
// When they get their first stock fill, both players are paid REFERRAL_REWARD_CASH and
// REFERRAL_REWARD_CREDIT (default $250 and 2,500 Credit). A sharer's own share is paid at most
// REFERRAL_WEEKLY_CAP (default 3) times a week, so at most $8,250 of net worth a week.
//
// The same `ref` parameter also carries plain source tags (?ref=v1-email). A value that isn't
// anyone's code is stored as the new account's signup_source, for counting on /admin/analytics.
//
// Rules (decideReferral, tested in test/referrals.test.js), reusing the alt checks from PR #60:
// - Nothing is paid when the new account has shared an IP hash (ipHash.js) with the sharer, or with
//   another account the sharer already brought in and got paid for. Self-referrals fall under the
//   same rule, plus a check constraint.
// - The new player needs a verified email and a first fill within REFERRAL_WINDOW_DAYS of
//   signing up. Their share is paid then.
// - The sharer's share needs the account rule the card exchange and staked tables use
//   (games/accountRules.js): a verified email and an account EXCHANGE_MIN_ACCOUNT_AGE_HOURS old. It
//   also needs fewer than REFERRAL_WEEKLY_CAP sharer payouts in the last 7 days, and IP linking
//   turned on (IP_HASH_SALT): without it the shared-network check can't see anything. While any of
//   those fails, the share waits and is tried again later (referrer_retry_at). Shared IPs and
//   suspensions are checked again at that point.
//
// The scheduler pod settles referrals every minute (startReferralScheduler), and the same loop
// deletes old visit rows (visits.js).

const crypto = require("node:crypto");
const economy = require("./economy");
const { ensureUserCashAccount } = require("./portfolioCash");
const { accountStatus, MIN_ACCOUNT_AGE_HOURS } = require("./games/accountRules");
const { ipHashingEnabled, sharedIpAccounts } = require("./ipHash");
const { activeSuspensionSql } = require("./moderation");
const notifications = require("./notifications");
const schedulerHealth = require("./schedulerHealth");
const { profilePictureUrlSql } = require("../profilePictures");

const LOCK_KEY = 9_204_130;
const INTERVAL_MS = 60_000;
const WEEK_MS = 7 * 86_400_000;
const UNVERIFIED_RETRY_MS = 15 * 60_000;
const IP_CHECK_RETRY_MS = 60 * 60_000;
const CODE_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const CODE_LENGTH = 8;
// Where a link was found: a plain link, or a shared game moment (lib/games/moments.ts kinds).
const VIAS = new Set(["link", "blackjack", "cards"]);

const amount = (value, fallback) => {
  const parsed = Number(value);
  return value !== undefined && value !== "" && Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

function referralSettings(env = process.env) {
  return {
    cash: amount(env.REFERRAL_REWARD_CASH, 250),
    credit: amount(env.REFERRAL_REWARD_CREDIT, 2500),
    weeklyCap: Math.floor(amount(env.REFERRAL_WEEKLY_CAP, 3)),
    windowDays: amount(env.REFERRAL_WINDOW_DAYS, 30),
    minAgeHours: MIN_ACCOUNT_AGE_HOURS,
  };
}

function publicSettings(settings = referralSettings()) {
  return {
    cash: settings.cash,
    credit: settings.credit,
    weekly_cap: settings.weeklyCap,
    window_days: settings.windowDays,
    min_age_hours: settings.minAgeHours,
  };
}

/** A new code: 8 letters and digits, none that look alike (no i, l, o, 0 or 1). */
function generateCode() {
  let code = "";
  for (let index = 0; index < CODE_LENGTH; index += 1) code += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  return code;
}

/** A `ref` value as it's stored (a code or a source tag): lower case, 1 to 40 of a-z 0-9 _ -, else null. */
function cleanTag(value) {
  const text = String(value ?? "").trim().toLowerCase();
  return /^[a-z0-9][a-z0-9_-]{0,39}$/.test(text) ? text : null;
}

const cleanVia = (value) => (VIAS.has(String(value)) ? String(value) : "link");

/**
 * What the browser kept from the links it arrived through, newest first: [{ ref, via }] (or plain
 * strings). Cleaned, deduplicated, at most 5.
 */
function cleanRefs(input) {
  const list = Array.isArray(input) ? input : input ? [input] : [];
  const out = [];
  for (const item of list.slice(0, 10)) {
    const tag = cleanTag(typeof item === "string" ? item : item?.ref);
    if (!tag || out.some((entry) => entry.tag === tag)) continue;
    out.push({ tag, via: cleanVia(typeof item === "string" ? null : item?.via) });
    if (out.length >= 5) break;
  }
  return out;
}

/** The player's code, made the first time it's asked for. */
async function ensureReferralCode(db, userId) {
  const { rows } = await db.query(`SELECT referral_code FROM market.users WHERE id = $1`, [userId]);
  if (!rows[0]) throw Object.assign(new Error("user_not_found"), { code: "user_not_found" });
  if (rows[0].referral_code) return rows[0].referral_code;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const { rows: set } = await db.query(
        `UPDATE market.users SET referral_code = COALESCE(referral_code, $2) WHERE id = $1 RETURNING referral_code`,
        [userId, generateCode()]
      );
      return set[0].referral_code;
    } catch (error) {
      if (error?.code !== "23505") throw error; // someone else has that code: draw again
    }
  }
  throw new Error("referral_code_unavailable");
}

/**
 * At sign-up: the newest `refs` value that's someone's code becomes a referral, and the newest one
 * that isn't becomes the account's signup_source. Returns { referral_id, referrer_id, source }.
 */
async function recordSignup(db, { userId, refs }) {
  const tags = cleanRefs(refs);
  if (!tags.length) return { referral_id: null, referrer_id: null, source: null };
  const { rows } = await db.query(`SELECT id, referral_code FROM market.users WHERE referral_code = ANY($1::text[])`, [tags.map((entry) => entry.tag)]);
  const owners = new Map(rows.map((row) => [row.referral_code, Number(row.id)]));
  // Someone's code is never a source tag, the player's own included (that one just doesn't count).
  const code = tags.find((entry) => owners.has(entry.tag) && owners.get(entry.tag) !== Number(userId)) || null;
  const source = tags.find((entry) => !owners.has(entry.tag)) || null;
  if (source) await db.query(`UPDATE market.users SET signup_source = $2 WHERE id = $1 AND signup_source IS NULL`, [userId, source.tag]);
  let referralId = null;
  if (code) {
    const { rows: inserted } = await db.query(
      `INSERT INTO market.referrals (referrer_id, referee_id, via) VALUES ($1, $2, $3) ON CONFLICT (referee_id) DO NOTHING RETURNING id`,
      [owners.get(code.tag), userId, code.via]
    );
    referralId = inserted[0] ? Number(inserted[0].id) : null;
  }
  return { referral_id: referralId, referrer_id: code ? owners.get(code.tag) : null, source: source?.tag ?? null };
}

const time = (value) => (value ? new Date(value).getTime() : null);

/**
 * What to do with one referral, from the facts gatherFacts reads. Pure, so the rules are tested on
 * their own.
 *
 * facts: {
 *   referral: { status, referrer_status },
 *   referrer, referee: { id, created_at, email_verified, suspended },
 *   firstFillAt: the new player's first stock fill, or null,
 *   sharedIp: the new account has shared an IP hash with the sharer, or with an account the
 *     sharer already got paid for,
 *   ipCheck: IP linking is on (ipHash.js), so sharedIp means something (default true),
 *   referrerPaidAt: when the sharer's payouts in the last 7 days landed,
 * }
 * Returns { referee: { action: "wait" | "pay" | "refuse" | "expire" | "done", reason },
 *           referrer: { action: "wait" | "pay" | "refuse" | "none", reason, retryAt } }.
 */
function decideReferral(facts, settings = referralSettings(), now = new Date()) {
  const { referral, referrer, referee } = facts;
  const nowMs = now.getTime();
  const none = { action: "none", reason: null, retryAt: null };
  let refereeSide;
  if (referral.status === "pending") {
    if (!referrer || !referee || Number(referrer.id) === Number(referee.id)) return { referee: { action: "refuse", reason: "self" }, referrer: none };
    if (referee.suspended) return { referee: { action: "refuse", reason: "suspended" }, referrer: none };
    if (facts.sharedIp) return { referee: { action: "refuse", reason: "shared_ip" }, referrer: none };
    if (!facts.firstFillAt || !referee.email_verified) {
      const deadline = time(referee.created_at) + settings.windowDays * 86_400_000;
      if (nowMs >= deadline) return { referee: { action: "expire", reason: facts.firstFillAt ? "unverified" : "no_trade" }, referrer: none };
      return { referee: { action: "wait", reason: facts.firstFillAt ? "unverified" : "no_trade" }, referrer: none };
    }
    refereeSide = { action: "pay", reason: null };
  } else if (referral.status === "paid" && referral.referrer_status === "waiting") {
    refereeSide = { action: "done", reason: null };
  } else {
    return { referee: { action: "done", reason: null }, referrer: none };
  }

  // The sharer's side: when the new player is paid, and again each time a waiting share is due.
  if (referrer.suspended) return { referee: refereeSide, referrer: { action: "refuse", reason: "suspended", retryAt: null } };
  if (facts.sharedIp) return { referee: refereeSide, referrer: { action: "refuse", reason: "shared_ip", retryAt: null } };
  if (facts.ipCheck === false) return { referee: refereeSide, referrer: { action: "wait", reason: "ip_check_off", retryAt: new Date(nowMs + IP_CHECK_RETRY_MS) } };
  const status = accountStatus(referrer, { tooNew: "too_new", now: nowMs, minAgeHours: settings.minAgeHours });
  if (!status.eligible) {
    const retryAt = status.available_at ? new Date(status.available_at) : new Date(nowMs + UNVERIFIED_RETRY_MS);
    return { referee: refereeSide, referrer: { action: "wait", reason: status.reason === "too_new" ? "too_new" : "unverified", retryAt } };
  }
  if (!(settings.weeklyCap > 0)) return { referee: refereeSide, referrer: { action: "refuse", reason: "sharer_rewards_off", retryAt: null } };
  const recent = (facts.referrerPaidAt || []).map(time).filter((at) => at !== null && at > nowMs - WEEK_MS).sort((a, b) => a - b);
  if (recent.length >= settings.weeklyCap) {
    // The slot frees when the oldest payout in the window turns a week old.
    const retryAt = new Date(recent[recent.length - settings.weeklyCap] + WEEK_MS);
    return { referee: refereeSide, referrer: { action: "wait", reason: "weekly_cap", retryAt } };
  }
  return { referee: refereeSide, referrer: { action: "pay", reason: null, retryAt: null } };
}

/** Everything decideReferral needs, read inside the referral's transaction. */
async function gatherFacts(db, referral, now = new Date()) {
  const referrerId = Number(referral.referrer_id);
  const refereeId = Number(referral.referee_id);
  const { rows: users } = await db.query(
    `SELECT u.id, u.username, u.created_at, u.email_verified, ${activeSuspensionSql("u")} AS suspended FROM market.users u WHERE u.id = ANY($1::bigint[])`,
    [[referrerId, refereeId]]
  );
  const byId = new Map(users.map((row) => [Number(row.id), { ...row, id: Number(row.id), suspended: Boolean(row.suspended) }]));
  const { rows: fills } = await db.query(`SELECT min(ts) AS first_at FROM market.trade_fills WHERE user_id = $1`, [refereeId]);
  const shared = (await sharedIpAccounts(db, [refereeId])).get(refereeId) || [];
  let sharedIp = shared.some((account) => account.id === referrerId);
  if (!sharedIp && shared.length) {
    const { rows: paidSiblings } = await db.query(
      `SELECT referee_id FROM market.referrals WHERE referrer_id = $1 AND referee_id <> $2 AND status = 'paid' AND referee_id = ANY($3::bigint[])`,
      [referrerId, refereeId, shared.map((account) => account.id)]
    );
    sharedIp = paidSiblings.length > 0;
  }
  const { rows: paid } = await db.query(
    `SELECT referrer_paid_at FROM market.referrals WHERE referrer_id = $1 AND referrer_paid_at > $2::timestamptz - interval '7 days' ORDER BY referrer_paid_at`,
    [referrerId, now.toISOString()]
  );
  return {
    referral,
    referrer: byId.get(referrerId) || null,
    referee: byId.get(refereeId) || null,
    firstFillAt: fills[0]?.first_at || null,
    sharedIp,
    ipCheck: ipHashingEnabled(),
    referrerPaidAt: paid.map((row) => row.referrer_paid_at),
  };
}

const moneyText = (value) => `$${Number(value).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

function rewardText({ cash, credit }) {
  const parts = [];
  if (cash > 0) parts.push(moneyText(cash));
  if (credit > 0) parts.push(`${Number(credit).toLocaleString("en-US", { maximumFractionDigits: 2 })} Credit`);
  return parts.join(" and ") || "nothing";
}

/**
 * Decides one referral and writes the outcome: balances, ledger rows (entry_type referral_reward,
 * reference referral/<id>) and the referral row, in one transaction. Returns what happened, or null
 * when there was nothing to do (or another transaction holds a row it needs: the next sweep tries
 * again).
 */
async function settleReferral(pool, referralId, { settings = referralSettings(), now = new Date() } = {}) {
  const client = await pool.connect();
  let result = null;
  try {
    await client.query("BEGIN");
    await client.query(`SET LOCAL lock_timeout = '2s'`);
    const { rows } = await client.query(`SELECT * FROM market.referrals WHERE id = $1 FOR UPDATE`, [referralId]);
    const referral = rows[0];
    if (!referral || !(referral.status === "pending" || (referral.status === "paid" && referral.referrer_status === "waiting"))) {
      await client.query("ROLLBACK");
      return null;
    }
    const facts = await gatherFacts(client, referral, now);
    const decision = decideReferral(facts, settings, now);
    const reward = { cash: settings.cash, credit: settings.credit };
    const moves = [];
    const payee = (userId) => ({ userId: Number(userId), cash: reward.cash, credit: reward.credit, entryType: "referral_reward", referenceType: "referral", referenceId: Number(referral.id) });
    if (decision.referee.action === "pay") moves.push(payee(referral.referee_id));
    if (decision.referrer.action === "pay") moves.push(payee(referral.referrer_id));
    if (decision.referee.action === "wait" && decision.referrer.action === "none") {
      await client.query("ROLLBACK");
      return { id: Number(referral.id), decision };
    }
    if (moves.length && (reward.cash > 0 || reward.credit > 0)) {
      // Cash rows in id order, the order a live-order batch locks them in.
      for (const userId of moves.map((move) => move.userId).sort((a, b) => a - b)) await ensureUserCashAccount(client, userId);
      await economy.writeMoves(client, moves);
    }
    const refereeStatus = { pay: "paid", refuse: "refused", expire: "expired" }[decision.referee.action] || referral.status;
    const referrerStatus = { pay: "paid", refuse: "refused", wait: "waiting" }[decision.referrer.action] || referral.referrer_status;
    await client.query(
      `
      UPDATE market.referrals SET
        status = $2,
        reason = CASE WHEN $3::boolean THEN $4 ELSE reason END,
        referee_cash = CASE WHEN $5::boolean THEN $6 ELSE referee_cash END,
        referee_credit = CASE WHEN $5::boolean THEN $7 ELSE referee_credit END,
        referee_paid_at = CASE WHEN $5::boolean THEN now() ELSE referee_paid_at END,
        referrer_status = $8,
        referrer_reason = $9,
        referrer_retry_at = $10,
        referrer_cash = CASE WHEN $11::boolean THEN $6 ELSE referrer_cash END,
        referrer_credit = CASE WHEN $11::boolean THEN $7 ELSE referrer_credit END,
        referrer_paid_at = CASE WHEN $11::boolean THEN now() ELSE referrer_paid_at END,
        decided_at = COALESCE(decided_at, CASE WHEN $2 <> 'pending' THEN now() END)
      WHERE id = $1
    `,
      [
        referral.id,
        refereeStatus,
        decision.referee.action !== "done",
        decision.referee.reason,
        decision.referee.action === "pay",
        reward.cash,
        reward.credit,
        referrerStatus,
        decision.referrer.action === "none" ? referral.referrer_reason : decision.referrer.reason,
        decision.referrer.retryAt ? decision.referrer.retryAt.toISOString() : null,
        decision.referrer.action === "pay",
      ]
    );
    await client.query("COMMIT");
    result = { id: Number(referral.id), decision, referrer: facts.referrer, referee: facts.referee };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    if (error?.code === "55P03") return null; // lock_timeout: a batch has the wallet, next sweep
    throw error;
  } finally {
    client.release();
  }

  // The bell, after the money is in.
  const text = rewardText({ cash: settings.cash, credit: settings.credit });
  const notes = [];
  if (result.decision.referee.action === "pay") {
    notes.push([result.referee.id, { kind: "referral", title: `Welcome bonus: ${text}`, body: `For your first trade after joining through ${result.referrer.username}'s link.`, href: "/profile?invite=1" }]);
  }
  if (result.decision.referrer.action === "pay") {
    notes.push([result.referrer.id, { kind: "referral", title: `Referral bonus: ${text}`, body: `${result.referee.username} joined through your link and made a first trade.`, href: "/profile?invite=1" }]);
  }
  for (const [userId, note] of notes) await notifications.notify(pool, userId, note).catch(() => {});
  return result;
}

/** Settles every referral that's due: new players with a first fill or past the window, and waiting shares. */
async function settleDueReferrals(pool, { settings = referralSettings(), now = new Date(), limit = 100 } = {}) {
  const { rows } = await pool.query(
    `
    SELECT r.id FROM market.referrals r
    JOIN market.users e ON e.id = r.referee_id
    WHERE (r.status = 'pending' AND (
            EXISTS (SELECT 1 FROM market.trade_fills f WHERE f.user_id = r.referee_id)
            OR e.created_at <= $1::timestamptz - $2::double precision * interval '1 day'))
       OR (r.status = 'paid' AND r.referrer_status = 'waiting' AND (r.referrer_retry_at IS NULL OR r.referrer_retry_at <= $1::timestamptz))
    ORDER BY r.id
    LIMIT $3
  `,
    [now.toISOString(), settings.windowDays, limit]
  );
  const results = [];
  for (const row of rows) {
    const result = await settleReferral(pool, Number(row.id), { settings, now });
    if (result) results.push(result);
  }
  return results;
}

/** The referral panel on a player's own profile. */
async function referralSummary(db, userId, { settings = referralSettings(), now = new Date() } = {}) {
  const code = await ensureReferralCode(db, userId);
  const { rows } = await db.query(
    `
    SELECT r.id, r.via, r.status, r.reason, r.referrer_status, r.referrer_reason, r.referrer_retry_at,
           r.referrer_cash, r.referrer_credit, r.referrer_paid_at, r.created_at,
           u.username, u.profile_color, ${profilePictureUrlSql("small")} AS profile_picture_url
    FROM market.referrals r
    JOIN market.users u ON u.id = r.referee_id
    LEFT JOIN market.profile_pictures pp ON pp.id = u.profile_picture_id
    WHERE r.referrer_id = $1
    ORDER BY r.created_at DESC, r.id DESC
    LIMIT 100
  `,
    [userId]
  );
  const { rows: totals } = await db.query(
    `
    SELECT count(*)::int AS joined,
           count(*) FILTER (WHERE referrer_paid_at IS NOT NULL)::int AS paid,
           count(*) FILTER (WHERE referrer_paid_at > $2::timestamptz - interval '7 days')::int AS paid_this_week,
           COALESCE(sum(referrer_cash), 0) AS cash,
           COALESCE(sum(referrer_credit), 0) AS credit
    FROM market.referrals WHERE referrer_id = $1
  `,
    [userId, now.toISOString()]
  );
  const { rows: invited } = await db.query(
    `SELECT r.status, r.reason, r.referee_cash, r.referee_credit, r.created_at, u.username
     FROM market.referrals r JOIN market.users u ON u.id = r.referrer_id WHERE r.referee_id = $1`,
    [userId]
  );
  const total = totals[0];
  return {
    code,
    path: `/?ref=${code}`,
    settings: publicSettings(settings),
    totals: { joined: total.joined, paid: total.paid, paid_this_week: total.paid_this_week, cash: Number(total.cash), credit: Number(total.credit) },
    joined: rows.map((row) => ({
      username: row.username,
      profile_color: row.profile_color || null,
      profile_picture_url: row.profile_picture_url || null,
      joined_at: row.created_at,
      via: row.via,
      status: row.status,
      reason: row.reason,
      your_share: row.referrer_status || null,
      your_share_reason: row.referrer_reason || null,
      your_share_retry_at: row.referrer_status === "waiting" ? row.referrer_retry_at : null,
      paid_at: row.referrer_paid_at,
    })),
    invited_by: invited[0]
      ? {
          username: invited[0].username,
          status: invited[0].status,
          reason: invited[0].reason,
          cash: Number(invited[0].referee_cash),
          credit: Number(invited[0].referee_credit),
          joined_at: invited[0].created_at,
        }
      : null,
  };
}

/** Whose link a code is, for the sign-up form ("Invited by ..."); null when it isn't anyone's. */
async function inviteFor(db, code) {
  const tag = cleanTag(code);
  if (!tag) return null;
  const { rows } = await db.query(`SELECT u.username FROM market.users u WHERE u.referral_code = $1 AND NOT ${activeSuspensionSql("u")}`, [tag]);
  return rows[0] ? { username: rows[0].username } : null;
}

/** The referral loop, on the scheduler pod. It also deletes visit rows past their retention (visits.js). */
function startReferralScheduler(pool, logger = console, redis = null, { intervalMs = INTERVAL_MS, firstTickMs = 30_000 } = {}) {
  const enabled = (process.env.REFERRALS_ENABLED || "true").toLowerCase() !== "false";
  const heartbeat = schedulerHealth.startSchedulerHeartbeat(redis, "referrals", { enabled, intervalMs }, logger);
  if (!enabled) return () => heartbeat.stop();
  const visits = require("./visits");
  let running = false;
  let lastPrune = 0;
  async function tick() {
    if (running) return;
    running = true;
    heartbeat.update("running");
    let client;
    try {
      client = await pool.connect();
      const { rows } = await client.query("SELECT pg_try_advisory_lock($1) AS locked", [LOCK_KEY]);
      if (!rows[0]?.locked) {
        heartbeat.skip();
        return;
      }
      try {
        const settled = await settleDueReferrals(pool);
        const paid = settled.filter((entry) => entry.decision.referee.action === "pay" || entry.decision.referrer.action === "pay").length;
        if (paid) logger.log?.(`referrals: paid ${paid}`);
        if (Date.now() - lastPrune > 3_600_000) {
          lastPrune = Date.now();
          const removed = await visits.pruneOldVisits(pool);
          if (removed) logger.log?.(`visits: deleted ${removed} rows past retention`);
        }
      } finally {
        await client.query("SELECT pg_advisory_unlock($1)", [LOCK_KEY]).catch(() => {});
      }
      heartbeat.update("idle");
    } catch (error) {
      heartbeat.update("error", error);
      logger.error?.("referrals failed", error);
    } finally {
      client?.release();
      running = false;
    }
  }
  const timer = setInterval(() => void tick(), intervalMs);
  timer.unref?.();
  const first = setTimeout(() => void tick(), firstTickMs);
  first.unref?.();
  return () => {
    clearTimeout(first);
    clearInterval(timer);
    heartbeat.stop();
  };
}

module.exports = {
  CODE_ALPHABET,
  LOCK_KEY,
  cleanRefs,
  cleanTag,
  decideReferral,
  ensureReferralCode,
  gatherFacts,
  generateCode,
  inviteFor,
  publicSettings,
  recordSignup,
  referralSettings,
  referralSummary,
  settleDueReferrals,
  settleReferral,
  startReferralScheduler,
};
