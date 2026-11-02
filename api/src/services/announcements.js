// Announcement popups: a title, some text and maybe a button, shown to each visitor once while they
// run (app-client components/common/announcement-popup.tsx). The banner under the header is a
// different thing: one line for what everyone should know right now (services/siteState.js).
//
// Admins write, schedule and retire them on /admin/announcements (routes/admin.js), and each change
// goes in the admin log. /api/site hands out the running ones from a list each process keeps for
// CACHE_MS, so a visitor costs no query of their own. A signed-in player's dismissals are stored
// here so they hold on other devices; a signed-out visitor's stay in their browser. Tables and the
// first announcement are in migrations.js.

const moderation = require("./moderation");
const { safeLink } = require("./siteState");

const CACHE_MS = 30_000;
const AUDIENCES = new Set(["everyone", "signed_in", "signed_out"]);
const TITLE_MAX = 120;
const BODY_MAX = 1000;
const BUTTON_LABEL_MAX = 40;
const DISMISS_BATCH_MAX = 50;
const ADMIN_LIST_MAX = 200;

/** The first announcement, added once by migrations.js. */
const V1_LINK_SEED = {
  key: "v1-link",
  title: "Played the original NASFAQ?",
  body: "Link your old account and bring your history with you. You get a v1 Veteran badge with the year you joined, a trophy on your profile with your v1 stats, and the v1 Classic theme, so your profile looks like the old site.\n\nPress the button, sign in here if you need to, then confirm on nasfaq.biz. It works for v1 accounts made before October 1, 2026.",
  button_label: "Link my v1 account",
  button_link: "/link-v1",
  audience: "everyone",
  hide_from_v1_linked: true,
};

function announcementError(code, field) {
  const error = new Error(code);
  error.code = code;
  if (field !== undefined) error.field = field;
  return error;
}

const iso = (value) => (value ? new Date(value).toISOString() : null);
const blank = (value) => value === undefined || value === null || value === "";

/** One line: no control characters, runs of spaces closed up. */
const oneLine = (value) => String(value ?? "").replace(/[\p{Cc}\s]+/gu, " ").trim();

