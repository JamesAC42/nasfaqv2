import test from "node:test";
import assert from "node:assert/strict";
import { displayMode, formatInZone, isMarketZone, makeTimeFormat, wallClock, zoneCity, zoneLabel, zonedInstant, zoneOffsetMinutes } from "./display-time.mjs";

// 09:05 in New York on a Monday in November (14:05 UTC, 23:05 in Tokyo).
const AT = Date.parse("2026-11-16T14:05:00Z");
const SUMMER = Date.parse("2026-07-13T13:05:00Z"); // 09:05 EDT

test("modes: ET until mounted, the old spots while the flag is off, then the player's pick", () => {
  assert.equal(displayMode({ mounted: false, flagOn: true, choice: "local" }), "server");
  assert.equal(displayMode({ mounted: true, flagOn: false, choice: "local" }), "legacy");
  assert.equal(displayMode({ mounted: true, flagOn: true, choice: null }), "market");
  assert.equal(displayMode({ mounted: true, flagOn: true, choice: "market" }), "market");
  assert.equal(displayMode({ mounted: true, flagOn: true, choice: "local" }), "local");
});

test("zone names: ET all year for New York, English short names elsewhere, an offset where there's none", () => {
  assert.equal(zoneLabel("America/New_York", AT), "ET");
  assert.equal(zoneLabel("America/New_York", SUMMER), "ET");
  assert.equal(zoneLabel("Asia/Tokyo", AT), "JST");
  assert.equal(zoneLabel("Asia/Seoul", AT), "KST");
  assert.equal(zoneLabel("America/Los_Angeles", AT), "PST");
  assert.equal(zoneLabel("America/Los_Angeles", SUMMER), "PDT");
  assert.equal(zoneLabel("Europe/Berlin", AT), "CET");
  assert.equal(zoneLabel("Europe/London", SUMMER), "BST");
  assert.equal(zoneLabel("Australia/Sydney", AT), "AEDT");
  assert.equal(zoneLabel("Asia/Kolkata", AT), "IST");
  assert.match(zoneLabel("America/Sao_Paulo", AT), /^GMT-3$/);
  assert.equal(zoneCity("Asia/Tokyo"), "Tokyo");
  assert.equal(zoneCity("America/Argentina/Buenos_Aires"), "Buenos Aires");
  assert.equal(zoneCity("America/New_York"), "New York");
  assert.ok(isMarketZone("America/New_York") && isMarketZone("US/Eastern") && !isMarketZone("America/Toronto"));
});

test("wall clocks and instants in a zone, across daylight saving", () => {
  assert.deepEqual(wallClock(AT, "Asia/Tokyo"), { year: 2026, month: 11, day: 16, hour: 23, minute: 5, second: 0, weekday: 1 });
  assert.deepEqual(wallClock(Date.parse("2026-11-16T05:00:00Z"), "America/New_York").hour, 0, "midnight is 0, not 24");
  assert.equal(zoneOffsetMinutes(AT, "America/New_York"), -300);
  assert.equal(zoneOffsetMinutes(SUMMER, "America/New_York"), -240);
  assert.equal(zoneOffsetMinutes(AT, "Asia/Kolkata"), 330);
  assert.equal(zonedInstant(2026, 11, 16, 9, 5, "America/New_York"), AT);
  assert.equal(zonedInstant(2026, 7, 13, 9, 5, "America/New_York"), SUMMER);
  assert.equal(zonedInstant(2026, 11, 16, 23, 5, "Asia/Tokyo"), AT);
  // The night clocks go back (Nov 1, 2026): midnight to midnight is 25 hours.
  assert.equal(zonedInstant(2026, 11, 2, 0, 0, "America/New_York") - zonedInstant(2026, 11, 1, 0, 0, "America/New_York"), 25 * 3600_000);
});

test("before mount everything is ET, so the server's HTML and the first render agree", () => {
  const tf = makeTimeFormat({ mode: "server", browserZone: "Asia/Tokyo" });
  assert.equal(tf.clock(AT), "09:05 ET");
  assert.equal(tf.clock(AT, { was: "local" }), "09:05", "a spot that showed the browser's time, still ET and unlabelled");
  assert.equal(tf.clock(AT, { was: "bare" }), "09:05");
  assert.equal(tf.local, false);
});

