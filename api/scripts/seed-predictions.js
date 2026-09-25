// Prediction-market demo data for a LOCAL dev database (called from seed-dev.js).
//
//   predictions [you]          ~17 markets in every state, a week of price history, trades from sim traders,
//                              and (if you pass your username) positions, an order and settled bets for you
//   predictions-live [minutes] sim traders keep trading so the floor, tape and charts move (default 10 minutes)
//
// Sim traders are accounts with an unusable password: nobody can sign in as them.
// Markets already seeded (same title) are skipped, so running it again only tops things up.

const markets = require("../src/services/predictions/markets");
const trading = require("../src/services/predictions/trading");
const resolution = require("../src/services/predictions/resolution");
const events = require("../src/services/predictions/events");
const { ensureUserCashAccount } = require("../src/services/portfolioCash");

const SIMS = [
  ["desk_ayumi", "#3fb8f5"],
  ["desk_renji", "#ff9e6b"],
  ["pekofan_88", "#7cc3ff"],
  ["shrimp_capital", "#8fd3ff"],
  ["kiara_bull", "#ff8365"],
  ["marine_maxi", "#bf4848"],
  ["dooby_trades", "#9effbb"],
  ["sakamata_sam", "#7d7dff"],
  ["kobo_quant", "#addafb"],
  ["okayu_onigiri", "#b468f3"],
];

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const at = (ms) => new Date(Date.now() + ms).toISOString();
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (list) => list[Math.floor(Math.random() * list.length)];

