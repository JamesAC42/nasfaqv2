const test = require("node:test");
const assert = require("node:assert/strict");
const cards = require("../src/services/games/cards");
const duel = require("../src/services/games/tables/duelEngine");
const highLow = require("../src/services/games/tables/highLowEngine");
const npc = require("../src/services/games/tables/npc");
const pvp = require("../src/services/games/tables/pvp");

const talent = (symbol, extra = {}) => ({ symbol, name: `Talent ${symbol}`, unit: "gen0", icon: null, color: "#123456", price: 10, move_pct: 0, ...extra });
const deckCard = (symbol, rarity, stars = 1, extra = {}) => ({ key: cards.cardKey(symbol, rarity), symbol, name: symbol, unit: "gen0", icon: null, color: null, rarity, stars, base: cards.basePower(rarity, stars), momentum: 0, move_pct: 0, price: 10, ...extra });

test("the NPC's duel deck matches your rarities and stars on other talents", () => {
  const mine = [deckCard("AAA", "UR", 3), deckCard("BBB", "SSR"), deckCard("CCC", "SR", 2), deckCard("DDD", "R"), deckCard("EEE", "C", 5)];
  const talents = ["AAA", "BBB", "CCC", "DDD", "EEE", "FFF", "GGG", "HHH", "III", "JJJ", "KKK"].map((symbol) => talent(symbol, { move_pct: 0.031 }));
  const deck = npc.duelDeck(mine, talents);
  assert.deepEqual(deck.map((card) => [card.rarity, card.stars, card.base]), mine.map((card) => [card.rarity, card.stars, card.base]));
  assert.equal(new Set(deck.map((card) => card.symbol)).size, 5);
  assert.ok(deck.every((card) => !["AAA", "BBB", "CCC", "DDD", "EEE"].includes(card.symbol)));
  assert.ok(deck.every((card) => cards.parseCardKey(card.key)?.symbol === card.symbol && card.momentum === 3));
});

test("the duel NPC plays its best card for the round, never a used one", () => {
  const decks = [
    [deckCard("A", "C"), deckCard("B", "C"), deckCard("C", "C"), deckCard("D", "C"), deckCard("E", "C")],
    [deckCard("V", "C"), deckCard("W", "UR"), deckCard("X", "C"), deckCard("Y", "SR"), deckCard("Z", "C")],
  ];
  let state = duel.tick(duel.setup({ decks, now: 0 }), 3000);
  state = { ...state, conditions: state.conditions.map(() => ({ key: "quiet", label: "Quiet", text: "" })) };
  const steady = () => 0.9; // above the wander chance: always the best card
  assert.deepEqual(npc.duelPick(state, 1, steady), { type: "pick", card: 1 });
  state = { ...state, used: [state.used[0], [false, true, false, false, false]] };
  assert.deepEqual(npc.duelPick(state, 1, steady), { type: "pick", card: 3 });
  // Wandering still only picks what's left.
  const rolls = [0.1, 0.99];
  const wander = () => rolls.shift();
  const pick = npc.duelPick(state, 1, wander).card;
  assert.ok([0, 2, 3, 4].includes(pick));
});

test("the high-low NPC counts the cards already seen, and doubles when it's sure", () => {
  let state = highLow.tick({ ...highLow.setup({ now: 0 }), current: { rank: 2, suit: "S" } }, 3000);
  assert.deepEqual(npc.highLowCall(state, 1), { type: "call", dir: "higher", double: true });
  assert.deepEqual(npc.highLowCall({ ...state, doubles_used: [false, true] }, 1), { type: "call", dir: "higher", double: false });
  assert.deepEqual(npc.highLowCall({ ...state, current: { rank: 14, suit: "H" } }, 1).dir, "lower");

  // An 8 is a coin flip on a fresh deck, until the high cards have gone by.
  state = { ...state, current: { rank: 8, suit: "C" } };
  assert.equal(npc.highLowCall(state, 1, () => 0.2).dir, "higher");
  assert.equal(npc.highLowCall(state, 1, () => 0.7).dir, "lower");
  const gone = [9, 10, 11, 12, 13, 14].flatMap((rank) => ["S", "H"].map((suit) => ({ rank, suit })));
  const history = gone.map((card, index) => ({ round: index + 1, from: index ? gone[index - 1] : { rank: 8, suit: "D" }, to: card, calls: [], deltas: [] }));
  assert.equal(npc.unseenRanks({ ...state, history }).length, 52 - 14);
  assert.equal(npc.highLowCall({ ...state, history }, 1, () => 0.2).dir, "lower");
});

test("whole practice games finish with the NPC moving every round", () => {
  for (let game = 0; game < 20; game += 1) {
    const decks = [0, 1].map((seat) => ["C", "R", "SR", "SSR", "UR"].map((rarity, index) => deckCard(`S${seat}${index}`, rarity, 1, { momentum: (index % 3) - 1 })));
    let state = duel.setup({ decks, now: 0 });
    let now = 0;
    while (state.phase !== "done") {
      if (state.phase === "picking") {
        const mine = state.used[0].findIndex((used) => !used);
        state = duel.act(state, 0, { type: "pick", card: mine }, now);
        if (state.phase === "picking") state = duel.act(state, 1, npc.nextAction("oshi-duel", state, 1), now);
      } else {
        now = state.deadline;
        state = duel.tick(state, now);
      }
    }
    assert.ok(state.history.every((round) => round.auto.every((auto) => !auto)));
  }
  for (let game = 0; game < 20; game += 1) {
    let state = highLow.setup({ now: 0 });
    let now = 0;
    while (state.phase !== "done") {
      if (state.phase === "calling") {
        state = highLow.act(state, 0, { type: "call", dir: "higher" }, now);
        state = highLow.act(state, 1, npc.nextAction("high-low", state, 1), now);
      } else {
        now = state.deadline;
        state = highLow.tick(state, now);
      }
    }
    assert.equal(state.history.length, highLow.ROUNDS);
    assert.ok(state.history.every((round) => round.calls[1].dir !== "pass"));
  }
  assert.equal(npc.nextAction("high-low", { phase: "reveal", calls: [null, null] }, 1), null);
});

