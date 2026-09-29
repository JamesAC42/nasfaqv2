// Bug reports from the "Report a bug" button. Every report is kept (the admin overview lists them)
// and, when DISCORD_BUG_WEBHOOK_URL is set, posted to that Discord channel too. The page is kept
// without its query string (a verification link carries a token there), and a Discord post can
// never ping anyone, whatever the report says.

const MAX_MESSAGE = 2000;

const schema = `
  CREATE TABLE IF NOT EXISTS content.bug_reports (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NULL REFERENCES market.users(id) ON DELETE SET NULL,
    username TEXT NULL,
    message TEXT NOT NULL,
    page_path TEXT NULL,
    user_agent TEXT NULL,
    release_version TEXT NULL,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at TIMESTAMPTZ NULL,
    resolved_by BIGINT NULL
  );
  CREATE INDEX IF NOT EXISTS content_bug_reports_status_idx ON content.bug_reports (status, created_at DESC);
`;

function reportError(code) {
  return Object.assign(new Error(code), { code });
}

/** Just the path of the page the report came from: no host, query string or fragment. */
function pagePath(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  let path = text;
  try {
    path = new URL(text, "https://holo.nasfaq.biz").pathname;
  } catch {
    path = text.split(/[?#]/)[0];
  }
  return path.startsWith("/") ? path.slice(0, 200) : null;
}

/** A report ready to store, or throws invalid_report. */
function cleanReport({ message, page, userAgent, version }) {
  const text = String(message ?? "").replace(/\r\n/g, "\n").trim();
  if (text.length < 5) throw reportError("invalid_report");
  return {
    message: text.slice(0, MAX_MESSAGE),
    page_path: pagePath(page),
    user_agent: userAgent ? String(userAgent).slice(0, 300) : null,
    release_version: version ? String(version).slice(0, 80) : null,
  };
}

const toReport = (row) => ({
  id: Number(row.id),
  user_id: row.user_id === null ? null : Number(row.user_id),
  username: row.username ?? null,
  message: row.message,
  page_path: row.page_path ?? null,
  user_agent: row.user_agent ?? null,
  release_version: row.release_version ?? null,
  status: row.status,
  created_at: new Date(row.created_at).toISOString(),
  resolved_at: row.resolved_at ? new Date(row.resolved_at).toISOString() : null,
});

async function createReport(db, { user = null, ...input }) {
  const report = cleanReport(input);
  const { rows } = await db.query(
    `
    INSERT INTO content.bug_reports (user_id, username, message, page_path, user_agent, release_version)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING *
  `,
    [user?.id ?? null, user?.username ?? null, report.message, report.page_path, report.user_agent, report.release_version]
  );
  return toReport(rows[0]);
}

async function listReports(db, { status = "open", limit = 50 } = {}) {
  const safeStatus = status === "resolved" || status === "all" ? status : "open";
  const { rows } = await db.query(
    `
    SELECT * FROM content.bug_reports
    WHERE ($1 = 'all' OR status = $1)
    ORDER BY created_at DESC
    LIMIT $2
  `,
    [safeStatus, Math.min(200, Math.max(1, Number(limit) || 50))]
  );
  const { rows: counts } = await db.query(`SELECT COUNT(*) FILTER (WHERE status = 'open')::int AS open FROM content.bug_reports`);
  return { reports: rows.map(toReport), open_count: counts[0]?.open ?? 0 };
}

async function setResolved(db, id, { resolved, adminId }) {
  const { rows } = await db.query(
    `
    UPDATE content.bug_reports
    SET status = CASE WHEN $2 THEN 'resolved' ELSE 'open' END,
        resolved_at = CASE WHEN $2 THEN now() ELSE NULL END,
        resolved_by = CASE WHEN $2 THEN $3::bigint ELSE NULL END
    WHERE id = $1
    RETURNING *
  `,
    [id, Boolean(resolved), adminId ?? null]
  );
  if (!rows[0]) throw reportError("bug_report_not_found");
  return toReport(rows[0]);
}

/** The Discord webhook body for a report (an embed; mentions are switched off). */
function discordPayload(report, { siteUrl = "https://holo.nasfaq.biz" } = {}) {
  const fields = [
    { name: "From", value: report.username ? `[${report.username}](${siteUrl}/profile/${encodeURIComponent(report.username)})` : "Signed out", inline: true },
    { name: "Page", value: report.page_path ? `${siteUrl}${report.page_path}`.slice(0, 1024) : "Unknown", inline: true },
  ];
  if (report.release_version) fields.push({ name: "Version", value: report.release_version.slice(0, 1024), inline: true });
  if (report.user_agent) fields.push({ name: "Browser", value: report.user_agent.slice(0, 1024) });
  return {
    username: "NASFAQ bug reports",
    allowed_mentions: { parse: [] },
    embeds: [
      {
        title: `Bug report #${report.id}`,
        description: report.message.slice(0, 4000),
        color: 0xf5a623,
        fields,
        timestamp: report.created_at,
      },
    ],
  };
}

/** Posts the report to Discord if a webhook is set. Never throws; the report is saved either way. */
async function notifyDiscord(report, { url = process.env.DISCORD_BUG_WEBHOOK_URL, fetchImpl = fetch, logger = console } = {}) {
  if (!url) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(discordPayload(report)),
      signal: controller.signal,
    });
    if (!response.ok) logger.warn?.(`bug report #${report.id}: Discord answered ${response.status}`);
    return response.ok;
  } catch (error) {
    // Never log the URL: the webhook's token is in it.
    logger.warn?.(`bug report #${report.id}: Discord post failed (${error?.name === "AbortError" ? "timeout" : "network"})`);
    return false;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { MAX_MESSAGE, cleanReport, createReport, discordPayload, listReports, notifyDiscord, pagePath, schema, setResolved };
