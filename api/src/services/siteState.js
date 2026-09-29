// Site-wide state every page shows: which release is live, and maintenance.
//
// Maintenance pauses new games. Game tables live in the api-games process's memory and a restart
// refunds whatever is unfinished, so before a release restarts it the deploy "drains": new games are
// turned away and the ones in play finish (scripts/maintenance.js, run by deploy/release.sh). An
// admin can also turn maintenance on by hand, with a message for players. A deploy never overrides
// or ends an admin's maintenance. Trading has its own pause (marketState) and isn't touched here.

const { publishMarketEvent } = require("./marketEvents");

const STATES = new Set(["off", "draining", "on"]);
const SITE_EVENT = "site.status";

const schema = `
  CREATE TABLE IF NOT EXISTS market.site_state (
    id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    maintenance TEXT NOT NULL DEFAULT 'off' CHECK (maintenance IN ('off', 'draining', 'on')),
    maintenance_source TEXT NULL,
    maintenance_message TEXT NULL,
    maintenance_started_at TIMESTAMPTZ NULL,
    release_version TEXT NULL,
    released_at TIMESTAMPTZ NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  INSERT INTO market.site_state (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
`;

const iso = (value) => (value ? new Date(value).toISOString() : null);

function toSite(row) {
  return {
    version: row?.release_version ?? null,
    released_at: iso(row?.released_at),
    maintenance: {
      state: STATES.has(row?.maintenance) ? row.maintenance : "off",
      source: row?.maintenance_source ?? null,
      message: row?.maintenance_message ?? null,
      started_at: iso(row?.maintenance_started_at),
    },
  };
}

// ── This process's view (the games guard reads it on every new game) ─────────

let current = null;
const listeners = new Set();

/** Whether new games are paused, as far as this process has heard. */
function gamesPaused() {
  const state = current?.maintenance?.state;
  return state === "draining" || state === "on";
}

function remember(site) {
  const was = gamesPaused();
  current = site;
  const now = gamesPaused();
  if (now !== was) {
    for (const listener of listeners) {
      try {
        listener(now, site);
      } catch {}
    }
  }
  return site;
}

/** Calls `listener(paused, site)` whenever this process sees games pause or resume. */
function onGamesPausedChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** A `site.status` event from the market channel (published by any process or the release jobs). */
function applyEvent(site) {
  if (site && typeof site === "object" && site.maintenance && typeof site.maintenance === "object") remember(site);
}

// ── Reads and writes ─────────────────────────────────────────────────────────

async function getSiteState(db) {
  const { rows } = await db.query(`SELECT * FROM market.site_state WHERE id = 1`);
  return remember(toSite(rows[0]));
}

/**
 * Starts or ends maintenance. An admin can start or end any maintenance. A deploy only starts one
 * when none is on, and only ends its own.
 */
async function setMaintenance(db, { state, source, message = null }) {
  if (!STATES.has(state)) throw new Error(`invalid maintenance state: ${state}`);
  const guard = source === "deploy" ? (state === "off" ? "AND maintenance_source = 'deploy'" : "AND maintenance = 'off'") : "";
  const text = message ? String(message).trim().slice(0, 280) || null : null;
  const { rows } = await db.query(
    `
    UPDATE market.site_state
    SET maintenance = $1::text,
        maintenance_source = CASE WHEN $1::text = 'off' THEN NULL ELSE $2::text END,
        maintenance_message = CASE WHEN $1::text = 'off' THEN NULL ELSE $3::text END,
        maintenance_started_at = CASE WHEN $1::text = 'off' THEN NULL WHEN maintenance = 'off' THEN now() ELSE maintenance_started_at END,
        updated_at = now()
    WHERE id = 1 ${guard}
    RETURNING *
  `,
    [state, source, text]
  );
  return rows.length ? remember(toSite(rows[0])) : getSiteState(db);
}

/** Records the release that just went live (the deploy's last step). */
async function markReleased(db, version) {
  const { rows } = await db.query(
    `UPDATE market.site_state SET release_version = $1, released_at = now(), updated_at = now() WHERE id = 1 RETURNING *`,
    [String(version).slice(0, 80)]
  );
  return remember(toSite(rows[0]));
}

/** Tells every open page (over the market socket) and every API process. */
function publishSiteState(redis, site) {
  return publishMarketEvent(redis, { type: SITE_EVENT, site, at: new Date().toISOString() });
}

/**
 * Keeps this process's view fresh when it can't count on the socket event alone (the games process:
 * it must turn new games away within seconds of a drain starting). Returns a stop function.
 */
function startWatch(db, { intervalMs = 5000, logger = console } = {}) {
  let failing = false;
  const tick = async () => {
    try {
      await getSiteState(db);
      failing = false;
    } catch (error) {
      if (!failing) logger.warn?.("site state read failed", String(error?.message || error));
      failing = true;
    }
  };
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}

module.exports = {
  SITE_EVENT,
  applyEvent,
  gamesPaused,
  getSiteState,
  markReleased,
  onGamesPausedChange,
  publishSiteState,
  schema,
  setMaintenance,
  startWatch,
};
