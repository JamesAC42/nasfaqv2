// Mirrors production's livestreams into the LOCAL database and Redis, so the local site shows who is
// live right now and updates on its own. Production's scraper keeps the current streams in its own
// Redis, which isn't reachable; this rebuilds the same view from production's database instead
// (live and upcoming sessions, and the 5-minute viewer buckets), then publishes the same Redis
// messages the scraper does. Viewer counts therefore move in 5-minute steps.
//
//   PROD_DATABASE_URL=postgres://nasfaq_diagnostics:…@host:port/tsdb?sslmode=verify-full \
//     node scripts/mirror-live.js               poll every 60 seconds until stopped (Ctrl+C)
//     node scripts/mirror-live.js --every=30    poll interval in seconds (minimum 15)
//     node scripts/mirror-live.js --once        one pass, then exit
//
// Run it next to the API (it uses the API's DATABASE_URL and REDIS_URL from api/.env). Production is
// only read, in one READ ONLY transaction per pass; the local target must be localhost.

const { Client } = require("pg");
const { loadEnv } = require("../src/config");
const { createRedis } = require("../src/redis");

const argv = process.argv.slice(2);
const option = (name, fallback) => {
  const hit = argv.find((arg) => arg.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const ONCE = argv.includes("--once");
const EVERY_SECONDS = Math.max(15, Number(option("every", 60)) || 60);
// How far back the first pass reads sessions that changed and viewer buckets.
const FIRST_LOOKBACK = "12 hours";

const VIEWER_UPDATES = "nasfaq_livestreams:viewer_updates";
const BUCKET_UPDATES = "nasfaq_livestreams:bucket_updates";
const keyFor = (channelId) => `nasfaq_livestreams:{${channelId}}`;
const q = (name) => name.split(".").map((part) => `"${part.replace(/"/g, '""')}"`).join(".");

function assertLocal(url) {
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    throw new Error("DATABASE_URL is missing or invalid");
  }
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(host)) throw new Error(`refusing to write to ${host}: the target must be a local database`);
}

async function columns(db, table) {
  const [schema, name] = table.split(".");
  const { rows } = await db.query(
    `SELECT a.attname AS name FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = $1 AND c.relname = $2 AND a.attnum > 0 AND NOT a.attisdropped AND a.attgenerated = '' ORDER BY a.attnum`,
    [schema, name]
  );
  return rows.map((row) => row.name);
}

async function sharedColumns(local, prod, table) {
  const [mine, theirs] = await Promise.all([columns(local, table), columns(prod, table)]);
  const cols = mine.filter((col) => theirs.includes(col));
  if (!cols.length) throw new Error(`${table} is missing locally or on production (run node scripts/migrate.js, then pull-prod.js)`);
  return cols;
}

async function upsert(local, table, cols, keys, rows) {
  if (!rows.length) return 0;
  const list = cols.map(q).join(", ");
  const updates = cols.filter((col) => !keys.includes(col)).map((col) => `${q(col)} = EXCLUDED.${q(col)}`).join(", ");
  const result = await local.query(
    `INSERT INTO ${q(table)} (${list}) SELECT ${list} FROM jsonb_populate_recordset(NULL::${q(table)}, $1::jsonb)
     ON CONFLICT (${keys.map(q).join(", ")}) DO UPDATE SET ${updates}`,
    [JSON.stringify(rows)]
  );
  return result.rowCount;
}

