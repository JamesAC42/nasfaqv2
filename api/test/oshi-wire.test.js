const test = require("node:test");
const assert = require("node:assert/strict");
const { Pool } = require("pg");
const { applySchema } = require("../src/migrations");
const wire = require("../src/services/wire");
const oshiWire = require("../src/services/wire/oshiMoves");
const features = require("../src/features");

// Oshi moves on the Wire (services/wire/oshiMoves.js), behind the oshi-wire flag: the headlines, who
// may be named, the flood limit, the front page's ranking, and that only flagged viewers are sent
// them through the cached routes. The pure parts run anywhere; the rest needs
// CHAT_TEST_DATABASE_URL (a local server) and makes its own database.
const databaseUrl = process.env.CHAT_TEST_DATABASE_URL;
const quiet = { log() {}, info() {}, warn() {}, error() {} };

const PEK = { symbol: "PEK", name: "Pekora" };
const MAR = { symbol: "MAR", name: "Marine" };
const move = (extra) => ({ id: 1, kind: "change", username: "honk", before: PEK, after: MAR, switches: 1, boughtIn: false, ...extra });

// ── Pure ──────────────────────────────────────────────────────────────────
test("oshi moves: the headline names the player and both oshis, nothing else", () => {
  const seen = new Set();
  for (let id = 1; id <= 30; id += 1) {
    const { headline, blurb } = oshiWire.oshiHeadline(move({ id }));
    seen.add(headline);
    assert.match(headline, /^honk .*Pekora.*Marine|^honk .*Marine.*Pekora/);
    assert.equal(blurb, "The Marine mark follows their name now.");
  }
  assert.ok(seen.has("honk left Pekora for Marine"), "the owner's example is one of them");
  assert.ok(seen.size >= 3, "a few ways to say it");
});

test("oshi moves: clears, picking again, and repeat switches", () => {
  const clear = oshiWire.oshiHeadline(move({ kind: "clear", after: null }));
  assert.match(clear.headline, /honk .*Pekora/);
  assert.equal(clear.blurb, "No oshi mark by their name for now.");
  const back = oshiWire.oshiHeadline(move({ before: null }));
  assert.match(back.headline, /^honk (picks a new oshi|has an oshi again): Marine$/);

  const again = oshiWire.oshiHeadline(move({ switches: 3 }));
  assert.match(again.headline, /again|hopping/i);
  assert.equal(again.blurb, "Their 3rd oshi switch in 30 days.");
  const dropAgain = oshiWire.oshiHeadline(move({ kind: "clear", after: null, switches: 2 }));
  assert.equal(dropAgain.blurb, "Their 2nd oshi switch in 30 days.");
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 111].map(oshiWire.ordinal), ["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "23rd", "101st", "111th"]);
});

test("oshi moves: buying the new oshi first says so, with no amounts", () => {
  for (let id = 1; id <= 10; id += 1) {
    const bought = oshiWire.oshiHeadline(move({ id, boughtIn: true }));
    assert.match(bought.headline, /^honk (loads up on|buys) MAR, then (makes Marine their oshi|switches oshi to Marine)$/);
    assert.ok(!/\d/.test(bought.headline), "no numbers in it");
  }
  const both = oshiWire.oshiHeadline(move({ switches: 2, boughtIn: true }));
  assert.equal(both.blurb, "Their 2nd oshi switch in 30 days, and they bought MAR in the 3 days before.");
  const picked = oshiWire.oshiHeadline(move({ before: null, boughtIn: true }));
  assert.equal(picked.blurb, "They bought MAR in the 3 days before.");
  assert.ok(!/MAR in/.test(oshiWire.oshiHeadline(move({ kind: "clear", after: null, boughtIn: true })).blurb), "a clear has nothing bought");
});

test("oshi moves: nothing to say about a stock that's gone", () => {
  assert.equal(oshiWire.oshiHeadline(move({ after: null })), null);
  assert.equal(oshiWire.oshiHeadline(move({ kind: "clear", before: null, after: null })), null);
  assert.equal(oshiWire.oshiHeadline(move({ kind: "first_pick" })), null, "first picks are never news");
});

