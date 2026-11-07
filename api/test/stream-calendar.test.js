const test = require("node:test");
const assert = require("node:assert/strict");
const { Pool } = require("pg");
const { applySchema } = require("../src/migrations");
const streamCalendar = require("../src/services/streamCalendar");

// The stream calendar reads the stream-peak predictions' source (yt.livestream_sessions): listed
// talents only, slots the scraper still sees, a day back to a week out.

const databaseUrl = process.env.CHAT_TEST_DATABASE_URL;

async function freshDatabase(t, name) {
  const target = new URL(databaseUrl);
  assert.ok(["127.0.0.1", "localhost"].includes(target.hostname));
  assert.equal(target.pathname, "/nasfaq_chat_test");
  const admin = new Pool({ connectionString: databaseUrl });
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${name}`);
  } finally {
    await admin.end();
  }
  target.pathname = `/${name}`;
  const pool = new Pool({ connectionString: target.href });
  t.after(() => pool.end());
  const warn = console.warn;
  const log = console.log;
  console.warn = () => {};
  console.log = () => {};
  try {
    await applySchema(pool);
  } finally {
    console.warn = warn;
    console.log = log;
  }
  return pool;
}

async function addTalent(pool, symbol, { status = "active" } = {}) {
  const channel = `UC${symbol}`;
  await pool.query(`INSERT INTO yt.youtube_channels (youtube_channel_id, name_short, name_english, symbol, is_active) VALUES ($1, $2, $2, $3, true)`, [channel, symbol, symbol]);
  const { rows } = await pool.query(
    `INSERT INTO market.market_assets (youtube_channel_id, symbol, display_name, status, max_supply, circulating_supply, treasury_supply, liquidity_depth, spread_bps)
     VALUES ($1, $2, $2, $3, 10000, 0, 10000, 2000, 400) RETURNING id`,
    [channel, symbol, status]
  );
  return { channel, id: Number(rows[0].id) };
}

test("the stream calendar: listed talents' live, upcoming and recent streams, never stale slots", { skip: !databaseUrl, timeout: 120_000 }, async (t) => {
  const pool = await freshDatabase(t, "nasfaq_stream_calendar_test");
  const { channel } = await addTalent(pool, "MAR");
  await pool.query(`INSERT INTO yt.youtube_channels (youtube_channel_id, name_short, name_english, is_active) VALUES ('UCNOSTOCK', 'Guest', 'Guest', true)`);
  const hours = (n) => new Date(Date.now() + n * 3_600_000);
  const add = (video, fields) =>
    pool.query(
      `INSERT INTO yt.livestream_sessions (youtube_channel_id, video_id, status, video_title, scheduled_start_at, actual_start_at, first_seen_at, last_seen_at, max_concurrent_viewers, updated_at)
       VALUES ($1, $2, $3, $2, $4, $5, now(), $6, $7, now())`,
      [fields.channel ?? channel, video, fields.status, fields.scheduled ?? null, fields.actual ?? null, fields.seen ?? new Date(), fields.peak ?? null]
    );
  await add("soon", { status: "upcoming", scheduled: hours(3) });
  await add("nextweek", { status: "upcoming", scheduled: hours(24 * 6) });
  await add("toofar", { status: "upcoming", scheduled: hours(24 * 9) });
  await add("stale", { status: "upcoming", scheduled: hours(5), seen: hours(-3) });
  await add("late", { status: "upcoming", scheduled: hours(-1) });
  await add("onair", { status: "live", scheduled: hours(-2), actual: hours(-2), peak: 12_000 });
  await add("earlier", { status: "ended", scheduled: hours(-8), actual: hours(-8), peak: 30_000 });
  await add("lastweek", { status: "ended", scheduled: hours(-24 * 5), actual: hours(-24 * 5), peak: 9_000 });
  await add("guest", { status: "upcoming", scheduled: hours(2), channel: "UCNOSTOCK" });

  const calendar = await streamCalendar.getStreamCalendar(pool, { days: 7 });
  const byId = new Map(calendar.streams.map((stream) => [stream.video_id, stream]));
  assert.deepEqual([...byId.keys()].sort(), ["earlier", "late", "nextweek", "onair", "soon"]);
  assert.equal(byId.get("soon").state, "upcoming");
  assert.equal(byId.get("soon").peak_viewers, null);
  assert.equal(byId.get("late").state, "late");
  assert.equal(byId.get("onair").state, "live");
  assert.equal(byId.get("earlier").state, "ended");
  assert.equal(byId.get("earlier").peak_viewers, 30_000);
  assert.equal(byId.get("soon").symbol, "MAR");
  assert.equal(byId.get("soon").prediction, null);
  // In start order.
  const starts = calendar.streams.map((stream) => Date.parse(stream.starts_at));
  assert.deepEqual(starts, [...starts].sort((a, b) => a - b));
});
