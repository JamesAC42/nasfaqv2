const test = require("node:test");
const assert = require("node:assert/strict");
const { mentionCandidates, exchangeText } = require("../src/services/notifications");

test("mention candidates try the longest name first and ignore emails", () => {
  assert.deepEqual(mentionCandidates("hi @tester_one check this"), [["tester_one check this", "tester_one check", "tester_one"]]);
  assert.deepEqual(mentionCandidates("mail me at a@b.com"), []);
  assert.deepEqual(mentionCandidates("@ab"), []);
  assert.equal(mentionCandidates("@one @two @three").length, 3);
});

test("exchange alerts read like the toasts and link to the card", () => {
  const outbid = exchangeText({ kind: "outbid", card: { key: "card:PEK:SSR", name: "Usada Pekora", rarity: "SSR" }, your_bid: 120, amount: 150 });
  assert.equal(outbid.title, "You've been outbid");
  assert.match(outbid.body, /\$150\.00/);
  assert.equal(outbid.href, "/games/exchange/card/PEK/SSR");
  assert.equal(exchangeText({ kind: "unknown" }), null);
});
