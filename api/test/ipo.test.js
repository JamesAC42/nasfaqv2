const test = require("node:test");
const assert = require("node:assert/strict");

const ipo = require("../src/services/ipo");
const { computeDerivedSnapshot, debutShare } = require("../src/services/fundamentals");
const { suggestSymbol, parseBirthday, profileIdFromUrl, extractEmojis, twemojiUrl } = require("../src/services/talentDetect");

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

// allocate() as first written: one pass per share taken back, and an indexOf in the sort.
function allocateBefore(subscriptions, offered) {
  const subs = subscriptions.map((sub) => ({ ...sub, requested: Math.max(0, Math.floor(Number(sub.requested))) })).filter((sub) => sub.requested > 0);
  const result = new Map(subscriptions.map((sub) => [sub.id, 0]));
  const supply = Math.max(0, Math.floor(Number(offered)));
  const demand = subs.reduce((total, sub) => total + sub.requested, 0);
  if (!supply || !demand) return result;
  if (demand <= supply) {
    for (const sub of subs) result.set(sub.id, sub.requested);
    return result;
  }
  const byTime = [...subs].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)) || String(a.id).localeCompare(String(b.id), undefined, { numeric: true }));
  if (subs.length >= supply) {
    for (const sub of byTime.slice(0, supply)) result.set(sub.id, 1);
    return result;
  }
  const shares = subs.map((sub) => {
    const exact = (sub.requested * supply) / demand;
    return { sub, shares: Math.max(1, Math.floor(exact)), remainder: exact - Math.floor(exact) };
  });
  let total = shares.reduce((acc, entry) => acc + entry.shares, 0);
  while (total > supply) {
    const biggest = shares.filter((entry) => entry.shares > 1).sort((a, b) => b.shares - a.shares)[0];
    if (!biggest) break;
    biggest.shares -= 1;
    total -= 1;
  }
  const order = [...shares].sort((a, b) => b.remainder - a.remainder || byTime.indexOf(a.sub) - byTime.indexOf(b.sub));
  for (let i = 0; total < supply && order.length; i = (i + 1) % order.length) {
    const entry = order[i];
    if (entry.shares < entry.sub.requested) {
      entry.shares += 1;
      total += 1;
    } else if (order.every((candidate) => candidate.shares >= candidate.sub.requested)) {
      break;
    }
  }
  for (const entry of shares) result.set(entry.sub.id, entry.shares);
  return result;
}

function seeded(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test("allocation: the faster allocate() hands out exactly what the original did", () => {
  const random = seeded(42);
  for (let round = 0; round < 400; round += 1) {
    const count = 1 + Math.floor(random() * 300);
    // Mostly small requests with a few whales, so floors of 1 often overshoot and shares get taken back.
    const subs = Array.from({ length: count }, (_, i) => ({
      id: String(i + 1),
      requested: random() < 0.15 ? 200 + Math.floor(random() * 4_000) : 1 + Math.floor(random() * (random() < 0.5 ? 5 : 60)),
      created_at: `2026-11-12T14:${String(Math.floor(random() * 60)).padStart(2, "0")}:00.000Z`,
    }));
    const demand = subs.reduce((total, sub) => total + sub.requested, 0);
    const offered = Math.max(1, Math.floor(demand * random() * 1.1));
    assert.deepEqual([...ipo.allocate(subs, offered)], [...allocateBefore(subs, offered)], `round ${round}: ${count} subscribers, ${offered} of ${demand}`);
  }
});

test("allocation: tens of thousands of subscribers in well under a second", () => {
  const random = seeded(7);
  const subs = Array.from({ length: 40_000 }, (_, i) => ({
    id: String(i + 1),
    requested: i % 40 === 0 ? 5_000 : 1 + Math.floor(random() * 3),
    created_at: new Date(Date.UTC(2026, 10, 12, 14) + i * 1000).toISOString(),
  }));
  const offered = 45_000;
  const started = performance.now();
  const result = ipo.allocate(subs, offered);
  const elapsed = performance.now() - started;
  assert.equal(sum(result), offered);
  assert.ok([...result.values()].every((shares) => shares >= 1), "everyone gets a share");
  assert.ok(elapsed < 1_000, `took ${Math.round(elapsed)} ms`);
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

test("oshimarks: the emoji in an X name, and their Twemoji files", () => {
  assert.deepEqual(extractEmojis("熱千めら🧯アソビ★まわり隊！"), ["🧯"]);
  assert.deepEqual(extractEmojis("鈴鳴つづり🐐💌アソビ★まわり隊！"), ["🐐", "💌"]);
  assert.deepEqual(extractEmojis("百灯キョーコ👮📢👮"), ["👮", "📢"], "no repeats");
  assert.deepEqual(extractEmojis("plain ★ ☆ ™ text"), [], "symbols that aren't emoji are skipped");
  assert.equal(twemojiUrl("🧯").split("/").pop(), "1f9ef.svg");
  assert.equal(twemojiUrl("❤️").split("/").pop(), "2764.svg", "variation selector dropped");
  assert.equal(twemojiUrl("👯‍♀️").split("/").pop(), "1f46f-200d-2640-fe0f.svg", "kept inside a ZWJ sequence");
});
