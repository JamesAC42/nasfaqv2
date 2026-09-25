const test = require("node:test");
const assert = require("node:assert/strict");
const lmsr = require("../src/services/predictions/lmsr");

const close = (a, b, eps = 1e-7) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

test("prices sum to 1 and seed at the requested odds", () => {
  const q = lmsr.seedShares([0.2, 0.5, 0.3], 150);
  const p = lmsr.prices(q, 150);
  close(p.reduce((s, x) => s + x, 0), 1);
  close(p[0], 0.2);
  close(p[1], 0.5);
});

test("buying by cash spends exactly that much curve cash", () => {
  const q = [0, 0];
  const shares = lmsr.sharesForCash(q, 100, 0, 50);
  close(lmsr.buyCost(q, 100, 0, shares), 50, 1e-6);
  assert.ok(lmsr.prices([shares, 0], 100)[0] > 0.5);
});

test("a round trip returns the same cash (no fee)", () => {
  const q = [12, -4, 7];
  const shares = lmsr.sharesForCash(q, 200, 1, 321.5);
  const after = [12, -4 + shares, 7];
  close(lmsr.sellProceeds(after, 200, 1, shares), 321.5, 1e-6);
});

test("sharesToPrice lands on the target", () => {
  const q = [3, 9, -2, 0];
  const d = lmsr.sharesToPrice(q, 120, 2, 0.4);
  close(lmsr.prices(q.map((v, i) => (i === 2 ? v + d : v)), 120)[2], 0.4);
  const down = lmsr.sharesToPrice(q, 120, 1, 0.05);
  assert.ok(down < 0);
});

test("rails: the max buy stops at 99c and the house loss stays under b·ln N", () => {
  const b = 100;
  const q = [0, 0];
  const shares = lmsr.maxBuyShares(q, b, 0);
  const after = [shares, 0];
  close(lmsr.prices(after, b)[0], 0.99);
  const paid = lmsr.buyCost(q, b, 0, shares);
  assert.ok(shares - paid <= lmsr.maxLoss(b, 2) + 1e-9);
});

test("no overflow on large positions", () => {
  const q = [50000, 49000];
  const p = lmsr.prices(q, 250);
  assert.ok(Number.isFinite(p[0]) && Number.isFinite(lmsr.cost(q, 250)));
  assert.ok(Number.isFinite(lmsr.sharesForCash(q, 250, 1, 10)));
});

const trading = require("../src/services/predictions/trading");

test("buy pricing: fee on top, never over budget, rails respected", () => {
  const state = { b: 100, q: [0, 0] };
  const fill = trading.priceBuy(state, 0, 101, 0.01);
  assert.ok(fill.total <= 101 && Math.abs(fill.total - 101) < 0.011);
  close(fill.fee, fill.total - fill.curve, 1e-9);
  const huge = trading.priceBuy(state, 0, 25000, 0.01);
  assert.equal(huge.capped, "price");
  assert.ok(huge.pricesAfter[0] <= 0.99 + 1e-9 && huge.total < 25000);
  const limited = trading.priceBuy(state, 0, 500, 0.01, { ceiling: 0.6 });
  close(limited.pricesAfter[0], 0.6, 1e-9);
});

test("sell pricing: fee comes out of proceeds, floor respected", () => {
  const state = { b: 100, q: [120, 0] };
  const fill = trading.priceSell(state, 0, 50, 0.01);
  assert.ok(fill.payout < fill.curve && fill.payout > 0);
  const dump = trading.priceSell(state, 0, 100000, 0.01);
  assert.equal(dump.capped, "price");
  assert.ok(dump.pricesAfter[0] >= 0.01 - 1e-9);
});
