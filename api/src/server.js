const http = require("http");
const express = require("express");
const cors = require("cors");
const { WebSocketServer } = require("ws");

const { loadEnv, getConfig } = require("./config");
const { createPool } = require("./db");
const { applySchema } = require("./migrations");
const { createRedis } = require("./redis");
const chatDb = require("./chatDb");
const authService = require("./services/auth");
const marketState = require("./services/marketState");
const { startMarketScheduler, loadSchedulerConfig, computeNextScheduledAt } = require("./services/marketScheduler");

const channelsRoutes = require("./routes/channels");
const { router: chatRoutes, CHAT_EVENTS_REDIS_CHANNEL } = require("./routes/chat");
const overviewRoutes = require("./routes/overview");
const livestreamsRoutes = require("./routes/livestreams");
const newsRoutes = require("./routes/news");
const articleRoutes = require("./routes/articles");
const articleDb = require("./articleDb");
const analysisRoutes = require("./routes/analysis");
const leaderboardRoutes = require("./routes/leaderboard");
const marketRoutes = require("./routes/market");
const internalMarketRoutes = require("./routes/internalMarket");
const portfolioRoutes = require("./routes/portfolio");
const profileRoutes = require("./routes/profiles");
const authRoutes = require("./routes/auth");
const statsRoutes = require("./routes/stats");
const nasfaqThreadRoutes = require("./routes/nasfaqThread");
const adminAssetsRoutes = require("./routes/adminAssets");
const assetsRoutes = require("./routes/assets");
const mediaCatalog = require("./services/mediaCatalog");
const achievements = require("./services/achievements");

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

function normalizeChannelKeyList(value) {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .map((item) => {
          const parsed = chatDb.parseChannelKey(item);
          return parsed?.channelKey || null;
        })
        .filter(Boolean)
    )
  );
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
app.use(express.json({ limit: "25mb" }));
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

app.use(async (req, _res, next) => {
  try {
    const user = await authService.getAuthenticatedUser(pool, req);
    req.ctx = { pool, redis, user };
    next();
  } catch (error) {
    next(error);
  }
});

api.use("/auth", authRoutes);

app.use("/internal/market", internalMarketRoutes);

api.use("/channels", channelsRoutes);
api.use("/chat", chatRoutes);
api.use("/overview", overviewRoutes);
api.use("/livestreams", livestreamsRoutes);
api.use("/news", newsRoutes);
api.use("/articles", articleRoutes);
api.use("/analysis", analysisRoutes);
api.use("/leaderboard", leaderboardRoutes);
api.use("/market", marketRoutes);
api.use("/portfolio", portfolioRoutes);
api.use("/profiles", profileRoutes);
api.use("/stats", statsRoutes);
api.use("/admin/assets", adminAssetsRoutes);
api.use("/assets", assetsRoutes);
api.use("/", nasfaqThreadRoutes);

app.use("/api", api);

app.use((err, _req, res, _next) => {
  // eslint-disable-next-line no-console
  console.error(err);
  if (err?.code === "unauthenticated") return res.status(401).json({ error: "unauthenticated" });
  if (err?.code === "forbidden") return res.status(403).json({ error: "forbidden" });
  if (err?.code === "article_not_found" || err?.code === "proposal_not_found" || err?.code === "profile_not_found") return res.status(404).json({ error: err.code });
  if (err?.code === "profile_picture_not_found") return res.status(404).json({ error: err.code });
  if (
    err?.code === "already_friends"
    || err?.code === "friend_request_pending"
    || err?.code === "friend_request_needs_response"
  ) {
    return res.status(409).json({ error: err.code });
  }
  if (
    err?.code === "invalid_article"
    || err?.code === "invalid_comment"
    || err?.code === "invalid_proposal"
    || err?.code === "invalid_news_id"
    || err?.code === "invalid_chat_channel"
    || err?.code === "invalid_chat_message"
    || err?.code === "invalid_chat_report"
    || err?.code === "invalid_chat_moderation"
    || err?.code === "proposal_not_allowed"
    || err?.code === "cannot_edit_news_article"
    || err?.code === "invalid_profile_target"
    || err?.code === "friend_request_not_found"
    || err?.code === "invalid_profile_picture"
    || err?.code === "invalid_profile_update"
    || err?.code === "invalid_admin_asset"
  ) {
    return res.status(400).json({ error: err.code });
  }
  if (
    err?.code === "chat_channel_locked"
    || err?.code === "chat_user_muted"
    || err?.code === "chat_user_banned"
    || err?.code === "chat_rate_limited"
  ) {
    return res.status(409).json({
      error: err.code,
      retry_after_ms: err.retry_after_ms || null,
      expires_at: err.expires_at || null,
    });
  }
  if (
    err?.code === "chat_channel_not_found"
    || err?.code === "chat_message_not_found"
    || err?.code === "chat_report_not_found"
    || err?.code === "admin_asset_not_found"
  ) {
    return res.status(404).json({ error: err.code });
  }
  return res.status(500).json({ error: "internal_error" });
});

