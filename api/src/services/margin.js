// Margin for prediction pools (docs/design/predictions-pools.md §3).
//
// A pool bet can borrow once the player's Credit is spent. What it borrows takes Credit below zero,
// and that negative Credit is the debt: it already counts against net worth, and the Saturday
// conversion only converts positive Credit. While Credit is below zero the player is "in the red"
// (economy.assertNotInRed refuses spending Credit), so only one bet borrows at a time.
//
// - The line is 25% of the market value of the shares the player holds, up to $100,000. Shares only
//   size it: nothing is sold or taken to repay it.
// - Only accounts 7+ days old with a verified email, not suspended, can borrow.
// - Every Credit payment repays it, simply by landing on the negative balance. Cash never does (the
//   owner, 2026-11-09: Cash stays untouched by anything but stocks), and the debt never stops a player
//   trading stocks.
// - No interest and no forced sales, for now.

function envNumber(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

const SETTINGS = Object.freeze({
  /** Owner (2026-11-06): the line is this share of the value of the shares held. */
  lineShare: Math.min(envNumber("MARGIN_LINE_SHARE", 0.25), 1),
  /** Owner (2026-11-06): the most anyone can borrow. */
  lineMax: envNumber("MARGIN_LINE_MAX", 100_000),
  /** Owner (2026-11-06): accounts must be this old to borrow (7 days). */
  minAccountAgeHours: envNumber("MARGIN_MIN_ACCOUNT_AGE_HOURS", 168),
});

const num = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const round2 = (value) => Math.round(num(value) * 100) / 100;
const floor2 = (value) => Math.floor(num(value) * 100 + 1e-7) / 100;

function marginError(code, extra = {}) {
  const error = new Error(code);
  error.code = code;
  Object.assign(error, extra);
  return error;
}

/** The line for a given share value: 25% of it, at most the ceiling, rounded down to the cent. */
function computeLine(shareValue, { share = SETTINGS.lineShare, max = SETTINGS.lineMax } = {}) {
  const value = Math.max(0, num(shareValue));
  return floor2(Math.min(value * share, max));
}

const isSuspended = (row, now) => Boolean(row?.suspended_at && (!row.suspended_until || new Date(row.suspended_until).getTime() > now));

/**
 * Whether a market.users row (created_at, email_verified, suspended_at, suspended_until) may
 * borrow: { eligible, reason, available_at }.
 */
function eligibility(row, { now = Date.now(), minAgeHours = SETTINGS.minAccountAgeHours } = {}) {
  if (!row) return { eligible: false, reason: "unauthenticated", available_at: null };
  if (!row.email_verified) return { eligible: false, reason: "email_verification_required", available_at: null };
  if (isSuspended(row, now)) return { eligible: false, reason: "account_suspended", available_at: null };
  const availableAt = new Date(new Date(row.created_at).getTime() + minAgeHours * 3_600_000);
  if (availableAt.getTime() > now) return { eligible: false, reason: "margin_account_too_new", available_at: availableAt.toISOString() };
  return { eligible: true, reason: null, available_at: null };
}

/** Market value of the shares a player holds, at current prices. */
async function shareValue(db, userId) {
  const { rows } = await db.query(
    `SELECT COALESCE(SUM(h.quantity * COALESCE(a.current_mid_price, 0)), 0) AS value
     FROM market.portfolio_holdings h JOIN market.market_assets a ON a.id = h.asset_id
     WHERE h.user_id = $1 AND h.quantity > 0`,
    [userId]
  );
  return round2(rows[0]?.value);
}

async function userRow(db, userId) {
  const { rows } = await db.query(`SELECT id, created_at, email_verified, suspended_at, suspended_until FROM market.users WHERE id = $1`, [userId]);
  return rows[0] || null;
}

/**
 * Everything the bet slip and portfolio show about margin, for a wallet ({ credit, cash }):
 * what's owed, whether the player can borrow, and how much.
 */
async function status(db, userId, wallet) {
  const owed = round2(Math.max(0, -num(wallet.credit)));
  const [row, value] = await Promise.all([userRow(db, userId), shareValue(db, userId)]);
  const gate = eligibility(row);
  const line = computeLine(value);
  const canBorrow = gate.eligible && owed === 0 && line > 0;
  return {
    in_red: owed > 0,
    owed,
    eligible: gate.eligible,
    reason: owed > 0 ? "in_the_red" : gate.reason || (line > 0 ? null : "no_shares"),
    available_at: gate.available_at,
    share_value: value,
    line,
    available: canBorrow ? line : 0,
    line_share: SETTINGS.lineShare,
    line_max: SETTINGS.lineMax,
  };
}

module.exports = { SETTINGS, computeLine, eligibility, marginError, shareValue, status, userRow };
