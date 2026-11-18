import assert from "node:assert/strict";
import test from "node:test";
import { contrast, flagColors, flagScale, flagTier, flagWidth, waveFrames } from "./oshiboard-flag.mjs";

test("tiers: the podium, the top ten, everyone else", () => {
  assert.deepEqual([1, 2, 3, 4, 10, 11, 250].map(flagTier), ["crown", "silver", "bronze", "top10", "top10", "member", "member"]);
});

test("every place up the board is at least as big, and first is the biggest", () => {
  let last = -1;
  for (let rank = 150; rank >= 1; rank -= 1) {
    assert.ok(flagScale(rank) >= last, `#${rank}`);
    last = flagScale(rank);
  }
  assert.equal(flagScale(1), 1);
  assert.equal(flagScale(100), 0);
  assert.equal(flagScale(0), 0, "no rank, no size");
  assert.equal(flagWidth(1, 44, 88), 88);
  assert.equal(flagWidth(500, 44, 88), 44);
  assert.ok(flagWidth(2) > flagWidth(3) && flagWidth(3) > flagWidth(4) && flagWidth(4) > flagWidth(20));
});

test("the oshimark always has a ground it shows on, whatever the two colors", () => {
  const talents = ["#feefbc", "#35323d", "#cedcf5", "#bd0f0f", "#fee020", "#3b42ab", "#ffffff", "#000000"];
  const players = [...talents, "#ff7ad9", "#3fb8f5", "#4caf50", null, "not a color"];
  for (const talent of talents) {
    for (const player of players) {
      const colors = flagColors(player, talent);
      assert.ok(contrast(colors.plate, talent) >= 3, `${player} on ${talent}: patch ${colors.plate} is ${contrast(colors.plate, talent).toFixed(2)}`);
      assert.ok(contrast(colors.cloth, talent) >= 1.5, `${player} on ${talent}: cloth ${colors.cloth}`);
      assert.ok(contrast(colors.mark, colors.plate) >= 3, `${player} on ${talent}: letter`);
    }
  }
});

test("the player's color stays theirs when it already stands apart", () => {
  assert.equal(flagColors("#3f6fd8", "#feefbc").cloth, "#3f6fd8");
  assert.equal(flagColors("#4caf50", "#35323d").cloth, "#4caf50");
});

test("the wave loops without a seam and keeps the same outline structure", () => {
  const frames = waveFrames(12);
  assert.equal(frames.length, 13);
  assert.equal(frames[0].d, frames[12].d);
  const shape = (d) => d.replace(/-?\d+(\.\d+)?/g, "#");
  for (const frame of frames) assert.equal(shape(frame.d), shape(frames[0].d), "SMIL needs matching commands to interpolate");
});
