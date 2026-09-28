// Games WebSocket hub (/api/games/ws). Clients subscribe to channels and receive pushes:
//   lobby:{gameKey}      → { type: "lobby", game, tables }
//   table:{id}           → { type: "table", table }
//   blackjack:{tableKey} → { type: "blackjack", table }
// Every message carries its `channel`. The hub is anonymous: everything it sends is public. Hidden information (duel picks before the
// reveal, the dealer's hole card) is withheld by the engines before it gets here.

const { WebSocketServer } = require("ws");

const CHANNEL_RE = /^(lobby:[a-z0-9-]{1,40}|table:\d{1,12}|blackjack:[a-z0-9-]{1,20}|exchange)$/;
// `me` is the signed-in player's own feed (exchange alerts: outbid, sold, trade offers). The
// socket is authenticated at upgrade; `me` maps to `user:{id}` and is never public.
const ME = "me";
const userChannel = (userId) => `user:${userId}`;
const MAX_CHANNELS_PER_CLIENT = 8;

const channels = new Map(); // channel → Set<ws>
const snapshotProviders = []; // (channel) => payload | null
let wss = null;

function send(ws, payload) {
  if (ws.readyState !== 1) return;
  try {
    ws.send(typeof payload === "string" ? payload : JSON.stringify(payload));
  } catch {
    /* socket closing */
  }
}

function resolveChannel(ws, channel) {
  if (channel === ME) return ws.userId ? userChannel(ws.userId) : null;
  return CHANNEL_RE.test(channel) ? channel : null;
}

function subscribe(ws, requested) {
  const channel = resolveChannel(ws, requested);
  if (!channel) return;
  if (ws.gameChannels.size >= MAX_CHANNELS_PER_CLIENT && !ws.gameChannels.has(channel)) return;
  ws.gameChannels.add(channel);
  if (!channels.has(channel)) channels.set(channel, new Set());
  channels.get(channel).add(ws);
  for (const provider of snapshotProviders) {
    const snapshot = provider(channel);
    if (snapshot) {
      send(ws, { ...snapshot, channel });
      break;
    }
  }
  onCountChange(channel);
}

function unsubscribe(ws, requested) {
  const channel = resolveChannel(ws, requested) ?? requested;
  ws.gameChannels.delete(channel);
  const set = channels.get(channel);
  if (!set) return;
  set.delete(ws);
  if (!set.size) channels.delete(channel);
  onCountChange(channel);
}

const countListeners = [];
function onCountChange(channel) {
  for (const listener of countListeners) listener(channel, count(channel));
}

function count(channel) {
  return channels.get(channel)?.size ?? 0;
}

// With more than one API process (Kubernetes runs several), a push has to reach sockets held by the
// other processes too: server.js sets a bridge that publishes through Redis, and every process
// (this one included) delivers what arrives on it to its own sockets via deliverBridged().
let bridge = null;
function setBridge(fn) {
  bridge = typeof fn === "function" ? fn : null;
}

function deliverLocal(channelKey, text) {
  const set = channels.get(channelKey);
  if (!set?.size) return;
  for (const ws of set) send(ws, text);
}

function publish(channel, payload) {
  const text = JSON.stringify({ ...payload, channel });
  if (bridge) return void bridge({ to: channel, text });
  deliverLocal(channel, text);
}

/** Push to one player's `me` feed (every socket they have open, on any API process). */
function publishToUser(userId, payload) {
  const text = JSON.stringify({ ...payload, channel: ME });
  if (bridge) return void bridge({ to: userChannel(userId), text });
  deliverLocal(userChannel(userId), text);
}

/** A push that came in over the bridge (from any process). */
function deliverBridged(message) {
  if (message && typeof message.to === "string" && typeof message.text === "string") deliverLocal(message.to, message.text);
}

function createGamesWss() {
  wss = new WebSocketServer({ noServer: true, perMessageDeflate: false, maxPayload: 16 * 1024 });
  wss.on("connection", (ws, req) => {
    ws.on("error", () => ws.terminate()); // a bad frame must not take the process down
    ws.userId = req?.gamesUser?.id ? Number(req.gamesUser.id) : null;
    ws.gameChannels = new Set();
    ws.isAlive = true;
    ws.on("pong", () => {
      ws.isAlive = true;
    });
    ws.on("message", (raw) => {
      let message;
      try {
        message = JSON.parse(String(raw));
      } catch {
        return;
      }
      const list = Array.isArray(message?.channels) ? message.channels.map(String) : [];
      if (message?.action === "subscribe") list.forEach((channel) => subscribe(ws, channel));
      else if (message?.action === "unsubscribe") list.forEach((channel) => unsubscribe(ws, channel));
      else if (message?.action === "ping") send(ws, { type: "pong" });
    });
    ws.on("close", () => {
      for (const channel of [...ws.gameChannels]) unsubscribe(ws, channel);
    });
    send(ws, { type: "hello" });
  });
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      try {
        ws.ping();
      } catch {
        /* closing */
      }
    }
  }, 30_000);
  heartbeat.unref?.();
  return wss;
}

module.exports = {
  count,
  createGamesWss,
  onSubscriberCount: (listener) => countListeners.push(listener),
  publish,
  publishToUser,
  setBridge,
  deliverBridged,
  registerSnapshotProvider: (provider) => snapshotProviders.push(provider),
};
