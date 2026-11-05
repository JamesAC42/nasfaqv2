const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { WebSocket } = require("ws");

const { BURST, PER_SECOND, REACTIONS, SPECTATOR, channelOf, createReactions } = require("../src/services/games/tables/reactions");
const hub = require("../src/services/games/tables/hub");
const blackjack = require("../src/services/games/tables/blackjack");
const chatDb = require("../src/chatDb");

function harness({ seats = { 1: 2 } } = {}) {
  const pushes = [];
  let clock = 1_000_000;
  const reactions = createReactions({
    publish: (channel, payload) => pushes.push({ channel, ...payload }),
    // User 1 sits in seat 2; everyone else is watching; only the low table exists.
    seatOf: (tableKey, userId) => (tableKey === "low" ? (seats[userId] ?? SPECTATOR) : null),
    now: () => clock,
  });
  const socket = (userId, { canReact = true, channels = ["blackjack:low"] } = {}) => ({ userId, canReact, gameChannels: new Set(channels) });
  return { reactions, pushes, socket, advance: (ms) => (clock += ms) };
}

const send = (reactions, ws, counts, table = "low") => reactions.handle(ws, { action: "react", table, counts });

test("reactions go out as counts per emoji and seat, on the table's own channel", () => {
  const { reactions, pushes, socket } = harness();
  send(reactions, socket(1), { fire: 2 });
  send(reactions, socket(1), { fire: 1, lol: 1 });
  send(reactions, socket(9), { fire: 1 });
  reactions.flushAll();

  assert.equal(pushes.length, 1);
  assert.equal(pushes[0].channel, "reactions:blackjack:low");
  assert.equal(pushes[0].type, "reactions");
  assert.deepEqual(pushes[0].items.sort(), [["fire", 2, 3], ["fire", SPECTATOR, 1], ["lol", 2, 1]].sort());
  // Nothing says who was watching.
  assert.ok(pushes[0].items.every((item) => item.length === 3));
});

test("nothing is sent when there's nothing to send", () => {
  const { reactions, pushes } = harness();
  reactions.flushAll();
  assert.equal(pushes.length, 0);
});

test("only the fixed list gets through", () => {
  const { reactions, pushes, socket } = harness();
  send(reactions, socket(1), JSON.parse('{"<img src=x>": 5, "slur": 1, "__proto__": { "fire": 3 }, "constructor": 2}'));
  reactions.flushAll();
  assert.equal(pushes.length, 0);
});

test("counts have to be whole numbers above zero", () => {
  const { reactions, pushes, socket } = harness();
  for (const bad of [0, -3, 1.5, "4", null, {}, Number.NaN, Infinity]) send(reactions, socket(1), { fire: bad });
  reactions.handle(socket(1), { action: "react", table: "low" });
  reactions.handle(socket(1), { action: "react", table: "low", counts: "fire" });
  reactions.flushAll();
  assert.equal(pushes.length, 0);
});

test("a signed-out, unverified or suspended socket can't send", () => {
  const { reactions, pushes, socket } = harness();
  send(reactions, socket(null), { fire: 1 });
  send(reactions, socket(1, { canReact: false }), { fire: 1 });
  reactions.flushAll();
  assert.equal(pushes.length, 0);
});

test("you have to be at the table, and it has to exist", () => {
  const { reactions, pushes, socket } = harness();
  send(reactions, socket(1, { channels: ["blackjack:mid"] }), { fire: 1 });
  send(reactions, socket(1, { channels: ["blackjack:nope"] }), { fire: 1 }, "nope");
  reactions.flushAll();
  assert.equal(pushes.length, 0);
});

test("one player gets a burst, then a trickle, whatever they ask for", () => {
  const { reactions, pushes, socket, advance } = harness();
  const total = () => pushes.flatMap((push) => push.items).reduce((sum, item) => sum + item[2], 0);

  send(reactions, socket(1), { fire: 1000 });
  reactions.flushAll();
  assert.equal(total(), BURST);

  send(reactions, socket(1), { fire: 1 });
  reactions.flushAll();
  assert.equal(total(), BURST, "the bucket is empty");

  advance(1000);
  send(reactions, socket(1), { fire: 1000 });
  reactions.flushAll();
  assert.equal(total(), BURST + PER_SECOND);

  advance(60_000);
  send(reactions, socket(1), { fire: 1000 });
  reactions.flushAll();
  assert.equal(total(), BURST + PER_SECOND + BURST, "it refills no higher than the burst");
});

