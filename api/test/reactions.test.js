const test = require("node:test");
const assert = require("node:assert/strict");
const reactions = require("../src/services/games/reactions");
const { profilePictureUrlSql } = require("../src/profilePictures");

test("parseSticker only accepts a whole-body sticker token", () => {
  assert.deepEqual(reactions.parseSticker("[[sticker:PEK/hype]]"), { symbol: "PEK", pose: "hype" });
  assert.deepEqual(reactions.parseSticker("  [[sticker:MAR/smug]] "), { symbol: "MAR", pose: "smug" });
  assert.equal(reactions.parseSticker("gm [[sticker:PEK/hype]]"), null);
  assert.equal(reactions.parseSticker("[[sticker:PEK/dance]]"), null);
  assert.equal(reactions.parseSticker("[[sticker:pek/hype]]"), null);
});

test("parseReactionId normalizes and rejects bad poses", () => {
  assert.deepEqual(reactions.parseReactionId("pek/moon"), { symbol: "PEK", pose: "moon" });
  assert.throws(() => reactions.parseReactionId("PEK/dance"), { code: "invalid_reaction" });
  assert.throws(() => reactions.parseReactionId(""), { code: "invalid_reaction" });
});

test("avatar SQL prefers the reaction, then the catalog picture", () => {
  const sql = profilePictureUrlSql("small", "pp", "friend");
  assert.match(sql, /WHEN friend\.profile_reaction IS NOT NULL THEN 'reaction:' \|\| friend\.profile_reaction/);
  assert.ok(sql.indexOf("profile_reaction") < sql.indexOf("pp.is_deleted"));
  assert.match(sql, /\/small\/' \|\| pp\.filename_small/);
});