test("oshi moves: the Wire item ranks lowest and links to the player", () => {
  const row = {
    id: "7", kind: "change", changed_at: new Date("2026-11-07T12:00:00Z"), user_id: "42", username: "honk & co",
    before_symbol: "PEK", before_name: "Pekora", after_symbol: "MAR", after_name: "Marine", switches: 1, bought_cash: "999.99",
  };
  const item = oshiWire.oshiItem(row);
  assert.equal(item.kind, "oshi_change");
  assert.equal(item.dedupe_key, "oshi:7");
  assert.equal(item.importance, 0);
  assert.deepEqual(item.symbols, ["MAR", "PEK"], "the new oshi's mark first");
  assert.equal(item.link_url, "/profile/honk%20%26%20co");
  assert.equal(item.occurred_at, row.changed_at);
  assert.deepEqual(item.meta, { user_id: 42, move: "change", before: "PEK", after: "MAR", switches: 1, bought_in: false });
  assert.equal(oshiWire.oshiItem({ ...row, bought_cash: "1000" }).meta.bought_in, true, "from $1,000 of buys");
  const clear = oshiWire.oshiItem({ ...row, kind: "clear", after_symbol: null, after_name: null });
  assert.deepEqual([clear.symbols, clear.meta.after], [["PEK"], null]);
  assert.equal(oshiWire.oshiItem({ ...row, kind: "first_pick", before_symbol: null }), null);
});

test("oshi moves: the Oshi group is only for viewers with the flag", () => {
  assert.equal(wire.groupFor("oshi", { withOshi: false }), null);
  assert.equal(wire.groupFor("oshi", { withOshi: true }), "oshi");
  assert.equal(wire.groupFor("market"), "market");
  assert.equal(wire.groupFor("constructor"), null, "not a group");
  assert.equal(wire.groupFor(""), null);
});

