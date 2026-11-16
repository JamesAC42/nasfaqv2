const test = require("node:test");
const assert = require("node:assert/strict");
const weekly = require("../src/services/weeklyEvaluation");
const supply = require("../src/services/marketSupply");

test("the evaluation date is the latest Saturday in New York", () => {
  assert.equal(weekly.evaluationDateFor(new Date("2026-09-26T04:00:30Z")), "2026-09-26"); // Sat 00:00:30 EDT
  assert.equal(weekly.evaluationDateFor(new Date("2026-09-26T03:59:00Z")), "2026-09-19"); // Fri 23:59 EDT
  assert.equal(weekly.evaluationDateFor(new Date("2026-09-30T15:00:00Z")), "2026-09-26"); // Wednesday
});

test("bell-curve ranking gives the same spread whatever the raw numbers", () => {
  const scores = weekly.rankScores([0.001, 0.002, 5, -3, NaN, 0.0015]);
  assert.equal(scores[4], null);
  assert.ok(scores[2] > 0 && scores[3] < 0);
  assert.ok(Math.abs(scores[2] + scores[3]) < 1e-9, "the best and worst are mirror images");
  const tied = weekly.rankScores([1, 1, 1]);
  assert.deepEqual(tied, [0, 0, 0]);
  assert.ok(Math.abs(weekly.normalQuantile(0.975) - 1.959964) < 1e-5);
});

test("dividend rates: nothing near the mean, capped at 10%", () => {
  assert.equal(weekly.dividendRate(0.2), 0);
  assert.equal(weekly.dividendRate(-0.3), 0);
  assert.ok(Math.abs(weekly.dividendRate(1.35) - 0.04) < 1e-12);
  assert.ok(Math.abs(weekly.dividendRate(-1.35) + 0.04) < 1e-12);
  assert.equal(weekly.dividendRate(10), 0.1);
  assert.equal(weekly.dividendRate(-10), -0.1);
  assert.equal(weekly.dividendRate(null), 0);
});

test("max shares follow subscribers on a bell curve, in steps of 100", () => {
  assert.equal(weekly.maxSharesFor(0), 18000);
  assert.ok(weekly.maxSharesFor(-3) <= 6200 && weekly.maxSharesFor(3) >= 29800);
  assert.equal(weekly.maxSharesFor(1.1) % 100, 0);
});

test("shares for sale leave the broker's buffer and stop in a buyback", () => {
  const asset = { max_supply: 1000, treasury_supply: 100, broker_buffer_pct: 0.02, trading_state: "open" };
  assert.equal(supply.sharesForSale(asset), 80);
  assert.equal(supply.sharesForSale({ ...asset, treasury_supply: 10 }), 0);
  assert.equal(supply.sharesForSale({ ...asset, trading_state: "buyback" }), 0);
  assert.equal(supply.sharesForSale({ ...asset, broker_buffer_pct: null }), 80);
});

test("the buyback price starts at 120% and drops 10 points a day to 50%", () => {
  const start = "2026-09-26T04:00:00Z";
  const at = (hours) => supply.buybackMultiplier(start, new Date(Date.parse(start) + hours * 3_600_000));
  assert.ok(Math.abs(at(0) - 1.2) < 1e-12);
  assert.ok(Math.abs(at(23) - 1.2) < 1e-12);
  assert.ok(Math.abs(at(24) - 1.1) < 1e-12);
  assert.ok(Math.abs(at(6 * 24 + 1) - 0.6) < 1e-12);
  assert.equal(at(30 * 24), 0.5);
  assert.equal(supply.buybackPrice({ frozen_price: 10, started_at: start }, new Date(Date.parse(start) + 49 * 3_600_000)), 10 * (1.2 - 0.2));
});

test("a buyback pays the offer only on shares still over the max", () => {
  const buyback = { frozen_price: 10, started_at: "2026-09-26T04:00:00Z" };
  const at = new Date("2026-09-26T10:00:00Z"); // day 0: 120%
  const asset = { circulating_supply: 1050, max_supply: 1000 };
  assert.ok(Math.abs(supply.buybackFillPrice(asset, buyback, 20, at) - 12) < 1e-9); // all 20 over
  assert.ok(Math.abs(supply.buybackFillPrice(asset, buyback, 100, at) - (50 * 12 + 50 * 10) / 100) < 1e-9); // half over
  assert.equal(supply.buybackFillPrice({ circulating_supply: 990, max_supply: 1000 }, buyback, 10, at), 10); // back under: frozen price
});

