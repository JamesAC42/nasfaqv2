const test = require("node:test");
const assert = require("node:assert/strict");
const { Pool } = require("pg");

const { applySchema } = require("../src/migrations");
const economy = require("../src/services/economy");
const features = require("../src/features");
const ipHash = require("../src/services/ipHash");
const bot = require("../src/services/games/mahjong/bot");
const limits = require("../src/services/games/mahjong/limits");
const ratings = require("../src/services/games/mahjong/ratings");
const records = require("../src/services/games/mahjong/records");
const round = require("../src/services/games/mahjong/round");
const tables = require("../src/services/games/mahjong/tables");
const tournaments = require("../src/services/games/mahjong/tournaments");
const { SETTINGS, rankFor, stakesPrizeTable, tournamentPrizeTable } = require("../src/services/games/mahjong/settings");
const wallet = require("../src/services/games/wallet");

// Mahjong's tables and money: who may sit, what a seat costs and pays, the caps, and what a finished
// game writes down. The rules as numbers first, then end to end on a freshly migrated database.
const databaseUrl = process.env.CHAT_TEST_DATABASE_URL;

// ── The rules as numbers ───────────────────────────────────────────────────
test("a stakes table pays out less than it takes in, and the prize table is fixed by place", () => {
  for (const fee of SETTINGS.stakesTiers) {
    const table = stakesPrizeTable(fee);
    const paid = table.prizes.reduce((sum, prize) => sum + prize, 0);
    assert.equal(table.pot, fee * 4);
    assert.ok(paid < table.pot, "something always leaves circulation");
    assert.equal(Math.round((table.pot - paid) * 100) / 100, table.cut);
    assert.equal(table.cut, fee * 0.4, "a tenth of the pot");
    assert.deepEqual([...table.prizes].sort((a, b) => b - a), table.prizes, "first is paid most");
    assert.equal(table.prizes[3], 0, "last place gets nothing back");
    assert.equal(table.top_net, table.prizes[0] - fee);
    // The top table can't end a week on its own: four last places are the weekly minimum.
    assert.ok(fee * 4 <= SETTINGS.weeklyMinimum);
  }
  const tournament = tournamentPrizeTable(500, 16);
  assert.equal(tournament.pot, 8000);
  assert.equal(tournament.pool, 7200);
  assert.equal(tournament.prizes.reduce((sum, prize) => sum + prize, 0), 7200);
});

test("mahjong money goes through the games wallet as its own entry types, and the fee is under the floor rule", () => {
  assert.ok(wallet.VALID_ENTRY_TYPES.has("mahjong_entry_fee"));
  assert.ok(wallet.VALID_ENTRY_TYPES.has("mahjong_prize_payout"));
  assert.equal(economy.SETTINGS.sideModeFunds, "credit");
});

test("the weekly cap: room for the fee on the way down and for first prize on the way up", () => {
  const settings = { ...SETTINGS, weeklyMinimum: 10000, weeklyRate: 0.05, minNetWorth: 50000, paidGamesPerDay: 6 };
  const base = { credit: 90000, netWorth: 120000, weekNet: 0, openFees: 0, openMaxNet: 0, gamesToday: 0 };
  const fresh = limits.planLimits(base, settings);
  assert.equal(fresh.blocked, null);
  assert.equal(fresh.weekly_limit, 10000, "5% of $90,000 is under the $10,000 minimum");
  assert.equal(fresh.loss_room, 10000);
  assert.equal(fresh.win_room, 10000);
  assert.equal(limits.planLimits({ ...base, credit: 400000 }, settings).weekly_limit, 20000, "5% of Credit once that's more");

  // Down $9,000 with a $2,500 fee: no room. A $1,000 one still fits.
  const down = limits.planLimits({ ...base, weekNet: -9000 }, settings);
  assert.equal(down.loss_room, 1000);
  assert.throws(() => limits.assertCanEnter(down, { fee: 2500, topNet: 2500 }), { code: "mahjong_weekly_limit" });
  limits.assertCanEnter(down, { fee: 1000, topNet: 1000 });
  // Fees already out count as lost until they come back.
  assert.equal(limits.planLimits({ ...base, weekNet: -6000, openFees: 2500 }, settings).loss_room, 1500);
  // Up $9,000: a table whose first prize nets $2,500 would overshoot. One that nets $200 fits.
  const up = limits.planLimits({ ...base, weekNet: 9000 }, settings);
  assert.equal(up.win_room, 1000);
  assert.throws(() => limits.assertCanEnter(up, { fee: 2500, topNet: 2500 }), { code: "mahjong_weekly_limit" });
  limits.assertCanEnter(up, { fee: 200, topNet: 200 });
  // And the prizes open entries could still win hold room too.
  assert.equal(limits.planLimits({ ...base, weekNet: 5000, openMaxNet: 3100 }, settings).win_room, 1900);
  // At the cap either way, nothing paid is open.
  assert.equal(limits.planLimits({ ...base, weekNet: 10000 }, settings).blocked, "weekly_limit");
  assert.equal(limits.planLimits({ ...base, weekNet: -10000 }, settings).blocked, "weekly_limit");

  const floor = limits.planLimits({ ...base, netWorth: 49999 }, settings);
  assert.equal(floor.blocked, "net_worth");
  assert.throws(() => limits.assertCanEnter(floor, { fee: 200, topNet: 200 }), { code: "net_worth_floor", limit: 50000 });
  assert.equal(limits.planLimits({ ...base, credit: -5 }, settings).blocked, "in_the_red");
  const day = limits.planLimits({ ...base, gamesToday: 6 }, settings);
  assert.throws(() => limits.assertCanEnter(day, { fee: 200, topNet: 200 }), { code: "mahjong_daily_limit", limit: 6 });
});

