const test = require("node:test");
const assert = require("node:assert/strict");
const { _test } = require("../src/services/trading");

const at = (iso) => _test.clockLiveOrderInterval(new Date(iso));

test("tick windows follow the ET clock", () => {
  // 2026-09-25 is EDT (UTC-4).
  assert.deepEqual([at("2026-09-25T13:30:00Z").marketDate, at("2026-09-25T13:30:00Z").intervalKey], ["2026-09-25", "open"]); // 09:30 ET
  assert.equal(at("2026-09-25T19:05:00Z").intervalKey, "lunch"); // 15:05 ET
  assert.equal(at("2026-09-26T01:30:00Z").intervalKey, "late"); // 21:30 ET
  assert.deepEqual([at("2026-09-26T05:00:00Z").marketDate, at("2026-09-26T05:00:00Z").intervalKey], ["2026-09-25", "late"]); // 01:00 ET, still the 25th's day
  assert.deepEqual([at("2026-09-26T08:00:00Z").marketDate, at("2026-09-26T08:00:00Z").intervalKey], ["2026-09-25", "overnight"]); // 04:00 ET
  assert.deepEqual([at("2026-09-26T13:00:00Z").marketDate, at("2026-09-26T13:00:00Z").intervalKey], ["2026-09-26", "open"]); // 09:00 ET: new day
});

test("a stale settlement date falls back to the clock window", async () => {
  const client = { query: async () => ({ rows: [{ interval_key: "overnight", scheduled_at: "2024-01-01T08:00:00Z" }] }) };
  const window = await _test.resolveLiveOrderInterval(client, { statusMarketDate: new Date(2024, 0, 1), now: new Date("2026-09-25T13:30:00Z") });
  assert.deepEqual([window.marketDate, window.intervalKey], ["2026-09-25", "open"]);
});

test("the limit resets at the next tick", () => {
  assert.equal(_test.nextLiveOrderWindowAt(new Date("2026-09-26T13:30:00Z")).toISOString(), "2026-09-26T19:00:00.000Z"); // 09:30 ET -> 15:00 ET
  assert.equal(_test.nextLiveOrderWindowAt(new Date("2026-09-26T05:00:00Z")).toISOString(), "2026-09-26T07:00:00.000Z"); // 01:00 ET -> 03:00 ET
});
