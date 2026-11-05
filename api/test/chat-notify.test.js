const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { Pool } = require("pg");
const chatDb = require("../src/chatDb");
const { applySchema } = require("../src/migrations");
const { router } = require("../src/routes/chat");
const chatNotify = require("../src/services/chatNotify");
const notifications = require("../src/services/notifications");
const { blockSuspendedWrites } = require("../src/userContext");

// On a freshly migrated database of its own, from the local or CI test server.
const databaseUrl = process.env.CHAT_TEST_DATABASE_URL;

async function setup(t) {
  const target = new URL(databaseUrl);
  assert.ok(["127.0.0.1", "localhost"].includes(target.hostname));
  assert.equal(target.pathname, "/nasfaq_chat_test");
  const admin = new Pool({ connectionString: databaseUrl });
  try {
    await admin.query("DROP DATABASE IF EXISTS nasfaq_chat_notify_test WITH (FORCE)");
    await admin.query("CREATE DATABASE nasfaq_chat_notify_test");
  } finally {
    await admin.end();
  }
  target.pathname = "/nasfaq_chat_notify_test";
  const pool = new Pool({ connectionString: target.href });
  t.after(async () => {
    // notify() pushes to the bell a moment after it commits.
    await new Promise((resolve) => setTimeout(resolve, 500));
    await pool.end();
  });
  const quiet = [console.warn, console.log, console.info];
  console.warn = console.log = console.info = () => {};
  try {
    await applySchema(pool);
  } finally {
    [console.warn, console.log, console.info] = quiet;
  }
  let seq = 0;
  async function makeUser(name) {
    seq += 1;
    const username = `${name}${seq}`;
    const { rows } = await pool.query(
      `INSERT INTO market.users (username, username_normalized, email, email_verified, password_hash, password_salt, password_params_json)
       VALUES ($1, lower($1), $1 || '@example.test', true, 'x', 'x', '{}') RETURNING id`,
      [username]
    );
    return Number(rows[0].id);
  }
  async function makeRoom(name) {
    seq += 1;
    const scopeKey = `${name}-${seq}`;
    const { rows } = await pool.query(`INSERT INTO chat.channels (scope_type, scope_key, display_name, posting_policy) VALUES ('unit', $1, $2, 'authenticated') RETURNING id`, [scopeKey, name]);
    return { id: Number(rows[0].id), key: `unit:${scopeKey}` };
  }
  async function post(channelId, authorId, body = "hello", createdAt = "now()") {
    const { rows } = await pool.query(`INSERT INTO chat.messages (channel_id, author_id, body, status, created_at) VALUES ($1, $2, $3, 'active', ${createdAt}) RETURNING id`, [channelId, authorId, body]);
    return Number(rows[0].id);
  }
  return { pool, makeUser, makeRoom, post };
}

const roomOf = (settings, key) => settings.rooms.find((room) => room.channel_key === key);

