// Undoes an IPO listing that went out by mistake (docs/market/ipo.md, "Undoing a listing").
//
//   node scripts/revert-ipo-listing.js --event 1                       what it would do; writes nothing
//   node scripts/revert-ipo-listing.js --event 1 --apply               do it
//   node scripts/revert-ipo-listing.js --event 1 --apply --relist 2026-11-19 [--window-hours 168]
//                                                                      ...and announce a new IPO for the same talents
//
// Only while nobody has traded the talents: allocated shares go back, what players paid returns to
// their Cash, the stocks return to prelaunch with their market history since listing removed, and the
// event is cancelled. Refuses (and writes nothing) if there are orders, fills, cards or dividends.
// Run it where the API runs (it uses DATABASE_URL and REDIS_URL from the environment or api/.env).

const { loadEnv } = require("../src/config");
const { createPool } = require("../src/db");
const { createRedis } = require("../src/redis");
const ipo = require("../src/services/ipo");

function option(name) {
  const at = process.argv.indexOf(name);
  return at > -1 ? process.argv[at + 1] : undefined;
}

async function main() {
  loadEnv();
  const eventId = Number(option("--event"));
  if (!Number.isInteger(eventId) || eventId <= 0) throw new Error("pass --event <id>");
  const apply = process.argv.includes("--apply");
  const relist = option("--relist");
  const windowHours = option("--window-hours");
  if (relist && !apply) throw new Error("--relist needs --apply");

  const pool = createPool(process.env.DATABASE_URL);
  const redis = apply && process.env.REDIS_URL ? await createRedis(process.env.REDIS_URL, process.env.REDIS_PASSWORD).catch(() => null) : null;
  try {
    const report = await ipo.revertListing(pool, eventId, { apply, redis });
    console.log(`${report.applied ? "Reverted" : "Would revert"} IPO ${report.event_id} (${report.title})`);
    for (const talent of report.talents) {
      console.log(`  ${talent.symbol.padEnd(5)} back to prelaunch (IPO price ${talent.ipo_price}, trading at ${talent.price_now ?? "-"})`);
    }
    for (const refund of report.refunds) {
      console.log(`  user ${refund.user_id}: ${refund.shares} ${refund.symbol} back, ${refund.cash.toFixed(2)} Cash returned`);
    }
    const removed = Object.entries(report.removed).map(([what, n]) => `${n} ${what.replace(/_/g, " ")}`);
    console.log(`  market history removed: ${removed.join(", ")}`);
    if (!apply) {
      console.log("\nNothing was written. Run again with --apply to do it.");
      return;
    }
    if (relist) {
      const old = (await pool.query(`SELECT title, discount_pct, offering_pct, player_cap_pct FROM market.ipo_events WHERE id = $1`, [eventId])).rows[0];
      const { rows: assets } = await pool.query(`SELECT asset_id FROM market.ipo_listings WHERE event_id = $1 ORDER BY id`, [eventId]);
      const created = await ipo.createEvent(pool, {
        title: old.title,
        listing_date: relist,
        window_hours: windowHours ?? undefined,
        discount_pct: old.discount_pct,
        offering_pct: old.offering_pct,
        player_cap_pct: old.player_cap_pct,
        asset_ids: assets.map((row) => Number(row.asset_id)),
      });
      console.log(`Announced IPO ${created.event_id}: listing ${relist}${windowHours ? `, window ${windowHours} h` : ""}. Adjust it in the admin IPO room.`);
    }
  } finally {
    await pool.end();
    await redis?.quit().catch(() => {});
  }
}

main().catch((error) => {
  console.error(error.code ? `${error.code}${error.field ? `: ${error.field}` : ""}` : error);
  process.exitCode = 1;
});