test("the budget is the player's, not the socket's, and doesn't touch anyone else's", () => {
  const { reactions, pushes, socket } = harness();
  const total = (seat) => pushes.flatMap((push) => push.items).filter((item) => item[1] === seat).reduce((sum, item) => sum + item[2], 0);
  send(reactions, socket(1), { fire: BURST });
  send(reactions, socket(1), { fire: BURST }); // a second tab
  send(reactions, socket(9), { lol: BURST });
  reactions.flushAll();
  assert.equal(total(2), BURST);
  assert.equal(total(SPECTATOR), BURST);
});

test("a crowd still means one small message per flush", () => {
  const { reactions, pushes, socket } = harness();
  for (let userId = 100; userId < 400; userId += 1) send(reactions, socket(userId), { fire: 3, party: 3, clap: 3, lol: 1 });
  reactions.flushAll();
  assert.equal(pushes.length, 1);
  assert.ok(pushes[0].items.length <= REACTIONS.length * 6);
  assert.ok(JSON.stringify(pushes[0]).length < 1024);
});

test("the coalescer holds pushes back until the flush", async () => {
  const pushes = [];
  const reactions = createReactions({ publish: (channel, payload) => pushes.push(payload), seatOf: () => SPECTATOR, flushMs: 20 });
  const ws = { userId: 1, canReact: true, gameChannels: new Set(["blackjack:low"]) };
  send(reactions, ws, { fire: 1 });
  send(reactions, ws, { lol: 1 });
  assert.equal(pushes.length, 0);
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(pushes.length, 1);
  assert.equal(pushes[0].items.length, 2);
});

test("the client's emoji are the server's list, and it stays under the server's limits", () => {
  const source = fs.readFileSync(path.join(__dirname, "../../app-client/app/components/games/blackjack/bj-reactions.tsx"), "utf8");
  const ids = [...source.matchAll(/\{ id: "([a-z]+)", glyph:/g)].map((match) => match[1]);
  assert.deepEqual(ids, [...REACTIONS]);
  assert.ok(Number(/const BURST = (\d+)/.exec(source)[1]) <= BURST);
  assert.ok(Number(/const PER_SECOND = (\d+)/.exec(source)[1]) <= PER_SECOND);
  // The socket closes at 30 messages in 10 seconds, and the page sends a few control messages too.
  assert.ok(10_000 / Number(/const SEND_EVERY_MS = (\d+)/.exec(source)[1]) <= 20);
});

test("a table room's key parses, and each room belongs to a real table", () => {
  assert.deepEqual(chatDb.parseChannelKey("table:blackjack-low"), { channelKey: "table:blackjack-low", scopeType: "table", scopeKey: "blackjack-low" });
  assert.equal(chatDb.parseChannelKey("table:has spaces"), null);
  assert.equal(chatDb.parseChannelKey("table:"), null);
  assert.deepEqual(chatDb.TABLE_ROOMS.map((room) => room.table), blackjack.TABLES.map((table) => table.key));
  for (const room of chatDb.TABLE_ROOMS) assert.equal(room.key, `blackjack-${room.table}`);
});

// The real hub, over a real socket: the action reaches its handler, and channels stay separate.
test("the hub passes react messages on and keeps reactions off the table's own channel", async (t) => {
  const seen = [];
  hub.registerAction("react-test", (ws, message) => seen.push({ userId: ws.userId, canReact: ws.canReact, channels: [...ws.gameChannels], message }));
  const wss = hub.createGamesWss();
  const server = http.createServer();
  server.on("upgrade", (req, socket, head) => {
    req.gamesUser = { id: 7, email_verified: true, suspension: null };
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  });
  await new Promise((resolve) => server.listen(0, resolve));
  t.after(() => {
    for (const client of wss.clients) client.terminate();
    wss.close();
    server.close();
  });

  const client = new WebSocket(`ws://127.0.0.1:${server.address().port}`);
  const received = [];
  client.on("message", (raw) => received.push(JSON.parse(String(raw))));
  await new Promise((resolve) => client.once("open", resolve));

  client.send(JSON.stringify({ action: "subscribe", channels: ["blackjack:low", channelOf("low"), "reactions:nope"] }));
  client.send(JSON.stringify({ action: "react-test", table: "low", counts: { fire: 1 } }));
  client.send(JSON.stringify({ action: "constructor" }));
  await new Promise((resolve) => setTimeout(resolve, 80));

  assert.equal(seen.length, 1);
  assert.equal(seen[0].userId, 7);
  assert.equal(seen[0].canReact, true);
  assert.deepEqual(seen[0].channels, ["blackjack:low", "reactions:blackjack:low"]);
  assert.equal(hub.count("reactions:nope"), 0);
  assert.equal(hub.count(channelOf("low")), 1);

  hub.publish(channelOf("low"), { type: "reactions", items: [["fire", SPECTATOR, 1]] });
  await new Promise((resolve) => setTimeout(resolve, 40));
  const push = received.find((message) => message.type === "reactions");
  assert.equal(push.channel, "reactions:blackjack:low");
  client.close();
});

test("a suspended or unverified player's socket is marked at connection", async (t) => {
  const wss = hub.createGamesWss();
  const server = http.createServer();
  const users = [{ id: 1, email_verified: true, suspension: { reason: "x" } }, { id: 2, email_verified: false, suspension: null }, null];
  const opened = [];
  server.on("upgrade", (req, socket, head) => {
    req.gamesUser = users.shift();
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
      opened.push(ws.canReact);
    });
  });
  await new Promise((resolve) => server.listen(0, resolve));
  t.after(() => {
    for (const client of wss.clients) client.terminate();
    wss.close();
    server.close();
  });
  for (let index = 0; index < 3; index += 1) {
    const client = new WebSocket(`ws://127.0.0.1:${server.address().port}`);
    await new Promise((resolve) => client.once("open", resolve));
    client.close();
  }
  assert.deepEqual(opened, [false, false, false]);
});

