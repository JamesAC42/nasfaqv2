// Games WebSocket hub (/api/games/ws). Clients subscribe to channels and receive pushes:
//   lobby:{gameKey}      → { type: "lobby", game, tables }
//   table:{id}           → { type: "table", table }
//   blackjack:{tableKey} → { type: "blackjack", table }
// The hub is anonymous: everything it sends is public. Hidden information (duel picks before the
// reveal, the dealer's hole card) is withheld by the engines before it gets here.

const { WebSocketServer } = require("ws");

const CHANNEL_RE = /^(lobby:[a-z0-9-]{1,40}|table:\d{1,12}|blackjack:[a-z0-9-]{1,20})$/;
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

function subscribe(ws, channel) {
  if (!CHANNEL_RE.test(channel)) return;
  if (ws.gameChannels.size >= MAX_CHANNELS_PER_CLIENT && !ws.gameChannels.has(channel)) return;
  ws.gameChannels.add(channel);
  if (!channels.has(channel)) channels.set(channel, new Set());
  channels.get(channel).add(ws);
  for (const provider of snapshotProviders) {
    const snapshot = provider(channel);
    if (snapshot) {
      send(ws, snapshot);
      break;
    }
  }
  onCountChange(channel);
}

function unsubscribe(ws, channel) {
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

function publish(channel, payload) {
  const set = channels.get(channel);
  if (!set?.size) return;
  const text = JSON.stringify(payload);
  for (const ws of set) send(ws, text);
}

function createGamesWss() {
  wss = new WebSocketServer({ noServer: true, perMessageDeflate: false });
  wss.on("connection", (ws) => {
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
  registerSnapshotProvider: (provider) => snapshotProviders.push(provider),
};
