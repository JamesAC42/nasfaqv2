import assert from "node:assert/strict";
import test from "node:test";
import { buybackPlan, buybackSell, nextEvaluationAt, nextOpenAt, offerOn, sharesAtOffer, stepsOf, yourOfferShares } from "./buyback-plan.mjs";

// Saturday 2026-11-14 00:00:04 EST, as a weekly evaluation would start one.
const STARTED = "2026-11-14T05:00:04Z";
const buyback = { started_at: STARTED, frozen_price: 10, multiplier: 1.2, daily_step: 0.1, floor: 0.5, shares_over: 40, start: 1.2 };
const at = (iso) => Date.parse(iso);

test("the offer drops 10 points a day and stops at the floor", () => {
  assert.equal(offerOn(buyback, 0), 1.2);
  assert.equal(offerOn(buyback, 1), 1.1);
  assert.equal(offerOn(buyback, 6), 0.6);
  assert.equal(offerOn(buyback, 9), 0.5);
  // Without `start` in the payload it falls back to the API's default.
  assert.equal(offerOn({ ...buyback, start: undefined }, 2), 1);
});

test("a Saturday buyback has seven days of offers before the evaluation forces the rest", () => {
  const now = at("2026-11-16T15:00:00Z"); // Monday: day 2
  const steps = stepsOf(buyback, now, nextEvaluationAt(now));
  assert.deepEqual(steps.map((step) => step.pct), [1.2, 1.1, 1, 0.9, 0.8, 0.7, 0.6]);
  assert.deepEqual(steps.map((step) => step.state), ["past", "past", "now", "later", "later", "later", "later"]);
});

test("a buyback started midweek reaches the floor and stops there", () => {
  const early = { ...buyback, started_at: "2026-11-01T05:00:00Z" };
  const steps = stepsOf(early, at("2026-11-02T15:00:00Z"), null);
  assert.equal(steps.at(-1).pct, 0.5);
  assert.equal(steps.length, 8);
});

test("the plan: today's offer, the next drop, and the shares still at the offer", () => {
  const now = at("2026-11-16T15:00:00Z");
  const plan = buybackPlan({ buyback, circulating: 1030, max: 1000 }, now);
  assert.equal(plan.pct, 1);
  assert.equal(plan.offer, 10);
  assert.equal(plan.nextPct, 0.9);
  assert.equal(plan.nextStepAt, at("2026-11-17T05:00:04Z"));
  assert.equal(plan.over, 30);
  assert.equal(plan.endKind, "forced");
  assert.equal(plan.endsAt, at("2026-11-21T05:00:00Z"));
});

test("back under the max, it ends at the next Open", () => {
  const now = at("2026-11-16T15:00:00Z"); // 10:00 EST
  const plan = buybackPlan({ buyback, circulating: 990, max: 1000 }, now);
  assert.equal(plan.over, 0);
  assert.equal(plan.endKind, "open");
  assert.equal(plan.endsAt, at("2026-11-17T14:00:00Z")); // Tuesday 09:00 EST
});

test("on its last day there's no next drop", () => {
  const plan = buybackPlan({ buyback }, at("2026-11-20T20:00:00Z")); // Friday
  assert.equal(plan.pct, 0.6);
  assert.equal(plan.nextStepAt, null);
  assert.equal(plan.over, 40); // from the payload when supply isn't known
});

test("shares at the offer never go negative", () => {
  assert.equal(sharesAtOffer({ circulating: 10, max: 20 }), 0);
  assert.equal(sharesAtOffer({ circulating: null, max: null, fallback: 7 }), 7);
});

test("the Open and the evaluation in New York time, across the clocks going back", () => {
  assert.equal(nextOpenAt(at("2026-11-16T13:59:00Z")), at("2026-11-16T14:00:00Z")); // 08:59 EST
  assert.equal(nextOpenAt(at("2026-11-16T14:00:00Z")), at("2026-11-17T14:00:00Z")); // right at the Open: the next one
  assert.equal(nextEvaluationAt(at("2026-10-30T12:00:00Z")), at("2026-10-31T04:00:00Z")); // EDT
  assert.equal(nextEvaluationAt(at("2026-11-14T05:00:04Z")), at("2026-11-21T05:00:00Z"));
});

test("a holder's shares at the offer: bought before the cutoff, less queued sells", () => {
  assert.equal(yourOfferShares({ held: 300 }), 300); // no buyback limit
  assert.equal(yourOfferShares({ held: 300, eligible: 200 }), 200); // 100 bought after the cutoff
  assert.equal(yourOfferShares({ held: 300, eligible: 0 }), 0); // all bought after it
  assert.equal(yourOfferShares({ held: 300, eligible: 200, queued: 150 }), 50);
  assert.equal(yourOfferShares({ held: 300, eligible: 200, queued: 250 }), 0);
  assert.equal(yourOfferShares({ held: 100, eligible: 200 }), 100); // never more than held
});

test("a sell fills at the offer on shares over the max that are yours to sell at it, the frozen price after", () => {
  const plan = { offer: 12, frozen: 10, over: 600 };
  assert.equal(buybackSell(plan, 20).price, 12); // held before the cutoff
  assert.deepEqual(buybackSell(plan, 20, 0), { price: 10, atOffer: 0 }); // bought after it
  assert.deepEqual(buybackSell(plan, 250, 200), { price: (200 * 12 + 50 * 10) / 250, atOffer: 200 }); // some of each
  assert.deepEqual(buybackSell({ ...plan, over: 100 }, 300, 300), { price: (100 * 12 + 200 * 10) / 300, atOffer: 100 }); // first come: only the excess
  assert.deepEqual(buybackSell(plan, 0), { price: 10, atOffer: 0 });
});
