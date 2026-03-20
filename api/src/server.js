const http = require("http");
const express = require("express");
const cors = require("cors");
const { WebSocketServer } = require("ws");

const { loadEnv, getConfig } = require("./config");
const { createPool } = require("./db");
const { applySchema } = require("./migrations");
const { createRedis } = require("./redis");

const channelsRoutes = require("./routes/channels");
const overviewRoutes = require("./routes/overview");
const livestreamsRoutes = require("./routes/livestreams");
const analysisRoutes = require("./routes/analysis");

const LIVESTREAM_VIEWER_UPDATES_CHANNEL = "nasfaq_livestreams:viewer_updates";
const LIVESTREAM_BUCKET_UPDATES_CHANNEL = "nasfaq_livestreams:bucket_updates";
const LIVESTREAM_SNAPSHOT_REFRESH_MS = 30_000;

function sendWsText(client, payload) {
  if (!client || client.readyState !== 1) return;
  client.send(payload, { binary: false, compress: false });
}

function safeParseJSON(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function cmpAsc(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function toListStream(item) {
  // Only include fields needed by the livestream list + modal open.
  // Modal fetches session/buckets separately, so omit large/unneeded fields.
  return {
    video_id: item.video_id,
    status: item.status,
    title: item.title,
    thumbnail_url: item.thumbnail_url,
    channel_name: item.channel_name,
    channel_icon: item.channel_icon,
    channel_color: item.channel_color,
    scheduled_start_time: item.scheduled_start_time,
    actual_start_time: item.actual_start_time,
    concurrent_viewers: item.concurrent_viewers,
  };
}

function signatureForStreamDiff(stream) {
  // Ignore concurrent_viewers so we don't emit diffs every time viewer counts change.
  // Viewer counts are sent separately via the viewer websocket.
  return JSON.stringify({
    video_id: stream.video_id,
    status: stream.status,
    title: stream.title,
    thumbnail_url: stream.thumbnail_url,
    channel_name: stream.channel_name,
    channel_icon: stream.channel_icon,
    channel_color: stream.channel_color,
    scheduled_start_time: stream.scheduled_start_time,
    actual_start_time: stream.actual_start_time,
  });
}

function diffById(prevArr, nextArr) {
  const prevById = new Map(prevArr.map((s) => [s.video_id, s]));
  const nextById = new Map(nextArr.map((s) => [s.video_id, s]));

  const added = [];
  const updated = [];
  const removed = [];

  for (const [id, nextS] of nextById.entries()) {
    const prevS = prevById.get(id);
    if (!prevS) {
      added.push(nextS);
      continue;
    }
    if (signatureForStreamDiff(prevS) !== signatureForStreamDiff(nextS)) {
      updated.push(nextS);
    }
  }

  for (const [id] of prevById.entries()) {
    if (!nextById.has(id)) removed.push(id);
  }

  return { added, updated, removed };
}

async function computeLivestreamSnapshot(redisClient) {
  const live = [];
  const upcoming = [];
  if (!redisClient) return { type: "snapshot", at: new Date().toISOString(), live, upcoming };

  for await (const key of redisClient.scanIterator({ MATCH: "nasfaq_livestreams:{*}", COUNT: 200 })) {
    const h = await redisClient.hGetAll(key);
    for (const [, val] of Object.entries(h)) {
      const item = safeParseJSON(val);
      if (!item || !item.video_id) continue;
      if (item.status === "live") live.push(item);
      else if (item.status === "upcoming") upcoming.push(item);
    }
  }

  upcoming.sort((a, b) => {
    const at = a.scheduled_start_time || a.updated_at;
    const bt = b.scheduled_start_time || b.updated_at;
    return cmpAsc(String(at), String(bt));
  });
  live.sort((a, b) => {
    const at = a.actual_start_time || a.updated_at;
    const bt = b.actual_start_time || b.updated_at;
    return cmpAsc(String(bt), String(at));
  });

  return {
    type: "snapshot",
    at: new Date().toISOString(),
    live: live.map(toListStream),
    upcoming: upcoming.map(toListStream),
  };
}

loadEnv();
const cfg = getConfig();

const app = express();
app.use(express.json({ limit: "5mb" }));
app.use(
  cors({
    origin: cfg.corsOrigin,
    credentials: true
  })
);

const pool = createPool(cfg.databaseUrl);
let redis = null;

const api = express.Router();

api.get("/health", async (_req, res) => {
  try {
    const r = await pool.query("SELECT 1 AS ok");
    res.json({ ok: true, db: r.rows[0].ok === 1 });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

app.use((req, _res, next) => {
  req.ctx = { pool, redis };
  next();
});

api.use("/channels", channelsRoutes);
api.use("/overview", overviewRoutes);
api.use("/livestreams", livestreamsRoutes);
api.use("/analysis", analysisRoutes);

app.use("/api", api);

app.use((err, _req, res, _next) => {
  // eslint-disable-next-line no-console
  console.error(err);
  res.status(500).json({ error: "internal_error" });
});

async function main() {
  if (cfg.enableMigrations) {
    await applySchema(pool);
  }

  // Redis is required for livestream endpoints.
  redis = await createRedis(cfg.redisUrl, cfg.redisPassword);

  const server = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false });
  const bucketWss = new WebSocketServer({ noServer: true, perMessageDeflate: false });

  let lastSnapshot = { type: "snapshot", at: new Date().toISOString(), live: [], upcoming: [] };
  let snapshotRefreshing = false;
  const refreshSnapshot = async () => {
    if (snapshotRefreshing) return;
    snapshotRefreshing = true;
    try {
      const nextSnapshot = await computeLivestreamSnapshot(redis);
      const liveDiff = diffById(lastSnapshot.live, nextSnapshot.live);
      const upcomingDiff = diffById(lastSnapshot.upcoming, nextSnapshot.upcoming);

      const hasDiff =
        liveDiff.added.length > 0 ||
        liveDiff.updated.length > 0 ||
        liveDiff.removed.length > 0 ||
        upcomingDiff.added.length > 0 ||
        upcomingDiff.updated.length > 0 ||
        upcomingDiff.removed.length > 0;

      lastSnapshot = nextSnapshot;

      if (!hasDiff) return;

      const diffPayload = JSON.stringify({
        type: "diff",
        at: nextSnapshot.at,
        liveAdded: liveDiff.added,
        liveUpdated: liveDiff.updated,
        liveRemoved: liveDiff.removed,
        upcomingAdded: upcomingDiff.added,
        upcomingUpdated: upcomingDiff.updated,
        upcomingRemoved: upcomingDiff.removed,
      });

      wss.clients.forEach((client) => {
        sendWsText(client, diffPayload);
      });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("livestream snapshot refresh error:", String(e?.message || e));
    } finally {
      snapshotRefreshing = false;
    }
  };

  wss.on("connection", (ws) => {
    // Send the latest snapshot immediately (and ensure one refresh happens soon).
    try {
      sendWsText(ws, JSON.stringify(lastSnapshot));
    } catch {}
    void refreshSnapshot();
    ws.on("close", () => {});
  });
  bucketWss.on("connection", (ws) => {
    ws.on("close", () => {});
  });

  server.on("upgrade", (req, socket, head) => {
    let pathname = "";
    try {
      pathname = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`).pathname;
    } catch {
      socket.destroy();
      return;
    }

    const target =
      pathname === "/api/livestreams/ws"
        ? wss
        : pathname === "/api/livestreams/buckets/ws"
          ? bucketWss
          : null;

    if (!target) {
      socket.destroy();
      return;
    }

    target.handleUpgrade(req, socket, head, (ws) => {
      target.emit("connection", ws, req);
    });
  });

  // Dedicated Redis client for pub/sub (subscriber mode can't run other commands).
  const redisSub = await createRedis(cfg.redisUrl, cfg.redisPassword);
  await redisSub.subscribe(LIVESTREAM_VIEWER_UPDATES_CHANNEL, (message) => {
    const payload = String(message);
    wss.clients.forEach((client) => {
      sendWsText(client, payload);
    });
  });
  await redisSub.subscribe(LIVESTREAM_BUCKET_UPDATES_CHANNEL, (message) => {
    const payload = String(message);
    bucketWss.clients.forEach((client) => {
      sendWsText(client, payload);
    });
  });
  // eslint-disable-next-line no-console
  console.log("Subscribed to Redis channels:", LIVESTREAM_VIEWER_UPDATES_CHANNEL, LIVESTREAM_BUCKET_UPDATES_CHANNEL);

  // One server-side refresh timer replaces client polling.
  await refreshSnapshot();
  setInterval(refreshSnapshot, LIVESTREAM_SNAPSHOT_REFRESH_MS);

  server.listen(cfg.port, () => {
    // eslint-disable-next-line no-console
    console.log(
      `API listening on http://localhost:${cfg.port} (HTTP + WebSocket /api/livestreams/ws + /api/livestreams/buckets/ws)`
    );
  });
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error("fatal:", e);
  process.exit(1);
});


