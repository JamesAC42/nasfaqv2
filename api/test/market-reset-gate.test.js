const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const marketAdmin = require("../src/services/marketAdmin");
const router = require("../src/routes/internalMarket");
const { resetRefusal } = require("../scripts/rebuild-market");

const admin = { id: 1, username: "admin", is_admin: true };
// Any database call here is a bug: the gate runs first.
const noDatabase = {
  connect() {
    throw new Error("the database was touched");
  },
  query() {
    throw new Error("the database was touched");
  },
};

function withResetEnv(value, work) {
  const saved = process.env.ALLOW_MARKET_RESET;
  if (value === undefined) delete process.env.ALLOW_MARKET_RESET;
  else process.env.ALLOW_MARKET_RESET = value;
  return Promise.resolve()
    .then(work)
    .finally(() => {
      if (saved === undefined) delete process.env.ALLOW_MARKET_RESET;
      else process.env.ALLOW_MARKET_RESET = saved;
    });
}

async function call(method, body) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.ctx = { pool: noDatabase, redis: null, user: admin };
    next();
  });
  app.use("/internal/market", router);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}/internal/market/reset`, {
      method,
      headers: { "content-type": "application/json" },
      body: method === "GET" ? undefined : JSON.stringify(body || {}),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  } finally {
    server.close();
  }
}

test("a reset needs ALLOW_MARKET_RESET=true", async () => {
  assert.equal(marketAdmin.isMarketResetAllowed({}), false);
  assert.equal(marketAdmin.isMarketResetAllowed({ ALLOW_MARKET_RESET: "false" }), false);
  assert.equal(marketAdmin.isMarketResetAllowed({ ALLOW_MARKET_RESET: "1" }), false);
  assert.equal(marketAdmin.isMarketResetAllowed({ ALLOW_MARKET_RESET: " TRUE " }), true);
  await withResetEnv(undefined, () => assert.rejects(marketAdmin.resetMarketState(noDatabase), { code: "market_reset_disabled" }));
});

test("the API refuses a reset, and says so, unless the deployment allows it", async () => {
  await withResetEnv(undefined, async () => {
    assert.deepEqual((await call("GET")).body, { enabled: false });
    const refused = await call("POST", { confirmation: "reset" });
    assert.equal(refused.status, 403);
    assert.equal(refused.body.error, "market_reset_disabled");
  });
  await withResetEnv("true", async () => {
    assert.deepEqual((await call("GET")).body, { enabled: true });
    // Allowed now, but still only with the typed confirmation (and still admin only: see
    // internal-market-auth.test.js).
    assert.equal((await call("POST", { confirmation: "nope" })).status, 400);
  });
});

test("scripts/rebuild-market.js --reset only runs against a local database", () => {
  const local = "postgres://me:pw@localhost:5432/nasfaq";
  const remote = "postgres://me:pw@db.example.com:25060/nasfaq?sslmode=require";
  assert.equal(resetRefusal({ databaseUrl: local, nodeEnv: "development", argv: ["--reset"] }), null);
  assert.equal(resetRefusal({ databaseUrl: "postgres://me@127.0.0.1/nasfaq", nodeEnv: undefined, argv: [] }), null);
  assert.equal(resetRefusal({ databaseUrl: "postgres://me@[::1]:5432/nasfaq", nodeEnv: undefined, argv: [] }), null);
  assert.match(resetRefusal({ databaseUrl: remote, nodeEnv: undefined, argv: [] }), /db\.example\.com/);
  assert.match(resetRefusal({ databaseUrl: local, nodeEnv: "production", argv: [] }), /production/);
  // A ?host= parameter is where pg really connects.
  assert.match(resetRefusal({ databaseUrl: "postgres://me@localhost/nasfaq?host=db.example.com", nodeEnv: undefined, argv: [] }), /db\.example\.com/);
  assert.ok(resetRefusal({ databaseUrl: "not a url", nodeEnv: undefined, argv: [] }));
  assert.equal(resetRefusal({ databaseUrl: remote, nodeEnv: "production", argv: ["--reset", "--allow-remote-reset"] }), null);
});