async function main() {
  if (cfg.enableMigrations) {
    await applySchema(pool);
    await articleDb.backfillAllNewsArticles(pool);
  }
  await achievements.syncDefinitions(pool);
  await mediaCatalog.syncMediaCatalog(pool, console);
  await chatDb.ensureChatTopology(pool);

  const schedulerConfig = loadSchedulerConfig();
  const stateClient = await pool.connect();
  try {
    await marketState.ensureMarketRuntimeState(stateClient);
    const existingStatus = await marketState.getMarketStatusWithClient(stateClient);
    const nextScheduledAt = computeNextScheduledAt(new Date(), schedulerConfig).toISOString();
    if (existingStatus?.trading_status === "manual_closed") {
      await marketState.setNextScheduledSettlementAt(stateClient, nextScheduledAt);
    } else {
      await marketState.setMarketOpen(stateClient, {
        message: existingStatus?.trading_status === "settling" ? "API restarted. Trading reopened on the last committed market state." : existingStatus?.trading_message || null,
        nextScheduledSettlementAt: nextScheduledAt,
      });
    }
  } finally {
    stateClient.release();
  }

  // Redis is required for livestream endpoints.
  redis = await createRedis(cfg.redisUrl, cfg.redisPassword);

  const server = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false });
  const bucketWss = new WebSocketServer({ noServer: true, perMessageDeflate: false });
  const statsWss = new WebSocketServer({ noServer: true, perMessageDeflate: false });
  const chatWss = new WebSocketServer({ noServer: true, perMessageDeflate: false });

  const broadcastOnlineUserCount = () => {
    const payload = JSON.stringify({
      type: "online_count",
      online_users: statsWss.clients.size,
    });
    statsWss.clients.forEach((client) => {
      sendWsText(client, payload);
    });
  };

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
  statsWss.on("connection", (ws) => {
    broadcastOnlineUserCount();
    ws.on("close", () => {
      broadcastOnlineUserCount();
    });
  });
  chatWss.on("connection", (ws, req) => {
    ws.chatSubscriptions = new Set();

    sendWsText(
      ws,
      JSON.stringify({
        type: "chat.hello",
        authenticated: Boolean(req.chatUser),
        user: req.chatUser
          ? {
              id: Number(req.chatUser.id),
              username: req.chatUser.username,
              is_admin: Boolean(req.chatUser.is_admin),
            }
          : null,
        channels: [],
      })
    );

    ws.on("message", async (raw) => {
      const payload = safeParseJSON(String(raw || ""));
      if (!payload || typeof payload !== "object") {
        sendWsText(ws, JSON.stringify({ type: "chat.error", error: "invalid_payload" }));
        return;
      }

      const action = String(payload.action || "").trim().toLowerCase();
      if (action === "subscribe") {
        const requestedChannelKeys = normalizeChannelKeyList(payload.channel_keys);
        const subscribed = [];
        const rejected = [];

        for (const channelKey of requestedChannelKeys) {
          try {
            await chatDb.ensureChatTopology(pool);
            const channel = await chatDb.getChannelByKey(pool, channelKey, {
              viewerUserId: req.chatUser?.id || null,
              includeInactive: Boolean(req.chatUser?.is_admin),
            });
            if (!channel) {
              rejected.push(channelKey);
              continue;
            }
            ws.chatSubscriptions.add(channel.channel_key);
            subscribed.push(channel.channel_key);
          } catch {
            rejected.push(channelKey);
          }
        }

        sendWsText(
          ws,
          JSON.stringify({
            type: "chat.subscribed",
            channel_keys: subscribed,
            rejected_channel_keys: rejected,
          })
        );
        return;
      }

      if (action === "unsubscribe") {
        const channelKeys = normalizeChannelKeyList(payload.channel_keys);
        channelKeys.forEach((channelKey) => ws.chatSubscriptions.delete(channelKey));
        sendWsText(
          ws,
          JSON.stringify({
            type: "chat.unsubscribed",
            channel_keys: channelKeys,
          })
        );
        return;
      }

      sendWsText(ws, JSON.stringify({ type: "chat.error", error: "unsupported_action" }));
    });

    ws.on("close", () => {
      ws.chatSubscriptions.clear();
    });
  });

  server.on("upgrade", async (req, socket, head) => {
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
          : pathname === "/api/stats/ws"
            ? statsWss
            : pathname === "/api/chat/ws"
              ? chatWss
          : null;

    if (!target) {
      socket.destroy();
      return;
    }

    try {
      if (target === chatWss) {
        req.chatUser = await authService.getAuthenticatedUser(pool, req);
      }
      target.handleUpgrade(req, socket, head, (ws) => {
        target.emit("connection", ws, req);
      });
    } catch {
      socket.destroy();
    }
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
  await redisSub.subscribe(CHAT_EVENTS_REDIS_CHANNEL, (message) => {
    const payload = String(message);
    const parsed = safeParseJSON(payload);
    if (!parsed?.channel_key) return;

    chatWss.clients.forEach((client) => {
      if (!client.chatSubscriptions?.has(parsed.channel_key)) return;
      sendWsText(client, payload);
    });
  });
  // eslint-disable-next-line no-console
  console.log("Subscribed to Redis channels:", LIVESTREAM_VIEWER_UPDATES_CHANNEL, LIVESTREAM_BUCKET_UPDATES_CHANNEL, CHAT_EVENTS_REDIS_CHANNEL);

  // One server-side refresh timer replaces client polling.
  await refreshSnapshot();
  setInterval(refreshSnapshot, LIVESTREAM_SNAPSHOT_REFRESH_MS);

  server.listen(cfg.port, () => {
    // eslint-disable-next-line no-console
    console.log(
      `API listening on http://localhost:${cfg.port} (HTTP + WebSocket /api/livestreams/ws + /api/livestreams/buckets/ws + /api/stats/ws + /api/chat/ws)`
    );
  });

  if (cfg.enableMarketSettlementScheduler) {
    startMarketScheduler(pool, console);
  }
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error("fatal:", e);
  process.exit(1);
});