// state: open | proposed | disputed | needs_call | resolved | voided | pending
// target: where sim trading pushes the price (binary: YES; multi: one weight per outcome)
const MARKETS = [
  {
    state: "open", trades: 40, target: 0.64, opensDaysAgo: 8,
    input: { title: "Will Pekora hit 3M subscribers before New Year?", category: "hololive", closes_at: at(60 * DAY), probability: 0.55,
      rules_text: "YES if the Usada Pekora channel shows 3,000,000 or more subscribers at any point before Jan 1 00:00 JST.", resolution_source_text: "YouTube channel page (screenshots welcome)" },
  },
  {
    state: "open", trades: 35, target: 0.31, opensDaysAgo: 6,
    input: { title: "New hololive EN generation announced in October?", category: "hololive", closes_at: at(37 * DAY), probability: 0.4,
      rules_text: "YES if hololive officially announces a new English branch generation or unit during October (JST).", resolution_source_text: "Official hololive EN X account" },
  },
  {
    state: "open", trades: 45, target: [0.34, 0.26, 0.14, 0.18, 0.08], opensDaysAgo: 3,
    input: { title: "Who tops the Superchat chart this week?", category: "hololive", market_type: "multi", closes_at: at(4 * DAY + 5 * HOUR),
      outcomes: [{ label: "Houshou Marine", asset_symbol: "MAR", probability: 0.3 }, { label: "Usada Pekora", asset_symbol: "PEK", probability: 0.25 }, { label: "Hoshimachi Suisei", asset_symbol: "SUI", probability: 0.15 }, { label: "Sakura Miko", asset_symbol: "MIK", probability: 0.15 }, { label: "Someone else", probability: 0.15 }],
      rules_text: "Resolves to the talent with the most Superchat income this week (Mon to Sun JST). Anyone outside the four listed resolves to Someone else.", resolution_source_text: "NASFAQ Superchat tracker" },
  },
  {
    state: "open", trades: 30, target: 0.58, opensDaysAgo: 5,
    input: { title: "FUWAMOCO 3D showcase before December?", category: "hololive", closes_at: at(66 * DAY), probability: 0.5,
      rules_text: "YES if FUWAMOCO hold a 3D showcase stream on their channel before Dec 1 00:00 JST.", resolution_source_text: "Official schedule and the stream itself" },
  },
  {
    state: "open", trades: 35, target: [0.2, 0.3, 0.22, 0.12, 0.16], opensDaysAgo: 4,
    input: { title: "Which unit wins the October collab poll?", category: "community", market_type: "multi", closes_at: at(12 * DAY),
      outcomes: [{ label: "holoX" }, { label: "ReGLOSS" }, { label: "EN Myth" }, { label: "EN Advent" }, { label: "FLOW GLOW" }],
      rules_text: "Resolves to the unit that wins the community collab poll pinned in the forum, as it stands on Oct 31 23:59 ET.", resolution_source_text: "Forum poll" },
  },
  {
    state: "open", trades: 25, target: 0.22, opensDaysAgo: 7,
    input: { title: "Will the site hit 2,000 registered players by Halloween?", category: "community", closes_at: at(37 * DAY), probability: 0.3,
      rules_text: "YES if the registered player count reaches 2,000 before Oct 31 23:59 ET.", resolution_source_text: "Admin player count" },
  },
  {
    state: "open", trades: 40, target: 0.61, opensDaysAgo: 2,
    input: { title: "MAR finishes the week above $22?", category: "market", closes_at: at(2 * DAY + 3 * HOUR), probability: 0.5, yes_label: "Above", no_label: "Below",
      rules_text: "Above if MAR's price after Friday's Late tick is above $22.00. Below otherwise.", resolution_source_text: "NASFAQ tick record" },
  },
  {
    state: "open", trades: 30, target: 0.72, opensDaysAgo: 1,
    input: { title: "Korone's endurance stream goes past 8 hours?", category: "streams", closes_at: at(50 * 60_000), probability: 0.6,
      rules_text: "YES if the endurance stream that started today runs longer than 8 hours before it ends.", resolution_source_text: "The stream VOD length" },
  },
  {
    state: "open", trades: 25, target: 0.35, opensDaysAgo: 3,
    input: { title: "Suisei announces a new album this month?", category: "hololive", closes_at: at(5 * HOUR), probability: 0.3,
      rules_text: "YES if Hoshimachi Suisei or her label announce a new full album before the end of September (JST).", resolution_source_text: "Official announcement" },
  },
  {
    state: "open", trades: 35, target: [0.3, 0.22, 0.18, 0.2, 0.1], opensDaysAgo: 2,
    input: { title: "Most-watched stream this weekend?", category: "streams", market_type: "multi", closes_at: at(3 * DAY),
      outcomes: [{ label: "Gawr Gura", asset_symbol: "GUR", probability: 0.25 }, { label: "Houshou Marine", asset_symbol: "MAR", probability: 0.2 }, { label: "Inugami Korone", asset_symbol: "KRE", probability: 0.2 }, { label: "Usada Pekora", asset_symbol: "PEK", probability: 0.2 }, { label: "Someone else", probability: 0.15 }],
      rules_text: "Resolves to the talent whose single stream has the highest peak concurrent viewers between Saturday 00:00 and Sunday 23:59 JST.", resolution_source_text: "NASFAQ stream tracker" },
  },
  {
    state: "proposed", call: "no", trades: 30, target: 0.3, opensDaysAgo: 4,
    note: "Settled at $14.62 after the Late tick.", source: "https://example.com/nasfaq/ticks/pek",
    input: { title: "PEK closes above $15 at Friday settlement?", category: "market", closes_at: at(2 * DAY), probability: 0.45,
      rules_text: "YES if PEK's price after Friday's Late tick is above $15.00.", resolution_source_text: "NASFAQ tick record" },
  },
  {
    state: "disputed", call: "yes", trades: 30, target: 0.5, opensDaysAgo: 5,
    note: "Peaked at 104k.", source: "https://example.com/stream/gura",
    dispute: "That was the collab stream on Ina's channel, not Gura's own stream. The rules say her next stream.",
    input: { title: "Will Gura's next stream break 100k viewers?", category: "streams", closes_at: at(9 * DAY), probability: 0.44,
      rules_text: "YES if Gawr Gura's next livestream on her own channel peaks at 100,000 concurrent viewers or more.", resolution_source_text: "NASFAQ stream tracker" },
  },
  {
    state: "needs_call", trades: 25, target: 0.66, opensDaysAgo: 3,
    input: { title: "Miko's birthday stream trends #1 on X in Japan?", category: "hololive", closes_at: at(3 * DAY), probability: 0.55,
      rules_text: "YES if the birthday stream hashtag reaches #1 on X trending in Japan while the stream is live.", resolution_source_text: "Screenshots of X trending (Japan)" },
  },
  {
    state: "resolved", call: "yes", trades: 30, target: 0.7, opensDaysAgo: 6, settledHoursAgo: 30,
    note: "FLR closed Friday at $11.26, up from $11.02.", source: "https://example.com/nasfaq/ticks/flr",
    input: { title: "FLR closes the week green?", category: "market", closes_at: at(2 * DAY), probability: 0.5, yes_label: "Green", no_label: "Red",
      rules_text: "Green if FLR's price after Friday's Late tick is higher than Monday's Open tick.", resolution_source_text: "NASFAQ tick record" },
  },
  {
    state: "resolved", call: "o2", trades: 35, target: [0.2, 0.45, 0.15, 0.2], opensDaysAgo: 7, settledHoursAgo: 70,
    note: "Koyori won the final by 4 points.", source: "https://example.com/stream/holox-kart",
    input: { title: "Who wins the holoX kart tournament?", category: "hololive", market_type: "multi", closes_at: at(2 * DAY),
      outcomes: [{ label: "La+ Darknesss", asset_symbol: "DRK" }, { label: "Hakui Koyori", asset_symbol: "KYR" }, { label: "Sakamata Chloe", asset_symbol: "CHL" }, { label: "Kazama Iroha", asset_symbol: "IRO" }],
      rules_text: "Resolves to the winner of the holoX kart tournament final as announced at the end of the stream.", resolution_source_text: "The tournament stream" },
  },
  {
    state: "voided", trades: 20, target: 0.5, opensDaysAgo: 8, settledHoursAgo: 50,
    reason: "The reunion was postponed to an unannounced date, so the question can't be answered. Everyone is refunded.",
    input: { title: "Myth reunion stream happens in September?", category: "hololive", closes_at: at(2 * DAY), probability: 0.6,
      rules_text: "YES if all members of hololive EN Myth appear together on one stream in September (JST).", resolution_source_text: "The stream" },
  },
  {
    state: "pending",
    input: { title: "Will Kronii do a 24h stream before Christmas?", category: "hololive", closes_at: at(90 * DAY), probability: 0.2,
      rules_text: "YES if Ouro Kronii streams for 24 hours straight on her channel before Dec 25 00:00 JST.", resolution_source_text: "Her channel's VOD" },
  },
];

