const test = require("node:test");
const assert = require("node:assert/strict");

const { computeDerivedSnapshot, streamEventSignal, STREAM_EVENT_WEIGHTS } = require("../src/services/fundamentals");

function history(days) {
  const map = new Map();
  for (let i = 0; i < days; i += 1) {
    const date = new Date(Date.UTC(2026, 8, 1 + i)).toISOString().slice(0, 10);
    map.set(date, { youtube_channel_id: "UC1", snapshot_date: date, subscriber_count: 1_000_000 + i * 500, view_count: 50_000_000 + i * 200_000, video_count: 900 + i, has_video_count_data: true });
  }
  return map;
}

test("event lift: summed per kind, capped, unknown kinds ignored", () => {
  assert.deepEqual(streamEventSignal(null), { signal: 0, kinds: [] });
  assert.equal(streamEventSignal(["three_d"]).signal, STREAM_EVENT_WEIGHTS.three_d);
  assert.equal(streamEventSignal(["three_d", "new_outfit", "original_song"]).signal, 0.3);
  assert.deepEqual(streamEventSignal(["karaoke", "birthday", "birthday"]).kinds, ["birthday"]);
});

test("a big stream lifts that day's fair value once, and smoothing fades it", () => {
  const byDate = history(40);
  const dates = [...byDate.keys()];
  const run = (eventDay) => {
    let previous = null;
    const out = [];
    for (const date of dates) {
      previous = computeDerivedSnapshot(byDate.get(date), byDate, previous, 1, date === eventDay ? ["three_d"] : null);
      out.push(previous);
    }
    return out;
  };
  const base = run(null);
  const lifted = run(dates[35]);
  const ratio = (i) => lifted[i].fundamental_value_smoothed / base[i].fundamental_value_smoothed;
  assert.equal(ratio(34), 1);
  assert.ok(ratio(35) > 1.04 && ratio(35) < 1.08, `day-of lift ${ratio(35)}`);
  assert.ok(ratio(36) > 1 && ratio(36) < ratio(35), "fades the next day");
  assert.ok(ratio(39) < 1.002, "gone within a few days");
  assert.deepEqual(lifted[35].event_kinds, ["three_d"]);
  assert.equal(base[35].event_signal, 0);
});
