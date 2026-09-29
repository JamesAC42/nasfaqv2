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
  assert.deepEqual(side, { cards: [{ card_key: "card:PEK:SR", qty: 3 }], cash: 12.35, shards: 30 });
  assert.deepEqual(exchange.normalizeSide(null), { cards: [], cash: 0, shards: 0 });
  assert.throws(() => exchange.normalizeSide({ cards: [{ card_key: "card:PEK:XX" }] }), { code: "invalid_trade" });
  assert.throws(() => exchange.normalizeSide({ cash: -1 }), { code: "invalid_trade" });
  assert.throws(() => exchange.normalizeSide({ shards: 1.5 }), { code: "invalid_trade" });
  assert.throws(() => exchange.normalizeSide({ cards: [{ card_key: "card:PEK:C", qty: 21 }] }), { code: "invalid_trade" });
  const many = Array.from({ length: 11 }, (_, index) => ({ card_key: `card:T${index}:C`, qty: 1 }));
  assert.throws(() => exchange.normalizeSide({ cards: many }), { code: "invalid_trade" });
});
