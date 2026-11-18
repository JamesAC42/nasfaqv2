const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { Pool } = require("pg");

const { applySchema } = require("../src/migrations");
const features = require("../src/features");
const socketLimits = require("../src/socketLimits");
const hub = require("../src/services/games/tables/hub");
const tables = require("../src/services/games/mahjong/tables");
const tournaments = require("../src/services/games/mahjong/tournaments");
const { setTrialForTests } = require("../src/services/games/mahjong/settings");

// The talent select before a mahjong table's first deal: who may pick what, readying up, the clock, the
// bots, and the players' pointers streamed over the games socket. End to end on a migrated database,
// with the games hub driven through stand-in sockets the way server.js wires real ones.
const databaseUrl = process.env.CHAT_TEST_DATABASE_URL;
const ROSTER = ["AAA", "BBB", "CCC", "DDD", "EEE", "FFF"];
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("mahjong talent select, end to end", { skip: !databaseUrl, timeout: 300_000 }, async (t) => {
  const target = new URL(databaseUrl);
  assert.ok(["127.0.0.1", "localhost"].includes(target.hostname));
  assert.equal(target.pathname, "/nasfaq_chat_test");
  const admin = new Pool({ connectionString: databaseUrl });
  try {
    await admin.query("DROP DATABASE IF EXISTS nasfaq_mahjong_select_test WITH (FORCE)");
    await admin.query("CREATE DATABASE nasfaq_mahjong_select_test");
  } finally {
    await admin.end();
  }
  target.pathname = "/nasfaq_mahjong_select_test";
  const pool = new Pool({ connectionString: target.href, options: "-c timezone=UTC" });
  const saved = [console.warn, console.log, console.info];
  console.warn = console.log = console.info = () => {};
  try {
    await applySchema(pool);
  } finally {
    [console.warn, console.log, console.info] = saved;
  }
  const restoreFlags = features.override({ mahjong: "on" });
  const restoreTrial = setTrialForTests(true);
  await tables.init(pool, { onTableOver: tournaments.onTableOver });
  // A fresh database lists no talents (so the other suites deal at once): give this one a roster.
  const restoreTalents = tables._setTalentsForTests(ROSTER);
  const wss = hub.createGamesWss();
  t.after(async () => {
    tables.reset();
    restoreTalents();
    restoreFlags();
    restoreTrial();
    wss.close();
    await pool.end();
  });

  let seq = 0;
  const user = async (name) => {
    seq += 1;
    const { rows } = await pool.query(
      `INSERT INTO market.users (username, username_normalized, email, email_verified, password_hash, password_salt, password_params_json, created_at)
       VALUES ($1, $1, $1 || '@example.test', true, 'x', 'x', '{}', now() - interval '30 days') RETURNING id`,
      [`${name}_${seq}`]
    );
    await pool.query(`INSERT INTO market.portfolio_cash_balances (user_id, cash_balance, credit_balance) VALUES ($1, 20000, 90000)`, [rows[0].id]);
    return Number(rows[0].id);
  };
  const liveTable = (id) => tables._tables.get(id);
  const tick = (table) => tables.withLock(table.id, () => tables._tick(table));
  const indexOf = (table, userId) => table.seats.findIndex((seat) => seat?.user_id === userId);
  const pick = (userId, tableId, talent) => tables.selectAction({ userId, tableId, action: { action: "mj-pick-talent", talent } });
  const ready = (userId, tableId, on = true) => tables.selectAction({ userId, tableId, action: { action: "mj-ready", ready: on } });

  /** A games socket as server.js sets one up: the message cap first, then the hub's own handlers. */
  function socket(userId = null) {
    const ws = new EventEmitter();
    ws.readyState = 1;
    ws.sent = [];
    ws.send = (text) => ws.sent.push(JSON.parse(text));
    ws.close = (code) => {
      if (ws.readyState !== 1) return;
      ws.readyState = 3;
      ws.closedWith = code;
      ws.emit("close");
    };
    ws.terminate = () => ws.close(1006);
    ws.ping = () => {};
    socketLimits.limitMessages(ws);
    wss.emit("connection", ws, { gamesUser: userId ? { id: userId, email_verified: true } : null });
    ws.raw = (text) => ws.emit("message", Buffer.from(text));
    ws.say = (message) => ws.raw(JSON.stringify(message));
    ws.subscribe = (...channels) => ws.say({ action: "subscribe", channels });
    ws.cursors = () => ws.sent.filter((message) => message.type === "mj-cursors");
    return ws;
  }
  const cursor = (tableId, fields) => ({ action: "mj-cursor", table: tableId, x: 0.5, y: 0.5, vx: 0, vy: 0, t: 1000, ...fields });

  await t.test("practice: you pick, the bots take the rest at once, and the deal follows the beat", async () => {
    const player = await user("solo");
    const seated = await tables.createTable({ userId: player, kind: "practice", level: "easy", length: "east" });
    assert.equal(seated.table.status, "waiting");
    assert.equal(seated.table.game, null);
    assert.equal(seated.table.expires_at, null);
    const select = seated.table.select;
    assert.deepEqual(select.roster, ROSTER);
    assert.equal(select.cursors, false, "one player: no pointers to stream");
    assert.ok(select.deadline > Date.now() + 25_000 && select.deadline <= Date.now() + 30_000);
    assert.equal(select.starts_at, null);
    assert.deepEqual(select.picks.map((entry) => entry.talent), [null, null, null, null], "nobody has a talent yet");
    const id = seated.table.id;
    const table = liveTable(id);
    const me = seated.seat.index;
    assert.equal(table.seats[me].user_id, player, "the seat handed back is the player's after the shuffle");

    await assert.rejects(ready(player, id), { code: "pick_first" });
    await assert.rejects(pick(player, id, "ZZZ"), { code: "invalid_talent" });
    const picked = await pick(player, id, "DDD");
    assert.equal(picked.table.select.picks[me].talent, "DDD");
    assert.equal(picked.table.seats[me].talent, "DDD", "the seat shows the pick");
    const readied = await ready(player, id);
    assert.ok(readied.table.select.starts_at > Date.now(), "everyone is ready: the beat");
    const talents = readied.table.select.picks.map((entry) => entry.talent);
    assert.ok(talents.every(Boolean), "the bots picked");
    assert.equal(new Set(talents).size, 4, "one seat each");
    assert.ok(readied.table.select.picks.every((entry) => entry.ready));

    table.select.startsAt = 1;
    await tick(table);
    assert.equal(table.status, "playing");
    assert.equal(table.select, null);
    assert.deepEqual(table.seats.map((seat) => seat.talent), talents, "the picks are the seats' talents, in the seats they were picked in");
    assert.equal(table.seats[me].user_id, player);
    assert.ok(table.game.hand, "dealt");
    assert.equal((await tables.getTable({ tableId: id, userId: player })).table.select, null);
    await assert.rejects(pick(player, id, "EEE"), { code: "select_closed" });
    await tables.leaveTable({ userId: player, tableId: id });

    // Untimed practice waits on its player.
    const untimed = await tables.createTable({ userId: player, kind: "practice", speed: "untimed" });
    assert.equal(untimed.table.select.deadline, null);
    // Leaving practice during the select closes the table.
    await tables.leaveTable({ userId: player, tableId: untimed.table.id });
    assert.equal(liveTable(untimed.table.id), undefined);
  });

  await t.test("the tutorial and guided lessons skip the select", async () => {
    const learner = await user("learner");
    const lesson = await tables.createTable({ userId: learner, kind: "tutorial", lesson: "riichi" });
    assert.equal(lesson.table.status, "playing");
    assert.equal(lesson.table.select, null);
    await tables.leaveTable({ userId: learner, tableId: lesson.table.id });
    const guestLesson = await tables.createGuestTable({ ipKey: "198.51.100.40", lesson: "calls" });
    assert.equal(guestLesson.table.status, "playing");
    await tables.leaveTable({ token: guestLesson.seat.token, tableId: guestLesson.table.id });
    // A guest's practice hand gets one (untimed).
    const guest = await tables.createGuestTable({ ipKey: "198.51.100.40" });
    assert.equal(guest.table.status, "waiting");
    assert.equal(guest.table.select.deadline, null);
    await tables.selectAction({ token: guest.seat.token, tableId: guest.table.id, action: { action: "mj-pick-talent", talent: "AAA" } });
    await assert.rejects(tables.selectAction({ token: "f".repeat(32), tableId: guest.table.id, action: { action: "mj-pick-talent", talent: "BBB" } }), { code: "forbidden" });
    await tables.leaveTable({ token: guest.seat.token, tableId: guest.table.id });
  });

  await t.test("a shared table nobody has open deals at once with the talents it was seated with", async () => {
    const a = await user("away_a");
    const b = await user("away_b");
    const id = (await tables.createTable({ userId: a, kind: "ranked" })).table.id;
    await tables.createTable({ userId: b, kind: "ranked" });
    const table = liveTable(id);
    table.startAt = 1;
    await tick(table);
    assert.equal(table.status, "playing");
    assert.ok(table.seats.every((seat) => ROSTER.includes(seat.talent)));
  });

  // Played through the next tests: two players at a quick match, their sockets, a spectator's.
  const ann = await user("ann");
  const bea = await user("bea");
  const watcher = await user("watcher");
  const sharedId = (await tables.createTable({ userId: ann, kind: "ranked" })).table.id;
  await tables.createTable({ userId: bea, kind: "ranked" });
  const shared = liveTable(sharedId);
  const annWs = socket(ann);
  const beaWs = socket(bea);
  const railWs = socket(watcher);

  await t.test("players pick unique talents, change their minds until ready, and the table deals when all are ready", async () => {
    annWs.subscribe(`mj-seat:${shared.seats[indexOf(shared, ann)].token}`);
    beaWs.subscribe(`mj-seat:${shared.seats[indexOf(shared, bea)].token}`);
    railWs.subscribe(`mahjong:${sharedId}`, `mj-cursor:${sharedId}`);
    shared.startAt = 1;
    await tick(shared);
    assert.equal(shared.status, "waiting", "the select, not the deal");
    assert.ok(shared.select);
    assert.equal(shared.seats.filter((seat) => seat.bot).length, 2, "bots took the empty seats");
    const view = tables.publicTable(shared);
    assert.equal(view.select.cursors, true);
    assert.ok(view.select.deadline > Date.now() + 25_000 && view.select.deadline <= Date.now() + 30_000);
    assert.equal(view.starts_at, null);
    const annSeat = indexOf(shared, ann);
    const beaSeat = indexOf(shared, bea);

    await pick(ann, sharedId, "AAA");
    await assert.rejects(pick(bea, sharedId, "AAA"), { code: "talent_taken", seat: annSeat });
    await pick(bea, sharedId, "BBB");
    await pick(bea, sharedId, "CCC");
    assert.equal(shared.seats[beaSeat].talent, "CCC", "a pick can change");
    await pick(ann, sharedId, "BBB");
    await pick(ann, sharedId, "AAA");
    await assert.rejects(tables.selectAction({ userId: watcher, tableId: sharedId, action: { action: "mj-pick-talent", talent: "DDD" } }), { code: "forbidden" });
    await assert.rejects(tables.selectAction({ userId: ann, tableId: sharedId, action: { action: "mj-ready", ready: "yes" } }), { code: "invalid_action" });
    await assert.rejects(tables.selectAction({ userId: ann, tableId: sharedId, action: { action: "mj-sing" } }), { code: "invalid_action" });

    await ready(ann, sharedId);
    await assert.rejects(pick(ann, sharedId, "DDD"), { code: "already_ready" });
    assert.equal(shared.select.startsAt, null, "one player is still choosing");
    assert.ok(shared.seats.filter((seat) => seat.bot).every((seat) => seat.talent === null), "bots wait for the players");
    // What everyone sees: the picks and who is ready.
    const rail = railWs.sent.filter((message) => message.type === "mahjong").at(-1).table.select;
    assert.equal(rail.picks[annSeat].talent, "AAA");
    assert.equal(rail.picks[annSeat].ready, true);
    assert.equal(rail.picks[beaSeat].talent, "CCC");
    assert.equal(rail.picks[beaSeat].ready, false);

    await ready(bea, sharedId);
    assert.ok(shared.select.startsAt > Date.now());
    const botTalents = shared.seats.filter((seat) => seat.bot).map((seat) => seat.talent);
    assert.ok(botTalents.every((symbol) => symbol && !["AAA", "CCC"].includes(symbol)), "bots take only what's left");
    // Taken back during the beat: no deal, and the bots put theirs down.
    await ready(bea, sharedId, false);
    assert.equal(shared.select.startsAt, null);
    assert.ok(shared.seats.filter((seat) => seat.bot).every((seat) => seat.talent === null));
    await ready(bea, sharedId);
    assert.ok(shared.select.startsAt);
  });

  await t.test("pointers: checked, stamped and batched for players and spectators, within their own limits", async () => {
    const annSeat = indexOf(shared, ann);
    annWs.say(cursor(sharedId, { x: 0.25, y: 0.75, vx: 1.5, vy: -0.5, t: 5000, hover: "AAA" }));
    let got = railWs.cursors().at(-1);
    assert.ok(got, "the first one goes out at once");
    assert.equal(got.channel, `mj-cursor:${sharedId}`);
    assert.equal(got.table_id, sharedId);
    assert.equal(typeof got.server_time, "number");
    assert.deepEqual(got.cursors, [{ seat: annSeat, x: 0.25, y: 0.75, vx: 1.5, vy: -0.5, t: 5000, hover: "AAA", gone: false, at: got.cursors[0].at }]);
    assert.ok(beaWs.cursors().length === 0, "a player who hasn't opened the pointer channel gets none");

    // Out of range is clamped, a talent off the roster is dropped, and nonsense is ignored.
    const before = railWs.cursors().length;
    await wait(50);
    annWs.say(cursor(sharedId, { x: 7, y: -2, vx: 1e9, vy: -1e9, t: -5, hover: "ZZZ", gone: true }));
    got = railWs.cursors().at(-1).cursors[0];
    assert.equal(railWs.cursors().length, before + 1);
    assert.deepEqual([got.x, got.y, got.vx, got.vy, got.t, got.hover, got.gone], [1, 0, 20, -20, 0, null, true]);
    await wait(50);
    annWs.say(cursor(sharedId, { x: "0.5" }));
    annWs.say(cursor(sharedId, { y: null }));
    annWs.say({ ...cursor(sharedId, {}), table: 999_999 });
    await wait(60);
    assert.equal(railWs.cursors().length, before + 1, "nothing for a bad position or another table");

    // Not seated: a spectator's pointer goes nowhere.
    railWs.say(cursor(sharedId, {}));
    await wait(60);
    assert.equal(railWs.cursors().length, before + 1);

    // Two players inside one window go out together.
    await wait(50);
    annWs.say(cursor(sharedId, { x: 0.1 }));
    annWs.say(cursor(sharedId, { x: 0.2 }));
    beaWs.say(cursor(sharedId, { x: 0.9 }));
    await wait(80);
    const batch = railWs.cursors().at(-1).cursors;
    assert.deepEqual(batch.map((entry) => [entry.seat, entry.x]).sort(), [[annSeat, 0.2], [indexOf(shared, bea), 0.9]].sort());

    // A flood: the socket stays open (pointers don't count toward the socket's message cap), and past
    // its burst the rest are dropped.
    await wait(1000);
    const flooded = railWs.cursors().length;
    for (let i = 0; i < 100; i += 1) annWs.say(cursor(sharedId, { x: i / 1000 }));
    await wait(80);
    assert.equal(annWs.readyState, 1, "still open");
    const lastX = railWs.cursors().slice(flooded).at(-1).cursors.find((entry) => entry.seat === annSeat).x;
    assert.ok(lastX < 0.02, `only the first dozen or so got through (the last was ${lastX})`);

    // Other messages still count: a socket that floods pings is closed.
    const noisy = socket(watcher);
    for (let i = 0; i < 31; i += 1) noisy.say({ action: "ping" });
    assert.equal(noisy.closedWith, 1008);
    // Dressed up as a pointer, a subscribe isn't one.
    const sneaky = socket(watcher);
    sneaky.raw(`{"action":"mj-cursor","action":"subscribe","channels":["mj-cursor:${sharedId}"]}`);
    assert.equal(hub.count(`mj-cursor:${sharedId}`), 1, "only the spectator holds the channel");
    // And pointers past their own hard cap close the socket too.
    const firehose = socket(watcher);
    for (let i = 0; i < 601; i += 1) firehose.say(cursor(sharedId, {}));
    assert.equal(firehose.closedWith, 1008);
  });

  await t.test("the deal: the picks become the seats' talents, on the record too, and pointers stop", async () => {
    const chosen = shared.seats.map((seat) => seat.talent);
    shared.select.startsAt = 1;
    await tick(shared);
    assert.equal(shared.status, "playing");
    assert.deepEqual(shared.seats.map((seat) => seat.talent), chosen);
    assert.equal(shared.seats[indexOf(shared, ann)].talent, "AAA");
    assert.equal(shared.seats[indexOf(shared, bea)].talent, "CCC");
    const { rows } = await pool.query(`SELECT seat, talent FROM games.mahjong_game_players WHERE game_id = $1 ORDER BY seat`, [sharedId]);
    assert.deepEqual(rows.map((row) => row.talent), chosen);
    const count = railWs.cursors().length;
    await wait(60);
    annWs.say(cursor(sharedId, { x: 0.3 }));
    await wait(60);
    assert.equal(railWs.cursors().length, count, "no pointers once the game is on");
    await assert.rejects(ready(ann, sharedId, false), { code: "select_closed" });
  });

  await t.test("the clock: whoever hasn't picked (present or not) is picked for, then the deal", async () => {
    const host = await user("host");
    const friend = await user("friend");
    const room = await tables.createTable({ userId: host, kind: "friend", length: "east" });
    const id = room.table.id;
    await tables.joinTable({ userId: friend, tableId: id });
    const table = liveTable(id);
    const hostWs = socket(host);
    hostWs.subscribe(`mj-seat:${table.seats[indexOf(table, host)].token}`);
    // The friend never opens the page.
    await tables.startTable({ userId: host, tableId: id });
    assert.ok(table.select, "a friend room selects too");
    assert.ok(table.select.deadline > Date.now() + 55_000, "a minute for friends");
    await assert.rejects(tables.startTable({ userId: host, tableId: id }), { code: "table_not_open" });
    await pick(host, id, "EEE");
    table.select.deadline = 1;
    await tick(table);
    assert.equal(table.select.locked, true);
    assert.ok(table.select.startsAt > Date.now());
    assert.ok(table.select.ready.every(Boolean));
    const talents = table.seats.map((seat) => seat.talent);
    assert.ok(talents.every((symbol) => ROSTER.includes(symbol)));
    assert.equal(new Set(talents).size, 4);
    assert.equal(table.seats[indexOf(table, host)].talent, "EEE", "a pick stands");
    assert.equal(tables.publicTable(table).select.deadline, null);
    await assert.rejects(ready(host, id, false), { code: "select_closed" });
    await assert.rejects(pick(host, id, "FFF"), { code: "already_ready" });
    table.select.startsAt = 1;
    await tick(table);
    assert.equal(table.status, "playing");
    assert.deepEqual(table.seats.map((seat) => seat.talent), talents);
    hostWs.close();
  });

  await t.test("leaving during the select puts the seat on autopilot with a talent; the rest carry on", async () => {
    const a = await user("leave_a");
    const b = await user("leave_b");
    const id = (await tables.createTable({ userId: a, kind: "ranked" })).table.id;
    await tables.createTable({ userId: b, kind: "ranked" });
    const table = liveTable(id);
    const aWs = socket(a);
    aWs.subscribe(`mj-seat:${table.seats[indexOf(table, a)].token}`);
    table.startAt = 1;
    await tick(table);
    assert.ok(table.select);
    await tables.leaveTable({ userId: b, tableId: id });
    const gone = table.seats[indexOf(table, b)];
    assert.equal(gone.away, true);
    assert.ok(ROSTER.includes(gone.talent));
    await assert.rejects(tables.joinTable({ userId: await user("late"), tableId: id }), { code: "table_not_open" });
    await pick(a, id, ROSTER.find((symbol) => symbol !== gone.talent));
    await ready(a, id);
    assert.ok(table.select.startsAt, "the one left is ready: the beat");
    table.select.startsAt = 1;
    await tick(table);
    assert.equal(table.status, "playing");
    aWs.close();
  });

  await t.test("bots prefer talents that haven't been at a table lately", async () => {
    tables.reset();
    const deal = async (userId, talent) => {
      const seated = await tables.createTable({ userId, kind: "practice" });
      const table = liveTable(seated.table.id);
      await pick(userId, table.id, talent);
      await ready(userId, table.id);
      const bots = table.seats.filter((seat) => seat.bot).map((seat) => seat.talent);
      table.select.startsAt = 1;
      await tick(table);
      assert.equal(table.status, "playing");
      await tables.leaveTable({ userId, tableId: table.id });
      return bots;
    };
    // The first table puts four of the six talents on the recent list.
    const firstBots = await deal(await user("first"), "AAA");
    const unused = ROSTER.filter((symbol) => symbol !== "AAA" && !firstBots.includes(symbol));
    assert.equal(unused.length, 2);
    // The next player takes one of the two unused: the first bot to pick reaches for the other.
    const nextBots = await deal(await user("second"), unused[0]);
    assert.ok(nextBots.includes(unused[1]), `a bot took ${unused[1]} (bots took ${nextBots.join(", ")})`);
    assert.ok(!nextBots.includes(unused[0]));
  });

  await t.test("only talents with 3D table art are offered, to players and bots alike", async () => {
    tables.reset();
    const restore = tables._setTalentsForTests(["AAA", "PEK", "BBB", "GUR", "CCC", "SUI", "AME"]);
    try {
      const userId = await user("drawn");
      const seated = await tables.createTable({ userId, kind: "practice" });
      const table = liveTable(seated.table.id);
      assert.deepEqual([...table.select.roster].sort(), ["AME", "GUR", "PEK", "SUI"]);
      await assert.rejects(pick(userId, table.id, "AAA"), { code: "invalid_talent" });
      await pick(userId, table.id, "GUR");
      await ready(userId, table.id);
      const bots = table.seats.filter((seat) => seat.bot).map((seat) => seat.talent).sort();
      assert.deepEqual(bots, ["AME", "PEK", "SUI"], "the bots take the rest of the drawn talents");
      await tables.leaveTable({ userId, tableId: table.id });
    } finally {
      restore();
    }
  });
});