test("the NPC thinks for a moment, always inside the round's clock", () => {
  assert.equal(npc.thinkMs({ deadline: 10_000 }, 0, () => 0), 1200);
  assert.equal(npc.thinkMs({ deadline: 10_000 }, 0, () => 0.999), 3497);
  assert.equal(npc.thinkMs({ deadline: 2_000 }, 0, () => 0.999), 1600);
  assert.equal(npc.thinkMs({ deadline: 100 }, 0, () => 0.5), 150);
});

// A practice table against the NPC, through the table manager, on a stand-in database that records
// every statement: nothing may be written (no stake, no match rows, no payout).
function fakeDb() {
  const statements = [];
  const catalog = {
    "high-low": { id: 2, key: "high-low", name: "High-Low", game_type: "pvp", status: "active", min_stake_cash: 0, max_stake_cash: 5000, config_json: { call_seconds: 10 } },
    "oshi-duel": { id: 1, key: "oshi-duel", name: "Oshi Card Duel", game_type: "pvp", status: "active", min_stake_cash: 0, max_stake_cash: 5000, config_json: { pick_seconds: 20 } },
  };
  const owned = ["AAA:UR", "BBB:SSR", "CCC:SR", "DDD:R", "EEE:C"].map((entry) => cards.cardKey(...entry.split(":")));
  const query = async (text, params = []) => {
    statements.push(text);
    if (/FROM games\.game_catalog/.test(text)) return { rows: catalog[params[0]] ? [{ ...catalog[params[0]], created_at: null, updated_at: null }] : [] };
    if (/FROM market\.users WHERE id = \$1/.test(text)) return { rows: [{ id: params[0], username: `player${params[0]}`, profile_color: "#ff0000", profile_picture_url: null }] };
    if (/SELECT card_key FROM games\.user_cards/.test(text)) return { rows: params[1].filter((key) => owned.includes(key)).map((card_key) => ({ card_key })) };
    if (/SELECT card_key, stars FROM games\.user_cards/.test(text)) return { rows: params[1].map((card_key) => ({ card_key, stars: 2 })) };
    if (/latest_daily/.test(text)) {
      return { rows: "AAA BBB CCC DDD EEE FFF GGG HHH III JJJ".split(" ").map((symbol, index) => ({ id: index + 1, symbol, display_name: symbol, current_mid_price: 10, mid_open: 10, unit: "gen0", icon: null, color: null })) };
    }
    if (/FROM games\.pvp_matches WHERE status IN/.test(text)) return { rows: [] };
    if (/m\.status = 'completed'/.test(text)) return { rows: [] }; // the lobby's recent results
    throw new Error(`unexpected query: ${text.trim().slice(0, 80)}`);
  };
  return { statements, query, connect: async () => ({ query, release() {} }) };
}

test("a practice table is free, seats the NPC and writes nothing", async () => {
  const db = fakeDb();
  await pvp.init(db);
  const writes = () => db.statements.filter((text) => /\b(INSERT|UPDATE|DELETE)\b/i.test(text));

  const table = await pvp.createTable({ userId: 7, gameKey: "high-low", stake: 999, vsNpc: true });
  assert.equal(table.practice, true);
  assert.equal(table.status, "playing");
  assert.deepEqual([table.stake, table.pot, table.payout_if_win], [0, 0, 0]);
  assert.ok(table.id > 900_000_000_000);
  assert.deepEqual(table.players.map((player) => [player.seat, player.username, player.user_id, Boolean(player.npc)]), [[0, "player7", 7, false], [1, "NPC", null, true]]);
  assert.equal(table.state.phase, "starting");
  await assert.rejects(pvp.createTable({ userId: 7, gameKey: "high-low", vsNpc: true }), { code: "already_seated" });
  assert.deepEqual(pvp.tablesForUser(7).map((mine) => mine.id), [table.id]);
  assert.equal((await pvp.listTables("high-low")).tables.some((listed) => listed.id === table.id && listed.practice), true);

  const done = await pvp.actOnTable({ userId: 7, tableId: table.id, action: { type: "forfeit" } });
  assert.equal(done.status, "done");
  assert.deepEqual({ ...done.result }, { winner_seat: 1, winner_username: "NPC", payout: 0, rake: 0, reason: "forfeit", practice: true });
  assert.equal((await pvp.getTable(table.id)).status, "done");

  // The duel: the NPC's deck mirrors yours.
  const duelKeys = ["AAA:UR", "BBB:SSR", "CCC:SR", "DDD:R", "EEE:C"].map((entry) => cards.cardKey(...entry.split(":")));
  const duelTable = await pvp.createTable({ userId: 8, gameKey: "oshi-duel", deck: duelKeys, vsNpc: true });
  const [mine, theirs] = duelTable.state.decks;
  assert.deepEqual(theirs.map((card) => [card.rarity, card.stars]), mine.map((card) => [card.rarity, card.stars]));
  assert.ok(theirs.every((card) => !["AAA", "BBB", "CCC", "DDD", "EEE"].includes(card.symbol)));
  await pvp.actOnTable({ userId: 8, tableId: duelTable.id, action: { type: "forfeit" } });

  assert.deepEqual(writes(), []);
});