test("ratings: players trade points with each other, bots never move, and beating bots stops paying", () => {
  const even = ratings.rateGame([1, 2, 3, 4].map((place) => ({ rating: 1500, games: 0, place, fixed: false })));
  assert.deepEqual(even, [16, 5.33, -5.33, -16]);
  assert.ok(Math.abs(even.reduce((sum, delta) => sum + delta, 0)) < 0.02, "four players at one rating: zero sum");

  const withBots = ratings.rateGame([
    { rating: 1500, games: 0, place: 1, fixed: false },
    { rating: 1450, games: 0, place: 2, fixed: true },
    { rating: 1450, games: 0, place: 3, fixed: true },
    { rating: 1450, games: 0, place: 4, fixed: true },
  ]);
  assert.deepEqual(withBots.slice(1), [0, 0, 0]);
  assert.ok(withBots[0] > 0);
  // The same win from 400 points above the bots is worth a small fraction; a last place costs nearly a full step.
  const strong = (place) =>
    ratings.rateGame([{ rating: 1850, games: 0, place, fixed: false }, ...[1, 2, 3].map((n) => ({ rating: 1450, games: 0, place: place === 1 ? n + 1 : n, fixed: true }))])[0];
  assert.ok(strong(1) < withBots[0] / 4, `a win far above the bots gains ${strong(1)}`);
  assert.ok(strong(4) < -25, `a last place far above the bots costs ${strong(4)}`);
  // Settled players move half as far.
  const settled = ratings.rateGame([1, 2, 3, 4].map((place) => ({ rating: 1500, games: 30, place, fixed: false })));
  assert.deepEqual(settled, [8, 2.67, -2.67, -8]);

  assert.equal(ratings.carryOver(1700), 1600);
  assert.equal(ratings.carryOver(1300), 1400);
  assert.match(ratings.seasonOf(new Date("2026-11-01T03:59:00Z")), /^2026-10$/, "a season turns over at midnight New York time");
  assert.equal(ratings.seasonOf(new Date("2026-11-01T05:00:00Z")), "2026-11");
  assert.equal(rankFor(1900, 2).key, "unranked");
  assert.equal(rankFor(1500, 3).key, "floor-trader");
  assert.equal(rankFor(1900, 10).key, "market-maker");
  assert.equal(rankFor(900, 10).key, "bagholder");
});

test("tournament brackets send the top two through and split table-mates up", () => {
  const table = (name) => ({ result: [1, 2, 3, 4].map((place) => ({ place, name: `${name}${place}`, user_id: null })) });
  const eight = tournaments.advancers({ tables: [table("A"), table("B")] });
  assert.deepEqual(eight.map((group) => group.map((line) => line.name)), [["A1", "B2", "B1", "A2"]]);
  const sixteen = tournaments.advancers({ tables: [table("A"), table("B"), table("C"), table("D")] });
  assert.deepEqual(sixteen.map((group) => group.map((line) => line.name)), [
    ["A1", "B2", "C1", "D2"],
    ["B1", "A2", "D1", "C2"],
  ]);
});

