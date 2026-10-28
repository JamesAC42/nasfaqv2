const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { requireUploader } = require("../src/userContext");

// The same order as server.js: who's asking first, then the gate, then the big parser.
async function withApp(t) {
  const users = {
    admin: { id: 1, is_admin: true },
    manager: { id: 2, can_manage_assets: true },
    player: { id: 3 },
  };
  let parsed = 0;
  const app = express();
  app.use((req, _res, next) => {
    req.ctx = { user: users[req.headers["x-user"]] || null };
    next();
  });
  app.use("/api/admin/assets", requireUploader((user) => user?.is_admin || user?.can_manage_assets), express.json({ limit: "25mb" }));
  app.use(express.json({ limit: "1mb" }));
  app.use((req, res) => {
    if (req.body && Object.keys(req.body).length) parsed += 1;
    res.json({ ok: true, size: JSON.stringify(req.body || {}).length });
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => {
    server.closeAllConnections();
    return new Promise((resolve) => server.close(resolve));
  });
  const base = `http://127.0.0.1:${server.address().port}/api/admin/assets/emojis`;
  const send = (user, { method = "POST", body } = {}) =>
    fetch(base, {
      method,
      headers: { ...(user ? { "x-user": user } : {}), ...(body ? { "content-type": "application/json" } : {}) },
      body,
    });
  return { send, parsed: () => parsed };
}

test("only uploaders get a body parsed on the big-upload routes", async (t) => {
  const { send, parsed } = await withApp(t);
  const big = JSON.stringify({ data: "x".repeat(2 * 1024 * 1024) });

  const anonymous = await send(null, { body: big });
  assert.equal(anonymous.status, 401);
  assert.deepEqual(await anonymous.json(), { error: "unauthenticated" });
  const player = await send("player", { body: big });
  assert.equal(player.status, 403);
  assert.deepEqual(await player.json(), { error: "forbidden" });
  assert.equal(parsed(), 0);

  for (const user of ["admin", "manager"]) {
    const response = await send(user, { body: big });
    assert.equal(response.status, 200, user);
    assert.ok((await response.json()).size > 2 * 1024 * 1024);
  }
  assert.equal(parsed(), 2);

  // Reads and preflights carry no body and go through for anyone.
  assert.equal((await send(null, { method: "GET" })).status, 200);
  assert.equal((await send(null, { method: "OPTIONS" })).status, 200);
});
