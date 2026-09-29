// Maintenance around a release. deploy/release.sh runs these as Jobs with the new image:
//
//   node scripts/maintenance.js drain [--timeout-seconds 600]
//     Pauses new games (players see "update going out"), refunds tables nobody joined, and waits for
//     the matches and blackjack rounds in play to finish, up to the timeout. Past it, the release
//     goes ahead anyway: the restart refunds whatever is still unfinished, as it always has.
//   node scripts/maintenance.js end [--version sha-…]
//     Reopens games if the release paused them (never an admin's maintenance), records the version
//     that went live, and tells every open page so players can refresh.
//
// Exits 0 whenever the database answered; the release decides what a failure means.

const { loadEnv } = require("../src/config");
const { createPool } = require("../src/db");
const { createRedis } = require("../src/redis");
const siteState = require("../src/services/siteState");

const POLL_MS = 5000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const log = (...args) => console.log("maintenance:", ...args);

function option(args, name, fallback = null) {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] !== undefined ? args[index + 1] : fallback;
}

/** Games in play right now. Ones idle for 30+ minutes are abandoned (the admin overview's "left hanging") and don't hold a release. */
async function gamesInPlay(pool) {
  const { rows } = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM games.pvp_matches
        WHERE status = 'active' AND COALESCE(updated_at, started_at, created_at) > now() - interval '30 minutes')::int AS matches,
      (SELECT COUNT(*) FROM games.blackjack_rounds
        WHERE status IN ('betting', 'playing') AND started_at > now() - interval '30 minutes')::int AS rounds
  `);
  return rows[0];
}

async function drain(pool, redis, { timeoutSeconds, pollMs = POLL_MS }) {
  const site = await siteState.setMaintenance(pool, { state: "draining", source: "deploy" });
  await siteState.publishSiteState(redis, site);
  log(`games paused (${site.maintenance.state}, by ${site.maintenance.source})`);
  const deadline = Date.now() + timeoutSeconds * 1000;
  // Give the games process a moment to hear it before counting what's left.
  await sleep(pollMs);
  for (;;) {
    const { matches, rounds } = await gamesInPlay(pool);
    if (!matches && !rounds) {
      log("no games in play");
      return;
    }
    if (Date.now() >= deadline) {
      log(`${matches} match(es) and ${rounds} blackjack round(s) still in play after ${timeoutSeconds}s; going ahead (the restart refunds them)`);
      return;
    }
    log(`waiting for ${matches} match(es) and ${rounds} blackjack round(s)`);
    await sleep(pollMs);
  }
}

async function end(pool, redis, { version }) {
  let site = await siteState.setMaintenance(pool, { state: "off", source: "deploy" });
  if (version) site = await siteState.markReleased(pool, version);
  await siteState.publishSiteState(redis, site);
  log(`games ${site.maintenance.state === "off" ? "open" : `still paused (${site.maintenance.source})`}${version ? `; ${version} is live` : ""}`);
}

async function main() {
  loadEnv();
  const [command, ...args] = process.argv.slice(2);
  if (command !== "drain" && command !== "end") {
    console.error("usage: maintenance.js drain [--timeout-seconds N] | end [--version V]");
    process.exit(2);
  }
  const pool = createPool(process.env.DATABASE_URL);
  // Redis only carries the news to open pages; they also check on their own, so it's optional.
  const redis = await createRedis(process.env.REDIS_URL, process.env.REDIS_PASSWORD).catch((error) => {
    log("no redis, pages will notice on their next check:", String(error?.message || error));
    return null;
  });
  try {
    if (command === "drain") await drain(pool, redis, { timeoutSeconds: Math.max(0, Number(option(args, "timeout-seconds", 600)) || 0) });
    else await end(pool, redis, { version: option(args, "version") });
  } finally {
    await redis?.quit().catch(() => {});
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error("maintenance failed:", error);
    process.exit(1);
  });
}

module.exports = { drain, end, gamesInPlay };
