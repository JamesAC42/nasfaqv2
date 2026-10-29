const test = require("node:test");
const assert = require("node:assert/strict");
const alerts = require("../src/services/alerts");

// Discord alerts: one post per condition per cooldown, "Resolved" once, shared across pods through
// Redis (here an in-memory stand-in with Redis's SET NX/PX semantics; REDIS_TEST_URL runs the same
// cases on a real local Redis), and never a word when the webhook isn't set.

const URL_ = "https://discord.com/api/webhooks/1/token-secret";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const quiet = { info() {}, warn() {}, error() {} };

function recorder({ ok = true } = {}) {
  const posts = [];
  return { posts, fetchImpl: async (to, init) => (posts.push({ to, body: JSON.parse(init.body) }), { ok, status: ok ? 204 : 500 }) };
}

const stores = [["in-memory Redis", () => alerts.memoryStore()]];
const redisUrl = process.env.REDIS_TEST_URL;
if (redisUrl) {
  stores.push([
    "real Redis",
    async () => {
      const target = new URL(redisUrl);
      assert.ok(["127.0.0.1", "localhost"].includes(target.hostname), "REDIS_TEST_URL must be a local Redis");
      const { createClient } = require("redis");
      const client = createClient({ url: redisUrl });
      await client.connect();
      for await (const key of client.scanIterator({ MATCH: `${alerts.KEY_PREFIX}test-*`, COUNT: 100 })) await client.del(key);
      return client;
    },
  ]);
}

for (const [name, open] of stores) {
  test(`one post per cooldown, then Resolved once (${name})`, async (t) => {
    alerts._test.reset();
    const redis = await open();
    t.after(() => redis.quit?.());
    const { posts, fetchImpl } = recorder();
    const options = { url: URL_, fetchImpl, logger: quiet, cooldownMs: 300 };
    const alert = { title: "No settlement for 2026-10-29", message: "Past 09:30 ET.", fields: [{ name: "Last cycle error", value: "boom" }] };

    assert.deepEqual(await alerts.raise(redis, "test-a", alert, options), { sent: true });
    assert.equal((await alerts.raise(redis, "test-a", alert, options)).reason, "cooldown");
    assert.equal((await alerts.raise(redis, "test-a", { ...alert, title: "changed" }, options)).reason, "cooldown");
    assert.equal(posts.length, 1);
    assert.equal(posts[0].to, URL_);
    assert.equal(posts[0].body.embeds[0].title, "No settlement for 2026-10-29");
    assert.deepEqual(posts[0].body.allowed_mentions, { parse: [] });

    // Another key has its own cooldown.
    assert.equal((await alerts.raise(redis, "test-b", { title: "Other" }, options)).sent, true);
    assert.equal(posts.length, 2);

    const resolved = await alerts.resolve(redis, "test-a", { title: "ignored", message: "2026-10-29 is settled." }, options);
    assert.equal(resolved.sent, true);
    assert.equal(posts.length, 3);
    assert.equal(posts[2].body.embeds[0].title, "Resolved: No settlement for 2026-10-29");
    assert.match(posts[2].body.embeds[0].description, /2026-10-29 is settled\.\nLasted /);
    assert.equal(posts[2].body.embeds[0].color, 0x2e9e5b);
    assert.equal((await alerts.resolve(redis, "test-a", { title: "x" }, options)).reason, "not_active");
    assert.equal((await alerts.resolve(redis, "test-never", { title: "x" }, options)).reason, "not_active");

    // Flapping: a raise right after the resolve still waits out the cooldown, and so says nothing to resolve.
    assert.equal((await alerts.raise(redis, "test-a", alert, options)).reason, "cooldown");
    assert.equal((await alerts.resolve(redis, "test-a", { title: "x" }, options)).reason, "not_active");
    assert.equal(posts.length, 3);

    await sleep(350);
    assert.equal((await alerts.raise(redis, "test-a", alert, options)).sent, true);
    assert.equal(posts.length, 4);
  });

  test(`pods racing on one key post once (${name})`, async (t) => {
    alerts._test.reset();
    const redis = await open();
    t.after(() => redis.quit?.());
    const { posts, fetchImpl } = recorder();
    const options = { url: URL_, fetchImpl, logger: quiet, cooldownMs: 60_000 };
    const results = await Promise.all(Array.from({ length: 5 }, () => alerts.raise(redis, "test-race", { title: "Burst" }, options)));
    assert.equal(results.filter((result) => result.sent).length, 1);
    assert.equal(posts.length, 1);
    const resolves = await Promise.all(Array.from({ length: 3 }, () => alerts.resolve(redis, "test-race", { title: "Burst" }, options)));
    assert.equal(resolves.filter((result) => result.sent).length, 1);
    assert.equal(posts.length, 2);
  });

  test(`force skips the cooldown and the alert keeps its state (${name})`, async (t) => {
    alerts._test.reset();
    const redis = await open();
    t.after(() => redis.quit?.());
    const { posts, fetchImpl } = recorder();
    const options = { url: URL_, fetchImpl, logger: quiet, cooldownMs: 60_000 };
    await alerts.raise(redis, "test-force", { title: "1 scheduler" }, { ...options, state: { names: ["wire"] } });
    assert.deepEqual((await alerts.getActive(redis, "test-force")).state, { names: ["wire"] });
    assert.equal((await alerts.raise(redis, "test-force", { title: "2 schedulers" }, options)).reason, "cooldown");
    assert.equal((await alerts.raise(redis, "test-force", { title: "2 schedulers" }, { ...options, force: true, state: { names: ["wire", "settlement"] } })).sent, true);
    assert.equal(posts.length, 2);
    const active = await alerts.getActive(redis, "test-force");
    assert.deepEqual(active.state, { names: ["wire", "settlement"] });
    assert.equal(active.title, "2 schedulers");
  });
}

