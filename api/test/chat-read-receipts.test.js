const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const chatDb = require("../src/chatDb");
const { router } = require("../src/routes/chat");

test("marking a room read answers the reader and broadcasts nothing to the room", async (t) => {
  t.mock.method(chatDb, "ensureChatTopologyRecent", async () => {});
  t.mock.method(chatDb, "getChannelByKey", async () => ({ id: 7, channel_key: "market:global" }));
  const marked = [];
  t.mock.method(chatDb, "markChannelRead", async (_pool, args) => {
    marked.push(args);
    return 42;
  });
  const published = [];
  const redis = { publish: async (channel, message) => published.push({ channel, message }) };

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.ctx = { pool: {}, redis, user: { id: 5, username: "reader" } };
    next();
  });
  app.use("/api/chat", router);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/chat/channels/market:global/read`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ last_read_message_id: 42 }),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { channel_key: "market:global", user_id: 5, last_read_message_id: 42 });
  assert.deepEqual(marked, [{ channelId: 7, userId: 5, lastReadMessageId: 42 }]);
  assert.deepEqual(published, []);
});
