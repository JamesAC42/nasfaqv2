const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { Pool } = require("pg");

const { applySchema } = require("../src/migrations");
const features = require("../src/features");
const ipHash = require("../src/services/ipHash");
const bot = require("../src/services/games/mahjong/bot");
const limits = require("../src/services/games/mahjong/limits");
const records = require("../src/services/games/mahjong/records");
const round = require("../src/services/games/mahjong/round");
const tables = require("../src/services/games/mahjong/tables");
const tournaments = require("../src/services/games/mahjong/tournaments");
const { SETTINGS, chipResults, publicRules, setTrialForTests } = require("../src/services/games/mahjong/settings");
const { getCurrentNetWorth } = require("../src/services/netWorth");

// Trial (beta) mode: mahjong never takes or pays Cash or Credit; stakes tables play for chips. Then the
// features that came with it: the chip leaderboards, feedback, single-hand and untimed practice, and
// first-time badges. The rules as pure functions first, then end to end on a freshly migrated database.
const databaseUrl = process.env.CHAT_TEST_DATABASE_URL;

// ── Pure ───────────────────────────────────────────────────────────────────
test("trial mode can be pinned per test, and chips are the prize table less the fee", () => {
  const restore = setTrialForTests(true);
  assert.equal(SETTINGS.trial, true);
  assert.equal(publicRules().trial, true);
  const restoreOff = setTrialForTests(false);
  assert.equal(SETTINGS.trial, false);
  assert.equal(publicRules().trial, false);
  restoreOff();
  assert.equal(SETTINGS.trial, true, "the undo goes back to what it was");
  restore();
  assert.deepEqual(chipResults(1000), [1000, 100, -500, -1000]);
  assert.deepEqual(chipResults(200), [200, 20, -100, -200]);
  assert.deepEqual(publicRules().stakes.find((row) => row.fee === 2500).chips, [2500, 250, -1250, -2500]);
});

test("badges: what a finished game makes eligible", () => {
  const win = (seat, extra = {}) => ({ seat, from: seat, tsumo: false, limit: null, yaku: [], ...extra });
  const hand = (...wins) => ({ result: { type: "win", wins } });
  const draw = { result: { type: "draw", reason: "exhaustive" } };
  assert.deepEqual(records.badgesEarned({ hands: [draw], seat: 0, place: 4 }), ["first_game"]);
  assert.deepEqual(records.badgesEarned({ hands: [draw], seat: 0, place: 1 }), ["first_game", "first_table_win"]);
  // Somebody else's win is not mine.
  assert.deepEqual(records.badgesEarned({ hands: [hand(win(2, { tsumo: true, limit: "mangan" }))], seat: 0, place: 3 }), ["first_game"]);
  assert.deepEqual(records.badgesEarned({ hands: [hand(win(0))], seat: 0, place: 2 }), ["first_game", "first_win"]);
  assert.deepEqual(records.badgesEarned({ hands: [hand(win(0, { tsumo: true }))], seat: 0, place: 2 }), ["first_game", "first_win", "first_tsumo"]);
  assert.deepEqual(records.badgesEarned({ hands: [hand(win(0, { yaku: [{ key: "riichi" }] }))], seat: 0, place: 2 }), ["first_game", "first_win", "first_riichi_win"]);
  assert.ok(records.badgesEarned({ hands: [hand(win(0, { yaku: [{ key: "double-riichi" }] }))], seat: 0, place: 2 }).includes("first_riichi_win"));
  assert.deepEqual(records.badgesEarned({ hands: [hand(win(0, { limit: "haneman" }))], seat: 0, place: 2 }), ["first_game", "first_win", "first_mangan"]);
  // A double ron: both winners are counted.
  assert.ok(records.badgesEarned({ hands: [hand(win(1), win(3, { tsumo: false, limit: "mangan" }))], seat: 3, place: 2 }).includes("first_mangan"));
  const everything = records.badgesEarned({ hands: [hand(win(0, { tsumo: true, limit: "mangan", yaku: [{ key: "riichi" }] }))], seat: 0, place: 1 });
  assert.deepEqual(everything, records.BADGES);
});