test("chat popups against PostgreSQL", { skip: !databaseUrl, timeout: 180_000 }, async (t) => {
  const { pool, makeUser, makeRoom, post } = await setup(t);

  await t.test("settings: chosen rooms, rooms you posted in, turning one off, and the overall switch", async () => {
  const me = await makeUser("reader");
  const other = await makeUser("talker");
  const posted = await makeRoom("posted");
  const chosen = await makeRoom("chosen");
  const stale = await makeRoom("stale");
  const untouched = await makeRoom("untouched");

  await post(posted.id, me);
  await post(stale.id, me, "old", `now() - interval '${chatNotify.POSTED_WINDOW_DAYS + 1} days'`);
  // A room the chat page can't open never makes the list, posted in or not.
  const { rows: metaRows } = await pool.query(`INSERT INTO chat.channels (scope_type, scope_key, display_name, posting_policy) VALUES ('meta', 'global', 'Meta', 'authenticated') ON CONFLICT (scope_type, scope_key) DO UPDATE SET is_active = true RETURNING id`);
  await post(Number(metaRows[0].id), me, "in the meta room");
  await post(chosen.id, other, "before you chose it");
  await post(untouched.id, other);
  await chatNotify.setRoom(pool, me, chosen.id, true);

  let settings = await chatNotify.getSettings(pool, me);
  assert.equal(settings.enabled, true, "on until turned off");
  assert.deepEqual(
    settings.rooms.map((room) => room.channel_key).sort(),
    [posted.key, chosen.key].sort(),
    "a room you posted in a while ago, or never touched, isn't on the list"
  );
  assert.equal(roomOf(settings, posted.key).posted, true);
  assert.equal(roomOf(settings, posted.key).notify, null);
  assert.equal(roomOf(settings, chosen.key).notify, true);
  assert.equal(roomOf(settings, chosen.key).unread, 0, "choosing a room doesn't open at everything it ever said");

  await post(chosen.id, other, "after");
  await post(posted.id, other, "after");
  await post(posted.id, me, "your own doesn't count");
  settings = await chatNotify.getSettings(pool, me);
  assert.equal(roomOf(settings, chosen.key).unread, 1);
  assert.equal(roomOf(settings, posted.key).unread, 1);

  // Off sticks, even after posting there again, and an off room doesn't count unread.
  await chatNotify.setRoom(pool, me, posted.id, false);
  await post(posted.id, me, "still off");
  await post(posted.id, other, "not counted");
  settings = await chatNotify.getSettings(pool, me);
  assert.equal(roomOf(settings, posted.key).notify, false);
  assert.equal(roomOf(settings, posted.key).unread, 0);

  // Back on: unread starts from there, not from whenever you last read it.
  await chatNotify.setRoom(pool, me, posted.id, true);
  settings = await chatNotify.getSettings(pool, me);
  assert.equal(roomOf(settings, posted.key).notify, true);
  assert.equal(roomOf(settings, posted.key).unread, 0);

  // null puts it back to the default: on, because they posted there.
  await chatNotify.setRoom(pool, me, posted.id, null);
  settings = await chatNotify.getSettings(pool, me);
  assert.equal(roomOf(settings, posted.key).notify, null);
  assert.equal(roomOf(settings, posted.key).posted, true);

  await chatNotify.setEnabled(pool, me, false);
  assert.equal((await chatNotify.getSettings(pool, me)).enabled, false);
  await chatNotify.setEnabled(pool, me, true);
  assert.equal((await chatNotify.getSettings(pool, me)).enabled, true);

  await assert.rejects(chatNotify.setEnabled(pool, me, "yes"), { code: "invalid_chat_notify" });
  await assert.rejects(chatNotify.setRoom(pool, me, posted.id, "on"), { code: "invalid_chat_notify" });
  });

  await t.test("unread stops counting at the cap", async () => {
  const me = await makeUser("reader");
  const other = await makeUser("talker");
  const room = await makeRoom("busy");
  await chatNotify.setRoom(pool, me, room.id, true);
  await pool.query(`INSERT INTO chat.messages (channel_id, author_id, body, status) SELECT $1, $2, 'x', 'active' FROM generate_series(1, $3::int)`, [room.id, other, chatNotify.UNREAD_CAP + 20]);
  const settings = await chatNotify.getSettings(pool, me);
  assert.equal(roomOf(settings, room.key).unread, chatNotify.UNREAD_CAP);
  });

  await t.test("muting: their messages don't count, and their mentions and replies don't ring the bell", async () => {
  const me = await makeUser("reader");
  const pest = await makeUser("pest");
  const friend = await makeUser("friend");
  const room = await makeRoom("muted-room");
  await chatNotify.setRoom(pool, me, room.id, true);

  await chatNotify.mutePlayer(pool, me, pest);
  await chatNotify.mutePlayer(pool, me, pest); // twice is fine
  await post(room.id, pest, "ignored");
  await post(room.id, friend, "counted");
  let settings = await chatNotify.getSettings(pool, me);
  assert.equal(roomOf(settings, room.key).unread, 1);
  assert.deepEqual(settings.muted_players.map((player) => player.id), [pest]);

  await assert.rejects(chatNotify.mutePlayer(pool, me, me), { code: "invalid_chat_notify" });
  await assert.rejects(chatNotify.mutePlayer(pool, me, 999999999), { code: "chat_player_not_found" });

  const { rows: names } = await pool.query(`SELECT id, username FROM market.users WHERE id = ANY($1::bigint[])`, [[me, pest, friend]]);
  const nameOf = new Map(names.map((row) => [Number(row.id), row.username]));
  const mineBefore = await pool.query(`SELECT count(*)::int AS n FROM market.notifications WHERE user_id = $1`, [me]);
  const mention = (authorId) => ({
    message: { id: 1, body: `hey @${nameOf.get(me)} look`, reply_to_message_id: null },
    channel: { display_name: "Room", channel_key: room.key },
    author: { id: authorId },
  });

  await notifications.notifyChatMessage(pool, mention(pest));
  let mine = await pool.query(`SELECT count(*)::int AS n FROM market.notifications WHERE user_id = $1`, [me]);
  assert.equal(mine.rows[0].n, mineBefore.rows[0].n, "muted: no bell");

  await notifications.notifyChatMessage(pool, mention(friend));
  mine = await pool.query(`SELECT count(*)::int AS n FROM market.notifications WHERE user_id = $1`, [me]);
  assert.equal(mine.rows[0].n, mineBefore.rows[0].n + 1, "anyone else still rings it");

  await chatNotify.unmutePlayer(pool, me, pest);
  await notifications.notifyChatMessage(pool, mention(pest));
  mine = await pool.query(`SELECT count(*)::int AS n FROM market.notifications WHERE user_id = $1`, [me]);
  assert.equal(mine.rows[0].n, mineBefore.rows[0].n + 2, "unmuted: back to normal");
  assert.deepEqual((await chatNotify.getSettings(pool, me)).muted_players, []);
  });

  await t.test("findChannels finds existing rooms in one query and leaves out closed ones", async () => {
  const open = await makeRoom("open");
  const closed = await makeRoom("closed");
  await pool.query(`UPDATE chat.channels SET is_active = false WHERE id = $1`, [closed.id]);
  const queries = [];
  const counting = { query: (...args) => (queries.push(args[0]), pool.query(...args)) };
  const found = await chatDb.findChannels(counting, [open.key, closed.key, "unit:nothing-here", "not a key"]);
  assert.deepEqual(found, [{ id: open.id, channel_key: open.key }]);
  assert.equal(queries.length, 1);
  const withClosed = await chatDb.findChannels(pool, [closed.key], { includeInactive: true });
  assert.deepEqual(withClosed, [{ id: closed.id, channel_key: closed.key }]);
  assert.deepEqual(await chatDb.findChannels(pool, []), []);
  });
});

