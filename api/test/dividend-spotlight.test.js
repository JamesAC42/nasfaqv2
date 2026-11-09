const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { Pool } = require("pg");
const { applySchema } = require("../src/migrations");
const features = require("../src/features");
const dividendBoard = require("../src/services/dividendBoard");
const leaderboardRoutes = require("../src/routes/leaderboard");
const marketRoutes = require("../src/routes/market");
const weeklyEvaluation = require("../src/services/weeklyEvaluation");
const { invalidateCachedJson } = require("../src/responseCache");

// The dividend spotlight (services/dividendBoard.js, the dividend-spotlight flag): the leaderboard
// and the front page's card. Nobody gets either without the flag; oshi protection's figures reach
// only viewers its own flag is on for, from every endpoint and shared cache; and only players the
// Wire could name are ranked. The flag checks need CHAT_TEST_DATABASE_URL (a local server), which
// makes its own database.
const databaseUrl = process.env.CHAT_TEST_DATABASE_URL;
const FLAG = dividendBoard.FLAG;
const OSHI = "oshi-protection";

test("dividend spotlight: it has a flag, and hides its data with whole endpoints", () => {
  const flag = features.list().find((entry) => entry.key === FLAG);
  assert.ok(flag, "there's a flag file");
  const oshi = features.list().find((entry) => entry.key === OSHI);
  for (const field of ["oshi_waived", "oshi_protected_quantity"]) assert.ok(oshi.fields.includes(field), `${field} is oshi protection's to withhold`);
  assert.equal(dividendBoard.parseWindow("all"), "all");
  assert.equal(dividendBoard.parseWindow("latest"), "latest");
  assert.equal(dividendBoard.parseWindow("anything else"), "latest");
});

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
  return new Pool({ connectionString: target.href, options: "-c timezone=UTC" });
}

async function migrate(pool) {
  const log = [console.log, console.warn];
  console.log = () => {};
  console.warn = () => {};
  try {
    await applySchema(pool);
  } finally {
    [console.log, console.warn] = log;
  }
}

/** A Redis with only what responseCache uses, so the shared copies can be read back. */
function fakeRedis() {
  const data = new Map();
  return {
    data,
    get: async (key) => data.get(key) ?? null,
    set: async (key, value) => void data.set(key, value),
    del: async (keys) => void [].concat(keys).forEach((key) => data.delete(key)),
  };
}