/** Paragraphs: line breaks kept (at most one blank line in a row), other control characters gone. */
function paragraphs(value) {
  return String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[^\P{Cc}\n]/gu, " ")
    .replace(/[^\S\n]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function parseTime(value, field) {
  if (typeof value !== "string" && !(value instanceof Date)) throw announcementError("invalid_announcement", field);
  const time = new Date(value);
  if (Number.isNaN(time.getTime())) throw announcementError("invalid_announcement", field);
  return time.toISOString();
}

/**
 * Checks what an admin wrote: { title (1-120), body (1-1000), button_label + button_link (both or
 * neither; the link is a path here or an https URL), audience, hide_from_v1_linked, starts_at (blank
 * is now), ends_at (blank is no end) }. The text is plain and React escapes it where it's shown, so
 * markup in it stays visible text. Returns the cleaned values or throws invalid_announcement with
 * the field.
 */
function planAnnouncement(body, now = new Date()) {
  const title = oneLine(body?.title);
  if (!title || title.length > TITLE_MAX) throw announcementError("invalid_announcement", "title");
  const text = paragraphs(body?.body);
  if (!text || text.length > BODY_MAX) throw announcementError("invalid_announcement", "body");

  const buttonLabel = oneLine(body?.button_label);
  const rawLink = String(body?.button_link ?? "").trim();
  if (buttonLabel.length > BUTTON_LABEL_MAX || (rawLink && !buttonLabel)) throw announcementError("invalid_announcement", "button_label");
  const buttonLink = rawLink ? safeLink(rawLink) : null;
  if ((rawLink && !buttonLink) || (buttonLabel && !rawLink)) throw announcementError("invalid_announcement", "button_link");

  const audience = blank(body?.audience) ? "everyone" : String(body.audience);
  if (!AUDIENCES.has(audience)) throw announcementError("invalid_announcement", "audience");

  const startsAt = blank(body?.starts_at) ? new Date(now).toISOString() : parseTime(body.starts_at, "starts_at");
  const endsAt = blank(body?.ends_at) ? null : parseTime(body.ends_at, "ends_at");
  if (endsAt && Date.parse(endsAt) <= Date.parse(startsAt)) throw announcementError("invalid_announcement", "ends_at");

  return {
    title,
    body: text,
    button_label: buttonLabel || null,
    button_link: buttonLink,
    audience,
    hide_from_v1_linked: Boolean(body?.hide_from_v1_linked),
    starts_at: startsAt,
    ends_at: endsAt,
  };
}

function isRunning(row, now = Date.now()) {
  if (row.retired_at) return false;
  if (new Date(row.starts_at).getTime() > now) return false;
  return !row.ends_at || new Date(row.ends_at).getTime() > now;
}

/** "retired", "scheduled", "ended" or "live", as the admin page shows it. */
function statusOf(row, now = Date.now()) {
  if (row.retired_at) return "retired";
  if (new Date(row.starts_at).getTime() > now) return "scheduled";
  return isRunning(row, now) ? "live" : "ended";
}

/** What visitors get. */
const toPublic = (row) => ({
  id: Number(row.id),
  title: row.title,
  body: row.body,
  button_label: row.button_label,
  button_link: row.button_link,
  audience: row.audience,
  hide_from_v1_linked: row.hide_from_v1_linked,
  starts_at: iso(row.starts_at),
  ends_at: iso(row.ends_at),
});

const toAdmin = (row, now = Date.now()) => ({
  ...toPublic(row),
  status: statusOf(row, now),
  retired_at: iso(row.retired_at),
  dismissed_count: Number(row.dismissed_count ?? 0),
  created_by: row.created_by_username ?? null,
  created_at: iso(row.created_at),
  updated_at: iso(row.updated_at),
});

// ── What visitors read ───────────────────────────────────────────────────────

let cache = null; // { at, list }
let loading = null;

function forgetLive() {
  cache = null;
  loading = null;
}

async function readLive(db) {
  const { rows } = await db.query(
    `SELECT id, title, body, button_label, button_link, audience, hide_from_v1_linked, starts_at, ends_at
     FROM market.announcements
     WHERE retired_at IS NULL AND starts_at <= now() AND (ends_at IS NULL OR ends_at > now())
     ORDER BY starts_at, id
     LIMIT 20`
  );
  return rows.map(toPublic);
}

/**
 * Everything running, oldest first, from this process's copy. It never throws: /api/site also says
 * whether a release is out and must answer even if this can't, so a failed read gives the last list.
 */
async function listLive(db, now = Date.now()) {
  if (cache && now - cache.at < CACHE_MS) return cache.list;
  if (!loading) {
    loading = readLive(db)
      .then((list) => {
        cache = { at: Date.now(), list };
        return list;
      })
      .catch((error) => {
        // eslint-disable-next-line no-console
        console.warn("announcements read failed:", String(error?.message || error));
        // Don't ask again for each visitor while the database is unhappy.
        cache = { at: Date.now(), list: cache?.list ?? [] };
        return cache.list;
      })
      .finally(() => {
        loading = null;
      });
  }
  return loading;
}

/** The ones this visitor may see: still running (the list can be up to CACHE_MS old) and meant for them. */
function forViewer(list, user, now = Date.now()) {
  const audience = user?.id ? "signed_in" : "signed_out";
  return list.filter((item) => (item.audience === "everyone" || item.audience === audience) && isRunning(item, now));
}

// ── A signed-in player's own state ───────────────────────────────────────────

/** Which announcements this player has dismissed anywhere, and whether they've linked a v1 account. */
async function viewerState(db, userId) {
  const { rows } = await db.query(
    `SELECT
       ARRAY(SELECT announcement_id FROM market.announcement_dismissals WHERE user_id = $1) AS dismissed,
       EXISTS (SELECT 1 FROM market.v1_account_links WHERE user_id = $1) AS v1_linked`,
    [userId]
  );
  return { dismissed: (rows[0]?.dismissed ?? []).map(Number), v1_linked: Boolean(rows[0]?.v1_linked) };
}

/** Records dismissals; saying so twice is fine, and ids that don't exist are skipped. */
async function dismiss(db, userId, ids) {
  const valid = Array.isArray(ids) && ids.length > 0 && ids.length <= DISMISS_BATCH_MAX && ids.every((id) => Number.isSafeInteger(id) && id > 0);
  if (!valid) throw announcementError("invalid_announcement_ids");
  await db.query(
    `INSERT INTO market.announcement_dismissals (user_id, announcement_id)
     SELECT $1::bigint, a.id FROM market.announcements a WHERE a.id = ANY($2::bigint[])
     ON CONFLICT DO NOTHING`,
    [userId, ids]
  );
}

// ── The admin side ───────────────────────────────────────────────────────────

const COLUMNS = ["title", "body", "button_label", "button_link", "audience", "hide_from_v1_linked", "starts_at", "ends_at"];

function announcementId(value) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw announcementError("announcement_not_found");
  return id;
}