// The room behaves like any other: mutes, bans, reports, the 3-second rule, and it stays out of the room
// list. On a freshly migrated database of its own, from the local or CI test server.
const databaseUrl = process.env.CHAT_TEST_DATABASE_URL;

test("table rooms use chat's own moderation", { skip: !databaseUrl, timeout: 180_000 }, async (t) => {
  const { Pool } = require("pg");
  const { applySchema } = require("../src/migrations");
  const notifications = require("../src/services/notifications");

  const target = new URL(databaseUrl);
  assert.ok(["127.0.0.1", "localhost"].includes(target.hostname));
  assert.equal(target.pathname, "/nasfaq_chat_test");
  const admin = new Pool({ connectionString: databaseUrl });
  try {
    await admin.query("DROP DATABASE IF EXISTS nasfaq_table_rooms_test WITH (FORCE)");
    await admin.query("CREATE DATABASE nasfaq_table_rooms_test");
  } finally {
    await admin.end();
  }
  target.pathname = "/nasfaq_table_rooms_test";
  const pool = new Pool({ connectionString: target.href });
  t.after(() => pool.end());
  const quiet = [console.warn, console.log, console.info];
  console.warn = console.log = console.info = () => {};
  try {
    await applySchema(pool);
    await chatDb.ensureChatTopology(pool);
  } finally {
    [console.warn, console.log, console.info] = quiet;
  }

  const addUser = async (username, { isAdmin = false } = {}) => {
    const { rows } = await pool.query(
      `INSERT INTO market.users (username, username_normalized, email, email_verified, password_hash, password_salt, password_params_json, is_admin)
       VALUES ($1, lower($1), $1 || '@example.test', true, 'x', 'x', '{}', $2) RETURNING id`,
      [username, isAdmin]
    );
    return { id: Number(rows[0].id), username, is_admin: isAdmin };
  };
  const speaker = await addUser("speaker");
  const reporter = await addUser("reporter");
  const moderator = await addUser("moderator", { isAdmin: true });

  for (const room of chatDb.TABLE_ROOMS) {
    const channel = await chatDb.getChannelByKey(pool, `table:${room.key}`, { viewerUserId: speaker.id });
    assert.ok(channel, room.key);
    assert.equal(channel.posting_policy, "authenticated");
    assert.equal(channel.metadata.href, `/games/blackjack/${room.table}`);
  }

  // Not in the room list, so not in its unread counts; still there if you ask for that kind.
  const listed = await chatDb.listChannels(pool, { viewerUserId: speaker.id });
  assert.equal(listed.filter((channel) => channel.scope_type === "table").length, 0);
  assert.ok(listed.some((channel) => channel.scope_type === "market"));
  const tableRooms = await chatDb.listChannels(pool, { viewerUserId: speaker.id, scopeType: "table" });
  assert.equal(tableRooms.length, chatDb.TABLE_ROOMS.length);

  const room = await chatDb.getChannelByKey(pool, "table:blackjack-low", { viewerUserId: speaker.id });
  const { message } = await chatDb.createMessage(pool, { channelId: room.id, viewer: speaker, body: "nice hand" });
  assert.equal(message.channel_key, "table:blackjack-low");

  // The 3-second rule.
  await assert.rejects(chatDb.createMessage(pool, { channelId: room.id, viewer: speaker, body: "again" }), /chat_rate_limited/);
  await pool.query("UPDATE chat.messages SET created_at = now() - interval '1 minute' WHERE author_id = $1", [speaker.id]);

  // A report lands in the same queue.
  const report = await chatDb.createMessageReport(pool, { messageId: message.id, reporterId: reporter.id, reason: "Spam" });
  const queue = await chatDb.listReports(pool, { status: "open", limit: 100 });
  const queued = queue.reports.find((entry) => Number(entry.id) === Number(report.id));
  assert.equal(queued.message.channel_key, "table:blackjack-low");

  // A site-wide mute (what the ⋯ menu does) silences the player here too, then lifts.
  await chatDb.createModerationAction(pool, { targetUserId: speaker.id, moderatorId: moderator.id, channelId: null, actionType: "mute", reason: "test", durationMinutes: 10 });
  await assert.rejects(chatDb.createMessage(pool, { channelId: room.id, viewer: speaker, body: "muted" }), /chat_user_muted/);
  const muted = await chatDb.getChannelByKey(pool, "table:blackjack-low", { viewerUserId: speaker.id });
  assert.equal(muted.chat_restriction.type, "mute");
  await chatDb.revokeModerationActions(pool, { targetUserId: speaker.id, actionType: "mute", channelId: null });

  // So does a ban.
  await chatDb.createModerationAction(pool, { targetUserId: speaker.id, moderatorId: moderator.id, channelId: null, actionType: "ban", reason: "test" });
  await assert.rejects(chatDb.createMessage(pool, { channelId: room.id, viewer: speaker, body: "banned" }), /chat_user_banned/);
  await chatDb.revokeModerationActions(pool, { targetUserId: speaker.id, actionType: "ban", channelId: null });

  // A room an admin locked stays locked after the next topology sync.
  await chatDb.updateChannel(pool, room.id, { postingPolicy: "read_only" });
  await chatDb.ensureChatTopology(pool);
  const locked = await chatDb.getChannelByKey(pool, "table:blackjack-low", { viewerUserId: speaker.id });
  assert.equal(locked.posting_policy, "read_only");
  await assert.rejects(chatDb.createMessage(pool, { channelId: room.id, viewer: speaker, body: "locked" }), /chat_channel_locked/);
  await chatDb.updateChannel(pool, room.id, { postingPolicy: "authenticated" });

  // A mention in a table room links to the table, since the room isn't in /chat.
  const high = await chatDb.getChannelByKey(pool, "table:blackjack-high", { viewerUserId: speaker.id });
  await notifications.notifyChatMessage(pool, { message: { id: 1, body: "nice one @reporter" }, channel: high, author: speaker });
  const { rows } = await pool.query("SELECT href FROM market.notifications WHERE user_id = $1", [reporter.id]);
  assert.equal(rows[0]?.href, "/games/blackjack/high");
});
