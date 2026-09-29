const test = require("node:test");
const assert = require("node:assert/strict");
const presence = require("../src/services/presence");

/** Just enough of a Redis sorted set for presence: zAdd, zRemRangeByScore, zCard in a multi. */
function fakeRedis() {
  const set = new Map();
  return {
    set,
    multi() {
      const ops = [];
      const chain = {
        zAdd: (_key, items) => (ops.push(() => items.forEach(({ score, value }) => set.set(value, score))), chain),
        zRemRangeByScore: (_key, min, max) => (ops.push(() => [...set].forEach(([value, score]) => score >= min && score <= max && set.delete(value))), chain),
        zCard: () => (ops.push(() => set.size), chain),
        exec: async () => ops.map((op) => op() ?? "OK"),
      };
      return chain;
    },
  };
}

test("a signed-in player counts once across tabs; each signed-out tab counts", () => {
  assert.equal(presence.visitorKey({ id: 7 }), "u:7");
  assert.equal(presence.visitorKey({ id: 7 }), presence.visitorKey({ id: 7 }));
  assert.notEqual(presence.visitorKey(null), presence.visitorKey(null));
  assert.match(presence.visitorKey(undefined), /^a:/);
});

test("online is who was seen in the last minute, across processes", async () => {
  const redis = fakeRedis();
  const now = 1_000_000;
  assert.equal(await presence.seen(redis, ["u:1", "a:x"], now), 2);
  // Another process sees u:1 again and someone else.
  assert.equal(await presence.seen(redis, ["u:1", "u:2"], now + 10_000), 3);
  // A minute after a:x was last seen it drops off; the others were seen more recently.
  assert.equal(await presence.seen(redis, [], now + presence.WINDOW_MS + 1), 2);
});

test("new sockets hear the count at once, and everyone hears changes only", async () => {
  const redis = fakeRedis();
  const sockets = new Set([{ visitor: "u:1" }, { visitor: "u:1" }, { visitor: "a:tab" }]);
  const sent = [];
  const broadcasts = [];
  const tracker = presence.startPresence({
    redis,
    wss: { clients: sockets },
    send: (ws, text) => sent.push([ws.visitor, JSON.parse(text).online]),
    broadcast: (text) => broadcasts.push(JSON.parse(text)),
    intervalMs: 5,
  });
  try {
    await tracker.welcome([...sockets][0]);
    assert.deepEqual(sent, [["u:1", 1]]);
    await new Promise((resolve) => setTimeout(resolve, 30));
    // Several ticks ran, but the count (u:1 once, plus the signed-out tab) changed once.
    assert.deepEqual(broadcasts.map((event) => [event.type, event.online]), [["site.online", 2]]);
  } finally {
    tracker.stop();
  }
});
