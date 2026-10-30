// Account rules for anything that moves Cash between players: the card exchange and staked PvP
// tables. Both need a verified email and an account EXCHANGE_MIN_ACCOUNT_AGE_HOURS old (72 by
// default; production sets 168), so a fresh alt can't hand its starting money to a main account.

const MIN_ACCOUNT_AGE_HOURS = Number(process.env.EXCHANGE_MIN_ACCOUNT_AGE_HOURS ?? 72);

/**
 * Whether a market.users row (created_at, email_verified) passes: { eligible, reason, available_at }.
 * `tooNew` is the reason given while the account is younger than the minimum; available_at is when
 * it won't be.
 */
function accountStatus(row, { tooNew, now = Date.now(), minAgeHours = MIN_ACCOUNT_AGE_HOURS }) {
  if (!row) return { eligible: false, reason: "unauthenticated", available_at: null };
  if (!row.email_verified) return { eligible: false, reason: "email_verification_required", available_at: null };
  const availableAt = new Date(new Date(row.created_at).getTime() + minAgeHours * 3_600_000);
  if (availableAt.getTime() > now) return { eligible: false, reason: tooNew, available_at: availableAt.toISOString() };
  return { eligible: true, reason: null, available_at: null };
}

/** Throws pvp_account_too_new (with available_at) or email_verification_required unless the player may stake Cash on a table. */
async function assertCanStake(db, userId) {
  const { rows } = await db.query(`SELECT created_at, email_verified FROM market.users WHERE id = $1`, [userId]);
  const status = accountStatus(rows[0], { tooNew: "pvp_account_too_new" });
  if (!status.eligible) throw Object.assign(new Error(status.reason), { code: status.reason, available_at: status.available_at });
}

module.exports = { MIN_ACCOUNT_AGE_HOURS, accountStatus, assertCanStake };