test("no webhook: nothing posted, nothing kept, said once", async () => {
  alerts._test.reset();
  const lines = [];
  const logger = { info: (line) => lines.push(line), warn: (line) => lines.push(line) };
  const redis = alerts.memoryStore();
  const fetchImpl = async () => assert.fail("no webhook, no post");
  assert.equal((await alerts.raise(redis, "test-unset", { title: "x" }, { url: "", fetchImpl, logger })).reason, "not_configured");
  assert.equal((await alerts.raise(redis, "test-unset", { title: "x" }, { url: undefined, fetchImpl, logger })).reason, "not_configured");
  assert.equal((await alerts.resolve(redis, "test-unset", { title: "x" }, { url: "", fetchImpl, logger })).reason, "not_configured");
  assert.equal(lines.length, 1);
  assert.match(lines[0], /DISCORD_ALERT_WEBHOOK_URL is not set/);
  assert.equal(await redis.get(`${alerts.KEY_PREFIX}test-unset:cooldown`), null);
});

test("a failed post gives the cooldown back, and never logs the URL", async () => {
  alerts._test.reset();
  const lines = [];
  const logger = { info() {}, warn: (line) => lines.push(line) };
  const redis = alerts.memoryStore();
  const failing = recorder({ ok: false });
  assert.equal((await alerts.raise(redis, "test-fail", { title: "x" }, { url: URL_, fetchImpl: failing.fetchImpl, logger })).reason, "post_failed");
  assert.equal(await alerts.getActive(redis, "test-fail"), null);
  assert.equal((await alerts.raise(redis, "test-fail", { title: "x" }, { url: URL_, logger, fetchImpl: async () => { throw new Error(`connect failed to ${URL_}`); } })).reason, "post_failed");

  // The 5-second timeout (shortened here) aborts a hung Discord.
  const hung = async (_to, init) => new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }))));
  const started = Date.now();
  assert.equal((await alerts.raise(redis, "test-fail", { title: "x" }, { url: URL_, logger, fetchImpl: hung, timeoutMs: 30 })).reason, "post_failed");
  assert.ok(Date.now() - started < 1000);

  const ok = recorder();
  assert.equal((await alerts.raise(redis, "test-fail", { title: "x" }, { url: URL_, fetchImpl: ok.fetchImpl, logger })).sent, true);
  assert.deepEqual(lines, [
    "alert test-fail: Discord answered 500",
    "alert test-fail: Discord post failed (network)",
    "alert test-fail: Discord post failed (timeout)",
  ]);
  assert.ok(lines.every((line) => !line.includes("token-secret")));
});

test("Redis failing mid-way: dedupe carries on in memory", async () => {
  alerts._test.reset();
  const broken = { set: async () => { throw Object.assign(new Error("down"), { code: "ECONNREFUSED" }); }, get: async () => { throw new Error("down"); }, del: async () => { throw new Error("down"); } };
  const { posts, fetchImpl } = recorder();
  const warned = [];
  const options = { url: URL_, fetchImpl, logger: { info() {}, warn: (line) => warned.push(line) } };
  assert.equal((await alerts.raise(broken, "test-broken", { title: "x" }, options)).sent, true);
  assert.equal((await alerts.raise(broken, "test-broken", { title: "x" }, options)).reason, "cooldown");
  assert.equal(posts.length, 1);
  assert.equal(warned.filter((line) => line.includes("Redis unavailable")).length, 1);
});

test("only a new alert can ping, and only the configured role", () => {
  const firing = alerts.discordPayload("firing", "settlement-missing", { title: "No settlement", message: "m", severity: "error" }, { roleId: "123456789" });
  assert.equal(firing.content, "<@&123456789>");
  assert.deepEqual(firing.allowed_mentions, { parse: [], roles: ["123456789"] });
  assert.equal(firing.embeds[0].color, 0xd0021b);
  assert.match(firing.embeds[0].footer.text, /^settlement-missing/);

  const resolved = alerts.discordPayload("resolved", "settlement-missing", { title: "No settlement" }, { roleId: "123456789" });
  assert.equal(resolved.content, undefined);
  assert.deepEqual(resolved.allowed_mentions, { parse: [] });
  assert.equal(resolved.embeds[0].title, "Resolved: No settlement");

  const injected = alerts.discordPayload("firing", "k", { title: "x" }, { roleId: "@everyone" });
  assert.equal(injected.content, undefined);
  assert.deepEqual(injected.allowed_mentions, { parse: [] });

  const long = alerts.discordPayload("firing", "k", { title: "t".repeat(400), message: "m".repeat(5000), fields: [{ name: "Error", value: "e".repeat(2000) }] }, { roleId: "" });
  assert.equal(long.embeds[0].title.length, 256);
  assert.equal(long.embeds[0].description.length, 4000);
  assert.equal(long.embeds[0].fields[0].value.length, 1024);
});