test("the offer pays only on shares held before the cutoff; the rest get the frozen price", () => {
  const buyback = { frozen_price: 10, started_at: "2026-09-26T04:00:00Z" };
  const at = new Date("2026-09-26T10:00:00Z"); // day 0: 120%
  const asset = { circulating_supply: 1600, max_supply: 1000 }; // 600 over
  const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} vs ${expected}`);
  // Held before the cutoff: the offer.
  close(supply.buybackFillPrice(asset, buyback, 20, at, supply.offerSharesFor(300, 0)), 12);
  // Bought after it: the frozen price.
  assert.deepEqual(supply.buybackFill(asset, buyback, 20, at, supply.offerSharesFor(300, 300)), { price: 10, atOffer: 0 });
  // Some of each: 200 held before, 100 after; a sale of 250 gets the offer on 200.
  const mixed = supply.buybackFill(asset, buyback, 250, at, supply.offerSharesFor(300, 100));
  assert.equal(mixed.atOffer, 200);
  close(mixed.price, (200 * 12 + 50 * 10) / 250);
  // What's left of that holding after the sale (50) is all late: the frozen price.
  assert.equal(supply.offerSharesFor(50, 100), 0);
  // First come, first served still caps it at the shares over the max.
  const capped = supply.buybackFill({ circulating_supply: 1100, max_supply: 1000 }, buyback, 300, at, supply.offerSharesFor(300, 0));
  assert.equal(capped.atOffer, 100);
  close(capped.price, (100 * 12 + 200 * 10) / 300);
});

test("the cutoff is the last tick before the buyback starts: Friday's Late tick for Saturday's", () => {
  // Saturday 00:00 EDT and EST: Friday 21:00 in New York.
  assert.equal(supply.offerCutoffBefore(weekly.evaluationStartsAt("2026-09-26")).toISOString(), "2026-09-26T01:00:00.000Z");
  assert.equal(supply.offerCutoffBefore(weekly.evaluationStartsAt("2026-12-05")).toISOString(), "2026-12-05T02:00:00.000Z");
  // An on-demand run: the last tick before it, strictly.
  assert.equal(supply.offerCutoffBefore(new Date("2026-11-16T15:30:00Z")).toISOString(), "2026-11-16T14:00:00.000Z"); // 10:30 EST → Open 09:00
  assert.equal(supply.offerCutoffBefore(new Date("2026-11-16T14:00:00Z")).toISOString(), "2026-11-16T08:00:00.000Z"); // at the Open → Overnight 03:00
  assert.equal(supply.offerCutoffBefore(new Date("2026-11-16T07:59:59Z")).toISOString(), "2026-11-16T02:00:00.000Z"); // 02:59 EST → Late 21:00
});

test("a buyback's public view carries its whole schedule and the shares still over", () => {
  const buyback = { frozen_price: 10, started_at: "2026-09-26T04:00:00Z", target_max_supply: 1000, shares_bought: 30 };
  const asset = { circulating_supply: 1050, max_supply: 1000, treasury_supply: 0, trading_state: "buyback" };
  const view = supply.supplyView(asset, buyback, new Date("2026-09-27T10:00:00Z")).buyback; // day 1
  assert.equal(view.start, supply.BUYBACK_START);
  assert.equal(view.daily_step, supply.BUYBACK_DAILY_STEP);
  assert.equal(view.floor, supply.BUYBACK_FLOOR);
  assert.ok(Math.abs(view.multiplier - 1.1) < 1e-12);
  assert.equal(view.next_step_at.toISOString(), "2026-09-28T04:00:00.000Z");
  assert.equal(view.shares_over, 50);
});

test("an evaluation starts at midnight New York time in both EDT and EST", () => {
  assert.equal(weekly.evaluationStartsAt("2026-09-26").toISOString(), "2026-09-26T04:00:00.000Z");
  assert.equal(weekly.evaluationStartsAt("2026-12-05").toISOString(), "2026-12-05T05:00:00.000Z");
});

test("headline moods from keywords when Jev can't say", () => {
  const { keywordMood } = require("../src/services/newsMoods");
  assert.equal(keywordMood("Minato Aqua graduation: final stream date set"), "cope");
  assert.equal(keywordMood("Usada Pekora announces her 3D live concert"), "hype");
  assert.equal(keywordMood("Suisei passes 2 million subscribers"), "moon");
  assert.equal(keywordMood("Marine wins the Mario Kart tournament"), "smug");
  assert.equal(keywordMood("Surprise collab leaks early"), "shock");
  assert.equal(keywordMood("Mio merch restock this weekend"), "idle");
});