// ── Database ──────────────────────────────────────────────────────────────
async function freshDatabase(name) {
  const target = new URL(databaseUrl);
  assert.ok(["127.0.0.1", "localhost"].includes(target.hostname), "a local test server only");
  const admin = new Pool({ connectionString: databaseUrl });
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${name}`);
  } finally {
    await admin.end();
  }
  target.pathname = `/${name}`;
  const pool = new Pool({ connectionString: target.href, options: "-c timezone=UTC" });
  const log = [console.log, console.warn];
  console.log = () => {};
  console.warn = () => {};
  try {
    await applySchema(pool);
  } finally {
    [console.log, console.warn] = log;
  }
  return pool;
}

async function addUser(pool, name, { verified = true, admin = false } = {}) {
  const { rows } = await pool.query(
    `INSERT INTO market.users (username, username_normalized, email, email_verified, password_hash, password_salt, password_params_json, is_admin)
     VALUES ($1, lower($1), lower($1) || '@example.test', $2, 'x', 'x', '{}', $3) RETURNING id`,
    [name, verified, admin]
  );
  return Number(rows[0].id);
}

test("oshi moves on the Wire, end to end", { skip: !databaseUrl, timeout: 180_000 }, async (t) => {
  const pool = await freshDatabase("nasfaq_oshi_wire_test");
  t.after(() => pool.end());

  const asset = {};
  for (const [symbol, name] of [["PEK", "Pekora"], ["MAR", "Marine"], ["SUI", "Suisei"], ["MIK", "Miko"]]) {
    await pool.query(`INSERT INTO yt.youtube_channels (youtube_channel_id, name_short) VALUES ($1, $2)`, [`UC${symbol}`, name]);
    const { rows } = await pool.query(
      `INSERT INTO market.market_assets (youtube_channel_id, symbol, display_name, status, max_supply, circulating_supply, treasury_supply, liquidity_depth, spread_bps)
       VALUES ($1, $2, $3, 'active', 10000, 0, 10000, 2000, 400) RETURNING id`,
      [`UC${symbol}`, symbol, name]
    );
    asset[symbol] = Number(rows[0].id);
  }
  /** A logged move `minutesAgo` minutes back (the generator reads only the log). */
  const logMove = async (userId, before, after, kind, minutesAgo) => {
    await pool.query(
      `INSERT INTO market.user_oshi_changes (user_id, asset_id_before, asset_id_after, kind, changed_at) VALUES ($1, $2, $3, $4, now() - make_interval(mins => $5))`,
      [userId, before ? asset[before] : null, after ? asset[after] : null, kind, minutesAgo]
    );
  };
  /** A filled buy of 100 shares for `cash` (a fill on their profile), `minutesAgo` minutes back. */
  const buy = async (userId, symbol, cash, minutesAgo) => {
    const { rows } = await pool.query(
      `INSERT INTO market.trade_orders (user_id, asset_id, side, order_type, status, requested_quantity, filled_quantity, requested_at)
       VALUES ($1, $2, 'buy', 'market', 'filled', 100, 100, now() - make_interval(mins => $3)) RETURNING id, requested_at`,
      [userId, asset[symbol], minutesAgo]
    );
    await pool.query(
      `INSERT INTO market.trade_fills (order_id, user_id, asset_id, side, price, quantity, gross_cash, fee_cash, net_cash, counterparty_type, ts)
       VALUES ($1, $2, $3, 'buy', $4, 100, $5, 1, $6, 'treasury', $7)`,
      [rows[0].id, userId, asset[symbol], cash / 100, cash, -(cash + 1), rows[0].requested_at]
    );
  };
  const run = () => wire.runWire(pool, quiet, { only: ["oshiMoves"] });
  const items = async () => (await pool.query(`SELECT kind, headline, blurb, symbols, importance, meta FROM content.wire_items WHERE kind = 'oshi_change' ORDER BY occurred_at, id`)).rows;
  const about = async (userId) => (await items()).filter((row) => Number(row.meta.user_id) === userId);

  const honk = await addUser(pool, "honk", { admin: true });
  const loyal = await addUser(pool, "Loyal");
  const hopper = await addUser(pool, "Hopper");
  const whale = await addUser(pool, "Whale");
  const alt = await addUser(pool, "Alt", { verified: false });
  const suspended = await addUser(pool, "Benched");
  const banned = await addUser(pool, "Gagged");
  const muted = await addUser(pool, "Hushed");
  await pool.query(`UPDATE market.users SET suspended_at = now() - interval '1 hour', suspended_until = now() + interval '1 day' WHERE id = $1`, [suspended]);
  await pool.query(`INSERT INTO chat.user_moderation_actions (user_id, action_type, reason) VALUES ($1, 'ban', 'test'), ($2, 'mute', 'test')`, [banned, muted]);

  await t.test("changes and clears make headlines; first picks never do", async () => {
    await logMove(loyal, null, "PEK", "first_pick", 600);
    await logMove(honk, null, "PEK", "first_pick", 300);
    await logMove(honk, "PEK", "MAR", "change", 200);
    await logMove(whale, null, "PEK", "first_pick", 900);
    await logMove(whale, "PEK", null, "clear", 100);
    const summary = await run();
    assert.equal(summary.oshiMoves.items, 2);
    assert.deepEqual(await about(loyal), [], "a first pick isn't news");
    const [change] = await about(honk);
    assert.match(change.headline, /^honk .*(Pekora|Marine)/);
    assert.deepEqual(change.symbols, ["MAR", "PEK"]);
    assert.equal(change.importance, 0);
    assert.deepEqual(change.meta, { user_id: honk, move: "change", before: "PEK", after: "MAR", switches: 1, bought_in: false });
    const [clear] = await about(whale);
    assert.match(clear.headline, /Whale .*Pekora/);
    assert.equal((await run()).oshiMoves.items, 0, "each move once");
  });

  await t.test("unverified, suspended and chat-banned players are never named; a mute doesn't stop it", async () => {
    for (const userId of [alt, suspended, banned, muted]) await logMove(userId, "PEK", "SUI", "change", 50);
    await run();
    assert.deepEqual(await about(alt), []);
    assert.deepEqual(await about(suspended), []);
    assert.deepEqual(await about(banned), []);
    assert.equal((await about(muted)).length, 1, "a mute is about chat posts only");
  });

  await t.test("repeat switches are called out, and a flood stops at three a day", async () => {
    // Six switches in an hour: the first three are posted, counted 1st..3rd.
    const path = ["PEK", "MAR", "SUI", "MIK", "PEK", "MAR", "SUI"];
    for (let i = 1; i < path.length; i += 1) await logMove(hopper, path[i - 1], path[i], "change", 70 - i * 10);
    await run();
    const posted = await about(hopper);
    assert.equal(posted.length, oshiWire.PER_PLAYER_DAY);
    assert.deepEqual(posted.map((row) => row.meta.switches), [1, 2, 3]);
    assert.equal(posted[1].blurb, "Their 2nd oshi switch in 30 days.");
    assert.match(posted[2].headline, /again|hopping/i);
  });

  await t.test("buying the new oshi first: only past the threshold, and only the fact that they bought", async () => {
    const small = await addUser(pool, "Dabbler");
    await buy(small, "MIK", 200, 30);
    await logMove(small, "PEK", "MIK", "change", 20);
    await buy(whale, "MAR", 600, 2000); // 33 hours before: inside the 3 days
    await buy(whale, "MAR", 700, 40);
    await buy(whale, "MAR", 5000, 5); // after the switch: doesn't count
    await logMove(whale, null, "MAR", "change", 20);
    await run();
    const [dabbler] = await about(small);
    assert.equal(dabbler.meta.bought_in, false, "$200 isn't buying in");
    const whaleMoves = await about(whale);
    const back = whaleMoves[whaleMoves.length - 1];
    assert.equal(back.meta.bought_in, true, "$1,300 in the 3 days before");
    assert.equal(back.blurb, "Their 2nd oshi switch in 30 days, and they bought MAR in the 3 days before.");
    assert.ok(!/\$|\d{3,}/.test(`${back.headline} ${back.blurb}`), "no amounts or share counts");
  });

  await t.test("only viewers with the flag are sent them, and the counts match", async () => {
    // Some news too: a two-hour-old UR pull (importance 1), a 20-hour-old 3D stream (importance 3)
    // and a five-day-old mover (importance 2).
    await pool.query(`
      INSERT INTO content.wire_items (kind, dedupe_key, headline, importance, occurred_at) VALUES
        ('ur_pull', 'test:pull', 'Someone pulls a UR', 1, now() - interval '2 hours'),
        ('stream_three_d', 'test:3d', 'A 3D stream', 3, now() - interval '20 hours'),
        ('market_mover', 'test:mover', 'An old mover', 2, now() - interval '5 days')`);
    const without = await wire.listWire(pool, { order: "time", limit: 200 });
    assert.equal(without.length, 3);
    assert.ok(without.every((item) => item.kind !== "oshi_change"));
    const withThem = await wire.listWire(pool, { order: "time", limit: 200, withOshi: true });
    const oshiCount = withThem.filter((item) => item.kind === "oshi_change").length;
    assert.equal(oshiCount, (await items()).length);
    assert.deepEqual(await wire.listWire(pool, { order: "time", group: "oshi" }), without, "the Oshi group means nothing without the flag");

    const counts = await wire.countWire(pool, {});
    assert.equal(counts.oshi, undefined, "no Oshi count without the flag");
    assert.equal(counts.all, without.length);
    const flagged = await wire.countWire(pool, { withOshi: true });
    assert.equal(flagged.oshi, oshiCount);
    assert.equal(flagged.all, without.length + oshiCount);
    assert.equal((await wire.countWire(pool, { withOshi: true, symbol: "MIK" })).oshi, withThem.filter((item) => item.kind === "oshi_change" && item.symbols.includes("MIK")).length);
  });

  await t.test("a player suspended or banned later drops off the Wire; lifting it brings them back", async () => {
    const before = (await wire.listWire(pool, { order: "time", limit: 200, withOshi: true })).filter((item) => item.meta.user_id === honk);
    assert.equal(before.length, 1);
    await pool.query(`UPDATE market.users SET suspended_at = now(), suspended_until = NULL WHERE id = $1`, [honk]);
    assert.equal((await wire.listWire(pool, { order: "time", limit: 200, withOshi: true })).filter((item) => item.meta.user_id === honk).length, 0);
    assert.equal((await wire.countWire(pool, { withOshi: true })).oshi, (await items()).length - 1);
    await pool.query(`UPDATE market.users SET suspended_at = NULL WHERE id = $1`, [honk]);
    await pool.query(`INSERT INTO chat.user_moderation_actions (user_id, action_type, reason, expires_at) VALUES ($1, 'ban', 'test', now() + interval '1 day')`, [hopper]);
    assert.equal((await wire.listWire(pool, { order: "time", limit: 200, withOshi: true })).filter((item) => item.meta.user_id === hopper).length, 0);
    await pool.query(`UPDATE chat.user_moderation_actions SET revoked_at = now() WHERE user_id = $1`, [hopper]);
    assert.equal((await wire.listWire(pool, { order: "time", limit: 200, withOshi: true })).filter((item) => item.meta.user_id === hopper).length, oshiWire.PER_PLAYER_DAY);
    assert.equal((await wire.listWire(pool, { order: "time", limit: 200, withOshi: true })).filter((item) => item.meta.user_id === honk).length, 1);
  });

  await t.test("ranked (the front page): under the day's news, and at most three of them", async () => {
    // The UR pull and the 3D stream beat every oshi move from the last hours (they rank a day
    // behind); the five-day-old mover doesn't. Only the top three oshi moves are in the list at all.
    const ranked = await wire.listWire(pool, { order: "rank", limit: 40, withOshi: true });
    const oshiAt = ranked.map((item, index) => (item.kind === "oshi_change" ? index : -1)).filter((index) => index >= 0);
    assert.equal(oshiAt.length, wire.FRONT_OSHI_MAX);
    assert.ok(oshiAt.length > 0 && Math.min(...oshiAt) > ranked.findIndex((item) => item.kind === "ur_pull"), "under a fresh UR pull");
    assert.ok(Math.min(...oshiAt) > ranked.findIndex((item) => item.kind === "stream_three_d"), "under a day-old 3D stream");
    assert.ok(ranked.some((item) => item.kind === "market_mover"), "the old news is still there");
    const plain = await wire.listWire(pool, { order: "rank", limit: 40 });
    assert.deepEqual(ranked.filter((item) => item.kind !== "oshi_change"), plain, "the rest is what everyone else gets");
    assert.ok((await wire.listWire(pool, { order: "rank", limit: 40, withOshi: true, group: "oshi" })).length > wire.FRONT_OSHI_MAX, "the Oshi chip shows all of them");
  });

  await t.test("the routes: flagged viewers only, cached apart, private while staff-only", async () => {
    const express = require("express");
    const overview = require("../src/routes/overview");
    const app = express();
    app.use((req, _res, next) => {
      const id = Number(req.headers["x-test-user"]) || null;
      req.ctx = { pool, redis: null, user: id ? { id, is_admin: id === honk, email_verified: true } : null };
      next();
    });
    app.use("/api/overview", overview);
    const server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    const get = async (path, userId) => {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/overview${path}`, { headers: userId ? { "x-test-user": String(userId) } : {} });
      return { cache: response.headers.get("cache-control"), body: await response.json() };
    };
    const oshiIn = (body) => body.items.filter((item) => item.kind === "oshi_change").length;
    const restore = features.override({ "oshi-wire": "staff" });
    try {
      // The admin first, so a shared cache would have their copy ready for the next viewer.
      const admin = await get("/wire?order=time&limit=200&hours=71", honk);
      assert.ok(oshiIn(admin.body) > 0);
      assert.equal(admin.cache, "private, no-cache");
      for (const viewer of [loyal, null]) {
        const seen = await get("/wire?order=time&limit=200&hours=71", viewer);
        assert.equal(oshiIn(seen.body), 0, "no staff copy for players or visitors");
        assert.equal(seen.cache, "private, no-cache");
        assert.equal(oshiIn((await get("/wire?order=time&limit=200&hours=71&group=oshi", viewer)).body), 0);
        assert.equal(oshiIn((await get("/wire?limit=40&hours=71", viewer)).body), 0, "nor on the front page");
      }
      assert.ok(oshiIn((await get("/wire?limit=40&hours=71", honk)).body) <= wire.FRONT_OSHI_MAX);
      assert.ok((await get("/wire/counts?hours=71", honk)).body.oshi > 0);
      assert.equal((await get("/wire/counts?hours=71", loyal)).body.oshi, undefined);
      assert.equal((await get("/wire/counts?hours=71", loyal)).body.all, (await get("/wire?order=time&limit=200&hours=71", loyal)).body.items.length);
    } finally {
      restore();
    }
    // Any staff-only flag with Wire headlines keeps the response private, so pin the others (mahjong).
    const on = features.override({ "oshi-wire": "on", mahjong: "off" });
    try {
      const seen = await get("/wire?order=time&limit=200&hours=70", loyal);
      assert.ok(oshiIn(seen.body) > 0, "on: everyone");
      assert.equal(seen.cache, "no-cache", "one copy for everyone again");
    } finally {
      on();
    }
    const off = features.override({ "oshi-wire": "off" });
    try {
      assert.equal(oshiIn((await get("/wire?order=time&limit=200&hours=69", honk)).body), 0, "off: nobody");
    } finally {
      off();
      server.close();
    }
  });
});
