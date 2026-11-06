// Who can see and use prediction pools (and margin) while they're behind the `prediction-pools`
// feature flag: `off` (nobody), `staff` (staff preview) or `on` (everyone). The flag starts at
// `staff`; the owner turns it on in its own PR.
//
// This is the one place the flag is read. Players who can't use pools see no pools anywhere, and none
// of margin's in-the-red rules apply to them, so nothing changes for them until the flag is on.

const STATES = ["off", "staff", "on"];

function poolsFlag() {
  const raw = String(process.env.FEATURE_PREDICTION_POOLS || "").trim().toLowerCase();
  return STATES.includes(raw) ? raw : "staff";
}

/** Staff for the preview: admins, bookies and prediction staff. */
function isPoolStaff(user) {
  return Boolean(
    user?.is_admin ||
      user?.is_bookie ||
      user?.can_create_prediction_markets ||
      user?.can_approve_prediction_markets ||
      user?.can_resolve_prediction_markets ||
      user?.can_void_prediction_markets
  );
}

function poolsVisibleTo(user) {
  const flag = poolsFlag();
  if (flag === "on") return true;
  if (flag === "staff") return isPoolStaff(user);
  return false;
}

/** Same rule for a user id, read from the database (economy and the exchange only have the id). */
async function poolsVisibleToId(db, userId) {
  const flag = poolsFlag();
  if (flag === "on") return true;
  if (flag === "off" || !userId) return false;
  const { rows } = await db.query(
    `SELECT is_admin, is_bookie, can_create_prediction_markets, can_approve_prediction_markets, can_resolve_prediction_markets, can_void_prediction_markets
     FROM market.users WHERE id = $1`,
    [userId]
  );
  return isPoolStaff(rows[0]);
}

/** SQL that's true for a market.users row (alias) that can use pools. */
function poolsVisibleSql(alias) {
  const flag = poolsFlag();
  if (flag === "on") return "true";
  if (flag === "off") return "false";
  return `(${alias}.is_admin OR ${alias}.is_bookie OR ${alias}.can_create_prediction_markets OR ${alias}.can_approve_prediction_markets
    OR ${alias}.can_resolve_prediction_markets OR ${alias}.can_void_prediction_markets)`;
}

/** Bookies open and resolve pools; admins count as bookies. */
const isBookie = (user) => Boolean(user?.is_admin || user?.is_bookie);

module.exports = { isBookie, isPoolStaff, poolsFlag, poolsVisibleSql, poolsVisibleTo, poolsVisibleToId };
