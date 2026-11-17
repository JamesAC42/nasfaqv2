const test = require("node:test");
const assert = require("node:assert/strict");

const { SETTINGS, seatableTalents } = require("../src/services/games/mahjong/settings");

// Who a mahjong seat may sit as: every listed talent but the excluded ones (FuwaMoco are two people).
test("mahjong seats never take an excluded talent", () => {
  assert.ok(SETTINGS.excludedTalents.includes("BYS"));
  assert.deepEqual(seatableTalents(["AME", "BYS", "GUR", "PEK"]), ["AME", "GUR", "PEK"]);
  assert.deepEqual(seatableTalents([]), []);
});
