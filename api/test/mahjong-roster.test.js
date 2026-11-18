const test = require("node:test");
const assert = require("node:assert/strict");

const { SETTINGS, seatableTalents } = require("../src/services/games/mahjong/settings");

// Who a mahjong seat may sit as: every listed talent but the excluded ones (FuwaMoco are two people).
test("mahjong seats never take an excluded talent", () => {
  assert.ok(SETTINGS.excludedTalents.includes("BYS"));
  assert.deepEqual(seatableTalents(["AME", "BYS", "GUR", "PEK"]), ["AME", "GUR", "PEK"]);
  assert.deepEqual(seatableTalents([]), []);
});

// Only the talents with 3D table art are offered, once a listing has a table's worth of them.
test("mahjong seats take only the talents with table art", () => {
  assert.equal(SETTINGS.tableTalents.length, 36);
  assert.ok(!SETTINGS.tableTalents.includes("BYS"));
  assert.deepEqual(seatableTalents(["AKI", "AME", "BYS", "GUR", "LAP", "PEK", "SUI"]), ["AME", "GUR", "PEK", "SUI"]);
  // A listing without four of them (a test database) offers everyone but the excluded.
  assert.deepEqual(seatableTalents(["AAA", "AME", "BBB", "BYS"]), ["AAA", "AME", "BBB"]);
});
