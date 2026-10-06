const test = require("node:test");
const assert = require("node:assert/strict");

const ipo = require("../src/services/ipo");
const { computeDerivedSnapshot, debutShare } = require("../src/services/fundamentals");
const { suggestSymbol, parseBirthday, profileIdFromUrl } = require("../src/services/talentDetect");

const sum = (map) => [...map.values()].reduce((total, value) => total + value, 0);

test("allocation: everyone filled when the offering covers demand", () => {
  const result = ipo.allocate(
    [
      { id: "a", requested: 100, created_at: "1" },
      { id: "b", requested: 50, created_at: "2" },
    ],
    400
  );
  assert.equal(result.get("a"), 100);
  assert.equal(result.get("b"), 50);
});

test("allocation: pro rata when oversubscribed, whole shares, never more than offered", () => {
  const subs = [
    { id: "a", requested: 600, created_at: "1" },
    { id: "b", requested: 300, created_at: "2" },
    { id: "c", requested: 100, created_at: "3" },
  ];
  const result = ipo.allocate(subs, 500);
  assert.equal(sum(result), 500);
  assert.equal(result.get("a"), 300);
  assert.equal(result.get("b"), 150);
  assert.equal(result.get("c"), 50);
  for (const value of result.values()) assert.ok(Number.isInteger(value));
});

test("allocation: at least one share each, leftovers to the largest remainders", () => {
  const subs = [
    { id: "whale", requested: 997, created_at: "1" },
    { id: "s1", requested: 1, created_at: "2" },
    { id: "s2", requested: 2, created_at: "3" },
  ];
  const result = ipo.allocate(subs, 10);
  assert.equal(sum(result), 10);
  assert.equal(result.get("s1"), 1);
  assert.ok(result.get("s2") >= 1);
  assert.ok(result.get("whale") >= 7);
});

test("allocation: more subscribers than shares gives the earliest one share each", () => {
  const subs = Array.from({ length: 5 }, (_, i) => ({ id: `p${i}`, requested: 10, created_at: String(i) }));
  const result = ipo.allocate(subs, 3);
  assert.deepEqual([...result.values()], [1, 1, 1, 0, 0]);
});

test("allocation: nothing offered or nothing asked", () => {
  assert.equal(sum(ipo.allocate([{ id: "a", requested: 5, created_at: "1" }], 0)), 0);
  assert.equal(sum(ipo.allocate([{ id: "a", requested: 0, created_at: "1" }], 10)), 0);
});

test("the window closes at the listing day's 09:00 New York settlement", () => {
  const { opens, closes } = ipo.windowFor("2026-10-20", 48);
  assert.equal(closes.toISOString(), "2026-10-20T13:00:00.000Z"); // EDT
  assert.equal(opens.toISOString(), "2026-10-18T13:00:00.000Z");
  assert.equal(ipo.windowFor("2026-12-01", 48).closes.toISOString(), "2026-12-01T14:00:00.000Z"); // EST
});

function debutHistory(days, { subs = 250_000, subsPerDay = 2_000, viewsPerDay = 160_000 } = {}) {
  const map = new Map();
  for (let i = 0; i < days; i += 1) {
    const date = new Date(Date.UTC(2026, 9, 1 + i)).toISOString().slice(0, 10);
    map.set(date, { youtube_channel_id: "UCnew", snapshot_date: date, subscriber_count: subs + i * subsPerDay, view_count: 4_000_000 + i * viewsPerDay, video_count: 20 + Math.floor(i / 3), has_video_count_data: true });
  }
  return map;
}

function run(byDate, debut) {
  let previous = null;
  return [...byDate.keys()].map((date) => (previous = computeDerivedSnapshot(byDate.get(date), byDate, previous, 1, null, debut)));
}

test("debut mode: a young channel isn't priced ~3x low and then jumped at day 30", () => {
  const byDate = debutHistory(60);
  const normal = run(byDate, null);
  const debut = run(byDate, { trackedSince: [...byDate.keys()][0] });
  const value = (rows, day) => rows[day].fundamental_value_smoothed;
  // Without debut mode day 14 is far below where the channel settles; with it, close.
  assert.ok(value(normal, 14) / value(normal, 50) < 0.5, `normal day 14 ${value(normal, 14)} vs day 50 ${value(normal, 50)}`);
  const ratio = value(debut, 14) / value(debut, 50);
  assert.ok(ratio > 0.85 && ratio < 1.15, `debut day 14 vs 50: ${ratio}`);
  // No day-to-day jump bigger than the usual cap after the first week.
  for (let day = 8; day < 60; day += 1) {
    const move = value(debut, day) / value(debut, day - 1);
    assert.ok(move < 1.26 && move > 0.74, `day ${day} moved ${move}`);
  }
  // From day 45 it is the normal formula.
  assert.equal(debutShare(45), 0);
  assert.equal(debutShare(34), 1);
  assert.equal(debutShare(40), 0.5);
});

test("debut mode leaves an established channel's numbers untouched", () => {
  const byDate = debutHistory(60);
  const plain = run(byDate, null);
  const old = run(byDate, { trackedSince: "2025-01-01" });
  assert.deepEqual(old.map((row) => row.fundamental_value_smoothed), plain.map((row) => row.fundamental_value_smoothed));
});

test("detector helpers: tickers, birthdays, profile links", () => {
  assert.equal(suggestSymbol("Achichi Mela", "Mela"), "MEL");
  assert.equal(suggestSymbol("Suzuna Tsuzuri", "Tsuzuri"), "TSU");
  assert.equal(parseBirthday("April 16"), "2000-04-16");
  assert.equal(parseBirthday("June 28th"), "2000-06-28");
  assert.equal(parseBirthday(""), null);
  assert.equal(profileIdFromUrl("https://hololive.hololivepro.com/en/talents/achichi-mela/"), "achichi-mela");
  assert.equal(profileIdFromUrl("https://hololive.hololivepro.com/talents/achichi-mela/"), "achichi-mela");
  assert.equal(profileIdFromUrl("https://hololive.hololivepro.com/en/news/"), "");
});
