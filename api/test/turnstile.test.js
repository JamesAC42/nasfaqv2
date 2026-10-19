const test = require("node:test");
const assert = require("node:assert/strict");
const { expectedHostnames, verifyTurnstile } = require("../src/services/turnstile");

const production = { NODE_ENV: "production", TURNSTILE_SECRET_KEY: "secret", PUBLIC_APP_BASE_URL: "https://holo.nasfaq.biz" };
const request = (headers = {}) => ({ body: { turnstile_token: "token" }, headers, socket: { remoteAddress: "10.0.0.9" } });

function answer(body, { ok = true } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init, params: Object.fromEntries(init.body) });
    return { ok, json: async () => body };
  };
  return { calls, fetchImpl };
}

test("without a secret: skipped in development, sign-up refused in production", async (t) => {
  t.mock.method(console, "error", () => {});
  await verifyTurnstile(request(), { env: {} });
  await verifyTurnstile(request(), { env: {}, required: true });
  await verifyTurnstile(request(), { env: { NODE_ENV: "production" } });
  await assert.rejects(verifyTurnstile(request(), { env: { NODE_ENV: "production" }, required: true }), { code: "turnstile_unavailable" });
});

test("sends the secret, the token and the player's IP", async () => {
  const { calls, fetchImpl } = answer({ success: true, hostname: "holo.nasfaq.biz" });
  await verifyTurnstile(request({ "cf-connecting-ip": "203.0.113.7" }), { env: production, fetchImpl });
  assert.equal(calls[0].url, "https://challenges.cloudflare.com/turnstile/v0/siteverify");
  assert.deepEqual(calls[0].params, { secret: "secret", response: "token", remoteip: "203.0.113.7" });
  assert.ok(calls[0].init.signal instanceof AbortSignal);
  await verifyTurnstile(request(), { env: production, fetchImpl });
  assert.equal(calls[1].params.remoteip, "10.0.0.9");
  await assert.rejects(verifyTurnstile({ body: {}, headers: {} }, { env: production, fetchImpl }), { code: "turnstile_required" });
});

test("fails closed: a rejected token, a token from another site, or no answer in time", async () => {
  await assert.rejects(verifyTurnstile(request(), { env: production, fetchImpl: answer({ success: false }).fetchImpl }), { code: "turnstile_failed" });
  await assert.rejects(verifyTurnstile(request(), { env: production, fetchImpl: answer({ success: true }, { ok: false }).fetchImpl }), { code: "turnstile_failed" });
  await assert.rejects(verifyTurnstile(request(), { env: production, fetchImpl: answer({ success: true, hostname: "evil.example" }).fetchImpl }), { code: "turnstile_failed" });
  await assert.rejects(verifyTurnstile(request(), { env: production, fetchImpl: answer({ success: true }).fetchImpl }), { code: "turnstile_failed" });

  const hang = (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason)));
  const started = Date.now();
  await assert.rejects(verifyTurnstile(request(), { env: production, fetchImpl: hang, timeoutMs: 50 }), { code: "turnstile_unavailable" });
  assert.ok(Date.now() - started < 2_000);
  await assert.rejects(verifyTurnstile(request(), { env: production, fetchImpl: async () => { throw new Error("ECONNRESET"); } }), { code: "turnstile_unavailable" });
});

test("which hostnames a token may come from", async () => {
  assert.deepEqual(expectedHostnames(production), ["holo.nasfaq.biz"]);
  assert.deepEqual(expectedHostnames({ ...production, TURNSTILE_HOSTNAMES: "holo.nasfaq.biz, NASFAQ.biz" }), ["holo.nasfaq.biz", "nasfaq.biz"]);
  // Development accepts any (the test keys answer with their own hostname) unless told otherwise.
  assert.deepEqual(expectedHostnames({ PUBLIC_APP_BASE_URL: "http://localhost:3010" }), []);
  assert.deepEqual(expectedHostnames({ TURNSTILE_HOSTNAMES: "localhost" }), ["localhost"]);
  const env = { ...production, TURNSTILE_HOSTNAMES: "holo.nasfaq.biz,nasfaq.biz" };
  await verifyTurnstile(request(), { env, fetchImpl: answer({ success: true, hostname: "nasfaq.biz" }).fetchImpl });
  await verifyTurnstile(request(), { env: { TURNSTILE_SECRET_KEY: "secret" }, fetchImpl: answer({ success: true, hostname: "example.com" }).fetchImpl });
});
