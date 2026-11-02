// Site-wide state every page shows: which release is live, maintenance, and an admin's announcement.
//
// Maintenance pauses new games. Game tables live in the api-games process's memory and a restart
// refunds whatever is unfinished, so before a release restarts it the deploy "drains": new games are
// turned away and the ones in play finish (scripts/maintenance.js, run by deploy/release.sh). An
// admin can also turn maintenance on by hand, with a message for players. A deploy never overrides
// or ends an admin's maintenance. Trading has its own pause (marketState) and isn't touched here.
//
// The announcement is a line of text (info or warning, with an optional link and end time) that
// every page shows under the header until it's cleared or runs out; players can wave each one off.
// Its columns are added in migrations.js.

const { publishMarketEvent } = require("./marketEvents");

const STATES = new Set(["off", "draining", "on"]);
const SITE_EVENT = "site.status";
const ANNOUNCEMENT_TONES = new Set(["info", "warning"]);
const ANNOUNCEMENT_MAX = 280;
const ANNOUNCEMENT_MAX_HOURS = 24 * 30;

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

/** The announcement in force, or null (none, or it ran out). `id` tells one post from the next. */
function toAnnouncement(row, now = Date.now()) {
  if (!row?.announcement_text || !row.announcement_posted_at) return null;
  if (row.announcement_expires_at && new Date(row.announcement_expires_at).getTime() <= now) return null;
  return {
    id: iso(row.announcement_posted_at),
    text: row.announcement_text,
    tone: ANNOUNCEMENT_TONES.has(row.announcement_tone) ? row.announcement_tone : "info",
    link: row.announcement_link || null,
    expires_at: iso(row.announcement_expires_at),
    posted_at: iso(row.announcement_posted_at),
  };
}

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
    announcement: toAnnouncement(row),
  };
}

function announcementError(field) {
  const error = new Error("invalid_announcement");
  error.code = "invalid_announcement";
  error.field = field;
  return error;
}

/**
 * A link an admin may post: a path on this site or an https URL, up to 300 characters. Anything else
 * is null: javascript: and other schemes, //elsewhere, and spaces or control characters, which
 * browsers drop from an address (so "/<tab>/elsewhere" would leave the site).
 */
function safeLink(value) {
  const link = String(value ?? "");
  if (!link || link.length > 300 || /[\s\p{Cc}\p{Cf}\\]/u.test(link)) return null;
  if (link.startsWith("/")) return link.startsWith("//") ? null : link;
  try {
    return new URL(link).protocol === "https:" ? link : null;
  } catch {
    return null;
  }
}

/**
 * Checks an admin's announcement: { text (1-280), tone ("info" | "warning"), link (a path on the
 * site or an https URL, optional), expires_in_hours (1-720, optional: none means until cleared) }.
 * Returns the cleaned values or throws invalid_announcement with the field.
 */
function planAnnouncement(body) {
  const text = String(body?.text ?? "").replace(/\s+/g, " ").trim();
  if (!text || text.length > ANNOUNCEMENT_MAX) throw announcementError("text");
  const tone = body?.tone === undefined || body?.tone === null || body?.tone === "" ? "info" : String(body.tone);
  if (!ANNOUNCEMENT_TONES.has(tone)) throw announcementError("tone");
  const rawLink = String(body?.link ?? "").trim();
  let link = null;
  if (rawLink) {
    link = safeLink(rawLink);
    if (!link) throw announcementError("link");
  }
  let expiresInHours = null;
  if (body?.expires_in_hours !== undefined && body?.expires_in_hours !== null && body?.expires_in_hours !== "") {
    expiresInHours = Number(body.expires_in_hours);
    if (!Number.isFinite(expiresInHours) || expiresInHours <= 0 || expiresInHours > ANNOUNCEMENT_MAX_HOURS) throw announcementError("expires_in_hours");
  }
  return { text, tone, link, expiresInHours };
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

/** Posts the announcement (replacing any other), or clears it with `null`. Returns the site state. */
async function setAnnouncement(db, announcement) {
  const plan = announcement ? planAnnouncement(announcement) : null;
  const { rows } = await db.query(
    `
    UPDATE market.site_state
    SET announcement_text = $1::text,
        announcement_tone = $2::text,
        announcement_link = $3::text,
        announcement_expires_at = CASE WHEN $4::float8 IS NULL THEN NULL ELSE now() + make_interval(secs => $4::float8 * 3600) END,
        announcement_posted_at = CASE WHEN $1::text IS NULL THEN NULL ELSE now() END,
        updated_at = now()
    WHERE id = 1
    RETURNING *
  `,
    [plan?.text ?? null, plan?.tone ?? null, plan?.link ?? null, plan?.expiresInHours ?? null]
  );
  return remember(toSite(rows[0]));
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
  planAnnouncement,
  publishSiteState,
  safeLink,
  schema,
  setAnnouncement,
  setMaintenance,
  startWatch,
  toAnnouncement,
};