// ── End to end ─────────────────────────────────────────────────────────────
test("mahjong trial mode, end to end", { skip: !databaseUrl, timeout: 600_000 }, async (t) => {
  const target = new URL(databaseUrl);
  assert.ok(["127.0.0.1", "localhost"].includes(target.hostname));
  assert.equal(target.pathname, "/nasfaq_chat_test");
  const admin = new Pool({ connectionString: databaseUrl });
  try {
    await admin.query("DROP DATABASE IF EXISTS nasfaq_mahjong_trial_test WITH (FORCE)");
    await admin.query("CREATE DATABASE nasfaq_mahjong_trial_test");
  } finally {
    await admin.end();
  }
  target.pathname = "/nasfaq_mahjong_trial_test";
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
  const savedSalt = process.env.IP_HASH_SALT;
  process.env.IP_HASH_SALT = "mahjong-trial-test-salt";
  await tables.init(pool, { onTableOver: tournaments.onTableOver });
  const stopTournaments = tournaments.init(pool, tables);
  let closeServer = async () => {};
  t.after(async () => {
    stopTournaments();
    tables.reset();
    await closeServer();
    restoreFlags();
    restoreTrial();
    if (savedSalt === undefined) delete process.env.IP_HASH_SALT;
    else process.env.IP_HASH_SALT = savedSalt;
    await pool.end();
  });

  let ipSeq = 0;
  const user = async (name, { cash = 20000, credit = 90000, ip = null, verified = true, ageDays = 30, admin: isAdmin = false } = {}) => {
    ipSeq += 1;
    const { rows } = await pool.query(
      `INSERT INTO market.users (username, username_normalized, email, email_verified, password_hash, password_salt, password_params_json, signup_ip_hash, created_at)
       VALUES ($1, $1, $1 || '@example.test', $2, 'x', 'x', '{}', $3, now() - make_interval(days => $4)) RETURNING id`,
      [name, verified, ipHash.hashIp(ip ?? `10.8.${Math.floor(ipSeq / 250)}.${ipSeq % 250}`), ageDays]
    );
    await pool.query(`INSERT INTO market.portfolio_cash_balances (user_id, cash_balance, credit_balance) VALUES ($1, $2, $3)`, [rows[0].id, cash, credit]);
    const id = Number(rows[0].id);
    users.set(id, { id, email_verified: verified, is_admin: isAdmin });
    return id;
  };
  const users = new Map();
  const balances = async (id) => {
    const { rows } = await pool.query(`SELECT cash_balance, credit_balance FROM market.portfolio_cash_balances WHERE user_id = $1`, [id]);
    return { cash: Number(rows[0].cash_balance), credit: Number(rows[0].credit_balance) };
  };
  const ledger = async (id) => {
    const { rows } = await pool.query(`SELECT entry_type, cash_delta, credit_delta FROM market.ledger_entries WHERE user_id = $1 ORDER BY id`, [id]);
    return rows.map((row) => ({ type: row.entry_type, cash: Number(row.cash_delta), credit: Number(row.credit_delta) }));
  };
  /** Every row the economy writes to, as text, plus each player's net worth: equal before and after means nothing moved. */
  const snapshot = async (ids) => {
    const dump = async (sql) => (await pool.query(`SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb)::text AS rows FROM (${sql}) t`)).rows[0].rows;
    const worth = [];
    for (const id of ids) worth.push(JSON.stringify(await getCurrentNetWorth(pool, id)));
    return {
      wallets: await dump(`SELECT * FROM market.portfolio_cash_balances ORDER BY user_id`),
      ledger: await dump(`SELECT * FROM market.ledger_entries ORDER BY id`),
      entries: await dump(`SELECT * FROM games.mahjong_entries ORDER BY id`),
      holdings: await dump(`SELECT * FROM market.portfolio_holdings ORDER BY user_id, asset_id`),
      worth,
    };
  };
  const liveTable = (id) => tables._tables.get(id);

  async function playOut(tableId, { asUsers = true } = {}) {
    const table = liveTable(tableId);
    for (let guard = 0; guard < 20_000 && table.status === "playing"; guard += 1) {
      if (table.between) {
        table.between.until = 0;
        await tables.withLock(table.id, () => tables._tick(table));
        continue;
      }
      const hand = table.game.hand;
      const waiting = round.waitingSeats(hand);
      const human = waiting.find((seat) => !table.seats[seat].bot && !table.seats[seat].away);
      if (asUsers && human !== undefined) {
        await tables.actOnTable({ userId: table.seats[human].user_id, tableId, action: bot.decide(hand, human, { level: "normal", random: () => 0.5 }) });
      } else {
        for (const ask of Object.values(table.asks)) ask.due = 0;
        await tables.withLock(table.id, () => tables._tick(table));
      }
    }
    assert.equal(table.status, "done", "the table finishes");
    return table;
  }

  await t.test("a chip game moves no Cash or Credit and checks nothing about money", async () => {
    const fee = 1000;
    const poor = await user("chip_poor", { cash: 100, credit: 30000 }); // little Cash
    const fresh = await user("chip_fresh", { ageDays: 0 }); // too new for a paid table
    const red = await user("chip_red", { cash: 200000, credit: -50 }); // in the red
    const twin = await user("chip_twin", { ip: "10.77.0.1" });
    await pool.query(`UPDATE market.users SET signup_ip_hash = (SELECT signup_ip_hash FROM market.users WHERE id = $1) WHERE id = $2`, [poor, twin]); // same network as `poor`
    const ids = [poor, fresh, red, twin];
    // The weekly cap would stop all of them at a paid table: fill the week to prove nothing counts it.
    await pool.query(`INSERT INTO games.mahjong_entries (user_id, game_id, fee, max_net, payout, status, settled_at) VALUES ($1, NULL, 9900, 0, 0, 'settled', now())`, [twin]);
    const before = await snapshot(ids);

    const first = await tables.createTable({ userId: poor, kind: "stakes", tier: fee, length: "east" });
    const id = first.table.id;
    assert.equal(first.table.chips, true);
    assert.deepEqual(first.table.chip_results, [1000, 100, -500, -1000]);
    assert.equal(first.table.fee, fee, "the table is still labeled by its stake");
    assert.equal(first.table.status, "waiting");
    assert.ok(first.table.starts_at > Date.now(), "the bot wait starts with the first player, as in quick match");
    for (const other of [fresh, red, twin]) {
      const seated = await tables.createTable({ userId: other, kind: "stakes", tier: fee });
      assert.equal(seated.table.id, id, "everyone lands at the one open table, same network or not");
    }
    const table = liveTable(id);
    assert.ok(table.seats.every((seat) => seat && !seat.bot));
    assert.ok(table.seats.every((seat) => seat.fee === 0));
    assert.ok(table.startAt, "full: it starts soon");
    table.startAt = 1;
    await tables.withLock(id, () => tables._tick(table));
    assert.equal(table.status, "playing");
    await playOut(id);
    await new Promise((resolve) => setTimeout(resolve, 200));

    assert.deepEqual(await snapshot(ids), before, "wallets, ledger, entries, holdings and net worth are byte for byte what they were");
    const record = await records.getGame(pool, id);
    const nets = chipResults(fee);
    for (const player of record.players) {
      assert.equal(player.chips, nets[player.place - 1]);
      assert.equal(player.payout, 0);
    }
    assert.deepEqual(record.players.map((player) => player.chips).sort((a, b) => a - b), [-1000, -500, 100, 1000]);
    // The game-over payload carries them too.
    for (const line of table.result.standings) assert.equal(line.chips, nets[line.place - 1]);
    assert.deepEqual((await pool.query(`SELECT COUNT(*)::int AS n FROM games.mahjong_entries WHERE game_id = $1`, [id])).rows[0], { n: 0 });
    assert.equal((await pool.query(`SELECT entry_fee::int AS fee FROM games.mahjong_games WHERE id = $1`, [id])).rows[0].fee, fee);
    assert.equal(tables.tableOfUser(poor), null);
  });

  await t.test("bots fill a chip table after the wait, get no chips, and an unfinished game records none", async () => {
    const solo = await user("chip_solo");
    const before = await snapshot([solo]);
    const seated = await tables.createTable({ userId: solo, kind: "stakes", tier: 200 });
    const id = seated.table.id;
    const table = liveTable(id);
    assert.equal(table.status, "waiting");
    table.startAt = 1;
    await tables.withLock(id, () => tables._tick(table));
    assert.equal(table.status, "playing", "no four-player requirement in trial");
    assert.equal(table.seats.filter((seat) => seat.bot === "normal").length, 3);
    await playOut(id);
    const { rows } = await pool.query(`SELECT user_id, bot_level, chips, place FROM games.mahjong_game_players WHERE game_id = $1 ORDER BY seat`, [id]);
    assert.equal(rows.length, 4);
    for (const row of rows) {
      if (row.user_id) assert.equal(row.chips, chipResults(200)[row.place - 1]);
      else assert.equal(row.chips, null, "bots get no chips");
    }
    assert.equal(rows.filter((row) => row.chips !== null).length, 1);
    assert.deepEqual(await snapshot([solo]), before);

    // Cancelled or cut short: nothing is recorded.
    const stood = await user("chip_stood");
    const waiting = await tables.createTable({ userId: stood, kind: "stakes", tier: 1000 });
    await tables.leaveTable({ userId: stood, tableId: waiting.table.id });
    const cut = await user("chip_cut");
    const live = await tables.createTable({ userId: cut, kind: "stakes", tier: 1000 });
    const liveId = live.table.id;
    const cutTable = liveTable(liveId);
    cutTable.startAt = 1;
    await tables.withLock(liveId, () => tables._tick(cutTable));
    assert.equal(cutTable.status, "playing");
    tables.reset();
    await records.cancelUnfinishedGames(pool);
    const { rows: none } = await pool.query(`SELECT COUNT(*)::int AS n FROM games.mahjong_game_players WHERE game_id = ANY($1::bigint[]) AND chips IS NOT NULL`, [[liveId, waiting.table.id]]);
    assert.equal(none[0].n, 0);
    assert.deepEqual(await ledger(cut), []);
  });

  await t.test("the chip leaderboards: this week from Saturday 00:00 New York, all time, and the viewer's own line", async () => {
    const lbA = await user("lb_a");
    const lbB = await user("lb_b");
    const lbC = await user("lb_c");
    const unverified = await user("lb_unverified", { verified: false });
    const { rows: edge } = await pool.query(
      `SELECT ((date_trunc('week', ((now() AT TIME ZONE 'America/New_York')::date + 2)::timestamp) - interval '2 days') AT TIME ZONE 'America/New_York') AS week_start`
    );
    const weekStart = new Date(edge[0].week_start);
    // The week starts on a Saturday at midnight New York, and the cap's own boundary is the same instant.
    assert.match(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "long", hour: "numeric", hourCycle: "h23" }).format(weekStart), /^Saturday,? 00$/);
    const plan = await limits.readPlan(pool, lbA);
    assert.equal(new Date(plan.week_resets_at).getTime() - weekStart.getTime() >= 7 * 86_400_000 - 3_600_000, true);
    const synthetic = async (userId, chips, completedAt) => {
      const { rows } = await pool.query(`INSERT INTO games.mahjong_games (kind, status, entry_fee, completed_at) VALUES ('stakes', 'completed', 1000, $1) RETURNING id`, [completedAt]);
      await pool.query(`INSERT INTO games.mahjong_game_players (game_id, seat, user_id, name, chips) VALUES ($1, 0, $2, 'x', $3)`, [rows[0].id, userId, chips]);
      return Number(rows[0].id);
    };
    const justBefore = new Date(weekStart.getTime() - 60_000);
    const justAfter = new Date(weekStart.getTime() + 60_000);
    await synthetic(lbA, 5000, justBefore); // last week
    await synthetic(lbA, 100, justAfter);
    await synthetic(lbB, -300, justAfter);
    await synthetic(lbB, 40, justAfter);
    await synthetic(unverified, 99999, justAfter);
    // A game still being played, a cancelled one, and a chip-less one count for nothing.
    const { rows: playing } = await pool.query(`INSERT INTO games.mahjong_games (kind, status, entry_fee) VALUES ('stakes', 'playing', 1000) RETURNING id`);
    await pool.query(`INSERT INTO games.mahjong_game_players (game_id, seat, user_id, name, chips) VALUES ($1, 0, $2, 'x', 7777)`, [playing[0].id, lbC]);
    await synthetic(lbC, null, justAfter);

    const week = await records.chipLeaderboard(pool, { range: "week", viewerId: lbA });
    assert.equal(week.range, "week");
    const pick = (list, name) => list.leaders.find((row) => row.username === name);
    assert.deepEqual({ chips: pick(week, "lb_a").chips, games: pick(week, "lb_a").games }, { chips: 100, games: 1 }, "last week's +5,000 is out");
    assert.deepEqual({ chips: pick(week, "lb_b").chips, games: pick(week, "lb_b").games }, { chips: -260, games: 2 });
    assert.equal(pick(week, "lb_c"), undefined);
    assert.equal(pick(week, "lb_unverified"), undefined, "unverified accounts aren't ranked");
    assert.deepEqual(week.leaders.map((row) => row.rank), week.leaders.map((_, index) => index + 1));
    assert.ok(week.leaders.every((row, index) => index === 0 || week.leaders[index - 1].chips >= row.chips), "best first");
    assert.deepEqual(week.me, pick(week, "lb_a"));

    const all = await records.chipLeaderboard(pool, { range: "all", viewerId: lbB });
    assert.deepEqual({ chips: pick(all, "lb_a").chips, games: pick(all, "lb_a").games }, { chips: 5100, games: 2 });
    assert.equal(all.me.username, "lb_b");
    assert.equal(all.me.chips, -260);

    // The viewer with no chip games gets a line without a rank; a signed-out viewer gets none.
    const none = await records.chipLeaderboard(pool, { range: "week", viewerId: lbC });
    assert.deepEqual(none.me, { rank: null, username: "lb_c", chips: 0, games: 0 });
    assert.equal((await records.chipLeaderboard(pool, { range: "week" })).me, null);
    // An unranked (unverified) viewer still sees their own result.
    const own = await records.chipLeaderboard(pool, { range: "all", viewerId: unverified });
    assert.equal(own.me.chips, 99999);
    assert.equal(own.leaders.some((row) => row.username === "lb_unverified"), false);

    assert.deepEqual(await records.chipTotals(pool, lbA), { week: 100, week_games: 1, all: 5100, all_games: 2 });
    assert.deepEqual(await records.chipTotals(pool, lbC), { week: 0, week_games: 0, all: 0, all_games: 0 });
  });

  await t.test("payEntry and the prize payout refuse to run in trial mode, and a paid tournament can't be made or joined", async () => {
    const payer = await user("guard_payer");
    const before = await snapshot([payer]);
    await assert.rejects(records.inTransaction(pool, (client) => records.payEntry(client, { userId: payer, gameId: 1, fee: 200, maxNet: 200 })), { code: "trial_mode" });
    await assert.rejects(records.inTransaction(pool, (client) => records.payPrize(client, { userId: payer, amount: 100, gameId: 1 })), { code: "trial_mode" });
    await assert.rejects(records.inTransaction(pool, (client) => records.payPrize(client, { userId: payer, amount: 100, tournamentId: 1 })), { code: "trial_mode" });
    assert.deepEqual(await snapshot([payer]), before, "and nothing moved");

    const soon = new Date(Date.now() + 3_600_000);
    await assert.rejects(tournaments.create(pool, { name: "Fee tournament", seats: 4, entryFee: 200, startsAt: soon }), { code: "trial_no_fees" });
    await assert.rejects(tournaments.create(pool, { name: "Rich tournament", seats: 16, entryFee: 99999, startsAt: soon }), { code: "trial_no_fees" });
    const free = await tournaments.create(pool, { name: "Free tournament", seats: 4, entryFee: 0, startsAt: soon });
    assert.equal(free.entry_fee, 0);
    await tournaments.register(pool, { tournamentId: free.id, userId: payer });
    assert.deepEqual(await snapshot([payer]), before);
    // A paid one booked before trial mode: nobody can join it now ...
    const restorePaid = setTrialForTests(false);
    const booked = await tournaments.create(pool, { name: "Booked earlier", seats: 4, finalLength: "east", entryFee: 500, startsAt: soon });
    const entrants = [];
    for (const name of ["old_1", "old_2", "old_3"]) {
      const id = await user(name);
      entrants.push(id);
      await tournaments.register(pool, { tournamentId: booked.id, userId: id });
    }
    assert.deepEqual(await balances(entrants[0]), { cash: 20000, credit: 89500 });
    restorePaid();
    const late = await user("old_late");
    await assert.rejects(tournaments.register(pool, { tournamentId: booked.id, userId: late }), { code: "trial_no_fees" });
    // ... and when it starts, every fee goes back and no prize is ever paid.
    await pool.query(`UPDATE games.mahjong_tournaments SET starts_at = now() - interval '1 second' WHERE id = $1`, [booked.id]);
    await tournaments.tick();
    const started = await tournaments.get(pool, booked.id);
    assert.equal(started.tournament.status, "running");
    assert.equal(started.tournament.paid, false);
    for (const id of entrants) assert.deepEqual(await balances(id), { cash: 20000, credit: 90000 }, "fees refunded");
    await tournaments.cancel(pool, { tournamentId: booked.id });
    await tournaments.cancel(pool, { tournamentId: free.id });
    tables.reset();
  });

  await t.test("with trial off, a stakes table still charges and refunds as before", async () => {
    const restore = setTrialForTests(false);
    try {
      const payer = await user("paid_smoke");
      const seated = await tables.createTable({ userId: payer, kind: "stakes", tier: 200 });
      assert.equal(seated.table.chips, false);
      assert.equal(seated.table.chip_results, null);
      assert.deepEqual(await balances(payer), { cash: 20000, credit: 89800 });
      assert.deepEqual(await ledger(payer), [{ type: "mahjong_entry_fee", cash: 0, credit: -200 }]);
      await tables.leaveTable({ userId: payer, tableId: seated.table.id });
      assert.deepEqual(await balances(payer), { cash: 20000, credit: 90000 });
      assert.equal(publicRules().trial, false);
      // And the checks are back: a player in the red is turned away.
      const red = await user("paid_red", { cash: 100, credit: -50 });
      await assert.rejects(tables.createTable({ userId: red, kind: "stakes", tier: 200 }), { code: "in_the_red" });
    } finally {
      restore();
    }
  });

  // ── Routes: feedback, the leaderboard and badges endpoints ────────────────
  const mahjongRoutes = require("../src/routes/mahjong");
  const app = express();
  app.use(async (req, _res, next) => {
    const id = Number(req.get("x-test-user")) || null;
    req.ctx = { pool, redis: null, user: id ? users.get(id) : null };
    next();
  });
  app.use(express.json());
  app.use("/api/games/mahjong", mahjongRoutes.site);
  app.use((error, _req, res, _next) => {
    const code = error?.code;
    if (code === "unauthenticated") return res.status(401).json({ error: code });
    return res.status(500).json({ error: String(code || error?.message || error) });
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  closeServer = () => {
    server.closeAllConnections();
    return new Promise((resolve) => server.close(resolve));
  };
  const base = `http://127.0.0.1:${server.address().port}/api/games/mahjong`;
  const call = async (method, path, { as = null, body } = {}) => {
    const res = await fetch(`${base}${path}`, { method, headers: { ...(body ? { "content-type": "application/json" } : {}), ...(as ? { "x-test-user": String(as) } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {}
    return { status: res.status, body: json };
  };

  await t.test("feedback: length limits, signed in only, five an hour, staff read it newest first", async () => {
    const writer = await user("fb_writer");
    assert.equal((await call("POST", "/feedback", { body: { body: "hello" } })).status, 401, "signed in only");
    const empty = await call("POST", "/feedback", { as: writer, body: { body: "" } });
    assert.deepEqual([empty.status, empty.body], [400, { error: "invalid_feedback", field: "body" }]);
    assert.equal((await call("POST", "/feedback", { as: writer, body: { body: "   \n  " } })).status, 400, "trimmed to nothing");
    assert.equal((await call("POST", "/feedback", { as: writer, body: { body: "x".repeat(2001) } })).status, 400);
    assert.equal((await call("POST", "/feedback", { as: writer, body: { body: ["not", "text"] } })).status, 400);
    const bad = await call("POST", "/feedback", { as: writer, body: { body: "ok", table_id: "abc" } });
    assert.deepEqual([bad.status, bad.body], [400, { error: "invalid_feedback", field: "table_id" }]);
    const writer2 = await user("fb_writer2");
    const longest = await call("POST", "/feedback", { as: writer2, body: { body: `  ${"y".repeat(2000)}  `, table_id: 800000000001, game_id: 42, page: "p".repeat(300) } });
    assert.equal(longest.status, 201);
    assert.equal(typeof longest.body.id, "number");
    const { rows } = await pool.query(`SELECT * FROM games.mahjong_feedback WHERE id = $1`, [longest.body.id]);
    assert.equal(rows[0].body.length, 2000, "stored trimmed");
    assert.equal(rows[0].page.length, 200);
    assert.equal(Number(rows[0].table_id), 800000000001);
    assert.equal(Number(rows[0].game_id), 42);

    // Five an hour per player; the sixth is turned away.
    const talker = await user("fb_talker");
    const sent = [];
    for (let i = 0; i < 6; i += 1) sent.push((await call("POST", "/feedback", { as: talker, body: { body: `note ${i}` } })).status);
    assert.deepEqual(sent, [201, 201, 201, 201, 201, 429]);
    // Someone else has their own budget.
    assert.equal((await call("POST", "/feedback", { as: await user("fb_other"), body: { body: "hi" } })).status, 201);

    // Staff only; newest first, 50 a page, with the username.
    const staff = await user("fb_staff", { admin: true });
    assert.equal((await call("GET", "/admin/feedback")).status, 403, "signed out");
    assert.equal((await call("GET", "/admin/feedback", { as: writer })).status, 403);
    for (let i = 0; i < 60; i += 1) await pool.query(`INSERT INTO games.mahjong_feedback (user_id, body) VALUES ($1, $2)`, [writer, `bulk ${i}`]);
    const pageOne = await call("GET", "/admin/feedback", { as: staff });
    assert.equal(pageOne.status, 200);
    assert.equal(pageOne.body.feedback.length, 50);
    assert.deepEqual(Object.keys(pageOne.body.feedback[0]).sort(), ["body", "created_at", "game_id", "id", "page", "table_id", "user_id", "username"]);
    assert.equal(pageOne.body.feedback[0].body, "bulk 59");
    assert.equal(pageOne.body.feedback[0].username, "fb_writer");
    const ids = pageOne.body.feedback.map((row) => row.id);
    assert.deepEqual(ids, [...ids].sort((a, b) => b - a));
    assert.equal(pageOne.body.next_before, ids[49]);
    const pageTwo = await call("GET", `/admin/feedback?before=${pageOne.body.next_before}`, { as: staff });
    assert.ok(pageTwo.body.feedback.length >= 10 && pageTwo.body.feedback.every((row) => row.id < ids[49]));
    assert.equal((await call("GET", "/admin/feedback?before=abc", { as: staff })).status, 400);
  });

  await t.test("single-hand practice ends after one hand; practice only", async () => {
    const player = await user("one_hand");
    for (const kind of ["ranked", "friend", "stakes", "tutorial"]) {
      await assert.rejects(tables.createTable({ userId: player, kind, length: "hand", tier: 200 }), { code: "invalid_table" });
      await assert.rejects(tables.createTable({ userId: player, kind, speed: "untimed", tier: 200 }), { code: "invalid_table" });
    }
    const seated = await tables.createTable({ userId: player, kind: "practice", length: "hand", level: "easy" });
    assert.equal(seated.table.length, "hand");
    assert.equal(seated.table.game.length, "hand");
    const table = liveTable(seated.table.id);
    await playOut(seated.table.id);
    assert.equal(table.game.hands.length, 1, "one hand was played");
    assert.equal(table.result.standings.length, 4);
    assert.equal(table.game.over, true);
    assert.equal(tables.tableOfUser(player), null);
    // The usual lengths are unchanged.
    const normal = await tables.createTable({ userId: player, kind: "practice", length: "east" });
    assert.equal(normal.table.length, "east");
    await tables.leaveTable({ userId: player, tableId: normal.table.id });
  });

  await t.test("untimed practice has no clock, no bank and never plays for the human", async () => {
    const player = await user("no_clock");
    const seated = await tables.createTable({ userId: player, kind: "practice", speed: "untimed", level: "easy" });
    const id = seated.table.id;
    const table = liveTable(id);
    assert.equal(seated.table.speed, "untimed");
    // Bots move; stop when it is the human's turn.
    for (let guard = 0; guard < 200 && !round.waitingSeats(table.game.hand).some((seat) => !table.seats[seat].bot); guard += 1) {
      for (const ask of Object.values(table.asks)) ask.due = 0;
      await tables.withLock(id, () => tables._tick(table));
    }
    const mine = table.seats.findIndex((seat) => !seat.bot);
    assert.ok(round.waitingSeats(table.game.hand).includes(mine), "waiting on the human");
    const ask = table.asks[mine];
    assert.equal(ask.kind, "human");
    assert.equal(ask.deadline, null, "no deadline");
    assert.ok(ask.due > Date.now() + 10 * 60_000, "nothing comes due for a long time");
    const view = (await tables.getTable({ tableId: id, userId: player })).table;
    assert.equal(view.clock, null);
    assert.equal(view.me.deadline, null);
    assert.equal(view.me.turn_ms, null);
    assert.equal(table.seats[mine].bank, 0);
    for (let i = 0; i < 5; i += 1) await tables.withLock(id, () => tables._tick(table));
    assert.equal(table.seats[mine].away, false);
    assert.equal(table.seats[mine].timeouts, 0);
    assert.ok(round.waitingSeats(table.game.hand).includes(mine), "still the human's move");
    // They can play on, and a clocked practice table (the default) still has its deadline.
    await tables.actOnTable({ userId: player, tableId: id, action: bot.decide(table.game.hand, mine, { level: "normal", random: () => 0.5 }) });
    // Left alone far too long, the table is closed rather than played for them.
    for (let guard = 0; guard < 200 && !round.waitingSeats(table.game.hand).some((seat) => !table.seats[seat].bot); guard += 1) {
      for (const ask2 of Object.values(table.asks)) if (ask2.kind === "bot") ask2.due = 0;
      await tables.withLock(id, () => tables._tick(table));
    }
    table.asks[mine].due = 0;
    await tables.withLock(id, () => tables._tick(table));
    assert.equal(table.status, "cancelled");
    assert.equal(table.result.cancelled, "idle");
    assert.equal(tables.tableOfUser(player), null);

    const clocked = await tables.createTable({ userId: player, kind: "practice", level: "easy" });
    const clockedTable = liveTable(clocked.table.id);
    const clockedMine = clockedTable.seats.findIndex((seat) => !seat.bot);
    for (let guard = 0; guard < 200 && !round.waitingSeats(clockedTable.game.hand).includes(clockedMine); guard += 1) {
      for (const ask3 of Object.values(clockedTable.asks)) ask3.due = 0;
      await tables.withLock(clockedTable.id, () => tables._tick(clockedTable));
    }
    assert.ok(Number.isFinite(clockedTable.asks[clockedMine].deadline), "a normal practice table has a clock");
    await tables.leaveTable({ userId: player, tableId: clocked.table.id });
  });

  await t.test("a coached single-hand game hands the seat its review at game over; an uncoached table has none", async () => {
    const player = await user("review_hand");
    const seated = await tables.createTable({ userId: player, kind: "practice", length: "hand", level: "easy" });
    assert.equal(seated.table.coach, true, "solo practice is coached");
    assert.equal(seated.table.me.review, null, "nothing to review mid-game");
    const done = await playOut(seated.table.id);
    const me = (await tables.getTable({ tableId: done.id, userId: player })).table.me;
    const seatIndex = done.seats.findIndex((entry) => entry.user_id === player);
    assert.equal(me.review.seat, seatIndex);
    assert.equal(typeof me.review.outcome, "string");
    assert.ok(me.review.final);
    for (const entry of [...(me.review.final.waits ?? []), ...(me.review.final.improve ?? [])]) {
      assert.ok(entry.copies, "copies are counted");
      assert.ok(entry.copies.wall !== null && entry.copies.dead_wall !== null, "the wall is known once the game is over");
    }
    assert.equal(tables.publicTable(liveTable(done.id), null).me, undefined, "spectators get none");

    // The same finished game on a table without the coach: no review.
    const finished = liveTable(done.id);
    finished.coach = false;
    finished.finalReviews = undefined;
    assert.equal(tables.publicTable(finished, seatIndex).me.review ?? null, null);
  });

  await t.test("a weekly repeat booked in trial mode is free", async () => {
    const soon = new Date(Date.now() + 3_600_000);
    const restorePaid = setTrialForTests(false);
    const weekly = await tournaments.create(pool, { name: "Weekly repeat check", seats: 4, entryFee: 500, startsAt: soon, repeatWeekly: true });
    restorePaid();
    assert.equal(weekly.entry_fee, 500);
    // Nobody entered, so starting it cancels it and books the next edition.
    await pool.query(`UPDATE games.mahjong_tournaments SET starts_at = now() - interval '1 second' WHERE id = $1`, [weekly.id]);
    await tournaments.tick();
    const { rows } = await pool.query(`SELECT entry_fee, paid, status FROM games.mahjong_tournaments WHERE name = 'Weekly repeat check' AND status = 'signup'`);
    assert.equal(rows.length, 1, "the next edition is booked");
    assert.equal(Number(rows[0].entry_fee), 0);
    assert.equal(rows[0].paid, false);
    await pool.query(`UPDATE games.mahjong_tournaments SET repeat_weekly = false, status = 'cancelled' WHERE name = 'Weekly repeat check'`);
  });

  await t.test("first-time badges are awarded once, in recorded games and practice, never in the tutorial", async () => {
    const player = await user("badger");
    // Practice (not recorded): the first game earns first_game, and the seat is told.
    const one = await tables.createTable({ userId: player, kind: "practice", length: "hand", level: "easy" });
    const first = await playOut(one.table.id);
    const seat = first.seats.findIndex((entry) => entry.user_id === player);
    const told = (await tables.getTable({ tableId: first.id, userId: player })).table.me.badges_earned;
    assert.ok(told.includes("first_game"), `told ${JSON.stringify(told)}`);
    const held = (await records.badgesOf(pool, player)).map((row) => row.badge);
    assert.deepEqual([...held].sort(), [...told].sort());
    assert.ok(held.includes("first_game"));
    assert.equal(first.seats[seat].user_id, player);
    // The second game earns the same ones nothing.
    const two = await tables.createTable({ userId: player, kind: "practice", length: "hand", level: "easy" });
    const second = await playOut(two.table.id);
    const secondTold = (await tables.getTable({ tableId: second.id, userId: player })).table.me.badges_earned;
    assert.ok(!secondTold.includes("first_game"));
    assert.deepEqual(secondTold.filter((key) => held.includes(key)), [], "never twice");
    const { rows: dupes } = await pool.query(`SELECT badge, COUNT(*)::int AS n FROM games.mahjong_badges WHERE user_id = $1 GROUP BY badge HAVING COUNT(*) > 1`, [player]);
    assert.deepEqual(dupes, []);

    // A recorded game awards inside finishGame and puts the badge on the record.
    const solo = await user("badger_rec");
    const seatedRec = await tables.createTable({ userId: solo, kind: "ranked" });
    const recTable = liveTable(seatedRec.table.id);
    recTable.startAt = 1;
    await tables.withLock(recTable.id, () => tables._tick(recTable));
    await playOut(recTable.id);
    const recBadges = await records.badgesOf(pool, solo);
    assert.ok(recBadges.some((row) => row.badge === "first_game" && row.game_id === recTable.id));
    assert.equal((await records.playerRecord(pool, "badger_rec")).badges.length, recBadges.length);
    assert.ok(recTable.seats.find((entry) => entry.user_id === solo).badgesEarned.includes("first_game"));

    // Granting is once per player and badge, whatever is asked.
    const direct = await user("badger_direct");
    assert.deepEqual(await records.grantBadges(pool, { userId: direct, keys: records.BADGES }), records.BADGES);
    assert.deepEqual(await records.grantBadges(pool, { userId: direct, keys: records.BADGES }), []);
    assert.deepEqual(await records.grantBadges(pool, { userId: direct, keys: [] }), []);
    assert.equal((await pool.query(`SELECT COUNT(*)::int AS n FROM games.mahjong_badges WHERE user_id = $1`, [direct])).rows[0].n, records.BADGES.length);

    // The endpoint.
    const mine = await call("GET", "/badges/me", { as: solo });
    assert.equal(mine.status, 200);
    assert.deepEqual(mine.body.badges.map((row) => row.badge).sort(), recBadges.map((row) => row.badge).sort());
    assert.equal((await call("GET", "/badges/me")).status, 401);
    const me = await call("GET", "/me", { as: solo });
    assert.equal(me.body.trial, true);
    assert.deepEqual(Object.keys(me.body.chips).sort(), ["all", "all_games", "week", "week_games"]);
    assert.equal(me.body.badges.length, recBadges.length);
    const board = await call("GET", "/chips/leaderboard?range=all", { as: solo });
    assert.equal(board.status, 200);
    assert.equal(board.body.range, "all");
    assert.equal(board.body.me.username, "badger_rec");
    assert.equal((await call("GET", "/chips/leaderboard?range=nonsense")).body.range, "week");
    assert.equal((await call("GET", "/rules")).body.rules.trial, true);

    // The tutorial never awards badges.
    const learner = await user("badger_learner");
    const lesson = await tables.createTable({ userId: learner, kind: "tutorial", lesson: "riichi" });
    const lessonTable = liveTable(lesson.table.id);
    const tileOf = (kind) => lessonTable.game.hand.hands[0].find((tile) => tile >> 2 === kind);
    const settle = async () => {
      while (lessonTable.status === "playing" && !lessonTable.between && !round.waitingSeats(lessonTable.game.hand).includes(0)) {
        for (const ask of Object.values(lessonTable.asks)) ask.due = 0;
        await tables.withLock(lessonTable.id, () => tables._tick(lessonTable));
      }
    };
    await tables.actOnTable({ userId: learner, tableId: lessonTable.id, action: { type: "discard", tile: tileOf(30) } });
    await settle();
    await tables.actOnTable({ userId: learner, tableId: lessonTable.id, action: { type: "pass" } });
    await settle();
    await tables.actOnTable({ userId: learner, tableId: lessonTable.id, action: { type: "discard", tile: tileOf(29), riichi: true } });
    await settle();
    await tables.actOnTable({ userId: learner, tableId: lessonTable.id, action: { type: "tsumo" } });
    lessonTable.between.until = 0;
    await tables.withLock(lessonTable.id, () => tables._tick(lessonTable));
    assert.equal(lessonTable.status, "done");
    assert.deepEqual(await records.badgesOf(pool, learner), []);
  });
});
