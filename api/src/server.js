const http = require("http");
const express = require("express");
const cors = require("cors");
const { WebSocketServer } = require("ws");

const { loadEnv, getConfig } = require("./config");
const { createPool } = require("./db");
const { applySchema } = require("./migrations");
const { createRedis } = require("./redis");
const chatDb = require("./chatDb");
const marketDb = require("./marketDb");
const authService = require("./services/auth");
const marketState = require("./services/marketState");
const { startMarketScheduler, loadSchedulerConfig, computeNextScheduledAt } = require("./services/marketScheduler");
const { startAdjustmentScheduler } = require("./services/marketAdjustments");
const { startLiveOrderScheduler } = require("./services/trading");
const { startPredictionsScheduler } = require("./services/predictions/scheduler");

const channelsRoutes = require("./routes/channels");
const { router: chatRoutes, CHAT_EVENTS_REDIS_CHANNEL } = require("./routes/chat");
const overviewRoutes = require("./routes/overview");
const livestreamsRoutes = require("./routes/livestreams");
const newsRoutes = require("./routes/news");
const articleRoutes = require("./routes/articles");
const articleDb = require("./articleDb");
const analysisRoutes = require("./routes/analysis");
const leaderboardRoutes = require("./routes/leaderboard");
const gamesRoutes = require("./routes/games");
const gameTablesRoutes = require("./routes/gameTables");
const gamesHub = require("./services/games/tables/hub");
const gameTablesOwner = String(process.env.GAMES_TABLES_OWNER || "true").toLowerCase() !== "false";
const pvpTables = require("./services/games/tables/pvp");
const blackjackTables = require("./services/games/tables/blackjack");
const marketRoutes = require("./routes/market");
const internalMarketRoutes = require("./routes/internalMarket");
const portfolioRoutes = require("./routes/portfolio");
const profileRoutes = require("./routes/profiles");
const notificationRoutes = require("./routes/notifications");
const predictionMarketsRoutes = require("./routes/predictions");
const authRoutes = require("./routes/auth");
const statsRoutes = require("./routes/stats");
const nasfaqThreadRoutes = require("./routes/nasfaqThread");
const adminAssetsRoutes = require("./routes/adminAssets");
const adminHolonewsRoutes = require("./routes/adminHolonews");
const adminRoutes = require("./routes/admin");
const assetsRoutes = require("./routes/assets");
const mediaCatalog = require("./services/mediaCatalog");
const achievements = require("./services/achievements");
const gamesCatalog = require("./services/games/catalog");
const { MARKET_EVENTS_REDIS_CHANNEL } = require("./services/marketEvents");
const { scrubPublicMarketPayload } = require("./services/marketSecrecy");
const { PREDICTION_MARKET_EVENTS_REDIS_CHANNEL } = require("./services/predictionMarketEvents");

const LIVESTREAM_VIEWER_UPDATES_CHANNEL = "nasfaq_livestreams:viewer_updates";
const LIVESTREAM_BUCKET_UPDATES_CHANNEL = "nasfaq_livestreams:bucket_updates";
const LIVESTREAM_SNAPSHOT_REFRESH_MS = 30_000;

function sendWsText(client, payload) {
  if (!client || client.readyState !== 1) return;
  client.send(payload, { binary: false, compress: false });
}

// Market events go out in bundles: everything that arrives within MARKET_BUNDLE_MS becomes one
// message ({ type: "market.bundle", events: [...] }) for sockets that said they understand bundles,
// so a batch of fills costs each socket a few sends instead of one per fill. Sending is the cost
// that grows with sockets × events; older clients still get one message per event.
const GAMES_EVENTS_REDIS_CHANNEL = "nasfaq_games:events";
// Clients only ever send small control messages (subscribe, hello, ping); the ws default is 100 MiB.
const WS_MAX_PAYLOAD = 16 * 1024;
const allowLoopbackOrigins = process.env.NODE_ENV !== "production";
const MARKET_BUNDLE_MS = 100;
let marketQueue = [];
let marketFlushTimer = null;
let marketWssRef = null;

function queueMarketEvent(text) {
  marketQueue.push(text);
  if (!marketFlushTimer) marketFlushTimer = setTimeout(flushMarketEvents, MARKET_BUNDLE_MS);
}