test("with the flag off every spot shows exactly what it did before", () => {
  const tf = makeTimeFormat({ mode: "legacy", browserZone: "Asia/Tokyo" });
  const old = (options, zone) => new Date(AT).toLocaleString("en-US", { ...options, ...(zone ? { timeZone: zone } : {}) });
  // formatEtTime(date) + " ET"
  assert.equal(tf.clock(AT), `${new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour12: false, hour: "2-digit", minute: "2-digit" }).format(AT)} ET`);
  assert.equal(tf.clock(AT, { seconds: true }), "09:05:00 ET");
  assert.equal(tf.clock(AT, { was: "bare" }), "09:05");
  const pool = { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" };
  assert.equal(tf.format(AT, pool, { was: "local" }), old(pool, "Asia/Tokyo"));
  assert.equal(tf.format(AT, { weekday: "short", hour: "numeric" }), `${old({ weekday: "short", hour: "numeric" }, "America/New_York")} ET`);
  assert.equal(tf.format(AT, { month: "short", day: "numeric" }), "Nov 16", "no zone after a date");
  assert.equal(tf.format(AT, pool, { was: "et", alongside: true }), "Nov 16, 9:05 AM ET", "no brackets while the flag is off");
  const tokyo = new Date(AT).toLocaleString(undefined, { timeZone: "Asia/Tokyo" });
  assert.equal(tf.stamp(AT), tokyo, "a tooltip is toLocaleString() in the browser's zone");
});

test("market time: ET with its name everywhere a clock shows", () => {
  const tf = makeTimeFormat({ mode: "market", browserZone: "Asia/Tokyo" });
  assert.equal(tf.clock(AT), "09:05 ET");
  assert.equal(tf.clock(AT, { was: "local" }), "09:05 ET", "the browser-time spots switch to ET too");
  assert.equal(tf.clock(AT, { was: "bare" }), "09:05 ET");
  assert.equal(tf.clock(AT, { label: false }), "09:05");
  assert.equal(tf.format(AT, { weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }, { alongside: true }), "Mon 09:05 ET", "no brackets in ET");
  assert.equal(tf.label(AT), "ET");
});

test("local time: the browser's zone and its name, ET alongside where asked", () => {
  const tf = makeTimeFormat({ mode: "local", browserZone: "Asia/Tokyo" });
  assert.equal(tf.local, true);
  assert.equal(tf.zone, "Asia/Tokyo");
  assert.equal(tf.clock(AT), "23:05 JST");
  assert.equal(tf.clock(AT, { was: "bare" }), "23:05 JST");
  assert.equal(tf.format(AT, { weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }), "Mon 23:05 JST", "weekday and clock in the same zone");
  assert.equal(tf.format(AT, { weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }, { alongside: true }), "Mon 23:05 JST (09:05 ET)");
  assert.equal(tf.format(Date.parse("2026-11-14T05:00:00Z"), { weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }, { alongside: true }), "Sat 14:00 JST (00:00 ET)", "Saturday's review");
  assert.equal(tf.format(AT, { month: "short", day: "numeric" }), "Nov 16");
  assert.equal(tf.label(AT), "JST");
  assert.equal(tf.stamp(AT), "11/16/2026, 11:05:00 PM JST");

  const ny = makeTimeFormat({ mode: "local", browserZone: "America/New_York" });
  assert.equal(ny.local, false, "local time in New York is market time");
  assert.equal(ny.clock(AT, { alongside: true }), "09:05 ET");
});

test("bad input never throws", () => {
  const tf = makeTimeFormat({ mode: "local", browserZone: "Not/AZone" });
  assert.equal(tf.clock("not a date"), "");
  assert.equal(formatInZone(Number.NaN, "Asia/Tokyo", { hour: "2-digit" }), "");
  assert.equal(typeof tf.clock(AT), "string");
});
