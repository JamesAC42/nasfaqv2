import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { clampShares, FEE_RATE, fillPrice, keyboardInset, maxBuyShares, maxSellShares, orderTotals, SLIPPAGE_WEIGHT, slippageFraction, stepShares } from "./trade-estimate.mjs";

// npm test runs from app-client/. The API's own numbers (api/test/market-sim.test.js keeps them honest).
const parity = JSON.parse(readFileSync(join(process.cwd(), "..", "api", "test", "fixtures", "market-sim-parity.json"), "utf8"));
const close = (actual, expected, message, tolerance = 1e-12) =>
  assert.ok(Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected)), `${message}: ${actual} vs ${expected}`);

test("the ticket prices a fill the way the API does: the quote moved by slippage on the order's size", () => {
  assert.equal(SLIPPAGE_WEIGHT, parity.settings.slippage_weight);
  assert.equal(FEE_RATE, parity.settings.fee_rate);
  for (const row of parity.execution) {
    close(fillPrice(row.side, row.side === "buy" ? row.ask : row.bid, row.quantity, row.depth), row.price, `${row.side} ${row.quantity} on ${row.depth}`);
  }
  // 180 shares on a depth of 2,000 fill 4.5% off the quote.
  close(slippageFraction(180, 2000), 0.045, "a full tick's worth");
  assert.equal(slippageFraction(180, null), 0, "no depth, no estimate of it");
});

test("totals: the fee comes out of Credit first", () => {
  const buy = orderTotals({ side: "buy", price: 10, quantity: 10, credit: 0.4 });
  close(buy.fee, 1, "fee");
  close(buy.feeFromCredit, 0.4, "from Credit");
  close(buy.total, 100.6, "Cash a buy takes");
  const sell = orderTotals({ side: "sell", price: 10, quantity: 10, credit: 5, sellCreditRate: 0.01 });
  close(sell.total, 100, "Credit paid the whole fee");
  close(sell.creditEarned, 1, "Credit earned");
});

test("MAX buy: the most Cash covers at the slipped ask with the fee, within the allowance and the shares for sale", () => {
  const ask = 12.24;
  const depth = 2000;
  const cost = (quantity, credit = 0) => orderTotals({ side: "buy", price: fillPrice("buy", ask, quantity, depth), quantity, credit }).total;
  const cash = 1000;
  const shares = maxBuyShares({ ask, depth, cash, room: 180 });
  assert.ok(cost(shares) <= cash && cost(shares + 1) > cash, `${shares} shares`);
  // Slippage counts: at the bare ask the same Cash would seem to buy more.
  assert.ok(Math.floor(cash / (ask * (1 + FEE_RATE))) >= shares);
  // Credit paying the fee leaves more Cash for shares.
  const withCredit = maxBuyShares({ ask, depth, cash, credit: 100, room: 180 });
  assert.ok(withCredit > shares && cost(withCredit, 100) <= cash && cost(withCredit + 1, 100) > cash);
  assert.equal(maxBuyShares({ ask, depth, cash: 1e9, room: 180 }), 180, "the allowance");
  assert.equal(maxBuyShares({ ask, depth, cash: 1e9, room: 180, forSale: 42.7 }), 42, "the shares for sale");
  assert.equal(maxBuyShares({ ask, depth, cash: 1e9, room: 0 }), 0, "nothing left this tick");
  assert.equal(maxBuyShares({ ask, depth, cash: 5, room: 180 }), 0, "not one share");
  assert.equal(maxBuyShares({ ask, depth, cash: -20, room: 180 }), 0, "in the red");
  assert.equal(maxBuyShares({ ask: null, depth, cash: 1000, room: 180 }), 0, "no quote");
});

test("MAX sell: what you hold less queued sells, within the allowance", () => {
  assert.deepEqual(maxSellShares({ held: 60, queued: 0, room: 180 }), { shares: 60, all: true });
  assert.deepEqual(maxSellShares({ held: 300, queued: 0, room: 180 }), { shares: 180, all: false });
  assert.deepEqual(maxSellShares({ held: 60, queued: 20, room: 180 }), { shares: 40, all: false });
  assert.deepEqual(maxSellShares({ held: 60, queued: 60, room: 180 }), { shares: 0, all: false });
  assert.deepEqual(maxSellShares({ held: 60.5, queued: 0, room: null }), { shares: 60, all: true });
});

test("share count: whole, not negative, within the MAX button's number or the share box", () => {
  assert.equal(clampShares(42.9, 180), 42);
  assert.equal(clampShares(-5, 180), 0);
  assert.equal(clampShares("", 180), 0);
  assert.equal(clampShares("250", 180), 180);
  assert.equal(clampShares(5000, null), 5000, "no max known: anything the box takes");
  assert.equal(clampShares(5_000_000, null), 999_999);
  assert.equal(clampShares(10, 0), 0, "nothing to buy");
});

test("steppers: one share at a time, between one share and the max", () => {
  assert.equal(stepShares(25, 1, 180), 26);
  assert.equal(stepShares(25, -1, 180), 24);
  assert.equal(stepShares(180, 1, 180), 180, "stops at the max");
  assert.equal(stepShares(1, -1, 180), 1, "never under one share");
  assert.equal(stepShares(0, 1, 180), 1);
  assert.equal(stepShares(0, -1, 180), 1);
  assert.equal(stepShares(500, -1, 180), 180, "over the max steps down to it");
  assert.equal(stepShares(500, 1, 180), 180);
  assert.equal(stepShares(3, 1, 0), 0, "nothing to buy: stays at none");
  assert.equal(stepShares(25, 1, null), 26, "no max known");
});

test("keyboard inset: what the visual viewport loses at the bottom, ignoring browser bars", () => {
  assert.equal(keyboardInset({ innerHeight: 800, viewHeight: 800 }), 0);
  assert.equal(keyboardInset({ innerHeight: 800, viewHeight: 760 }), 0, "a toolbar, not a keyboard");
  assert.equal(keyboardInset({ innerHeight: 800, viewHeight: 460 }), 340);
  assert.equal(keyboardInset({ innerHeight: 800, viewHeight: 460, offsetTop: 120 }), 220, "the page scrolled up under the keyboard");
});