async function ensureSims(pool) {
  const users = [];
  for (const [username, color] of SIMS) {
    const { rows } = await pool.query(
      `INSERT INTO market.users (username, username_normalized, password_hash, password_salt, password_params_json, email_verified, email_verified_at, profile_color)
       VALUES ($1, lower($1), '!sim', '!sim', '{"sim":true}', true, now(), $2)
       ON CONFLICT (username_normalized) DO UPDATE SET email_verified = true
       RETURNING id, username`,
      [username, color]
    );
    users.push(rows[0]);
  }
  // Enough cash to trade, through the ledger so balances reconcile.
  for (const user of users) await topUp(pool, user.id, 50_000);
  return users;
}

async function topUp(pool, userId, floor) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const account = await ensureUserCashAccount(client, userId);
    const balance = Number(account.cash_balance);
    if (balance < floor) {
      const delta = Math.round((floor - balance) * 100) / 100;
      await client.query(
        `INSERT INTO market.ledger_entries (user_id, asset_id, entry_type, quantity_delta, cash_delta, reference_type, reference_id) VALUES ($1, NULL, 'admin_grant', 0, $2, 'dev_seed', $1)`,
        [userId, delta]
      );
      await client.query(`UPDATE market.portfolio_cash_balances SET cash_balance = $2, updated_at = now() WHERE user_id = $1`, [userId, floor]);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function outcomesOf(pool, marketId) {
  const { rows } = await pool.query(`SELECT id, outcome_code, amm_shares, last_price FROM market.prediction_market_outcomes WHERE market_id = $1 ORDER BY sort_order, id`, [marketId]);
  return rows;
}

/** One trade nudging the market toward its target (with noise so it isn't a straight line). */
async function nudge(pool, market, user, target, { bias = 0.75 } = {}) {
  const outcomes = await outcomesOf(pool, market.id);
  const prices = outcomes.map((row) => Number(row.last_price));
  let index;
  if (Array.isArray(target)) {
    const gaps = target.map((weight, i) => weight - prices[i] + rnd(-0.04, 0.04));
    // Buying the cheap ones barely dents a runaway favourite, so holders of it take profit too.
    const over = gaps.indexOf(Math.min(...gaps));
    if (Math.random() < bias && gaps[over] < -0.05 && Math.random() < 0.5) {
      const fills = await sellOutcome(pool, market, outcomes[over].outcome_code);
      if (fills.length) return fills;
    }
    index = Math.random() < bias ? gaps.indexOf(Math.max(...gaps)) : Math.floor(Math.random() * outcomes.length);
  } else {
    const wantYes = prices[0] < target + rnd(-0.08, 0.08);
    index = (Math.random() < bias) === wantYes ? 0 : 1;
  }
  const amount = Math.round(Math.random() < 0.08 ? rnd(300, 800) : rnd(8, 180));
  try {
    const result = await trading.trade(pool, { userId: user.id, slug: market.slug, outcomeCode: outcomes[index].outcome_code, side: "buy", amount });
    return result.fills.map((fill, i) => (i === 0 ? { ...fill, username: user.username } : fill));
  } catch (error) {
    if (["price_at_limit", "insufficient_cash", "invalid_amount"].includes(error.code)) return [];
    throw error;
  }
}

async function sellOutcome(pool, market, outcomeCode) {
  const { rows } = await pool.query(
    `SELECT p.user_id, u.username, p.shares FROM market.prediction_market_positions p
     JOIN market.prediction_market_outcomes o ON o.id = p.outcome_id JOIN market.users u ON u.id = p.user_id
     WHERE p.market_id = $1 AND o.outcome_code = $2 AND p.shares > 2 AND u.password_hash = '!sim' ORDER BY random() LIMIT 1`,
    [market.id, outcomeCode]
  );
  if (!rows[0]) return [];
  try {
    const result = await trading.trade(pool, { userId: rows[0].user_id, slug: market.slug, outcomeCode, side: "sell", shares: Math.floor(Number(rows[0].shares) * rnd(0.3, 0.8) * 100) / 100 });
    return result.fills.map((fill, i) => (i === 0 ? { ...fill, username: rows[0].username } : fill));
  } catch (error) {
    if (["price_at_limit", "insufficient_shares", "invalid_amount"].includes(error.code)) return [];
    throw error;
  }
}

async function sellSome(pool, market, user) {
  const { rows } = await pool.query(
    `SELECT p.shares, o.outcome_code FROM market.prediction_market_positions p JOIN market.prediction_market_outcomes o ON o.id = p.outcome_id
     WHERE p.user_id = $1 AND p.market_id = $2 AND p.shares > 2 ORDER BY random() LIMIT 1`,
    [user.id, market.id]
  );
  if (!rows[0]) return [];
  try {
    const result = await trading.trade(pool, { userId: user.id, slug: market.slug, outcomeCode: rows[0].outcome_code, side: "sell", shares: Math.floor(Number(rows[0].shares) * rnd(0.2, 0.6) * 100) / 100 });
    return result.fills.map((fill, i) => (i === 0 ? { ...fill, username: user.username } : fill));
  } catch (error) {
    if (["price_at_limit", "insufficient_shares", "invalid_amount"].includes(error.code)) return [];
    throw error;
  }
}

/**
 * Replaces the market's price history with a smooth-ish walk from its opening prices to where it
 * trades now, so charts have a week of shape instead of one busy minute.
 */
async function paintHistory(pool, market, openingPrices, { endAt = Date.now() } = {}) {
  const outcomes = await outcomesOf(pool, market.id);
  const finals = outcomes.map((row) => Number(row.last_price));
  const opensAt = new Date(market.opens_at).getTime();
  await pool.query(`DELETE FROM market.prediction_market_price_history WHERE market_id = $1`, [market.id]);
  for (const [interval, step, cap] of [["1d", DAY, 30], ["1h", HOUR, 24 * 10], ["5m", 300_000, 288], ["1m", 60_000, 360]]) {
    const first = Math.max(opensAt, endAt - (cap - 1) * step);
    const count = Math.max(2, Math.floor((endAt - first) / step) + 1);
    // Brownian bridge per outcome: starts at the opening price (or mid-way for the short buckets), ends at today's price.
    const walks = outcomes.map((_, i) => {
      const start = first <= opensAt + step ? openingPrices[i] : openingPrices[i] + (finals[i] - openingPrices[i]) * ((first - opensAt) / Math.max(1, endAt - opensAt));
      let drift = 0;
      const noise = [];
      for (let k = 0; k < count; k++) noise.push((drift += rnd(-0.02, 0.02)));
      return noise.map((value, k) => {
        const t = k / (count - 1);
        return start + (finals[i] - start) * t + (value - noise[count - 1] * t);
      });
    });
    const rows = [];
    for (let k = 0; k < count; k++) {
      const clipped = walks.map((walk) => Math.min(0.97, Math.max(0.02, walk[k])));
      const total = clipped.reduce((sum, value) => sum + value, 0);
      const bucket = new Date(Math.floor((endAt - (count - 1 - k) * step) / step) * step);
      outcomes.forEach((outcome, i) => {
        const price = k === count - 1 ? finals[i] : clipped[i] / total;
        rows.push([outcome.id, bucket, Math.round(price * 1e6) / 1e6, i === 0 ? Math.round(rnd(0, 300) * 100) / 100 : 0]);
      });
    }
    await pool.query(
      `INSERT INTO market.prediction_market_price_history (market_id, outcome_id, bucket_interval, bucket_ts, open, high, low, close, last, volume_shares, volume_cash, trade_count)
       SELECT $1, o, $2, ts, p, p, p, p, p, 0, v, 0 FROM unnest($3::bigint[], $4::timestamptz[], $5::numeric[], $6::numeric[]) AS t(o, ts, p, v)
       ON CONFLICT (market_id, outcome_id, bucket_interval, bucket_ts) DO NOTHING`,
      [market.id, interval, rows.map((r) => r[0]), rows.map((r) => r[1]), rows.map((r) => r[2]), rows.map((r) => r[3])]
    );
  }
}

/** Spreads the market's trades over its life so the tape and 24h numbers look like a real week. */
async function spreadTrades(pool, marketId, fromMs, toMs, keepRecent = 6) {
  await pool.query(
    `WITH ranked AS (SELECT id, row_number() OVER (ORDER BY id DESC) AS n FROM market.prediction_market_trades WHERE market_id = $1)
     UPDATE market.prediction_market_trades t SET matched_at = to_timestamp(($2::float8 + random() * ($3::float8 - $2::float8)) / 1000.0)
     FROM ranked WHERE ranked.id = t.id AND ranked.n > $4::int`,
    [marketId, fromMs, toMs, keepRecent]
  );
}

async function youBuy(pool, you, market, outcomeCode, amount) {
  try {
    await trading.trade(pool, { userId: you.id, slug: market.slug, outcomeCode, side: "buy", amount });
  } catch (error) {
    console.log(`  (skipped your ${outcomeCode} bet on "${market.title}": ${error.code || error.message})`);
  }
}

async function seedPredictions(pool, username = null) {
  const sims = await ensureSims(pool);
  const [desk, desk2, creator, ...traders] = sims;
  const deskActor = { ...desk, is_admin: true };
  const desk2Actor = { ...desk2, is_admin: true };
  const creatorActor = { ...creator, can_create_prediction_markets: true };

  let you = null;
  if (username) {
    const { rows } = await pool.query(`SELECT id, username FROM market.users WHERE username_normalized = lower($1)`, [username]);
    if (!rows[0]) throw new Error(`no user called ${username}. Register on the site first.`);
    you = rows[0];
    await pool.query(`UPDATE market.users SET email_verified = true, email_verified_at = COALESCE(email_verified_at, now()) WHERE id = $1`, [you.id]);
    await topUp(pool, you.id, 10_000);
  }

  let made = 0;
  for (const spec of MARKETS) {
    const exists = await pool.query(`SELECT id FROM market.prediction_markets WHERE title = $1 LIMIT 1`, [spec.input.title]);
    if (exists.rows[0]) continue;
    const opensAt = at(-(spec.opensDaysAgo ?? 1) * DAY);

    if (spec.state === "pending") {
      await markets.createMarket(pool, creatorActor, { ...spec.input, submit: true });
      made += 1;
      continue;
    }

    const created = await markets.createMarket(pool, deskActor, { ...spec.input, opens_at: opensAt, publish: true, liquidity_b: spec.input.market_type === "multi" ? 800 : 1000 });
    const market = { ...created, opens_at: opensAt };
    const opening = (await outcomesOf(pool, market.id)).map((row) => Number(row.last_price));
    const codes = (await outcomesOf(pool, market.id)).map((row) => row.outcome_code);

    const total = spec.trades || 20;
    for (let i = 0; i < total; i++) {
      const user = pick(traders);
      if (i > 6 && i < total - 6 && Math.random() < 0.12) await sellSome(pool, market, user);
      else await nudge(pool, market, user, spec.target, { bias: i >= total - 6 ? 1 : 0.75 });
    }

    // Your bets, placed while the market is still open.
    if (you) {
      if (spec.state === "open" && Math.random() < 0.7) await youBuy(pool, you, market, pick(codes), Math.round(rnd(25, 150)));
      if (spec.state === "disputed") await youBuy(pool, you, market, "no", 60);
      if (spec.state === "proposed") await youBuy(pool, you, market, "yes", 40);
      if (spec.state === "resolved") await youBuy(pool, you, market, spec.call, 80);
      if (spec.state === "voided") await youBuy(pool, you, market, "yes", 50);
    }

    const settledAt = spec.settledHoursAgo ? Date.now() - spec.settledHoursAgo * HOUR : null;
    const endAt = settledAt ? settledAt - 2 * HOUR : Date.now();
    await paintHistory(pool, market, opening, { endAt });
    await spreadTrades(pool, market.id, new Date(opensAt).getTime(), endAt, settledAt ? 0 : 6);

    if (spec.state === "proposed" || spec.state === "disputed") {
      await resolution.propose(pool, deskActor, market.id, { outcome: spec.call, sourceUrl: spec.source, note: spec.note });
      if (spec.dispute) {
        const disputer = traders.find(Boolean);
        const { rows } = await pool.query(
          `SELECT p.user_id FROM market.prediction_market_positions p JOIN market.prediction_market_outcomes o ON o.id = p.outcome_id
           WHERE p.market_id = $1 AND o.outcome_code = 'no' AND p.shares > 0 LIMIT 1`,
          [market.id]
        );
        const who = rows[0] ? sims.find((sim) => String(sim.id) === String(rows[0].user_id)) || disputer : disputer;
        if (!rows[0]) await trading.trade(pool, { userId: who.id, slug: market.slug, outcomeCode: "no", side: "buy", amount: 20 }).catch(() => {});
        await resolution.dispute(pool, who, market.id, { reason: spec.dispute });
      }
    } else if (spec.state === "needs_call") {
      await resolution.closeMarket(pool, deskActor, market.id);
    } else if (spec.state === "resolved") {
      await resolution.propose(pool, deskActor, market.id, { outcome: spec.call, sourceUrl: spec.source, note: spec.note });
      await resolution.confirm(pool, desk2Actor, market.id);
    } else if (spec.state === "voided") {
      await resolution.voidMarket(pool, deskActor, market.id, { reason: spec.reason });
    }

    if (settledAt) {
      const settled = new Date(settledAt);
      const closed = new Date(settledAt - 2 * HOUR);
      await pool.query(
        `UPDATE market.prediction_markets SET closes_at = $2, resolved_at = CASE WHEN resolved_at IS NULL THEN NULL ELSE $3::timestamptz END,
           voided_at = CASE WHEN voided_at IS NULL THEN NULL ELSE $3::timestamptz END, updated_at = $3 WHERE id = $1`,
        [market.id, closed, settled]
      );
      await pool.query(`UPDATE market.prediction_resolution_proposals SET created_at = $2, window_ends_at = $3 WHERE market_id = $1`, [market.id, closed, settled]).catch(() => {});
    }
    made += 1;
    process.stdout.write(".");
  }
  if (made) process.stdout.write("\n");

  // A resting limit order so My bets shows one.
  if (you) {
    const { rows } = await pool.query(
      `SELECT pm.slug, o.outcome_code, o.last_price FROM market.prediction_markets pm JOIN market.prediction_market_outcomes o ON o.market_id = pm.id
       WHERE pm.status = 'open' AND pm.kind = 'event' AND pm.market_type = 'binary' AND o.outcome_code = 'yes' AND pm.closes_at > now() + interval '1 day' ORDER BY pm.id LIMIT 1`
    );
    const open = await pool.query(`SELECT 1 FROM market.prediction_limit_orders WHERE user_id = $1 AND status = 'open' LIMIT 1`, [you.id]);
    if (rows[0] && !open.rows[0]) {
      const limit = Math.max(0.02, Math.round((Number(rows[0].last_price) - 0.12) * 100) / 100);
      await trading.placeLimitOrder(pool, { userId: you.id, slug: rows[0].slug, outcomeCode: "yes", side: "buy", limitPrice: limit, amount: 75 }).catch((error) => console.log(`  (limit order skipped: ${error.code})`));
    }
  }

  const counts = (await pool.query(`SELECT status, count(*)::int AS n FROM market.prediction_markets GROUP BY status ORDER BY status`)).rows;
  console.log(`prediction markets: ${made} new · ${counts.map((row) => `${row.n} ${row.status}`).join(", ")}`);
  if (you) console.log(`${you.username} has bets, an open limit order and settled results on My bets`);
}

/** Sim traders keep trading so the floor moves. Ctrl+C to stop. */
async function runLive(pool, redis, minutes = 10) {
  const sims = await ensureSims(pool);
  const traders = sims.slice(3);
  const end = Date.now() + Math.max(1, Number(minutes) || 10) * 60_000;
  let count = 0;
  console.log(`sim traders trading for ${Math.round((end - Date.now()) / 60_000)} min (Ctrl+C to stop)`);
  while (Date.now() < end) {
    const { rows } = await pool.query(
      `SELECT id, slug, title, market_type FROM market.prediction_markets WHERE status = 'open' AND trading_status = 'open' AND closes_at > now() ORDER BY random() LIMIT 1`
    );
    if (rows[0]) {
      const market = rows[0];
      const user = pick(traders);
      const outcomes = await outcomesOf(pool, market.id);
      const target = market.market_type === "multi" ? outcomes.map(() => Math.random()) : Math.random();
      const fills = Math.random() < 0.2 ? await sellSome(pool, market, user) : await nudge(pool, market, user, target);
      if (fills.length) {
        await events.publishTrades(redis, fills);
        count += 1;
        if (count % 10 === 0) process.stdout.write(`${count} trades\r`);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, rnd(700, 2600)));
  }
  console.log(`\n${count} trades`);
}

module.exports = { seedPredictions, runLive };