// ── The routes, without a database ──────────────────────────────────────────
async function serve(t, user) {
  const app = express();
  const published = [];
  app.use((req, _res, next) => {
    req.ctx = { pool: {}, user, redis: { publish: async (channel, message) => published.push(JSON.parse(message)) } };
    next();
  });
  app.use(blockSuspendedWrites);
  app.use(express.json());
  app.use("/api/chat", router);
  // eslint-disable-next-line no-unused-vars
  app.use((error, _req, res, _next) => res.status(error.code === "unauthenticated" ? 401 : error.code === "invalid_chat_notify" ? 400 : 500).json({ error: error.code }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const call = (method, path, body) => fetch(`http://127.0.0.1:${server.address().port}${path}`, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { call, published };
}

function mockSettings(t) {
  const calls = [];
  t.mock.method(chatDb, "ensureChatTopologyRecent", async () => {});
  t.mock.method(chatDb, "findChannels", async (_pool, keys) => (keys[0] === "unit:missing" ? [] : [{ id: 7, channel_key: keys[0] }]));
  t.mock.method(chatNotify, "getSettings", async (_pool, userId) => ({ enabled: true, rooms: [], muted_players: [], for: userId }));
  for (const name of ["setEnabled", "setRoom", "mutePlayer", "unmutePlayer"]) {
    t.mock.method(chatNotify, name, async (_pool, ...args) => calls.push([name, ...args]));
  }
  return calls;
}

test("signed out, there's nothing to read or change", async (t) => {
  mockSettings(t);
  const { call } = await serve(t, null);
  assert.equal((await call("GET", "/api/chat/notify")).status, 401);
  assert.equal((await call("PUT", "/api/chat/notify", { enabled: false })).status, 401);
  assert.equal((await call("PUT", "/api/chat/mutes/3")).status, 401);
});

test("a change answers with the settings and tells only that player's other tabs", async (t) => {
  const calls = mockSettings(t);
  const { call, published } = await serve(t, { id: 5 });

  const response = await call("PUT", "/api/chat/channels/market:global/notify", { notify: false });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).for, 5);
  assert.deepEqual(calls.at(-1), ["setRoom", 5, 7, false]);
  assert.deepEqual(published.at(-1), { type: "chat.user.notify_changed", user_id: 5 });

  assert.equal((await call("PUT", "/api/chat/channels/unit:missing/notify", { notify: true })).status, 404);

  assert.equal((await call("PUT", "/api/chat/notify", { enabled: false })).status, 200);
  assert.deepEqual(calls.at(-1), ["setEnabled", 5, false]);
  assert.equal((await call("PUT", "/api/chat/mutes/9")).status, 200);
  assert.deepEqual(calls.at(-1), ["mutePlayer", 5, "9"]);
  assert.equal((await call("DELETE", "/api/chat/mutes/9")).status, 200);
  assert.deepEqual(calls.at(-1), ["unmutePlayer", 5, "9"]);
});

test("a suspended player can still turn things off, but not post", async (t) => {
  const calls = mockSettings(t);
  const { call } = await serve(t, { id: 5, suspension: { reason: "x", until: null, permanent: true } });
  assert.equal((await call("PUT", "/api/chat/notify", { enabled: false })).status, 200);
  assert.equal((await call("PUT", "/api/chat/channels/market:global/notify", { notify: false })).status, 200);
  assert.equal((await call("PUT", "/api/chat/mutes/9")).status, 200);
  assert.equal(calls.length, 3);
  assert.equal((await call("POST", "/api/chat/channels/market:global/messages", { body: "hi" })).status, 403);
});
