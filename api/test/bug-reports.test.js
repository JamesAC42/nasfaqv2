const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { Pool } = require("pg");
const bugReports = require("../src/services/bugReports");
const internalSite = require("../src/routes/internalSite");

test("reports keep the page's path only, and need a few words", () => {
  const report = bugReports.cleanReport({ message: "  The buy button does nothing \r\n on KNR  ", page: "https://holo.nasfaq.biz/verify-email?token=secret#top", userAgent: "UA", version: "sha-1" });
  assert.equal(report.message, "The buy button does nothing \n on KNR");
  assert.equal(report.page_path, "/verify-email");
  assert.equal(bugReports.pagePath("/stocks/KNR?tab=dividends"), "/stocks/KNR");
  assert.equal(bugReports.pagePath(""), null);
  assert.throws(() => bugReports.cleanReport({ message: "hi" }), { code: "invalid_report" });
  assert.equal(bugReports.cleanReport({ message: "x".repeat(5000) }).message.length, bugReports.MAX_MESSAGE);
});

const sample = { id: 7, username: "pekofan", message: "@everyone the chart is blank", page_path: "/stocks/PEK", user_agent: "Firefox", release_version: "sha-abc", created_at: "2026-09-29T20:00:00.000Z" };

test("the Discord post is an embed that can't ping anyone", () => {
  const body = bugReports.discordPayload(sample);
  assert.deepEqual(body.allowed_mentions, { parse: [] });
  assert.equal(body.embeds[0].title, "Bug report #7");
  assert.equal(body.embeds[0].description, "@everyone the chart is blank");
  assert.deepEqual(body.embeds[0].fields.map((field) => field.name), ["From", "Page", "Version", "Browser"]);
  assert.equal(bugReports.discordPayload({ ...sample, username: null }).embeds[0].fields[0].value, "Signed out");
});

test("Discord gets the report when a webhook is set, and failures never leak the URL", async () => {
  const url = "https://discord.com/api/webhooks/1/token-secret";
  const calls = [];
  assert.equal(await bugReports.notifyDiscord(sample, { url, fetchImpl: async (to, init) => (calls.push([to, JSON.parse(init.body)]), { ok: true }) }), true);
  assert.equal(calls[0][0], url);
  assert.equal(calls[0][1].embeds[0].title, "Bug report #7");

  assert.equal(await bugReports.notifyDiscord(sample, { url: "", fetchImpl: async () => assert.fail("no webhook, no post") }), false);

  const logged = [];
  const logger = { warn: (...args) => logged.push(args.join(" ")) };
  assert.equal(await bugReports.notifyDiscord(sample, { url, logger, fetchImpl: async () => { throw new Error(`connect failed to ${url}`); } }), false);
  assert.equal(await bugReports.notifyDiscord(sample, { url, logger, fetchImpl: async () => ({ ok: false, status: 404 }) }), false);
  assert.equal(logged.length, 2);
  assert.ok(logged.every((line) => !line.includes("token-secret")));
});

async function call(user, method, path, body) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.ctx = { pool: null, redis: null, user };
    next();
  });
  app.use("/internal/site", internalSite);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}/internal/site${path}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    return res.status;
  } finally {
    server.close();
  }
}

test("the bug report list and resolving are admin only", async () => {
  for (const [method, path] of [["GET", "/bug-reports"], ["POST", "/bug-reports/1/resolve"]]) {
    assert.equal(await call(null, method, path), 401);
    assert.equal(await call({ id: 5, is_admin: false }, method, path), 403);
  }
  assert.equal(await call({ id: 1, is_admin: true }, "POST", "/bug-reports/abc/resolve", {}), 400);
});

// Against a real database when CI provides one: its own, so the users stub can't collide with the
// chat retention test's.
const databaseUrl = process.env.CHAT_TEST_DATABASE_URL;
test("bug reports against PostgreSQL", { skip: !databaseUrl }, async (t) => {
  const target = new URL(databaseUrl);
  assert.ok(["127.0.0.1", "localhost"].includes(target.hostname));
  assert.equal(target.pathname, "/nasfaq_chat_test");
  const admin = new Pool({ connectionString: databaseUrl });
  try {
    await admin.query("CREATE DATABASE nasfaq_site_test");
  } catch (error) {
    if (error.code !== "42P04") throw error;
  } finally {
    await admin.end();
  }
  target.pathname = "/nasfaq_site_test";
  const pool = new Pool({ connectionString: target.href });
  t.after(() => pool.end());
  await pool.query(`
    CREATE SCHEMA IF NOT EXISTS market;
    CREATE SCHEMA IF NOT EXISTS content;
    DROP TABLE IF EXISTS content.bug_reports;
    CREATE TABLE IF NOT EXISTS market.users (id bigint PRIMARY KEY, username text);
    INSERT INTO market.users (id, username) VALUES (3, 'pekofan') ON CONFLICT DO NOTHING;
  `);
  await pool.query(bugReports.schema);

  const first = await bugReports.createReport(pool, { user: { id: 3, username: "pekofan" }, message: "Chart is blank on PEK", page: "/stocks/PEK?x=1" });
  const second = await bugReports.createReport(pool, { message: "Can't sign in on Safari", page: "/login" });
  assert.deepEqual([first.username, first.page_path, first.status], ["pekofan", "/stocks/PEK", "open"]);
  assert.equal(second.user_id, null);

  let list = await bugReports.listReports(pool);
  assert.deepEqual(list.reports.map((report) => report.id), [second.id, first.id]);
  assert.equal(list.open_count, 2);

  const done = await bugReports.setResolved(pool, first.id, { resolved: true, adminId: 3 });
  assert.equal(done.status, "resolved");
  assert.ok(done.resolved_at);
  list = await bugReports.listReports(pool);
  assert.deepEqual([list.reports.map((report) => report.id), list.open_count], [[second.id], 1]);
  assert.deepEqual((await bugReports.listReports(pool, { status: "resolved" })).reports.map((report) => report.id), [first.id]);

  assert.equal((await bugReports.setResolved(pool, first.id, { resolved: false })).status, "open");
  await assert.rejects(bugReports.setResolved(pool, 999999, { resolved: true }), { code: "bug_report_not_found" });
});