test("the dividend spotlight, end to end", { skip: !databaseUrl, timeout: 180_000 }, async (t) => {
  const real = await freshDatabase("nasfaq_dividend_spotlight_test");
  t.after(() => real.end());
  await migrate(real);

  // ── A market with two reviews ───────────────────────────────────────────
  const asset = {};
  for (const symbol of ["AAA", "BBB", "CCC"]) {
    await real.query(`INSERT INTO yt.youtube_channels (youtube_channel_id, name_short) VALUES ($1, $2)`, [`UC${symbol}`, symbol]);
    const { rows } = await real.query(
      `INSERT INTO market.market_assets (youtube_channel_id, symbol, display_name, status, max_supply, circulating_supply, treasury_supply, liquidity_depth, spread_bps)
       VALUES ($1, $2, $3, 'active', 10000, 0, 10000, 2000, 400) RETURNING id`,
      [`UC${symbol}`, symbol, `${symbol} Talent`]
    );
    asset[symbol] = Number(rows[0].id);
  }
  const addUser = async (name, { verified = true, admin = false } = {}) => {
    const { rows } = await real.query(
      `INSERT INTO market.users (username, username_normalized, email, email_verified, password_hash, password_salt, password_params_json, is_admin)
       VALUES ($1, lower($1), lower($1) || '@example.test', $2, 'x', 'x', '{}', $3) RETURNING id`,
      [name, verified, admin]
    );
    return Number(rows[0].id);
  };
  const addReview = async (evalDate, completedAt) => {
    const { rows } = await real.query(`INSERT INTO market.weekly_evaluations (eval_date, status, completed_at, report_json) VALUES ($1, 'completed', $2, '{}') RETURNING id`, [evalDate, completedAt]);
    return Number(rows[0].id);
  };
  const payout = (evaluationId, userId, symbol, amount, { waived = 0, protectedQuantity = 0, quantity = 100, perShare = 0.5 } = {}) =>
    real.query(`INSERT INTO market.dividend_payouts (evaluation_id, user_id, asset_id, quantity, per_share, amount, waived, protected_quantity) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, [
      evaluationId,
      userId,
      asset[symbol],
      quantity,
      perShare,
      amount,
      waived,
      protectedQuantity,
    ]);

  const alice = await addUser("Alice");
  const bob = await addUser("Bob");
  const carol = await addUser("Carol"); // part of a fee skipped
  const dana = await addUser("Dana"); // the whole fee skipped: nothing else happened to them
  const hushed = await addUser("Hushed"); // a mute and a room ban: still named
  const never = await addUser("Never"); // no payouts at all
  const unverified = await addUser("Unverified", { verified: false });
  const suspended = await addUser("Suspended");
  const banned = await addUser("Banned");
  const boss = await addUser("Boss", { admin: true });
  const everyone = [alice, bob, carol, dana, hushed, never, unverified, suspended, banned, boss];

  await real.query(`UPDATE market.users SET suspended_at = now() - interval '1 hour', suspended_until = now() + interval '1 day' WHERE id = $1`, [suspended]);
  const { rows: channel } = await real.query(`INSERT INTO chat.channels (scope_type, scope_key, display_name) VALUES ('meta', 'dividend-spotlight-test', 'Test room') RETURNING id`);
  await real.query(`INSERT INTO chat.user_moderation_actions (user_id, channel_id, action_type, reason) VALUES ($1, NULL, 'ban', 'test'), ($2, NULL, 'mute', 'test'), ($2, $3, 'ban', 'test')`, [banned, hushed, channel[0].id]);

  const older = await addReview("2026-10-31", new Date(Date.now() - 8 * 86_400_000));
  const latest = await addReview("2026-11-07", new Date(Date.now() - 86_400_000));

  await payout(latest, alice, "AAA", 100);
  await payout(latest, alice, "BBB", 50);
  await payout(latest, carol, "AAA", 40);
  await payout(latest, carol, "CCC", -10, { waived: 5, protectedQuantity: 20 });
  await payout(latest, dana, "CCC", 0, { waived: 20, protectedQuantity: 40 });
  await payout(latest, bob, "CCC", -60);
  await payout(latest, hushed, "AAA", 1);
  await payout(latest, unverified, "AAA", 1000);
  await payout(latest, suspended, "AAA", 2000);
  await payout(latest, banned, "AAA", 3000);
  await payout(older, bob, "AAA", 500);
  await payout(older, alice, "CCC", -25);
  await payout(older, dana, "CCC", 0, { waived: 3, protectedQuantity: 6 });

  // ── An app with these routes, a switchable viewer and a countable pool ──
  const redis = fakeRedis();
  let aggregates = 0;
  const pool = {
    query(text, ...rest) {
      if (typeof text === "string" && /SUM\(p\.amount\)/.test(text) && /GROUP BY p\.user_id/.test(text)) aggregates += 1;
      return real.query(text, ...rest);
    },
    connect: () => real.connect(),
  };
  const app = express();
  app.use((req, _res, next) => {
    const id = Number(req.headers["x-test-user"]) || null;
    req.ctx = { pool, redis, user: id ? { id, is_admin: id === boss, email_verified: true } : null };
    next();
  });
  app.use("/api/leaderboard", leaderboardRoutes);
  app.use("/api/market", marketRoutes);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => {
    server.closeAllConnections();
    return new Promise((resolve) => server.close(resolve));
  });
  const get = async (path, userId = null) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { headers: userId ? { "x-test-user": String(userId) } : {} });
    const text = await response.text();
    return { status: response.status, cache: response.headers.get("cache-control"), text, body: text ? JSON.parse(text) : null };
  };

  /** Forgets every cached copy, so each check sees what it set up. */
  const flush = async () => {
    const keys = [];
    for (const window of ["latest", "all"]) {
      for (const withOshi of [true, false]) {
        keys.push(dividendBoard.rankingKey(window, withOshi), dividendBoard.pageKey({ window, page: 1, limit: 25, withOshi }));
        for (const userId of everyone) keys.push(dividendBoard.breakdownKey({ userId, window, withOshi }));
      }
    }
    await invalidateCachedJson(redis, keys);
  };
  const withFlags = async (flags, work) => {
    const restore = features.override(flags);
    await flush();
    try {
      await work();
    } finally {
      restore();
    }
  };
  const BOARD = "/api/leaderboard/dividends";
  const names = (board) => board.entries.map((entry) => entry.username);

  await t.test("without the flag: 404 from every endpoint, signed out or in", async () => {
    const paths = [BOARD, `${BOARD}?window=all`, `${BOARD}/me`, `${BOARD}/players/${alice}`, "/api/market/me/dividend-week"];
    await withFlags({ [FLAG]: "staff", [OSHI]: "staff" }, async () => {
      for (const path of paths) {
        for (const viewer of [null, alice]) {
          const result = await get(path, viewer);
          assert.equal(result.status, 404, `${path} as ${viewer}`);
          assert.match(result.cache ?? "", /private/, "a 404 that depends on who's asking stays out of shared caches");
        }
        const staff = await get(path, boss);
        assert.equal(staff.status, 200, `${path} as staff`);
        assert.match(staff.cache, /private/, `${path} stays private while the flag is at staff`);
      }
    });
    await withFlags({ [FLAG]: "off", [OSHI]: "staff" }, async () => {
      for (const path of paths) assert.equal((await get(path, boss)).status, 404, `${path} with the flag off, even for staff`);
    });
    await withFlags({ [FLAG]: "on", [OSHI]: "staff" }, async () => {
      assert.equal((await get(BOARD)).status, 200, "signed out, the board reads");
      assert.equal((await get(`${BOARD}/me`)).status, 401);
      assert.equal((await get("/api/market/me/dividend-week")).status, 401);
    });
  });

  await t.test("ranked from the most earned down to the highest fees, a week or all time", async () => {
    await withFlags({ [FLAG]: "on", [OSHI]: "off" }, async () => {
      const week = (await get(BOARD)).body;
      assert.equal(week.window, "latest");
      assert.equal(week.eval_date, "2026-11-07");
      assert.equal(week.weeks, 2);
      assert.deepEqual(names(week), ["Alice", "Carol", "Hushed", "Bob"]);
      assert.deepEqual(week.entries.map((entry) => entry.rank), [1, 2, 3, 4]);
      const first = week.entries[0];
      assert.deepEqual([first.net, first.dividends, first.fees, first.stocks], [150, 150, 0, 2]);
      const mixed = week.entries[1];
      assert.deepEqual([mixed.net, mixed.dividends, mixed.fees, mixed.stocks], [30, 40, -10, 2]);
      assert.deepEqual(week.totals, { players: 4, dividends: 191, fees: -70 });
      assert.deepEqual(week.top, { user_id: alice, username: "Alice", net: 150 });
      assert.deepEqual(week.bottom, { user_id: bob, username: "Bob", net: -60 });

      const allTime = (await get(`${BOARD}?window=all`)).body;
      assert.equal(allTime.window, "all");
      assert.deepEqual(names(allTime), ["Bob", "Alice", "Carol", "Hushed"], "Bob's big dividend two weeks ago outweighs this week's fee");
      const bobAllTime = allTime.entries[0];
      assert.deepEqual([bobAllTime.net, bobAllTime.dividends, bobAllTime.fees], [440, 500, -60]);
      assert.equal(allTime.bottom, null, "nobody's in the red all time");
    });
  });

  await t.test("a page at a time, with the last page reachable", async () => {
    await withFlags({ [FLAG]: "on", [OSHI]: "off" }, async () => {
      const one = (await get(`${BOARD}?limit=2&page=1`)).body;
      assert.deepEqual(names(one), ["Alice", "Carol"]);
      assert.deepEqual(one.pagination, { total: 4, page: 1, limit: 2, page_count: 2, has_previous_page: false, has_next_page: true });
      const two = (await get(`${BOARD}?limit=2&page=2`)).body;
      assert.deepEqual(names(two), ["Hushed", "Bob"]);
      assert.equal(two.entries[1].rank, 4);
      assert.equal((await get(`${BOARD}?limit=2&page=9`)).body.entries.length, 0);
    });
  });

  await t.test("a breakdown by stock", async () => {
    await withFlags({ [FLAG]: "on", [OSHI]: "off" }, async () => {
      const week = (await get(`${BOARD}/players/${alice}`)).body;
      assert.equal(week.username, "Alice");
      assert.deepEqual(week.lines.map((line) => [line.symbol, line.net, line.dividends, line.fees]), [["AAA", 100, 100, 0], ["BBB", 50, 50, 0]]);
      const allTime = (await get(`${BOARD}/players/${alice}?window=all`)).body;
      assert.deepEqual(allTime.lines.map((line) => [line.symbol, line.net, line.weeks]), [["AAA", 100, 1], ["BBB", 50, 1], ["CCC", -25, 1]]);
      assert.equal((await get(`${BOARD}/players/${never}`)).body.lines.length, 0, "named, with nothing yet");
      assert.equal((await get(`${BOARD}/players/nobody`)).status, 400);
      assert.equal((await get(`${BOARD}/players/99999999`)).status, 404);
    });
  });

  await t.test("nobody can work a skipped fee out from the numbers", async () => {
    await withFlags({ [FLAG]: "on", [OSHI]: "staff" }, async () => {
      for (const path of [BOARD, `${BOARD}/players/${carol}`, `${BOARD}/me`]) {
        const { text } = await get(path, carol);
        assert.doesNotMatch(text, /quantity|per_share|"rate"/, `${path} leaves out shares and rates: amount and quantity × per_share would differ by the skipped fee`);
      }
    });
  });

  await t.test("oshi protection reaches only its flag's viewers, in either request order", async () => {
    for (const order of [["player first", [alice, boss]], ["staff first", [boss, alice]]]) {
      await withFlags({ [FLAG]: "on", [OSHI]: "staff" }, async () => {
        const answers = new Map();
        for (const viewer of order[1]) {
          answers.set(viewer, {
            week: await get(BOARD, viewer),
            allTime: await get(`${BOARD}?window=all`, viewer),
            carol: await get(`${BOARD}/players/${carol}`, viewer),
            dana: await get(`${BOARD}/players/${dana}`, viewer),
          });
        }
        const anonymous = await get(BOARD);
        for (const response of [...Object.values(answers.get(alice)), anonymous]) {
          assert.doesNotMatch(response.text, /oshi_/, `${order[0]}: a player's copy has no oshi field`);
          assert.match(response.cache, /private/, "copies differ by viewer, so no proxy may keep one");
        }
        const player = answers.get(alice);
        assert.deepEqual(names(player.week.body), ["Alice", "Carol", "Hushed", "Bob"], "a player whose only row is a skipped fee isn't on the board");
        assert.equal(player.week.body.totals.players, 4);
        assert.equal(player.dana.status, 200);
        assert.deepEqual(player.dana.body.lines, [], "a row that only exists because a fee was skipped isn't there either");
        assert.deepEqual(player.carol.body.lines.map((line) => [line.symbol, line.fees]), [["AAA", 0], ["CCC", -10]], "what was charged still shows");

        const staff = answers.get(boss);
        assert.deepEqual(names(staff.week.body), ["Alice", "Carol", "Hushed", "Dana", "Bob"]);
        assert.equal(staff.week.body.totals.oshi_waived, 25);
        assert.equal(staff.week.body.entries.find((entry) => entry.username === "Dana").oshi_waived, 20);
        assert.equal(staff.allTime.body.totals.oshi_waived, 28);
        const skipped = staff.carol.body.lines.find((line) => line.symbol === "CCC");
        assert.deepEqual([skipped.oshi_waived, skipped.oshi_protected_quantity], [5, 20]);
        assert.deepEqual(staff.dana.body.lines.map((line) => [line.symbol, line.net, line.oshi_waived]), [["CCC", 0, 20]]);
      });
      // The same goes for what's kept in the shared cache: staff copies live under their own keys.
      for (const [key, body] of redis.data) {
        if (/oshi_/.test(body)) assert.match(key, /:oshi(\|staff)?$/, `${key} has oshi figures, so it can't be the everyone copy`);
        if (key.endsWith(":-")) assert.doesNotMatch(body, /oshi_/, `${key} is for viewers without the flag`);
      }
      const everyoneCopy = redis.data.get(`resp:v1:${dividendBoard.pageKey({ window: "latest", page: 1, limit: 25, withOshi: false })}`);
      assert.ok(everyoneCopy, "the everyone copy was written");
      const staffCopy = redis.data.get(`resp:v1:${dividendBoard.pageKey({ window: "latest", page: 1, limit: 25, withOshi: true })}|staff`);
      assert.match(staffCopy, /oshi_waived/, "and the staff copy under its own key");
    }
  });

  await t.test("oshi protection on for everyone, or off for everyone", async () => {
    await withFlags({ [FLAG]: "on", [OSHI]: "on" }, async () => {
      const player = (await get(BOARD, alice)).body;
      assert.equal(player.totals.oshi_waived, 25);
      assert.ok(names(player).includes("Dana"));
      const carolLines = (await get(`${BOARD}/players/${carol}`)).body.lines;
      assert.equal(carolLines.find((line) => line.symbol === "CCC").oshi_waived, 5);
      const allTimeLines = (await get(`${BOARD}/players/${carol}?window=all`)).body.lines;
      assert.equal(allTimeLines.find((line) => line.symbol === "CCC").oshi_protected_quantity, undefined, "shares only add up within one review");
    });
    await withFlags({ [FLAG]: "on", [OSHI]: "off" }, async () => {
      const staff = await get(BOARD, boss);
      assert.doesNotMatch(staff.text, /oshi_/, "off means nobody, staff included");
      assert.ok(!names(staff.body).includes("Dana"));
    });
  });

  await t.test("only players the Wire could name are ranked", async () => {
    await withFlags({ [FLAG]: "on", [OSHI]: "off" }, async () => {
      const shown = names((await get(BOARD)).body);
      for (const hidden of ["Unverified", "Suspended", "Banned"]) assert.ok(!shown.includes(hidden), `${hidden} isn't ranked`);
      assert.ok(shown.includes("Hushed"), "a mute or a room ban is about chat posts only");
      for (const hidden of [unverified, suspended, banned]) {
        assert.equal((await get(`${BOARD}/players/${hidden}`)).status, 404, "nor can their breakdown be asked for by id");
        const place = (await get(`${BOARD}/me`, hidden)).body;
        assert.equal(place.me, null, "and they aren't told a rank");
      }
    });
    // Same for lifting it: they come back. Every rule the net worth board has is covered as well.
    await real.query(`UPDATE chat.user_moderation_actions SET revoked_at = now() WHERE user_id = $1`, [banned]);
    await real.query(`UPDATE market.users SET suspended_at = NULL WHERE id = $1`, [suspended]);
    await real.query(`UPDATE market.users SET email_verified = true WHERE id = $1`, [unverified]);
    await withFlags({ [FLAG]: "on", [OSHI]: "off" }, async () => {
      const board = (await get(BOARD)).body;
      assert.deepEqual(names(board).slice(0, 3), ["Banned", "Suspended", "Unverified"]);
      assert.equal((await get(`${BOARD}/me`, banned)).body.me.rank, 1);
      assert.equal((await get(`${BOARD}/players/${banned}`)).status, 200);
    });
    await real.query(`UPDATE chat.user_moderation_actions SET revoked_at = NULL WHERE user_id = $1`, [banned]);
    await real.query(`UPDATE market.users SET suspended_at = now() - interval '1 hour', suspended_until = now() + interval '1 day' WHERE id = $1`, [suspended]);
    await real.query(`UPDATE market.users SET email_verified = false WHERE id = $1`, [unverified]);
  });

  await t.test("one aggregate per window and audience, however many viewers and pages", async () => {
    await withFlags({ [FLAG]: "on", [OSHI]: "staff" }, async () => {
      aggregates = 0;
      await Promise.all([
        ...Array.from({ length: 12 }, () => get(BOARD)),
        ...Array.from({ length: 6 }, (_, index) => get(`${BOARD}?limit=1&page=${index + 1}`)),
        ...[alice, bob, carol, dana].map((viewer) => get(`${BOARD}/me`, viewer)),
        ...[alice, bob].map((viewer) => get("/api/market/me/dividend-week", viewer)),
      ]);
      assert.equal(aggregates, 1, "players' pages, ranks and cards all read one ranking");
      await get(BOARD, boss);
      assert.equal(aggregates, 2, "staff's copy with oshi protection is its own");
      await get(BOARD, boss);
      await get(`${BOARD}?page=3`, boss);
      assert.equal(aggregates, 2, "and it's cached too");
    });
  });

  await t.test("your place on the board is private", async () => {
    await withFlags({ [FLAG]: "on", [OSHI]: "on" }, async () => {
      const mine = await get(`${BOARD}/me`, carol);
      assert.match(mine.cache, /private/);
      assert.equal(mine.body.me.username, "Carol");
      assert.equal(mine.body.me.rank, 2);
      assert.equal(mine.body.players, 5);
      assert.equal((await get(`${BOARD}/me?window=all`, carol)).body.me.rank, 3);
      assert.equal((await get(`${BOARD}/me`, never)).body.me, null);
    });
  });

  await t.test("your week: net, dividends, fees and rank, and the countdown", async () => {
    await withFlags({ [FLAG]: "on", [OSHI]: "off" }, async () => {
      const result = await get("/api/market/me/dividend-week", alice);
      assert.match(result.cache, /private/);
      const expected = weeklyEvaluation.evaluationStartsAt(await weeklyEvaluation.pendingEvaluationDate(real)).toISOString();
      assert.equal(result.body.next_review_at, expected);
      assert.equal(result.body.holds_stocks, false);
      const { week } = result.body;
      assert.deepEqual([week.eval_date, week.net, week.dividends, week.fees, week.stocks, week.rank, week.players], ["2026-11-07", 150, 150, 0, 2, 1, 4]);
      assert.deepEqual(week.highlights, [{ symbol: "AAA", amount: 100 }, { symbol: "BBB", amount: 50 }]);

      const fees = (await get("/api/market/me/dividend-week", bob)).body.week;
      assert.deepEqual([fees.net, fees.dividends, fees.fees, fees.rank], [-60, 0, -60, 4], "just this review, not Bob's all-time");

      assert.deepEqual((await get("/api/market/me/dividend-week", never)).body.week, null, "nothing to say to a player the review didn't touch");
      await real.query(`INSERT INTO market.portfolio_holdings (user_id, asset_id, quantity, avg_cost_basis) VALUES ($1, $2, 5, 10)`, [never, asset.AAA]);
      assert.equal((await get("/api/market/me/dividend-week", never)).body.holds_stocks, true, "holding now is what the countdown goes by");
      await real.query(`DELETE FROM market.portfolio_holdings WHERE user_id = $1`, [never]);

      const own = (await get("/api/market/me/dividend-week", unverified)).body.week;
      assert.deepEqual([own.net, own.rank, own.players], [1000, null, 4], "your own week still shows when you can't be ranked");
    });
  });

  await t.test("your week: oshi protection only with its flag", async () => {
    await withFlags({ [FLAG]: "on", [OSHI]: "staff" }, async () => {
      const carolWeek = await get("/api/market/me/dividend-week", carol);
      assert.doesNotMatch(carolWeek.text, /oshi_/);
      assert.deepEqual([carolWeek.body.week.net, carolWeek.body.week.fees], [30, -10]);
      assert.deepEqual((await get("/api/market/me/dividend-week", dana)).body.week, null, "a week of only a skipped fee says nothing without the flag");
    });
    await withFlags({ [FLAG]: "on", [OSHI]: "on" }, async () => {
      const carolWeek = (await get("/api/market/me/dividend-week", carol)).body.week;
      assert.equal(carolWeek.oshi_waived, 5);
      assert.equal(carolWeek.highlights.find((line) => line.symbol === "CCC").oshi_waived, 5);
      const danaWeek = (await get("/api/market/me/dividend-week", dana)).body.week;
      assert.deepEqual([danaWeek.net, danaWeek.oshi_waived, danaWeek.rank], [0, 20, 4]);
    });
  });

  await t.test("your week goes quiet a few days after the review", async () => {
    await withFlags({ [FLAG]: "on", [OSHI]: "off" }, async () => {
      const { rows } = await real.query(`SELECT completed_at FROM market.weekly_evaluations WHERE id = $1`, [latest]);
      const reviewed = new Date(rows[0].completed_at).getTime();
      const at = (days) => dividendBoard.myWeek({ pool: real, redis }, alice, { withOshi: false, now: new Date(reviewed + days * 86_400_000) });
      const fresh = await at(dividendBoard.WEEK_CARD_DAYS - 0.01);
      assert.equal(fresh.week.net, 150);
      assert.equal(fresh.week.show_until, new Date(reviewed + dividendBoard.WEEK_CARD_DAYS * 86_400_000).toISOString());
      const stale = await at(dividendBoard.WEEK_CARD_DAYS + 0.01);
      assert.equal(stale.week, null);
      assert.ok(stale.next_review_at, "the countdown carries on");
    });
  });

  await t.test("right after a review lands, your week never shows last week's rank", async () => {
    await withFlags({ [FLAG]: "on", [OSHI]: "off" }, async () => {
      assert.equal((await get("/api/market/me/dividend-week", alice)).body.week.rank, 1, "this caches the ranking");
      const landed = await addReview("2026-11-14", new Date());
      await payout(landed, alice, "BBB", -5);
      const stale = (await get("/api/market/me/dividend-week", alice)).body.week;
      assert.deepEqual([stale.eval_date, stale.net, stale.rank], ["2026-11-14", -5, null], "the new week, with no rank yet");
      await flush();
      assert.equal((await get("/api/market/me/dividend-week", alice)).body.week.rank, 1, "and its rank once the ranking turns over");
      await real.query(`DELETE FROM market.weekly_evaluations WHERE id = $1`, [landed]);
    });
  });

  await t.test("before the first review there's an empty board, not an error", async () => {
    const empty = await freshDatabase("nasfaq_dividend_spotlight_empty_test");
    t.after(() => empty.end());
    await migrate(empty);
    const ctx = { pool: empty, redis: null };
    await withFlags({ [FLAG]: "on", [OSHI]: "off" }, async () => {
      const board = await dividendBoard.boardPage(ctx, { window: "latest", page: 1, limit: 25, withOshi: false });
      assert.deepEqual([board.eval_date, board.weeks, board.entries.length, board.top, board.bottom], [null, 0, 0, null, null]);
      const breakdownless = await dividendBoard.myWeek(ctx, 1, { withOshi: false });
      assert.equal(breakdownless.week, null);
      assert.ok(breakdownless.next_review_at);
    });
    await flush();
  });
});
