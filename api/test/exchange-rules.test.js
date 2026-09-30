const test = require("node:test");
const assert = require("node:assert/strict");
const exchange = require("../src/services/games/exchange");

test("bids step up by 5%, at least $1", () => {
  assert.equal(exchange.minIncrement(10), 1);
  assert.equal(exchange.minIncrement(50), 2.5);
  assert.equal(exchange.minIncrement(1234.5), 61.73);
});

test("trade sides merge duplicate cards and validate amounts", () => {
  const side = exchange.normalizeSide({ cards: [{ card_key: "card:PEK:SR", qty: 1 }, { card_key: "card:PEK:SR", qty: 2 }], cash: 12.345, shards: 30 });
  assert.deepEqual(side, { cards: [{ card_key: "card:PEK:SR", qty: 3 }], cosmetics: [], cash: 12.35, shards: 30 });
  assert.deepEqual(exchange.normalizeSide(null), { cards: [], cosmetics: [], cash: 0, shards: 0 });
  // Capsule items by key, once each; the client can't send a row along with them.
  assert.deepEqual(exchange.normalizeSide({ cosmetics: ["crown", { cosmetic_key: "crown", snapshot: { source_type: "gacha" } }, "hat:cap"] }).cosmetics, [{ cosmetic_key: "crown" }, { cosmetic_key: "hat:cap" }]);
  assert.throws(() => exchange.normalizeSide({ cosmetics: ["bad key!"] }), { code: "invalid_trade" });
  assert.throws(() => exchange.normalizeSide({ cosmetics: Array.from({ length: 11 }, (_, index) => `item${index}`) }), { code: "invalid_trade" });
  assert.throws(() => exchange.normalizeSide({ cards: [{ card_key: "card:PEK:XX" }] }), { code: "invalid_trade" });
  assert.throws(() => exchange.normalizeSide({ cash: -1 }), { code: "invalid_trade" });
  assert.throws(() => exchange.normalizeSide({ shards: 1.5 }), { code: "invalid_trade" });
  assert.throws(() => exchange.normalizeSide({ cards: [{ card_key: "card:PEK:C", qty: 21 }] }), { code: "invalid_trade" });
  const many = Array.from({ length: 11 }, (_, index) => ({ card_key: `card:T${index}:C`, qty: 1 }));
  assert.throws(() => exchange.normalizeSide({ cards: many }), { code: "invalid_trade" });
});
