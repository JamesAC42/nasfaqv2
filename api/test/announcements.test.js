const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { Pool } = require("pg");
const announcements = require("../src/services/announcements");
const siteState = require("../src/services/siteState");
const { blockSuspendedWrites } = require("../src/userContext");
const adminRoutes = require("../src/routes/admin");
const siteRoutes = require("../src/routes/site");

const good = (overrides = {}) => ({ title: "Hello", body: "Some news.", ...overrides });
const NOW = new Date("2026-11-02T12:00:00.000Z");
const plan = (overrides) => announcements.planAnnouncement(good(overrides), NOW);
const rejects = (overrides, field) => assert.throws(() => plan(overrides), { code: "invalid_announcement", field }, JSON.stringify(overrides));

/** An app with the admin and site routes behind `ctx` (a function of the request), as server.js has them. */
async function serve(t, ctx) {
  const app = express();
  app.use(async (req, _res, next) => {
    req.ctx = await ctx(req);
    next();
  });
  app.use(blockSuspendedWrites);
  app.use(express.json());
  app.use("/api/admin", adminRoutes);
  app.use("/api/site", siteRoutes);
  app.use((error, _req, res, _next) => {
    if (error?.code === "unauthenticated") return res.status(401).json({ error: error.code });
    if (error?.code === "forbidden") return res.status(403).json({ error: error.code });
    res.status(500).json({ error: String(error?.message || error) });
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => {
    server.closeAllConnections();
    return new Promise((resolve) => server.close(resolve));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return async (method, path, { body, as } = {}) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { ...(body ? { "content-type": "application/json" } : {}), ...(as ? { "x-test-user": String(as.id) } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
}

test("an announcement needs a title and text, within their limits", () => {
  const clean = plan();
  assert.equal(clean.title, "Hello");
  assert.equal(clean.audience, "everyone");
  assert.equal(clean.starts_at, NOW.toISOString());
  assert.equal(clean.ends_at, null);
  assert.equal(clean.button_label, null);
  assert.equal(clean.button_link, null);
  assert.equal(clean.hide_from_v1_linked, false);
  rejects({ title: "   " }, "title");
  rejects({ title: "x".repeat(121) }, "title");
  rejects({ body: "" }, "body");
  rejects({ body: "x".repeat(1001) }, "body");
  rejects({ audience: "admins" }, "audience");
});

test("markup in the text stays text: it's stored as written and never turned into HTML", () => {
  const markup = `<img src=x onerror="alert(1)"><script>alert(2)</script>`;
  const clean = plan({ title: `<b>Hi</b>`, body: markup });
  assert.equal(clean.title, "<b>Hi</b>");
  assert.equal(clean.body, markup);
});

test("line breaks in the text survive; other control characters don't", () => {
  assert.equal(plan({ body: "One\r\n\r\n\r\n\r\nTwo  words\tand\u0007 a bell  \nThree" }).body, "One\n\nTwo words and a bell\nThree");
  assert.equal(plan({ title: "Two\nlines\u0000here" }).title, "Two lines here");
  assert.equal(plan({ title: "Keep 👩‍💻 emoji" }).title, "Keep 👩‍💻 emoji");
});

test("the button needs a label and a link, and the link can only go somewhere safe", () => {
  const clean = plan({ button_label: " Link it ", button_link: " /link-v1 " });
  assert.equal(clean.button_label, "Link it");
  assert.equal(clean.button_link, "/link-v1");
  assert.equal(plan({ button_label: "Go", button_link: "https://example.com/a?b=c#d" }).button_link, "https://example.com/a?b=c#d");

  rejects({ button_label: "Go" }, "button_link");
  rejects({ button_link: "/link-v1" }, "button_label");
  rejects({ button_label: "x".repeat(41), button_link: "/a" }, "button_label");
  for (const link of [
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    " javascript:alert(1)",
    "java\tscript:alert(1)",
    "\u0001javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox(1)",
    "http://example.com",
    "//example.com",
    "/\\example.com",
    "/\t/example.com",
    "/\n/example.com",
    "/ /example.com",
    "https:\\\\example.com",
    "link-v1",
    `/${"x".repeat(300)}`,
  ]) {
    rejects({ button_label: "Go", button_link: link }, "button_link");
  }
});

test("the banner's link follows the same rule", () => {
  assert.equal(siteState.planAnnouncement({ text: "x", link: "/changelog" }).link, "/changelog");
  assert.throws(() => siteState.planAnnouncement({ text: "x", link: "/\t/example.com" }), { code: "invalid_announcement", field: "link" });
  assert.throws(() => siteState.planAnnouncement({ text: "x", link: "javascript:alert(1)" }), { code: "invalid_announcement", field: "link" });
});

test("times: a blank start is now, an end comes after the start, and nonsense is refused", () => {
  assert.equal(plan({ starts_at: "2026-12-01T05:00:00Z" }).starts_at, "2026-12-01T05:00:00.000Z");
  assert.equal(plan({ starts_at: "2026-12-01T05:00:00Z", ends_at: "2026-12-02T05:00:00Z" }).ends_at, "2026-12-02T05:00:00.000Z");
  assert.equal(plan({ ends_at: "" }).ends_at, null);
  rejects({ starts_at: "soon" }, "starts_at");
  rejects({ starts_at: 12345 }, "starts_at");
  rejects({ ends_at: "2026-13-45" }, "ends_at");
  rejects({ starts_at: "2026-12-02T00:00:00Z", ends_at: "2026-12-01T00:00:00Z" }, "ends_at");
  rejects({ starts_at: "2026-12-01T00:00:00Z", ends_at: "2026-12-01T00:00:00Z" }, "ends_at");
});

test("status follows the clock and retiring", () => {
  const now = NOW.getTime();
  const row = { starts_at: "2026-11-01T00:00:00Z", ends_at: "2026-11-03T00:00:00Z", retired_at: null };
  assert.equal(announcements.statusOf(row, now), "live");
  assert.equal(announcements.statusOf({ ...row, ends_at: null }, now), "live");
  assert.equal(announcements.statusOf({ ...row, starts_at: "2026-11-02T12:00:01Z" }, now), "scheduled");
  assert.equal(announcements.statusOf({ ...row, ends_at: "2026-11-02T12:00:00Z" }, now), "ended");
  assert.equal(announcements.statusOf({ ...row, retired_at: "2026-11-02T00:00:00Z" }, now), "retired");
});

test("each visitor only gets what's meant for them and still running", () => {
  const now = NOW.getTime();
  const row = (id, audience, extra = {}) => ({ id, audience, starts_at: "2026-11-01T00:00:00Z", ends_at: null, ...extra });
  const list = [row(1, "everyone"), row(2, "signed_in"), row(3, "signed_out"), row(4, "everyone", { ends_at: "2026-11-02T11:59:59Z" }), row(5, "everyone", { starts_at: "2026-11-03T00:00:00Z" })];
  const ids = (user) => announcements.forViewer(list, user, now).map((item) => item.id);
  assert.deepEqual(ids(null), [1, 3]);
  assert.deepEqual(ids({ id: 9 }), [1, 2]);
});

test("the public list is read once per CACHE_MS, however many visitors ask, and a bad read gives the last one", async () => {
  announcements.forgetLive();
  let reads = 0;
  let failing = false;
  const row = { id: "7", title: "T", body: "B", button_label: null, button_link: null, audience: "everyone", hide_from_v1_linked: false, starts_at: "2026-11-01T00:00:00Z", ends_at: null };
  const pool = {
    async query() {
      reads += 1;
      if (failing) throw new Error("database down");
      return { rows: [row] };
    },
  };
  const results = await Promise.all(Array.from({ length: 50 }, () => announcements.listLive(pool)));
  assert.equal(reads, 1);
  assert.deepEqual(results[49].map((item) => item.id), [7]);
  await announcements.listLive(pool);
  assert.equal(reads, 1);

  const later = () => Date.now() + announcements.CACHE_MS + 1;
  await announcements.listLive(pool, later());
  assert.equal(reads, 2);

  failing = true;
  const warn = console.warn;
  console.warn = () => {};
  try {
    assert.deepEqual((await announcements.listLive(pool, later())).map((item) => item.id), [7]);
    assert.equal(reads, 3);
    // It doesn't hammer a struggling database: the failed read counts as this period's read.
    await announcements.listLive(pool);
    assert.equal(reads, 3);
    // With nothing to fall back on, there's nothing to show.
    announcements.forgetLive();
    assert.deepEqual(await announcements.listLive(pool), []);
  } finally {
    console.warn = warn;
    announcements.forgetLive();
  }
});

test("admin routes: signed out 401, players 403, before any query; the public side doesn't let signed-out visitors write", async (t) => {
  const queries = [];
  const pool = {
    async query(sql) {
      queries.push(sql);
      return { rows: [], rowCount: 0 };
    },
    async connect() {
      throw new Error("no connection expected");
    },
  };
  let user = null;
  const call = await serve(t, () => ({ pool, redis: null, user }));
  const adminRequests = [
    ["GET", "/api/admin/announcements"],
    ["POST", "/api/admin/announcements", good()],
    ["PATCH", "/api/admin/announcements/1", { title: "x" }],
    ["POST", "/api/admin/announcements/1/retire", {}],
    ["POST", "/api/admin/announcements/1/restore", {}],
    ["DELETE", "/api/admin/announcements/1"],
  ];
  for (const [method, path, body] of adminRequests) assert.equal((await call(method, path, { body })).status, 401, `${method} ${path}`);
  assert.equal((await call("GET", "/api/site/announcements/me")).status, 401);
  assert.equal((await call("POST", "/api/site/announcements/dismiss", { body: { ids: [1] } })).status, 401);
  user = { id: 2, username: "pleb", is_admin: false, can_manage_assets: true };
  for (const [method, path, body] of adminRequests) assert.equal((await call(method, path, { body })).status, 403, `${method} ${path}`);
  assert.equal(queries.length, 0);

  // An admin's bad input is turned away before anything is written.
  user = { id: 1, username: "boss", is_admin: true };
  assert.deepEqual((await call("POST", "/api/admin/announcements", { body: good({ button_label: "Go", button_link: "javascript:alert(1)" }) })).body, { error: "invalid_announcement", field: "button_link" });
  assert.deepEqual((await call("PATCH", "/api/admin/announcements/abc", { body: { title: "x" } })).body, { error: "announcement_not_found" });
  assert.deepEqual((await call("POST", "/api/admin/announcements/-1/retire", { body: {} })).body, { error: "announcement_not_found" });
  assert.equal(queries.length, 0);

  // Dismissing checks its ids first too.
  for (const ids of [undefined, [], "1", [0], [-1], [1.5], ["1"], Array.from({ length: 51 }, (_, i) => i + 1)]) {
    assert.deepEqual((await call("POST", "/api/site/announcements/dismiss", { body: { ids } })).body, { error: "invalid_announcement_ids" }, JSON.stringify(ids));
  }
  assert.equal(queries.length, 0);
});

test("a suspended player can still close a popup, and nothing else here", async (t) => {
  const queries = [];
  const pool = {
    async query(sql) {
      queries.push(sql);
      return { rows: [], rowCount: 0 };
    },
  };
  const suspension = { reason: "x", since: "2026-11-01T00:00:00.000Z", until: null, permanent: true };
  const call = await serve(t, () => ({ pool, redis: null, user: { id: 7, username: "rrat", is_admin: true, suspension } }));
  assert.deepEqual((await call("POST", "/api/site/announcements/dismiss", { body: { ids: [1] } })).body, { ok: true });
  assert.equal(queries.length, 1);
  assert.equal((await call("POST", "/api/admin/announcements", { body: good() })).body.error, "account_suspended");
});

// End to end on a freshly migrated database of its own, from the local or CI test server.
const databaseUrl = process.env.CHAT_TEST_DATABASE_URL;

test("announcements end to end", { skip: !databaseUrl, timeout: 180_000 }, async (t) => {
  const target = new URL(databaseUrl);
  assert.ok(["127.0.0.1", "localhost"].includes(target.hostname));
  assert.equal(target.pathname, "/nasfaq_chat_test");
  const admin = new Pool({ connectionString: databaseUrl });
  try {
    await admin.query("DROP DATABASE IF EXISTS nasfaq_announcements_test WITH (FORCE)");
    await admin.query("CREATE DATABASE nasfaq_announcements_test");
  } finally {
    await admin.end();
  }
  target.pathname = "/nasfaq_announcements_test";
  const pool = new Pool({ connectionString: target.href });
  t.after(async () => {
    announcements.forgetLive();
    await new Promise((resolve) => setTimeout(resolve, 500));
    await pool.end();
  });
  const { applySchema } = require("../src/migrations");
  const migrate = async () => {
    const quiet = [console.warn, console.log, console.info];
    console.warn = console.log = console.info = () => {};
    try {
      await applySchema(pool);
    } finally {
      [console.warn, console.log, console.info] = quiet;
    }
  };
  await migrate();

  const addUser = async (username, { isAdmin = false } = {}) => {
    const { rows } = await pool.query(
      `INSERT INTO market.users (username, username_normalized, email, email_verified, password_hash, password_salt, password_params_json, is_admin)
       VALUES ($1, lower($1), $1 || '@example.test', true, 'x', 'x', '{}', $2) RETURNING id`,
      [username, isAdmin]
    );
    return { id: Number(rows[0].id), username, is_admin: isAdmin };
  };
  const boss = await addUser("boss", { isAdmin: true });
  const alice = await addUser("alice");
  const bob = await addUser("bob");
  const users = new Map([boss, alice, bob].map((user) => [String(user.id), user]));

  const call = await serve(t, (req) => ({ pool, redis: null, user: users.get(req.headers["x-test-user"]) ?? null }));
  const visible = async (as) => {
    const { status, body } = await call("GET", "/api/site", { as });
    assert.equal(status, 200);
    return body.announcements;
  };
  const logged = async (id) =>
    (await pool.query(`SELECT action, actor_id, target_type, target_label, details FROM market.admin_actions WHERE target_type = 'announcement' AND target_id = $1 ORDER BY id`, [String(id)])).rows;

  const seedId = (await visible(null))[0]?.id;

  await t.test("the first announcement is there after the migration, with the facts from /link-v1", async () => {
    const list = await visible(null);
    assert.equal(list.length, 1);
    const [seed] = list;
    assert.equal(seed.title, announcements.V1_LINK_SEED.title);
    assert.equal(seed.button_link, "/link-v1");
    assert.equal(seed.audience, "everyone");
    assert.equal(seed.hide_from_v1_linked, true);
    assert.match(seed.body, /v1 Veteran badge/);
    assert.match(seed.body, /year you joined/);
    assert.match(seed.body, /trophy/);
    assert.match(seed.body, /v1 Classic theme/);
    assert.match(seed.body, /October 1, 2026/);
    assert.match(seed.body, /nasfaq\.biz/);
    // It passes the same checks an admin's would, so saving it unedited works.
    assert.equal(announcements.planAnnouncement({ ...seed, starts_at: null }).body, seed.body);
    assert.deepEqual((await visible(alice)).map((item) => item.id), [seed.id]);
  });

  await t.test("running the migrations again adds nothing and leaves an admin's edits alone", async () => {
    await migrate();
    assert.equal((await pool.query(`SELECT count(*)::int AS n FROM market.announcements`)).rows[0].n, 1);
    const edited = await call("PATCH", `/api/admin/announcements/${seedId}`, { as: boss, body: { title: "Played v1?" } });
    assert.equal(edited.status, 200);
    assert.equal(edited.body.announcement.title, "Played v1?");
    assert.equal(edited.body.announcement.body, announcements.V1_LINK_SEED.body);
    await migrate();
    assert.equal((await visible(null))[0].title, "Played v1?");
    assert.deepEqual((await logged(seedId)).map((entry) => [entry.action, Number(entry.actor_id), entry.details.changed]), [["announcement.update", boss.id, ["title"]]]);
  });

  let scheduledId;
  await t.test("an admin creates one: it's logged, and shows from its start until its end", async () => {
    const start = new Date(Date.now() + 3_600_000).toISOString();
    const end = new Date(Date.now() + 7_200_000).toISOString();
    const made = await call("POST", "/api/admin/announcements", {
      as: boss,
      body: { title: "Coming up", body: "Line one\n\nLine two <b>not bold</b>", button_label: "See more", button_link: "/changelog", audience: "signed_in", starts_at: start, ends_at: end },
    });
    assert.equal(made.status, 201);
    const created = made.body.announcement;
    scheduledId = created.id;
    assert.equal(created.status, "scheduled");
    assert.equal(created.starts_at, start);
    assert.equal(created.ends_at, end);
    assert.deepEqual((await visible(alice)).map((item) => item.id), [seedId]);

    const entries = await logged(created.id);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].action, "announcement.create");
    assert.equal(Number(entries[0].actor_id), boss.id);
    assert.equal(entries[0].target_label, "Coming up");

    // Now running: signed-in players get it, oldest first; signed-out visitors don't.
    await call("PATCH", `/api/admin/announcements/${seedId}`, { as: boss, body: { starts_at: new Date(Date.now() - 86_400_000).toISOString() } });
    const running = await call("PATCH", `/api/admin/announcements/${created.id}`, { as: boss, body: { starts_at: new Date(Date.now() - 1000).toISOString() } });
    assert.equal(running.body.announcement.status, "live");
    assert.deepEqual((await visible(alice)).map((item) => item.id), [seedId, created.id]);
    assert.deepEqual((await visible(null)).map((item) => item.id), [seedId]);
    assert.equal((await visible(alice))[1].body, "Line one\n\nLine two <b>not bold</b>");

    const ended = await call("PATCH", `/api/admin/announcements/${created.id}`, { as: boss, body: { ends_at: new Date(Date.now() - 500).toISOString() } });
    assert.equal(ended.body.announcement.status, "ended");
    assert.deepEqual((await visible(alice)).map((item) => item.id), [seedId]);
    assert.deepEqual((await pool.query(`SELECT 1 FROM market.announcements WHERE id = $1`, [created.id])).rowCount, 1);
  });

  await t.test("a bad edit changes nothing", async () => {
    const before = (await call("GET", "/api/admin/announcements", { as: boss })).body.announcements.find((item) => item.id === seedId);
    const bad = await call("PATCH", `/api/admin/announcements/${seedId}`, { as: boss, body: { title: "New", button_link: "javascript:alert(1)" } });
    assert.deepEqual(bad.body, { error: "invalid_announcement", field: "button_link" });
    const after = (await call("GET", "/api/admin/announcements", { as: boss })).body.announcements.find((item) => item.id === seedId);
    assert.deepEqual(after, before);
    assert.equal((await call("PATCH", "/api/admin/announcements/999999", { as: boss, body: { title: "x" } })).status, 404);
  });

  await t.test("retiring takes it down at once and restoring puts it back, both logged", async () => {
    const retired = await call("POST", `/api/admin/announcements/${seedId}/retire`, { as: boss, body: {} });
    assert.equal(retired.body.announcement.status, "retired");
    assert.deepEqual(await visible(alice), []);
    const restored = await call("POST", `/api/admin/announcements/${seedId}/restore`, { as: boss, body: {} });
    assert.equal(restored.body.announcement.status, "live");
    assert.deepEqual((await visible(alice)).map((item) => item.id), [seedId]);
    const actions = (await logged(seedId)).map((entry) => entry.action);
    assert.deepEqual(actions.slice(-2), ["announcement.retire", "announcement.restore"]);
    assert.equal((await call("POST", "/api/admin/announcements/999999/retire", { as: boss, body: {} })).status, 404);
  });

  await t.test("a player's dismissal holds wherever they sign in, and only for them", async () => {
    const state = async (as) => (await call("GET", "/api/site/announcements/me", { as })).body;
    assert.deepEqual(await state(alice), { dismissed: [], v1_linked: false });
    assert.deepEqual((await call("POST", "/api/site/announcements/dismiss", { as: alice, body: { ids: [seedId] } })).body, { ok: true });
    assert.deepEqual((await state(alice)).dismissed, [seedId]);
    assert.deepEqual((await state(bob)).dismissed, []);

    // Twice is fine, and an id that doesn't exist is skipped along with the good ones.
    assert.equal((await call("POST", "/api/site/announcements/dismiss", { as: alice, body: { ids: [seedId, 999999] } })).status, 200);
    assert.deepEqual((await state(alice)).dismissed, [seedId]);

    // The public list stays the same for everyone: which ones to skip is the page's call.
    assert.deepEqual((await visible(alice)).map((item) => item.id), [seedId]);

    const list = (await call("GET", "/api/admin/announcements", { as: boss })).body.announcements;
    assert.equal(list.find((item) => item.id === seedId).dismissed_count, 1);
    assert.equal(list.find((item) => item.id === scheduledId).dismissed_count, 0);
    assert.equal(list.find((item) => item.id === seedId).status, "live");
  });

  await t.test("the page can tell a player who has already linked", async () => {
    await pool.query(`INSERT INTO market.v1_account_links (user_id, v1_user_id, v1_username, v1_joined_at) VALUES ($1, '4a8a7f7e-0d2b-4c55-9a11-111111111111', 'OldTimer', '2021-04-02T15:00:00Z')`, [bob.id]);
    assert.equal((await call("GET", "/api/site/announcements/me", { as: bob })).body.v1_linked, true);
    assert.equal((await call("GET", "/api/site/announcements/me", { as: alice })).body.v1_linked, false);
  });

  await t.test("deleting removes it with its dismissals, keeps the wording in the log, and the next deploy doesn't bring it back", async () => {
    const gone = await call("DELETE", `/api/admin/announcements/${seedId}`, { as: boss });
    assert.deepEqual(gone.body, { id: seedId });
    assert.deepEqual(await visible(null), []);
    assert.equal((await pool.query(`SELECT count(*)::int AS n FROM market.announcement_dismissals WHERE announcement_id = $1`, [seedId])).rows[0].n, 0);
    const last = (await logged(seedId)).at(-1);
    assert.equal(last.action, "announcement.delete");
    assert.equal(last.details.body, announcements.V1_LINK_SEED.body);
    assert.equal((await call("DELETE", `/api/admin/announcements/${seedId}`, { as: boss })).status, 404);

    await migrate();
    announcements.forgetLive();
    assert.deepEqual(await visible(null), []);
    assert.equal((await pool.query(`SELECT count(*)::int AS n FROM market.announcements WHERE title = $1 OR button_link = '/link-v1'`, [announcements.V1_LINK_SEED.title])).rows[0].n, 0);
  });

});