function flushMarketEvents() {
  marketFlushTimer = null;
  const events = marketQueue;
  marketQueue = [];
  if (!events.length || !marketWssRef) return;
  const bundle = events.length === 1 ? events[0] : `{"type":"market.bundle","events":[${events.join(",")}]}`;
  marketWssRef.clients.forEach((client) => {
    if (client.marketBundles) sendWsText(client, bundle);
    else for (const text of events) sendWsText(client, text);
  });
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
    channel_id: item.youtube_channel_id || item.channel_id || null,
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

function channelIdFromRedisKey(key) {
  const match = String(key || "").match(/^nasfaq_livestreams:\{(.+)\}$/);
  return match ? match[1] : null;
}

function withChannelId(item, channelID) {
  return {
    ...item,
    youtube_channel_id: item.youtube_channel_id || item.channel_id || channelID || null,
  };
}

function signatureForStreamDiff(stream) {
  // Ignore concurrent_viewers so we don't emit diffs every time viewer counts change.
  // Viewer counts are sent separately via the viewer websocket.
  return JSON.stringify({
    video_id: stream.video_id,
    status: stream.status,
    title: stream.title,
    channel_id: stream.youtube_channel_id || stream.channel_id || null,
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
    const channelID = channelIdFromRedisKey(key);
    const h = await redisClient.hGetAll(key);
    for (const [, val] of Object.entries(h)) {
      const item = safeParseJSON(val);
      if (!item || !item.video_id) continue;
      const stream = withChannelId(item, channelID);
      if (stream.status === "live") live.push(stream);
      else if (stream.status === "upcoming") upcoming.push(stream);
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
app.disable("x-powered-by");
app.use((_req, res, next) => {
  // API responses are data: never framed, never sniffed as something else.
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  next();
});
// Big bodies only where images are uploaded as data URLs (admin tools); 1 MB everywhere else, so an
// anonymous request can't make every pod parse 25 MB of JSON.
app.use(["/api/admin/assets", "/api/channels"], express.json({ limit: "25mb" }));
app.use(express.json({ limit: "1mb" }));
app.use(
  cors({
    origin(origin, callback) {
      // Local dev servers on any port, but never in production.
      const isAllowedLoopbackDevOrigin = allowLoopbackOrigins && /^https?:\/\/(localhost|127\.0\.0\.1):\d+$/.test(String(origin || ""));
      if (!origin || cfg.corsOrigins.includes(origin) || isAllowedLoopbackDevOrigin) {
        callback(null, true);
        return;
      }
      callback(new Error(`CORS origin not allowed: ${origin}`));
    },
    credentials: true
  })
);

const pool = createPool(cfg.databaseUrl);
let redis = null;

const api = express.Router();

// Health endpoints bypass authentication and other database-dependent middleware.
require("./health").registerHealthRoutes(app, pool);

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
// Only the process holding the tables lease serves table routes (see main()); elsewhere they fall
// through to 404.
let ownsGameTables = false;
api.use("/games", (req, res, next) => (ownsGameTables ? gameTablesRoutes(req, res, next) : next()));
api.use("/games", gamesRoutes);
api.use("/market", marketRoutes);
api.use("/portfolio", portfolioRoutes);
api.use("/prediction-markets", predictionMarketsRoutes);
api.use("/profiles", profileRoutes);
api.use("/notifications", notificationRoutes);
api.use("/stats", statsRoutes);
api.use("/admin/assets", adminAssetsRoutes);
api.use("/admin/holonews", adminHolonewsRoutes);
api.use("/admin", adminRoutes);
api.use("/assets", assetsRoutes);
api.use("/", nasfaqThreadRoutes);

app.use("/api", api);

app.use((err, _req, res, _next) => {
  // eslint-disable-next-line no-console
  console.error(err);
  if (err?.code === "unauthenticated") return res.status(401).json({ error: "unauthenticated" });
  if (err?.code === "email_verification_required") return res.status(403).json({ error: "email_verification_required" });
  if (err?.code === "forbidden") return res.status(403).json({ error: "forbidden" });
  if (
    err?.code === "article_not_found"
    || err?.code === "proposal_not_found"
    || err?.code === "profile_not_found"
    || err?.code === "asset_comment_not_found"
    || err?.code === "game_not_found"
    || err?.code === "cosmetic_not_found"
    || err?.code === "game_session_not_found"
  ) return res.status(404).json({ error: err.code });
  if (err?.code === "profile_picture_not_found") return res.status(404).json({ error: err.code });
  if (
    err?.code === "already_friends"
    || err?.code === "friend_request_pending"
    || err?.code === "friend_request_needs_response"
    || err?.code === "username_taken"
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
    || err?.code === "invalid_asset_comment"
    || err?.code === "invalid_asset_comment_vote"
    || err?.code === "invalid_prediction_market"
    || err?.code === "invalid_prediction_market_comment"
    || err?.code === "invalid_prediction_market_order"
    || err?.code === "invalid_game_inventory"
    || err?.code === "invalid_game_wallet"
    || err?.code === "invalid_game_gacha"
    || err?.code === "invalid_gacha_prize"
    || err?.code === "gacha_prize_pool_empty"
    || err?.code === "invalid_game_session"
    || err?.code === "invalid_holonews_thumbnail_request"
    || err?.code === "s3_not_configured"
    || err?.code === "gemini_not_configured"
    || err?.code === "gemini_request_failed"
    || err?.code === "reference_images_missing"
    || err?.code === "invalid_reaction"
  ) {
    return res.status(400).json({ error: err.code });
  }
  if (
    err?.code === "asset_comment_requires_holding"
    || err?.code === "asset_comment_self_vote"
    || err?.code === "prediction_market_comment_requires_position"
    || err?.code === "reaction_locked"
    || err?.code === "sticker_locked"
    || err?.code === "banner_locked"
  ) {
    return res.status(403).json({ error: err.code });
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
    || err?.code === "gacha_prize_not_found"
    || err?.code === "prediction_market_not_found"
    || err?.code === "holonews_item_not_found"
  ) {
    return res.status(404).json({ error: err.code });
  }
  if (
    err?.code === "prediction_market_slug_taken"
    || err?.code === "prediction_market_transition_invalid"
    || err?.code === "prediction_market_self_approval_forbidden"
    || err?.code === "prediction_market_closed"
    || err?.code === "prediction_insufficient_cash"
    || err?.code === "prediction_insufficient_holdings"
    || err?.code === "prediction_cash_invariant_failed"
    || err?.code === "prediction_order_not_found"
    || err?.code === "prediction_order_not_cancellable"
    || err?.code === "live_order_not_found_or_not_pending"
    || err?.code === "game_session_not_active"
  ) {
    return res.status(409).json({ error: err.code });
  }
  return res.status(500).json({ error: "internal_error" });
});

const GAME_TABLES_LEASE_KEY = 7_310_443;

async function acquireGameTablesLease(db, { waitMs = Number(process.env.GAMES_TABLES_LEASE_WAIT_MS || 60_000) } = {}) {
  const client = await db.connect();
  const deadline = Date.now() + waitMs;
  for (;;) {
    const { rows } = await client.query("SELECT pg_try_advisory_lock($1) AS ok", [GAME_TABLES_LEASE_KEY]);
    if (rows[0]?.ok) break;
    if (Date.now() > deadline) {
      client.release();
      console.error("games: another process holds the game tables; this one runs without them");
      return false;
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  // Losing this connection means losing the lease while tables are live: stop, and let the
  // orchestrator restart us (the restart refunds anything unfinished, once).
  client.on("error", (error) => {
    console.error("games: lost the game tables lease:", String(error?.message || error));
    process.exit(1);
  });
  return true;
}

async function main() {
  if (cfg.enableMigrations) {
    await applySchema(pool);
    await articleDb.backfillAllNewsArticles(pool);
  }
  await achievements.syncDefinitions(pool);
  await gamesCatalog.syncCatalog(pool);
  // Game tables live in this process's memory, and init() refunds every unfinished match it finds
  // (they can't survive a restart). So exactly one process may own them: in Kubernetes that's the
  // api-games Deployment (one replica; the ingress sends /api/games there), and every other API
  // process sets GAMES_TABLES_OWNER=false. Two owners would split tables between them and refund
  // matches the other one is still playing.
  // The lease is a Postgres session lock held for the life of the process: a second would-be owner
  // (a misconfigured pod, a rollout overlap) waits for it, and if it never frees up, runs without
  // tables rather than splitting them.
  if (gameTablesOwner && (await acquireGameTablesLease(pool))) {
    await pvpTables.init(pool);
    await blackjackTables.init(pool);
    ownsGameTables = true;
  }
  require("./services/games/sessions").startWeeklySettlement(pool);
  await mediaCatalog.syncMediaCatalog(pool, console);
  await chatDb.ensureChatTopology(pool);

  const schedulerConfig = loadSchedulerConfig();
  const stateClient = await pool.connect();
  try {
    await marketState.ensureMarketRuntimeState(stateClient);
    // Only the process that runs settlement may reopen the market at boot. An api-web pod
    // restarting while the scheduler is mid-settlement used to reopen trading under it.
    const ownsSettlement = (process.env.MARKET_SETTLEMENT_SCHEDULER_ENABLED || "true").toLowerCase() !== "false";
    const existingStatus = ownsSettlement ? await marketState.getMarketStatusWithClient(stateClient) : null;
    const nextScheduledAt = computeNextScheduledAt(new Date(), schedulerConfig).toISOString();
    if (!ownsSettlement) {
      // leave the market state to the scheduler
    } else if (existingStatus?.trading_status === "manual_closed") {
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
  const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false, maxPayload: WS_MAX_PAYLOAD });
  const bucketWss = new WebSocketServer({ noServer: true, perMessageDeflate: false, maxPayload: WS_MAX_PAYLOAD });
  const statsWss = new WebSocketServer({ noServer: true, perMessageDeflate: false, maxPayload: WS_MAX_PAYLOAD });
  const chatWss = new WebSocketServer({ noServer: true, perMessageDeflate: false, maxPayload: WS_MAX_PAYLOAD });
  const marketWss = new WebSocketServer({ noServer: true, perMessageDeflate: false, maxPayload: WS_MAX_PAYLOAD });
  const predictionMarketWss = new WebSocketServer({ noServer: true, perMessageDeflate: false, maxPayload: WS_MAX_PAYLOAD });
  const gamesWss = gamesHub.createGamesWss();

  // Heartbeat for the plain sockets (the games hub has its own): ping every 30s and drop any that
  // didn't answer the last one. Without it a phone that lost signal stays "connected" and keeps
  // collecting market broadcasts in its send buffer until TCP gives up, which can take many minutes.
  const HEARTBEAT_MS = 30_000;
  for (const server of [wss, bucketWss, statsWss, chatWss, marketWss, predictionMarketWss]) {
    server.on("connection", (socket) => {
      // A bad frame (too big, malformed) surfaces as an 'error' on the socket; without a listener
      // Node treats it as unhandled and the whole process exits. Drop just that socket.
      socket.on("error", () => socket.terminate());
      socket.isAlive = true;
      socket.on("pong", () => {
        socket.isAlive = true;
      });
    });
  }
  const heartbeat = setInterval(() => {
    for (const server of [wss, bucketWss, statsWss, chatWss, marketWss, predictionMarketWss]) {
      server.clients.forEach((socket) => {
        if (socket.isAlive === false) {
          socket.terminate();
          return;
        }
        socket.isAlive = false;
        try {
          socket.ping();
        } catch {}
      });
    }
  }, HEARTBEAT_MS);
  heartbeat.unref?.();

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
        // A handful of rooms at a time; one socket can't make the server look up thousands.
        const requestedChannelKeys = normalizeChannelKeyList(payload.channel_keys).slice(0, 20);
        const subscribed = [];
        const rejected = [];

        await chatDb.ensureChatTopologyRecent(pool).catch(() => {});
        for (const channelKey of requestedChannelKeys) {
          try {
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
  marketWssRef = marketWss;
  marketWss.on("connection", (ws) => {
    ws.on("message", (raw) => {
      const hello = safeParseJSON(String(raw).slice(0, 512));
      if (hello?.type === "hello" && hello.bundles === true) ws.marketBundles = true;
    });
    (async () => {
      try {
        // Status only. The board is 250+ KB of JSON and every page already loads it from
        // /api/market/assets (cached, gzipped); sending it again down each new socket made a reconnect
        // storm after a deploy cost a full board per socket. A client that reconnects refetches it.
        const status = await marketState.getMarketStatus(pool);
        sendWsText(
          ws,
          JSON.stringify({
            type: "market.snapshot",
            status: status || null,
            at: new Date().toISOString(),
          })
        );
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error("market websocket snapshot failed:", String(error?.message || error));
        sendWsText(
          ws,
          JSON.stringify({
            type: "market.error",
            error: "snapshot_unavailable",
            at: new Date().toISOString(),
          })
        );
      }
    })();
    ws.on("close", () => {});
  });
  predictionMarketWss.on("connection", (ws) => {
    sendWsText(ws, JSON.stringify({ type: "prediction.hello", at: new Date().toISOString() }));
    ws.on("close", () => {});
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
              : pathname === "/api/market/ws"
                ? marketWss
                : pathname === "/api/prediction-markets/ws"
                  ? predictionMarketWss
                  : pathname === "/api/games/ws"
                    ? gamesWss
          : null;

    if (!target) {
      socket.destroy();
      return;
    }

    // Browsers always send Origin on a socket upgrade; only our own site (or a local dev server)
    // may open one with the player's cookie. Non-browser clients send none and are let through.
    const origin = req.headers.origin;
    if (origin && !cfg.corsOrigins.includes(origin) && !(allowLoopbackOrigins && /^https?:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin))) {
      socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }

    try {
      if (target === chatWss) {
        req.chatUser = await authService.getAuthenticatedUser(pool, req);
      }
      if (target === gamesWss) {
        // Optional: signed-in sockets can follow their own `me` feed.
        req.gamesUser = await authService.getAuthenticatedUser(pool, req).catch(() => null);
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
  // Games pushes (tables, lobbies, each player's notifications) go through Redis so they reach the
  // socket whichever API process holds it; see games/tables/hub.js.
  if (redis) {
    gamesHub.setBridge((message) => {
      redis.publish(GAMES_EVENTS_REDIS_CHANNEL, JSON.stringify(message)).catch((error) => {
        console.error("games push failed:", String(error?.message || error));
      });
    });
    await redisSub.subscribe(GAMES_EVENTS_REDIS_CHANNEL, (message) => {
      gamesHub.deliverBridged(safeParseJSON(String(message)));
    });
  }
  await redisSub.subscribe(CHAT_EVENTS_REDIS_CHANNEL, (message) => {
    const payload = String(message);
    const parsed = safeParseJSON(payload);
    if (!parsed?.channel_key) return;

    chatWss.clients.forEach((client) => {
      if (!client.chatSubscriptions?.has(parsed.channel_key)) return;
      sendWsText(client, payload);
    });
  });
  await redisSub.subscribe(MARKET_EVENTS_REDIS_CHANNEL, (message) => {
    // Every market socket is public: strip fair value and premiums (the hidden tick target) from
    // settlement, tick and fill events before they go out.
    const parsed = safeParseJSON(String(message));
    if (!parsed) return;
    queueMarketEvent(JSON.stringify(scrubPublicMarketPayload(parsed)));
  });
  await redisSub.subscribe(PREDICTION_MARKET_EVENTS_REDIS_CHANNEL, (message) => {
    const payload = String(message);
    predictionMarketWss.clients.forEach((client) => {
      sendWsText(client, payload);
    });
  });
  // eslint-disable-next-line no-console
  console.log("Subscribed to Redis channels:", LIVESTREAM_VIEWER_UPDATES_CHANNEL, LIVESTREAM_BUCKET_UPDATES_CHANNEL, CHAT_EVENTS_REDIS_CHANNEL, MARKET_EVENTS_REDIS_CHANNEL, PREDICTION_MARKET_EVENTS_REDIS_CHANNEL);

  if (cfg.enableLivestreamSnapshotOwner) {
    // One server-side refresh timer replaces client polling; keep it single-owner in Kubernetes.
    await refreshSnapshot();
    setInterval(refreshSnapshot, LIVESTREAM_SNAPSHOT_REFRESH_MS);
  }

  server.listen(cfg.port, () => {
    // eslint-disable-next-line no-console
    console.log(
      `API listening on http://localhost:${cfg.port} (HTTP + WebSocket /api/livestreams/ws + /api/livestreams/buckets/ws + /api/stats/ws + /api/chat/ws + /api/market/ws + /api/prediction-markets/ws + /api/games/ws)`
    );
  });

  if (cfg.enableMarketSettlementScheduler) {
    startMarketScheduler(pool, console, redis);
  }
  if (cfg.enableMarketAdjustmentScheduler) {
    startAdjustmentScheduler(pool, console, redis);
  }
  if (cfg.enableMarketLiveOrderScheduler) {
    startLiveOrderScheduler(pool, console, redis);
  }
  if (cfg.enableMarketSettlementScheduler) {
    // Saturday 00:00 ET: dividends and fees, max shares, buybacks (MARKET_WEEKLY_EVALUATION_ENABLED=false to stop it).
    require("./services/weeklyEvaluation").startWeeklyEvaluationScheduler(pool, console, redis);
  }
  if (cfg.enablePredictionMarketScheduler) {
    startPredictionsScheduler(pool, console, redis);
  }
  // The card exchange closes auctions and expires listings and trade offers on its own clock.
  require("./services/games/exchange").startExchangeScheduler(pool, console);
  // The Wire posts automatic headlines every 10 minutes (stream events judged by Jev when JEV_API_KEY is set).
  require("./services/wire").startWireScheduler(pool, console);
  // The /vt/ chatter index scans hololive threads every 5 minutes (CHATTER_ENABLED=off to stop it).
  require("./services/chatter").startChatterScheduler(pool, console);
}

// A stray rejected promise is a bug to log, not a reason to drop every socket on this pod.
process.on("unhandledRejection", (reason) => {
  // eslint-disable-next-line no-console
  console.error("unhandled rejection:", reason);
});

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error("fatal:", e);
  process.exit(1);
});
