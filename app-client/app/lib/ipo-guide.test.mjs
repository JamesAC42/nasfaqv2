import assert from "node:assert/strict";
import { test } from "node:test";
import { dollars, holdSummary, ipoPhase, ipoSteps, localMoment, rangeText } from "./ipo-guide.mjs";

// A window from Thu Nov 12 09:00 ET to the listing at Thu Nov 19 09:00 ET (14:00 UTC both, EST).
const event = (status) => ({ status, window_opens_at: "2026-11-12T14:00:00.000Z", window_closes_at: "2026-11-19T14:00:00.000Z", listing_date: "2026-11-19" });
const before = Date.parse("2026-11-10T12:00:00Z");
const during = Date.parse("2026-11-14T19:00:00Z");
const after = Date.parse("2026-11-19T14:00:30Z");

const states = (result) => result.steps.map((step) => step.state).join(" ");

test("the phase follows the status, and the clock closes the window on time", () => {
  assert.equal(ipoPhase(event("announced"), before), "upcoming");
  assert.equal(ipoPhase(event("open"), during), "subscribe");
  // Still "open" in a cached body, but the close time has passed: shares are being handed out.
  assert.equal(ipoPhase(event("open"), after), "allocating");
  assert.equal(ipoPhase(event("open"), Date.parse("2026-11-19T14:00:00.000Z")), "allocating");
  assert.equal(ipoPhase(event("listed"), after), "trading");
  assert.equal(ipoPhase(event("cancelled"), during), "cancelled");
});

test("each step is done, current or next", () => {
  assert.deepEqual(
    ipoSteps(event("open"), during).steps.map((step) => step.key),
    ["subscribe", "allocate", "trade"],
  );
  assert.equal(states(ipoSteps(event("announced"), before)), "next next next");
  assert.equal(states(ipoSteps(event("open"), during)), "current next next");
  assert.equal(states(ipoSteps(event("open"), after)), "done current next");
  assert.equal(states(ipoSteps(event("listed"), after)), "done done current");
  assert.equal(states(ipoSteps(event("cancelled"), during)), "next next next");
  assert.equal(ipoSteps(event("listed"), after).phase, "trading");
});

test("times read in the viewer's own zone, with the zone named", () => {
  const close = "2026-11-19T14:00:00.000Z";
  assert.equal(localMoment(close, { timeZone: "America/New_York" }), "Thu, Nov 19, 9:00 AM EST");
  assert.equal(localMoment(close, { timeZone: "America/Los_Angeles" }), "Thu, Nov 19, 6:00 AM PST");
  assert.equal(localMoment(close, { timeZone: "Asia/Tokyo" }), "Thu, Nov 19, 11:00 PM GMT+9");
  assert.equal(localMoment("not a date"), "—");
});

test("money and ranges", () => {
  assert.equal(dollars(563.2), "$563.20");
  assert.equal(dollars(10000), "$10,000.00");
  assert.equal(dollars(-14.08), "-$14.08");
  assert.equal(rangeText([80, 84, 80, 84]), "80–84");
  assert.equal(rangeText([800, 800]), "800");
  assert.equal(rangeText([1200, 980]), "980–1,200");
  assert.equal(rangeText([null, undefined]), "");
  assert.equal(rangeText([null, 84]), "84");
});

test("a new request says what it holds from Cash and how the limit applies", () => {
  const line = holdSummary({ qty: 80, price: 7.04, cash: 10000, cap: 80, capPct: 10, offered: 800 });
  assert.equal(line.hold, "Holds $563.20 of your $10,000.00 Cash now.");
  assert.equal(line.cap, "Limit 80 per player: 10% of the 800 offered.");
  // Cents are rounded the way the API rounds the hold.
  assert.equal(holdSummary({ qty: 3, price: 6.555, capPct: 10 }).hold, "Holds $19.67 Cash now.");
});

test("changing a request holds only the difference, or gives it back", () => {
  const base = { price: 7.82, held: 312.8, cash: 9000, cap: 84, capPct: 10, offered: 840 };
  assert.equal(holdSummary({ ...base, qty: 50 }).hold, "Holds $78.20 more Cash now, $391.00 in all.");
  assert.equal(holdSummary({ ...base, qty: 30 }).hold, "Gives $78.20 back to your Cash now, $234.60 held.");
  assert.equal(holdSummary({ ...base, qty: 40 }).hold, "$312.80 of your Cash is held for these.");
});

test("nothing to hold without an amount or a price; the limit still shows when it's known", () => {
  assert.deepEqual(holdSummary({ qty: 0, price: 7.04, cap: 80, capPct: 10, offered: 800 }), { hold: "", cap: "Limit 80 per player: 10% of the 800 offered." });
  assert.deepEqual(holdSummary({ qty: 5, price: 0, capPct: 10 }), { hold: "", cap: "" });
  assert.equal(holdSummary({ qty: 5, price: 7, cap: 80, capPct: 10 }).cap, "Limit 80 per player.");
});
