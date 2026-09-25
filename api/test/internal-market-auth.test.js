const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const router = require("../src/routes/internalMarket");

// The guard runs before any handler touches the database, so a fake ctx is enough.
async function call(user, method, path) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.ctx = { pool: null, redis: null, user };
    next();
  });
  app.use("/internal/market", router);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}/internal/market${path}`, { method, headers: { "content-type": "application/json" }, body: method === "GET" ? undefined : "{}" });
    return { status: res.status, body: await res.json().catch(() => null) };
  } finally {
    server.close();
  }
}

for (const [method, path] of [["POST", "/close"], ["POST", "/open"], ["POST", "/settle/2026-09-25"], ["POST", "/adjustments/generate/2026-09-25"], ["POST", "/run-daily-cycle"], ["GET", "/status"], ["GET", "/jobs"]]) {
  test(`${method} ${path} refuses signed-out and non-admin users`, async () => {
    assert.equal((await call(null, method, path)).status, 401);
    const player = await call({ id: 5, username: "player", is_admin: false }, method, path);
    assert.equal(player.status, 403);
    assert.equal(player.body.error, "forbidden");
  });
}