async function listForAdmin(db) {
  const { rows } = await db.query(
    `SELECT a.*, u.username AS created_by_username,
       (SELECT count(*) FROM market.announcement_dismissals d WHERE d.announcement_id = a.id) AS dismissed_count
     FROM market.announcements a
     LEFT JOIN market.users u ON u.id = a.created_by
     ORDER BY a.starts_at DESC, a.id DESC
     LIMIT ${ADMIN_LIST_MAX}`
  );
  return rows.map((row) => toAdmin(row));
}

async function inTransaction(pool, work) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    forgetLive();
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

const logChange = (client, actor, action, row, details = {}) =>
  moderation.logAction(client, { actor, action, targetType: "announcement", targetId: row.id, targetLabel: row.title, details });

async function create(pool, actor, body) {
  const plan = planAnnouncement(body);
  return inTransaction(pool, async (client) => {
    const { rows } = await client.query(
      `INSERT INTO market.announcements (${COLUMNS.join(", ")}, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [...COLUMNS.map((column) => plan[column]), actor.id]
    );
    await logChange(client, actor, "announcement.create", rows[0], { audience: plan.audience, starts_at: plan.starts_at, ends_at: plan.ends_at });
    return toAdmin(rows[0]);
  });
}

async function update(pool, actor, rawId, body) {
  const id = announcementId(rawId);
  return inTransaction(pool, async (client) => {
    const { rows: found } = await client.query(`SELECT * FROM market.announcements WHERE id = $1 FOR UPDATE`, [id]);
    const current = found[0];
    if (!current) throw announcementError("announcement_not_found");
    // Only what the request names changes; a blank start still means now, like when creating.
    const merged = {};
    for (const column of COLUMNS) merged[column] = body && column in body ? body[column] : current[column];
    const plan = planAnnouncement(merged);
    const changed = COLUMNS.filter((column) => {
      const before = current[column] instanceof Date ? current[column].toISOString() : current[column];
      return before !== plan[column];
    });
    const { rows } = await client.query(
      `UPDATE market.announcements
       SET title = $1, body = $2, button_label = $3, button_link = $4, audience = $5, hide_from_v1_linked = $6, starts_at = $7, ends_at = $8, updated_at = now()
       WHERE id = $9
       RETURNING *`,
      [...COLUMNS.map((column) => plan[column]), id]
    );
    await logChange(client, actor, "announcement.update", rows[0], { changed });
    return toAdmin(rows[0]);
  });
}

/** Takes it down now and keeps the row (`retired: true`), or brings a retired one back. */
async function setRetired(pool, actor, rawId, retired) {
  const id = announcementId(rawId);
  return inTransaction(pool, async (client) => {
    const { rows } = await client.query(
      `UPDATE market.announcements
       SET retired_at = CASE WHEN $2::boolean THEN COALESCE(retired_at, now()) END, updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [id, Boolean(retired)]
    );
    if (!rows[0]) throw announcementError("announcement_not_found");
    await logChange(client, actor, retired ? "announcement.retire" : "announcement.restore", rows[0]);
    return toAdmin(rows[0]);
  });
}

/** Removes it for good, with its dismissals. The log keeps the wording. */
async function remove(pool, actor, rawId) {
  const id = announcementId(rawId);
  return inTransaction(pool, async (client) => {
    const { rows } = await client.query(`DELETE FROM market.announcements WHERE id = $1 RETURNING *`, [id]);
    if (!rows[0]) throw announcementError("announcement_not_found");
    const { title, body, button_label, button_link, audience } = rows[0];
    await logChange(client, actor, "announcement.delete", rows[0], { title, body, button_label, button_link, audience });
    return { id };
  });
}

module.exports = {
  CACHE_MS,
  V1_LINK_SEED,
  create,
  dismiss,
  forViewer,
  forgetLive,
  listForAdmin,
  listLive,
  planAnnouncement,
  remove,
  setRetired,
  statusOf,
  update,
  viewerState,
};