// ── End to end ─────────────────────────────────────────────────────────────
test("mahjong tables and money, end to end", { skip: !databaseUrl, timeout: 600_000 }, async (t) => {
  const target = new URL(databaseUrl);
  assert.ok(["127.0.0.1", "localhost"].includes(target.hostname));
  assert.equal(target.pathname, "/nasfaq_chat_test");
  const admin = new Pool({ connectionString: databaseUrl });
  try {
    await admin.query("DROP DATABASE IF EXISTS nasfaq_mahjong_test WITH (FORCE)");
    await admin.query("CREATE DATABASE nasfaq_mahjong_test");
  } finally {
    await admin.end();
  }
  target.pathname = "/nasfaq_mahjong_test";
  const pool = new Pool({ connectionString: target.href, options: "-c timezone=UTC" });
  const saved = [console.warn, console.log, console.info];
  console.warn = console.log = console.info = () => {};
  try {
    await applySchema(pool);
  } finally {
    [console.warn, console.log, console.info] = saved;
  }
  const restoreFlags = features.override({ mahjong: "on", "prediction-pools": "on" });
  const savedSalt = process.env.IP_HASH_SALT;
  process.env.IP_HASH_SALT = "mahjong-test-salt";
  await tables.init(pool, { onTableOver: tournaments.onTableOver });
  const stopTournaments = tournaments.init(pool, tables);
  t.after(async () => {
    stopTournaments();
    tables.reset();
    restoreFlags();
    if (savedSalt === undefined) delete process.env.IP_HASH_SALT;
    else process.env.IP_HASH_SALT = savedSalt;
    await pool.end();
  });

  let ipSeq = 0;
  const user = async (name, { cash = 20000, credit = 90000, ip = null, verified = true, ageDays = 30 } = {}) => {
    ipSeq += 1;
    const { rows } = await pool.query(
      `INSERT INTO market.users (username, username_normalized, email, email_verified, password_hash, password_salt, password_params_json, signup_ip_hash, created_at)
       VALUES ($1, $1, $1 || '@example.test', $2, 'x', 'x', '{}', $3, now() - make_interval(days => $4)) RETURNING id`,
      [name, verified, ipHash.hashIp(ip ?? `10.9.${Math.floor(ipSeq / 250)}.${ipSeq % 250}`), ageDays]
    );
    await pool.query(`INSERT INTO market.portfolio_cash_balances (user_id, cash_balance, credit_balance) VALUES ($1, $2, $3)`, [rows[0].id, cash, credit]);
    return Number(rows[0].id);
  };
  const balances = async (id) => {
    const { rows } = await pool.query(`SELECT cash_balance, credit_balance FROM market.portfolio_cash_balances WHERE user_id = $1`, [id]);
    return { cash: Number(rows[0].cash_balance), credit: Number(rows[0].credit_balance) };
  };
  const ledger = async (id) => {
    const { rows } = await pool.query(`SELECT entry_type, cash_delta, credit_delta FROM market.ledger_entries WHERE user_id = $1 ORDER BY id`, [id]);
    return rows.map((row) => ({ type: row.entry_type, cash: Number(row.cash_delta), credit: Number(row.credit_delta) }));
  };
  const liveTable = (id) => tables._tables.get(id);

  /** Plays a table to the end: players move as a normal bot would, bots and pauses come due at once. */
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

  await t.test("practice against bots: dealt at once, nothing recorded, no money", async () => {
    const player = await user("practice");
    const before = await balances(player);
    const seated = await tables.createTable({ userId: player, kind: "practice", level: "easy", length: "east" });
    assert.equal(seated.table.kind, "practice");
    assert.equal(seated.table.status, "playing");
    assert.equal(seated.table.recorded, false);
    assert.ok(seated.table.id >= tables.MEMORY_ID_BASE);
    assert.match(seated.seat.channel, /^mj-seat:[0-9a-f]{32}$/);
    assert.equal(seated.table.seats.filter((seat) => seat.bot).length, 3);
    assert.equal(seated.table.game.hand.hand.length + (seated.table.game.hand.drawn === null ? 0 : 1), seated.table.game.hand.seats[seated.table.me.seat].count);
    // One seat at a time.
    await assert.rejects(tables.createTable({ userId: player, kind: "practice" }), { code: "already_seated" });
    // What everyone else gets has no hand in it.
    const watcher = await tables.getTable({ tableId: seated.table.id });
    assert.equal(watcher.seat, undefined);
    assert.equal(watcher.table.game.hand.hand, undefined);
    assert.equal(watcher.table.game.hand.options, undefined);
    assert.equal(watcher.table.me, undefined);

    const table = await playOut(seated.table.id);
    assert.equal(table.result.standings.length, 4);
    assert.equal(table.result.replay, null);
    assert.match(table.result.seed, /^[0-9a-f]{64}$/);
    assert.deepEqual(await balances(player), before);
    assert.deepEqual(await ledger(player), []);
    const { rows } = await pool.query(`SELECT COUNT(*)::int AS games FROM games.mahjong_games`);
    assert.equal(rows[0].games, 0);
    // The seat is free again.
    assert.equal(tables.tableOfUser(player), null);
  });

  await t.test("the tutorial takes the lesson's moves and nothing else", async () => {
    const learner = await user("learner");
    const seated = await tables.createTable({ userId: learner, kind: "tutorial", lesson: "riichi" });
    assert.equal(seated.table.kind, "tutorial");
    assert.deepEqual(seated.table.lesson, { key: "riichi", step: 0, steps: 4 });
    const id = seated.table.id;
    const table = liveTable(id);
    const mine = () => table.game.hand.hands[0];
    const tileOf = (kind) => mine().find((tile) => tile >> 2 === kind);
    // Any other discard is refused and nothing changes.
    await assert.rejects(tables.actOnTable({ userId: learner, tableId: id, action: { type: "discard", tile: tileOf(29) } }), { code: "tutorial_step", step: 0 });
    assert.equal(table.lesson.step, 0);
    await tables.actOnTable({ userId: learner, tableId: id, action: { type: "discard", tile: tileOf(30) } });
    const settle = async () => {
      while (table.status === "playing" && !table.between && !round.waitingSeats(table.game.hand).includes(0)) {
        for (const ask of Object.values(table.asks)) ask.due = 0;
        await tables.withLock(id, () => tables._tick(table));
      }
    };
    await settle();
    await assert.rejects(tables.actOnTable({ userId: learner, tableId: id, action: { type: "pon" } }), { code: "tutorial_step", step: 1 });
    await tables.actOnTable({ userId: learner, tableId: id, action: { type: "pass" } });
    await settle();
    await tables.actOnTable({ userId: learner, tableId: id, action: { type: "discard", tile: tileOf(29), riichi: true } });
    await settle();
    const done = await tables.actOnTable({ userId: learner, tableId: id, action: { type: "tsumo" } });
    assert.equal(done.table.game.hand.result.wins[0].limit, "mangan");
    assert.equal(done.table.lesson.step, 4);
    // One hand: "next" ends the table.
    await tables.readyUp({ userId: learner, tableId: id });
    table.between.until = 0;
    await tables.withLock(id, () => tables._tick(table));
    assert.equal(table.status, "done");
    await assert.rejects(tables.createTable({ userId: learner, kind: "tutorial", lesson: "nope" }), { code: "lesson_not_found" });
  });

  await t.test("a signed-out visitor's table is theirs by its token alone", async () => {
    const seated = await tables.createGuestTable({ ipKey: "198.51.100.7", lesson: "calls" });
    assert.match(seated.seat.token, /^[0-9a-f]{32}$/);
    const id = seated.table.id;
    assert.equal((await tables.getTable({ tableId: id })).seat, undefined, "no token, no seat");
    assert.equal((await tables.getTable({ tableId: id, token: "f".repeat(32) })).seat, undefined);
    const mine = await tables.getTable({ tableId: id, token: seated.seat.token });
    assert.equal(mine.seat.index, 0);
    assert.ok(Array.isArray(mine.table.game.hand.hand));
    await assert.rejects(tables.actOnTable({ token: "f".repeat(32), tableId: id, action: { type: "pass" } }), { code: "forbidden" });
    await tables.leaveTable({ token: seated.seat.token, tableId: id });
    assert.equal(liveTable(id), undefined);
    // So many from one address in ten minutes.
    for (let i = 1; i < SETTINGS.guestTablesPerIp; i += 1) await tables.createGuestTable({ ipKey: "198.51.100.7" });
    await assert.rejects(tables.createGuestTable({ ipKey: "198.51.100.7" }), { code: "mahjong_guest_limit" });
    tables.reset();
  });

  await t.test("quick match: bots fill the empty seats, the game is recorded and rated, and it costs nothing", async () => {
    const ann = await user("ann");
    const bea = await user("bea");
    const first = await tables.createTable({ userId: ann, kind: "ranked", length: "east" });
    assert.equal(first.table.status, "waiting");
    assert.ok(first.table.starts_at > Date.now(), "the wait for players has started");
    const second = await tables.createTable({ userId: bea, kind: "ranked", length: "east" });
    assert.equal(second.table.id, first.table.id, "the second player joins the waiting table");
    const id = first.table.id;
    const table = liveTable(id);
    table.startAt = 0;
    await tables.withLock(id, () => tables._tick(table));
    assert.equal(table.status, "playing");
    assert.equal(table.seats.filter((seat) => seat.bot).length, 2);
    const { rows: started } = await pool.query(`SELECT status, seed_hash, seed, humans, rated FROM games.mahjong_games WHERE id = $1`, [id]);
    assert.equal(started[0].status, "playing");
    assert.match(started[0].seed_hash, /^[0-9a-f]{64}$/);
    assert.equal(started[0].seed, null, "the seed stays sealed while the game is on");
    assert.equal(started[0].humans, 2);
    assert.equal((await records.getGame(pool, id)).game.seed, null);

    await playOut(id);
    // saveHand is fire-and-forget: let the last one land.
    await new Promise((resolve) => setTimeout(resolve, 300));
    const record = await records.getGame(pool, id);
    assert.equal(record.game.status, "completed");
    assert.equal(record.game.seed, table.game.seed);
    assert.equal(require("../src/services/games/mahjong/wall").seedHash(record.game.seed), record.game.seed_hash, "the seed matches the hash published at the deal");
    assert.equal(record.hands.length, table.game.hands.length);
    assert.ok(record.hands.every((hand) => Array.isArray(hand.log) && hand.log[0].t === "deal"));
    assert.deepEqual(record.players.map((player) => player.place).sort(), [1, 2, 3, 4]);
    for (const player of record.players) {
      if (player.user_id) {
        assert.equal(player.rating_before, 1500);
        assert.notEqual(player.rating_after, null);
      } else {
        assert.equal(player.rating_after, null, "a bot's rating never moves");
      }
      assert.equal(player.payout, 0);
    }
    const mine = await ratings.readRating(pool, ann);
    assert.equal(mine.games, 1);
    assert.equal(mine.rating, record.players.find((player) => player.user_id === ann).rating_after);
    assert.deepEqual(await ledger(ann), []);
    assert.deepEqual(await ledger(bea), []);
    const profile = await records.playerRecord(pool, "ann");
    assert.equal(profile.totals.games, 1);
    assert.equal(profile.recent.length, 1);
    assert.equal(profile.totals.hands, record.hands.length);
  });

  let stakesId;
  await t.test("a stakes table: Credit only, four players, a fixed prize table and a cut", async () => {
    const fee = 1000;
    const players = [];
    for (const name of ["s1", "s2", "s3", "s4"]) players.push(await user(name));
    // Who can't sit down.
    const poor = await user("poor", { cash: 100, credit: 30000 });
    await assert.rejects(tables.createTable({ userId: poor, kind: "stakes", tier: fee }), { code: "net_worth_floor" });
    const fresh = await user("fresh", { ageDays: 0 });
    await assert.rejects(tables.createTable({ userId: fresh, kind: "stakes", tier: fee }), { code: "mahjong_account_too_new" });
    const broke = await user("broke", { cash: 90000, credit: 500 });
    await assert.rejects(tables.createTable({ userId: broke, kind: "stakes", tier: fee }), { code: "insufficient_credit" });
    assert.deepEqual(await balances(broke), { cash: 90000, credit: 500 }, "Cash is never touched");
    await assert.rejects(tables.createTable({ userId: players[0], kind: "stakes", tier: 123 }), { code: "invalid_stake" });
    const { rows: none } = await pool.query(`SELECT COUNT(*)::int AS n FROM games.mahjong_games WHERE kind = 'stakes' AND status = 'waiting'`);
    assert.equal(none[0].n, 0, "a table nobody could sit at is closed again");

    const first = await tables.createTable({ userId: players[0], kind: "stakes", tier: fee, length: "east" });
    stakesId = first.table.id;
    assert.deepEqual(first.table.prizes, [2000, 1100, 500, 0]);
    assert.deepEqual(await balances(players[0]), { cash: 20000, credit: 89000 });
    assert.deepEqual(await ledger(players[0]), [{ type: "mahjong_entry_fee", cash: 0, credit: -1000 }]);

    // Standing up before it starts gives the fee back.
    const second = await tables.createTable({ userId: players[1], kind: "stakes", tier: fee });
    assert.equal(second.table.id, stakesId);
    await tables.leaveTable({ userId: players[1], tableId: stakesId });
    assert.deepEqual(await balances(players[1]), { cash: 20000, credit: 90000 });
    assert.deepEqual((await ledger(players[1])).map((row) => row.type), ["mahjong_entry_fee", "game_refund"]);

    // Someone on the first player's network gets their own table, never this one.
    const housemate = await user("housemate", { ip: "10.9.0.1" });
    await pool.query(`UPDATE market.users SET signup_ip_hash = (SELECT signup_ip_hash FROM market.users WHERE id = $1) WHERE id = $2`, [players[0], housemate]);
    await assert.rejects(tables.joinTable({ userId: housemate, tableId: stakesId }), { code: "mahjong_same_network" });
    const elsewhere = await tables.createTable({ userId: housemate, kind: "stakes", tier: fee });
    assert.notEqual(elsewhere.table.id, stakesId);
    await tables.leaveTable({ userId: housemate, tableId: elsewhere.table.id });
    assert.deepEqual(await balances(housemate), { cash: 20000, credit: 90000 });

    for (const id of players.slice(1)) await tables.joinTable({ userId: id, tableId: stakesId });
    const table = liveTable(stakesId);
    assert.ok(table.startAt, "full: the countdown starts");
    assert.equal(table.seats.filter((seat) => seat.bot).length, 0);
    // No bots, ever: with a seat empty the countdown ending deals nothing.
    await tables.leaveTable({ userId: players[3], tableId: stakesId });
    table.startAt = 0;
    await tables.withLock(stakesId, () => tables._tick(table));
    assert.equal(table.status, "waiting");
    await tables.joinTable({ userId: players[3], tableId: stakesId });
    table.startAt = 0;
    await tables.withLock(stakesId, () => tables._tick(table));
    assert.equal(table.status, "playing");

    const plan = await limits.readPlan(pool, players[0]);
    assert.equal(plan.open_fees, fee);
    assert.equal(plan.loss_room, 9000);
    assert.equal(plan.win_room, 9000, "room is held for first prize");
    assert.equal(plan.games_today, 1);

    await playOut(stakesId);
    const record = await records.getGame(pool, stakesId);
    const prizes = [2000, 1100, 500, 0];
    let paid = 0;
    for (const player of record.players) {
      assert.equal(player.payout, prizes[player.place - 1]);
      paid += player.payout;
      const { cash, credit } = await balances(player.user_id);
      assert.equal(cash, 20000);
      assert.equal(credit, 90000 - fee + player.payout);
    }
    assert.equal(paid, 3600, "four fees in, 3,600 out: 400 left circulation");
    const winner = record.players.find((player) => player.place === 1);
    assert.deepEqual((await ledger(winner.user_id)).filter((row) => row.type.startsWith("mahjong")), [
      { type: "mahjong_entry_fee", cash: 0, credit: -1000 },
      { type: "mahjong_prize_payout", cash: 0, credit: 2000 },
    ]);
    const after = await limits.readPlan(pool, winner.user_id);
    assert.equal(after.week_net, 1000);
    assert.equal(after.open_fees, 0);
    assert.equal(after.win_room, 9000);
    const { rows: entries } = await pool.query(`SELECT status, COUNT(*)::int AS n FROM games.mahjong_entries WHERE game_id = $1 GROUP BY status`, [stakesId]);
    assert.deepEqual(entries, [{ status: "settled", n: 4 }], "the two who stood up were refunded, the four who played are settled");
    // Closing it twice pays nothing more.
    assert.equal(await records.finishGame(pool, { gameId: stakesId, seed: "0".repeat(64), rated: true, prizes, standings: table.game.final.standings, seats: table.seats, hands: table.game.hands }), null);
  });

  await t.test("the weekly cap and the daily count are enforced when a seat is paid for", async () => {
    const capped = await user("capped");
    // $9,500 down this week already: a $1,000 fee doesn't fit, a $200 one does.
    await pool.query(`INSERT INTO games.mahjong_entries (user_id, game_id, fee, max_net, payout, status, settled_at) VALUES ($1, $2, 9500, 0, 0, 'settled', now())`, [capped, stakesId]);
    await assert.rejects(tables.createTable({ userId: capped, kind: "stakes", tier: 1000 }), { code: "mahjong_weekly_limit", loss_room: 500 });
    const small = await tables.createTable({ userId: capped, kind: "stakes", tier: 200 });
    await tables.leaveTable({ userId: capped, tableId: small.table.id });
    assert.deepEqual(await balances(capped), { cash: 20000, credit: 90000 });

    const busy = await user("busy");
    for (let i = 0; i < SETTINGS.paidGamesPerDay; i += 1) {
      await pool.query(`INSERT INTO games.mahjong_entries (user_id, game_id, fee, max_net, payout, status, settled_at) VALUES ($1, $2, 200, 0, 220, 'settled', now())`, [busy, stakesId]);
    }
    await assert.rejects(tables.createTable({ userId: busy, kind: "stakes", tier: 200 }), { code: "mahjong_daily_limit" });
    // A refunded entry doesn't count toward the day.
    await pool.query(`UPDATE games.mahjong_entries SET status = 'refunded' WHERE id = (SELECT MAX(id) FROM games.mahjong_entries WHERE user_id = $1)`, [busy]);
    const again = await tables.createTable({ userId: busy, kind: "stakes", tier: 200 });
    await tables.leaveTable({ userId: busy, tableId: again.table.id });

    // In the red: no paid seat, and the fee itself would be refused too.
    const red = await user("red", { cash: 200000, credit: -50 });
    await assert.rejects(tables.createTable({ userId: red, kind: "stakes", tier: 200 }), { code: "in_the_red" });
  });

  await t.test("a paid seat on autopilot only discards, and a restart refunds whatever was unfinished", async () => {
    const players = [];
    for (const name of ["r1", "r2", "r3", "r4"]) players.push(await user(name));
    let id;
    for (const player of players) id = (await tables.createTable({ userId: player, kind: "stakes", tier: 200 })).table.id;
    const table = liveTable(id);
    table.startAt = 0;
    await tables.withLock(id, () => tables._tick(table));
    assert.equal(table.status, "playing");
    // Nobody moves: every clock runs out twice, then the seats are away and only throw back their draws.
    for (let guard = 0; guard < 400 && !table.between; guard += 1) {
      for (const ask of Object.values(table.asks)) ask.due = 0;
      await tables.withLock(id, () => tables._tick(table));
    }
    assert.ok(table.seats.every((seat) => seat.away));
    assert.equal(table.game.hand.result.type, "draw");
    assert.ok(table.game.hand.melds.every((melds) => melds.length === 0), "an absent seat never calls");
    // Coming back takes the seat off autopilot.
    const back = await tables.returnToSeat({ userId: players[0], tableId: id });
    assert.equal(back.table.me.away, false);

    // The process dies here. At the next start the game is cancelled and every fee handed back.
    tables.reset();
    assert.equal(await records.cancelUnfinishedGames(pool), 1);
    for (const player of players) {
      assert.deepEqual(await balances(player), { cash: 20000, credit: 90000 });
      assert.deepEqual((await ledger(player)).map((row) => row.type), ["mahjong_entry_fee", "game_refund"]);
    }
    assert.equal(await records.cancelUnfinishedGames(pool), 0, "once");
    const plan = await limits.readPlan(pool, players[0]);
    assert.equal(plan.games_today, 0);
    assert.equal(plan.open_fees, 0);
  });

  await t.test("a friend room: by its code, the host deals, bots take the rest, recorded but unrated", async () => {
    const host = await user("host");
    const guest = await user("friend");
    const room = await tables.createTable({ userId: host, kind: "friend", length: "east", level: "easy", coach: true });
    assert.match(room.table.room_code, /^[a-z0-9]{6}$/);
    assert.equal(tables.roomByCode(room.table.room_code.toUpperCase()), room.table.id);
    assert.equal(tables.lobby().tables.some((entry) => entry.id === room.table.id), false, "friend rooms aren't listed");
    await tables.joinTable({ userId: guest, tableId: room.table.id });
    await assert.rejects(tables.startTable({ userId: guest, tableId: room.table.id }), { code: "forbidden" });
    await tables.startTable({ userId: host, tableId: room.table.id });
    const table = liveTable(room.table.id);
    assert.equal(table.seats.filter((seat) => seat.bot === "easy").length, 2);
    await playOut(room.table.id);
    const record = await records.getGame(pool, room.table.id);
    assert.equal(record.game.rated, false);
    assert.ok(record.players.every((player) => player.rating_after === null));
    assert.equal((await ratings.readRating(pool, host)).games, 0);
  });

  await t.test("spectators pick a winner before the second hand, for nothing but the tally", async () => {
    const a = await user("pa");
    const b = await user("pb");
    const watcher = await user("watcher");
    const id = (await tables.createTable({ userId: a, kind: "ranked" })).table.id;
    await tables.createTable({ userId: b, kind: "ranked" });
    await assert.rejects(tables.pickWinner({ userId: watcher, tableId: id, seat: 0 }), { code: "mahjong_picks_closed" });
    const table = liveTable(id);
    table.startAt = 0;
    await tables.withLock(id, () => tables._tick(table));
    await assert.rejects(tables.pickWinner({ userId: a, tableId: id, seat: 0 }), { code: "forbidden" });
    await tables.pickWinner({ userId: watcher, tableId: id, seat: 1 });
    await tables.pickWinner({ userId: watcher, tableId: id, seat: 2 });
    assert.deepEqual(table.pickCounts, [0, 0, 1, 0], "changing a pick moves it");
    assert.deepEqual((await tables.getTable({ tableId: id, userId: watcher })).my_pick, { seat: 2 });
    await playOut(id);
    await assert.rejects(tables.pickWinner({ userId: watcher, tableId: id, seat: 0 }), { code: "mahjong_picks_closed" });
    const { rows } = await pool.query(`SELECT seat, correct FROM games.mahjong_picks WHERE user_id = $1`, [watcher]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].correct, table.result.standings[0].seat === 2);
    assert.deepEqual(await ledger(watcher), []);
  });

  await t.test("a tournament: sign-up, a knockout with bots filling in, a champion, and no money when a bot sits in", async () => {
    const staff = await user("staff");
    const entrants = [];
    for (const name of ["t1", "t2", "t3", "t4", "t5"]) entrants.push(await user(name));
    // First prize can't net more than the weekly minimum cap.
    await assert.rejects(tournaments.create(pool, { name: "Too rich", seats: 16, entryFee: 2500, startsAt: new Date(Date.now() + 3_600_000) }), { code: "mahjong_prize_over_cap" });
    await assert.rejects(tournaments.create(pool, { name: "Odd", seats: 6, startsAt: new Date(Date.now() + 3_600_000) }), { code: "invalid_tournament" });
    const created = await tournaments.create(pool, { name: "Friday Night Tiles", seats: 8, length: "east", finalLength: "east", entryFee: 500, startsAt: new Date(Date.now() + 3_600_000), repeatWeekly: true, createdBy: staff });
    assert.equal(created.prizes.pool, 3600);
    assert.deepEqual(created.prizes.prizes, [1800, 900, 540, 360]);
    for (const id of entrants) await tournaments.register(pool, { tournamentId: created.id, userId: id });
    await assert.rejects(tournaments.register(pool, { tournamentId: created.id, userId: entrants[0] }), { code: "already_seated" });
    assert.deepEqual(await balances(entrants[0]), { cash: 20000, credit: 89500 });
    // Withdrawing before the start refunds.
    await tournaments.withdraw(pool, { tournamentId: created.id, userId: entrants[4] });
    assert.deepEqual(await balances(entrants[4]), { cash: 20000, credit: 90000 });
    // A spectator's pick; entrants don't pick.
    const fan = await user("fan");
    await tournaments.pick(pool, { tournamentId: created.id, userId: fan, pickedUserId: entrants[0] });
    await assert.rejects(tournaments.pick(pool, { tournamentId: created.id, userId: entrants[1], pickedUserId: entrants[0] }), { code: "forbidden" });

    // The start: four players for eight seats, so bots sit in and it turns free.
    await pool.query(`UPDATE games.mahjong_tournaments SET starts_at = now() - interval '1 second' WHERE id = $1`, [created.id]);
    await tournaments.tick();
    let state = await tournaments.get(pool, created.id, entrants[0]);
    assert.equal(state.tournament.status, "running");
    assert.equal(state.tournament.paid, false);
    for (const id of entrants.slice(0, 4)) assert.deepEqual(await balances(id), { cash: 20000, credit: 90000 }, "every fee came back");
    assert.equal(state.bracket.rounds.length, 1);
    assert.equal(state.bracket.rounds[0].tables.length, 2);
    assert.equal(state.me.entered, true);
    await assert.rejects(tournaments.register(pool, { tournamentId: created.id, userId: entrants[4] }), { code: "tournament_closed" });

    const playRound = async () => {
      const round1 = (await tournaments.get(pool, created.id)).bracket.rounds.at(-1);
      for (const entry of round1.tables) {
        const table = liveTable(entry.game_id);
        assert.equal(table.kind, "tournament");
        assert.equal(table.status, "waiting", "seated, dealing in a moment");
        table.startAt = 0;
        await tables.withLock(table.id, () => tables._tick(table));
        // Nobody has opened the table: every player starts on autopilot, a full bot since it's free now.
        assert.ok(table.seats.every((seat) => seat.bot || seat.away));
        await playOut(table.id, { asUsers: false });
      }
    };
    await playRound();
    state = await tournaments.get(pool, created.id);
    assert.equal(state.bracket.rounds.length, 2, "the final table is drawn");
    assert.equal(state.bracket.rounds[1].name, "Final table");
    assert.equal(state.bracket.rounds[1].tables[0].players.length, 4);
    assert.ok(state.bracket.next_round_at > Date.now());
    await pool.query(`UPDATE games.mahjong_tournaments SET bracket_json = jsonb_set(bracket_json, '{next_round_at}', '0') WHERE id = $1`, [created.id]);
    await tournaments.tick();
    await playRound();
    state = await tournaments.get(pool, created.id);
    assert.equal(state.tournament.status, "completed");
    assert.equal(state.tournament.result.places.length, 4);
    assert.ok(state.tournament.result.places.every((line) => line.payout === 0), "a tournament with a bot in it pays nothing");
    for (const id of entrants) assert.deepEqual(await balances(id), { cash: 20000, credit: 90000 });
    const { rows: open } = await pool.query(`SELECT COUNT(*)::int AS n FROM games.mahjong_entries WHERE tournament_id = $1 AND status = 'open'`, [created.id]);
    assert.equal(open[0].n, 0);
    const { rows: picked } = await pool.query(`SELECT correct FROM games.mahjong_picks WHERE tournament_id = $1 AND user_id = $2`, [created.id, fan]);
    assert.equal(picked[0].correct, state.tournament.result.champion.user_id === entrants[0]);
    // It's weekly: next week's edition is open for sign-up.
    const { rows: next } = await pool.query(`SELECT status, starts_at FROM games.mahjong_tournaments WHERE name = 'Friday Night Tiles' AND status = 'signup'`);
    assert.equal(next.length, 1);
    assert.ok(new Date(next[0].starts_at).getTime() > Date.now() + 6 * 86_400_000);
  });

  await t.test("a full paid tournament pays its fixed split, in Credit, within the caps", async () => {
    const entrants = [];
    for (const name of ["p1", "p2", "p3", "p4"]) entrants.push(await user(name));
    const created = await tournaments.create(pool, { name: "Four Seat Final", seats: 4, finalLength: "east", entryFee: 1000, startsAt: new Date(Date.now() + 3_600_000) });
    for (const id of entrants) await tournaments.register(pool, { tournamentId: created.id, userId: id });
    const late = await user("late");
    await assert.rejects(tournaments.register(pool, { tournamentId: created.id, userId: late }), { code: "table_full" });
    const held = await limits.readPlan(pool, entrants[0]);
    assert.equal(held.open_fees, 1000);
    assert.equal(held.win_room, 10000 - created.prizes.top_net);
    await pool.query(`UPDATE games.mahjong_tournaments SET starts_at = now() - interval '1 second' WHERE id = $1`, [created.id]);
    await tournaments.tick();
    const state = await tournaments.get(pool, created.id);
    assert.equal(state.tournament.paid, true);
    const table = liveTable(state.bracket.rounds[0].tables[0].game_id);
    assert.equal(table.paidTournament, true);
    table.startAt = 0;
    await tables.withLock(table.id, () => tables._tick(table));
    for (const seat of table.seats) seat.away = false;
    await playOut(table.id);
    const done = await tournaments.get(pool, created.id);
    assert.equal(done.tournament.status, "completed");
    const prizes = [1800, 900, 540, 360];
    for (const line of done.tournament.result.places) {
      assert.equal(line.payout, prizes[line.place - 1]);
      assert.deepEqual(await balances(line.user_id), { cash: 20000, credit: 90000 - 1000 + line.payout });
    }
    const champion = done.tournament.result.champion;
    assert.equal((await limits.readPlan(pool, champion.user_id)).week_net, 800);
    assert.equal((await records.playerRecord(pool, champion.name)).tournaments_won.length, 1);
  });

  await t.test("the ladder, highlights and the staff's pair report read back what was played", async () => {
    const ladder = await records.ladder(pool);
    assert.ok(ladder.every((row) => row.games >= 3), "three games to be ranked");
    const highlights = await records.highlights(pool);
    assert.ok(Array.isArray(highlights.biggest));
    if (highlights.hand_of_the_day) assert.ok(highlights.hand_of_the_day.points > 0 && highlights.hand_of_the_day.win.hand.length > 0);
    const pairs = await records.pairReport(pool, { days: 30 });
    assert.ok(Array.isArray(pairs));
    const recent = await records.recentGames(pool, { limit: 5 });
    assert.ok(recent.length > 0 && recent.every((game) => game.seed === undefined));
  });
});