async function main() {
  loadEnv();
  const localUrl = process.env.DATABASE_URL;
  const prodUrl = process.env.PROD_DATABASE_URL;
  assertLocal(localUrl);
  if (!prodUrl) throw new Error("set PROD_DATABASE_URL to production's read-only connection (the nasfaq_diagnostics role)");
  if (!process.env.REDIS_URL) throw new Error("REDIS_URL is not set (it's read from api/.env, like the API)");

  const local = new Client({ connectionString: localUrl });
  const prod = new Client({ connectionString: prodUrl, application_name: "nasfaq-mirror-live" });
  await local.connect();
  await prod.connect();
  const redis = await createRedis(process.env.REDIS_URL, process.env.REDIS_PASSWORD);

  const sessionCols = await sharedColumns(local, prod, "yt.livestream_sessions");
  const bucketCols = await sharedColumns(local, prod, "yt.livestream_viewer_buckets_5m");
  let since = null; // production's clock at the previous pass
  const lastBucket = new Map(); // video_id -> latest bucket_start already published
  let stopping = false;

  const pass = async () => {
    await prod.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    let now, sessions, buckets, channels;
    try {
      now = (await prod.query("SELECT now() AS now")).rows[0].now;
      const changed = since ? "$1::timestamptz" : `now() - interval '${FIRST_LOOKBACK}'`;
      const params = since ? [since] : [];
      sessions = (
        await prod.query(
          `SELECT to_jsonb(x) AS row FROM (SELECT ${sessionCols.map(q).join(", ")} FROM yt.livestream_sessions
             WHERE status IN ('live', 'upcoming') OR updated_at >= ${changed}) x`,
          params
        )
      ).rows.map((row) => row.row);
      const ids = sessions.map((session) => session.video_id);
      buckets = ids.length
        ? (
            await prod.query(
              `SELECT to_jsonb(x) AS row FROM (SELECT ${bucketCols.map(q).join(", ")} FROM yt.livestream_viewer_buckets_5m
                 WHERE livestream_video_id = ANY($1::text[]) AND bucket_start >= ${since ? "$2::timestamptz - interval '30 minutes'" : `now() - interval '${FIRST_LOOKBACK}'`}
                 ORDER BY bucket_start ASC) x`,
              since ? [ids, since] : [ids]
            )
          ).rows.map((row) => row.row)
        : [];
      channels = (await prod.query(`SELECT youtube_channel_id, name_short, icon, color FROM yt.youtube_channels`)).rows;
    } finally {
      await prod.query("ROLLBACK");
    }

    // Local copies (skip channels the local database doesn't have yet: run pull-prod.js --refresh).
    const localChannels = new Set((await local.query(`SELECT youtube_channel_id FROM yt.youtube_channels`)).rows.map((row) => row.youtube_channel_id));
    const known = sessions.filter((session) => localChannels.has(session.youtube_channel_id));
    const knownIds = new Set(known.map((session) => session.video_id));
    const knownBuckets = buckets.filter((bucket) => knownIds.has(bucket.livestream_video_id));
    await local.query("BEGIN");
    try {
      await upsert(local, "yt.livestream_sessions", sessionCols, ["video_id"], known);
      await upsert(local, "yt.livestream_viewer_buckets_5m", bucketCols, ["livestream_video_id", "bucket_start"], knownBuckets);
      await local.query("COMMIT");
    } catch (error) {
      await local.query("ROLLBACK");
      throw error;
    }

    // Redis: the scraper's "current view" per channel (live + upcoming), then its update messages.
    const latestViewers = new Map();
    for (const bucket of knownBuckets) latestViewers.set(bucket.livestream_video_id, bucket.avg_viewers ?? bucket.max_viewers ?? null);
    const channelInfo = new Map(channels.map((row) => [row.youtube_channel_id, row]));
    const byChannel = new Map();
    const updatedAt = new Date(now).toISOString();
    for (const session of known) {
      if (session.status !== "live" && session.status !== "upcoming") continue;
      const channel = channelInfo.get(session.youtube_channel_id) || {};
      const viewers = latestViewers.has(session.video_id) ? latestViewers.get(session.video_id) : null;
      const stream = {
        video_id: session.video_id,
        video_url: `https://www.youtube.com/watch?v=${session.video_id}`,
        status: session.status,
        title: session.video_title || "",
        thumbnail_url: session.thumbnail_url || "",
        channel_id: session.youtube_channel_id,
        channel_name: channel.name_short || "",
        ...(channel.icon ? { channel_icon: channel.icon } : {}),
        ...(channel.color ? { channel_color: channel.color } : {}),
        ...(session.scheduled_start_at ? { scheduled_start_time: session.scheduled_start_at } : {}),
        ...(session.actual_start_at ? { actual_start_time: session.actual_start_at } : {}),
        ...(session.status === "live" && viewers !== null ? { concurrent_viewers: Number(viewers) } : {}),
        updated_at: updatedAt,
      };
      if (!byChannel.has(session.youtube_channel_id)) byChannel.set(session.youtube_channel_id, []);
      byChannel.get(session.youtube_channel_id).push(stream);
    }
    // Viewer counts only change with a new bucket: keep the previous count otherwise.
    for (const key of await redis.keys("nasfaq_livestreams:{*}")) {
      const channelId = key.slice("nasfaq_livestreams:{".length, -1);
      const current = byChannel.get(channelId) || [];
      const existing = await redis.hGetAll(key);
      for (const stream of current) {
        if (stream.status !== "live" || stream.concurrent_viewers !== undefined || !existing[stream.video_id]) continue;
        try {
          const before = JSON.parse(existing[stream.video_id]);
          if (before.concurrent_viewers !== undefined) stream.concurrent_viewers = before.concurrent_viewers;
        } catch {
          // ignore a malformed entry
        }
      }
      const stale = Object.keys(existing).filter((videoId) => !current.some((stream) => stream.video_id === videoId));
      if (stale.length) await redis.hDel(key, stale);
    }
    for (const [channelId, streams] of byChannel) {
      const key = keyFor(channelId);
      for (const stream of streams) await redis.hSet(key, stream.video_id, JSON.stringify(stream));
      await redis.expire(key, 7 * 24 * 60 * 60);
    }

    const live = [...byChannel.values()].flat().filter((stream) => stream.status === "live");
    await redis.publish(
      VIEWER_UPDATES,
      JSON.stringify({ at: updatedAt, live: live.map((stream) => ({ video_id: stream.video_id, ...(stream.concurrent_viewers !== undefined ? { concurrent_viewers: stream.concurrent_viewers } : {}) })) })
    );
    let published = 0;
    for (const bucket of knownBuckets) {
      const seen = lastBucket.get(bucket.livestream_video_id);
      if (seen && new Date(bucket.bucket_start) <= new Date(seen)) continue;
      lastBucket.set(bucket.livestream_video_id, bucket.bucket_start);
      if (!since) continue; // the first pass only loads history
      await redis.publish(
        BUCKET_UPDATES,
        JSON.stringify({
          video_id: bucket.livestream_video_id,
          bucket_start: bucket.bucket_start,
          bucket_end: bucket.bucket_end,
          ...(bucket.avg_viewers !== null && bucket.avg_viewers !== undefined ? { avg_viewers: Number(bucket.avg_viewers) } : {}),
          ...(bucket.max_viewers !== null && bucket.max_viewers !== undefined ? { max_viewers: Number(bucket.max_viewers) } : {}),
        })
      );
      published += 1;
    }

    since = now;
    const upcoming = [...byChannel.values()].flat().length - live.length;
    const skipped = sessions.length - known.length;
    console.log(
      `${new Date().toLocaleTimeString()}  live ${live.length}, upcoming ${upcoming}, ${known.length} sessions / ${knownBuckets.length} buckets synced` +
        (published ? `, ${published} new buckets` : "") +
        (skipped ? ` (${skipped} sessions for channels missing locally: run pull-prod.js --refresh)` : "")
    );
  };

  const stop = async () => {
    stopping = true;
    await prod.end().catch(() => {});
    await local.end().catch(() => {});
    await redis.quit().catch(() => {});
  };
  process.on("SIGINT", () => {
    void stop().then(() => process.exit(0));
  });

  try {
    await pass();
    if (ONCE) return;
    console.log(`Mirroring every ${EVERY_SECONDS}s. Ctrl+C to stop.`);
    while (!stopping) {
      await new Promise((resolve) => setTimeout(resolve, EVERY_SECONDS * 1000));
      if (stopping) break;
      try {
        await pass();
      } catch (error) {
        console.error(`pass failed: ${error.message}`);
        await prod.query("ROLLBACK").catch(() => {});
      }
    }
  } finally {
    if (!stopping) await stop();
  }
}

main().catch((error) => {
  console.error("\nmirror-live failed:", error.message);
  process.exit(1);
});
