const test = require("node:test");
const assert = require("node:assert/strict");

const game = require("../src/services/games/mahjong/game");
const round = require("../src/services/games/mahjong/round");
const bot = require("../src/services/games/mahjong/bot");
const view = require("../src/services/games/mahjong/view");
const tutorial = require("../src/services/games/mahjong/tutorial");
const { waitsOf } = require("../src/services/games/mahjong/shanten");
const { LIVE_END, RINSHAN_START, buildWall, newSeed, seededPicker } = require("../src/services/games/mahjong/wall");
const { countKinds, kindOf } = require("../src/services/games/mahjong/tiles");

// Whole games played by the bots, with the rules checked after every single move: no tile appears or
// disappears, points only move between players, nobody wins a hand they couldn't have. MAHJONG_SIM_GAMES
// sets how many (CI plays a few hundred; api/scripts/mahjong-sim.js plays thousands).
const GAMES = Number(process.env.MAHJONG_SIM_GAMES) || 150;
const LEVELS = ["easy", "normal", "hard", "normal"];

/** A seed for game `n`, the same every run, so a failure can be played again. */
const seedFor = (n) => {
  const pick = seededPicker("ab".repeat(32), n);
  return Array.from({ length: 64 }, () => "0123456789abcdef"[pick(16)]).join("");
};

function checkPosition(state, where) {
  // Every tile that has left the wall is in exactly one hand, meld or pond.
  const out = new Set([...state.wall.slice(0, state.livePos), ...state.wall.slice(RINSHAN_START, RINSHAN_START + state.rinshanUsed)]);
  const held = [];
  for (let seat = 0; seat < 4; seat += 1) {
    held.push(...state.hands[seat]);
    for (const meld of state.melds[seat]) held.push(...meld.tiles);
    for (const entry of state.ponds[seat]) if (!entry.called) held.push(entry.tile);
  }
  assert.equal(held.length, out.size, `${where}: tiles in play`);
  assert.equal(new Set(held).size, held.length, `${where}: a tile is in two places`);
  for (const tile of held) assert.ok(out.has(tile), `${where}: tile ${tile} never left the wall`);

  assert.ok(state.livePos <= state.liveEnd && state.liveEnd <= LIVE_END, `${where}: the live wall`);
  assert.equal(LIVE_END - state.liveEnd, state.kans, `${where}: one tile off the live wall per kan`);
  assert.equal(state.rinshanUsed, state.kans, `${where}: one replacement tile per kan`);
  assert.ok(state.kans <= 4 && state.doraShown + state.pendingDora === 1 + state.kans && state.doraShown <= 5, `${where}: indicators`);

  for (let seat = 0; seat < 4; seat += 1) {
    const size = state.hands[seat].length + 3 * state.melds[seat].length;
    const holding = state.phase === "turn" && state.turn === seat;
    if (state.phase !== "over") assert.equal(size, holding ? 14 : 13, `${where}: seat ${seat} holds ${size}`);
    if (state.riichi[seat]) assert.ok(round.isClosed(state, seat), `${where}: seat ${seat} is in riichi with an open hand`);
  }
  assert.equal(state.scores.reduce((sum, score) => sum + score, 0) + state.sticks * 1000, 100_000, `${where}: points`);
}

function checkResult(state, where) {
  const result = state.result;
  const moved = result.deltas.reduce((sum, delta) => sum + delta, 0);
  if (result.type === "draw") {
    assert.equal(moved, 0, `${where}: a draw moves points between players only`);
    return;
  }
  for (const win of result.wins) {
    assert.ok(win.yaku.length > 0 && win.han > 0 && win.base > 0, `${where}: a win needs a yaku`);
    assert.ok(win.gain > 0, `${where}: a win pays`);
    if (!win.tsumo) {
      // Nobody wins on a discard while waiting on something they threw away themselves.
      const waiting = waitsOf(countKinds(win.hand.map(kindOf)), win.melds.length);
      const thrown = new Set(state.ponds[win.seat].map((entry) => kindOf(entry.tile)));
      assert.ok(!waiting.some((kind) => thrown.has(kind)), `${where}: a furiten ron`);
      assert.ok(waiting.includes(kindOf(win.tile)), `${where}: won on a tile the hand wasn't waiting for`);
    }
  }
  // What winners gain beyond what losers pay is exactly the riichi sticks they picked up.
  assert.equal(moved, result.wins.reduce((sum, win) => sum + win.sticks, 0), `${where}: points made or lost`);
}

function playHand(state, where, levels = LEVELS) {
  let moves = 0;
  while (state.phase !== "over") {
    const waiting = round.waitingSeats(state);
    assert.ok(waiting.length > 0, `${where}: nobody to wait for`);
    const seat = waiting[0];
    const action = bot.decide(state, seat, { level: levels[seat], random: () => 0.5 });
    assert.ok(action, `${where}: the bot has no move`);
    round.act(state, seat, action);
    moves += 1;
    checkPosition(state, `${where} move ${moves}`);
    assert.ok(moves < 1500, `${where}: the hand doesn't end`);
  }
  checkResult(state, where);
  return moves;
}

test(`${GAMES} bot games keep every rule after every move`, { timeout: 600_000 }, () => {
  const seen = { hands: 0, wins: 0, draws: 0, moves: 0, reasons: {}, yaku: new Set(), lengths: { east: 0, south: 0 } };
  for (let n = 0; n < GAMES; n += 1) {
    const length = n % 3 === 0 ? "south" : "east";
    const match = game.createGame({ seed: seedFor(n), length });
    seen.lengths[length] += 1;
    let dealt = 0;
    while (!match.over) {
      const where = `game ${n} hand ${match.hand_index}`;
      checkPosition(match.hand, `${where} deal`);
      seen.moves += playHand(match.hand, where);
      const result = match.hand.result;
      seen.hands += 1;
      if (result.type === "win") {
        seen.wins += 1;
        for (const win of result.wins) for (const entry of win.yaku) seen.yaku.add(entry.key);
      } else {
        seen.draws += 1;
        seen.reasons[result.reason] = (seen.reasons[result.reason] ?? 0) + 1;
      }
      const dealer = match.hand.dealer;
      const summary = game.next(match);
      assert.equal(summary.dealer, dealer);
      // The deal stays put exactly when the rules say so.
      if (!match.over) assert.equal(match.hand.dealer, result.renchan ? dealer : (dealer + 1) % 4, `${where}: who deals next`);
      dealt += 1;
      assert.ok(dealt < 80, `game ${n} doesn't end`);
    }
    const final = match.final.standings;
    assert.deepEqual(final.map((entry) => entry.place), [1, 2, 3, 4]);
    assert.equal(final.reduce((sum, entry) => sum + entry.points, 0), 100_000, `game ${n}: final points`);
    assert.ok(Math.abs(final.reduce((sum, entry) => sum + entry.score, 0)) < 1e-9, `game ${n}: final scores sum to zero`);
    for (let i = 1; i < 4; i += 1) assert.ok(final[i - 1].points >= final[i].points, `game ${n}: standings in order`);
    // An East-only game is at least four hands unless someone went bust; an East-South game eight.
    const bust = match.scores.some((score) => score < 0);
    if (!bust) assert.ok(match.hands.length >= (length === "east" ? 4 : 8), `game ${n}: too short`);
  }
  assert.ok(seen.wins > seen.draws, "bots win hands more often than they draw them");
  for (const key of ["riichi", "tanyao", "pinfu", "menzen-tsumo"]) assert.ok(seen.yaku.has(key), `no ${key} in ${seen.hands} hands`);
  console.log(`mahjong sim: ${GAMES} games, ${seen.hands} hands, ${seen.moves} moves, ${seen.wins} won, draws ${JSON.stringify(seen.reasons)}, ${seen.yaku.size} different yaku`);
});

test("the same seed deals the same game", () => {
  const seed = newSeed();
  const play = () => {
    const match = game.createGame({ seed, length: "east" });
    while (!match.over) {
      const state = match.hand;
      while (state.phase !== "over") {
        const seat = round.waitingSeats(state)[0];
        round.act(state, seat, bot.decide(state, seat, { level: "normal", random: () => 0.5 }));
      }
      game.next(match);
    }
    return JSON.stringify({ hands: match.hands.map((hand) => hand.log), final: match.final });
  };
  assert.equal(play(), play());
  assert.deepEqual(buildWall(seed, 3), buildWall(seed, 3));
  assert.notDeepEqual(buildWall(seed, 3), buildWall(seed, 4));
});

// ── What each viewer is sent ───────────────────────────────────────────────
/** Every number in a payload that could be a tile id, whatever key it sits under. */
function tileIdsIn(value, found = new Set(), key = "") {
  if (Array.isArray(value)) for (const item of value) tileIdsIn(item, found, key);
  else if (value && typeof value === "object") for (const [name, item] of Object.entries(value)) tileIdsIn(item, found, name);
  else if (Number.isInteger(value) && ["tile", "tiles", "hand", "called", "added", "dora", "drawn", "ura"].includes(key)) found.add(value);
  return found;
}

test("the public table never carries a concealed tile, and a seat's view only its own", () => {
  let checked = 0;
  for (let n = 0; n < 12; n += 1) {
    const match = game.createGame({ seed: seedFor(1000 + n), length: "east" });
    const state = match.hand;
    while (state.phase !== "over") {
      const hidden = new Set();
      for (let seat = 0; seat < 4; seat += 1) for (const tile of state.hands[seat]) hidden.add(tile);
      const publicIds = tileIdsIn(view.publicHand(state));
      for (const tile of hidden) assert.ok(!publicIds.has(tile), `hand ${n}: the public table shows concealed tile ${tile}`);
      // Nothing still in the wall either (the next draws, the ura indicators).
      const unseen = [...state.wall.slice(state.livePos, LIVE_END), ...state.wall.slice(RINSHAN_START + state.rinshanUsed, RINSHAN_START + 4), ...state.wall.slice(RINSHAN_START + 4 + state.doraShown)];
      for (const tile of unseen) assert.ok(!publicIds.has(tile), `hand ${n}: the public table shows wall tile ${tile}`);

      for (let seat = 0; seat < 4; seat += 1) {
        const mine = new Set(state.hands[seat]);
        const seatIds = tileIdsIn(view.seatHand(state, seat, { coach: true }));
        for (const tile of hidden) if (!mine.has(tile)) assert.ok(!seatIds.has(tile), `hand ${n}: seat ${seat} is shown another seat's tile ${tile}`);
        for (const tile of unseen) assert.ok(!seatIds.has(tile), `hand ${n}: seat ${seat} is shown wall tile ${tile}`);
        for (const tile of mine) assert.ok(seatIds.has(tile), `hand ${n}: seat ${seat} can't see its own tile ${tile}`);
      }
      checked += 1;
      const seat = round.waitingSeats(state)[0];
      round.act(state, seat, bot.decide(state, seat, { level: "normal", random: () => 0.5 }));
    }
  }
  assert.ok(checked > 500);
});

test("a bot's move doesn't change when everything it can't see is scrambled", () => {
  let compared = 0;
  for (let n = 0; n < 25; n += 1) {
    const match = game.createGame({ seed: seedFor(2000 + n), length: "east" });
    const state = match.hand;
    const pick = seededPicker("cd".repeat(32), n);
    while (state.phase !== "over") {
      for (const seat of round.waitingSeats(state)) {
        // The same position with the other three hands and the rest of the wall dealt differently.
        const twin = structuredClone(state);
        const pool = [];
        for (let other = 0; other < 4; other += 1) if (other !== seat) pool.push(...twin.hands[other]);
        const wallSlots = [];
        for (let i = twin.livePos; i < twin.wall.length; i += 1) {
          const isIndicator = i >= RINSHAN_START + 4 && i < RINSHAN_START + 4 + twin.doraShown;
          if (!isIndicator) wallSlots.push(i);
        }
        for (const slot of wallSlots) pool.push(twin.wall[slot]);
        for (let i = pool.length - 1; i > 0; i -= 1) {
          const j = pick(i + 1);
          [pool[i], pool[j]] = [pool[j], pool[i]];
        }
        let at = 0;
        for (let other = 0; other < 4; other += 1) {
          if (other === seat) continue;
          twin.hands[other] = pool.slice(at, at + twin.hands[other].length);
          at += twin.hands[other].length;
        }
        for (const slot of wallSlots) twin.wall[slot] = pool[at++];
        // What the seat is asked is public (its own options): keep the question, scramble the rest.
        const level = LEVELS[seat];
        if (state.phase === "calls") continue; // whether a call is offered depends on the real hands; compared on turns
        assert.deepEqual(bot.decide(twin, seat, { level, random: () => 0.5 }), bot.decide(state, seat, { level, random: () => 0.5 }), `hand ${n}: seat ${seat} (${level}) used hidden tiles`);
        compared += 1;
      }
      const seat = round.waitingSeats(state)[0];
      round.act(state, seat, bot.decide(state, seat, { level: LEVELS[seat], random: () => 0.5 }));
    }
  }
  assert.ok(compared > 800);
});

test("the paid tables' autopilot only throws back what it draws and never calls or wins", () => {
  const match = game.createGame({ seed: seedFor(3000), length: "east" });
  const state = match.hand;
  while (state.phase !== "over") {
    const seat = round.waitingSeats(state)[0];
    const action = bot.decide(state, seat, { level: "auto" });
    if (state.phase === "turn") assert.deepEqual(action, { type: "discard", tile: state.drawn });
    else assert.deepEqual(action, { type: "pass" });
    round.act(state, seat, action);
  }
  assert.equal(state.result.type, "draw");
  assert.equal(state.result.reason === "exhaustive" || state.result.reason === "nagashi" || state.result.reason === "suufon", true);
  assert.ok(state.melds.every((melds) => melds.length === 0));
});

// ── The tutorial's guided hands ────────────────────────────────────────────
function playLesson(key) {
  const lesson = tutorial.lessonOf(key);
  const state = round.createHand({ wall: lesson.wall(), dealer: 0, roundWind: 27, scores: [25000, 25000, 25000, 25000] });
  let step = 0;
  let guard = 0;
  while (state.phase !== "over") {
    const waiting = round.waitingSeats(state);
    if (waiting.includes(0)) {
      const wanted = lesson.steps[step];
      assert.ok(wanted, `${key}: the learner is asked for a move the lesson doesn't have (step ${step})`);
      const options = round.optionsFor(state, 0);
      let action;
      if (wanted.type === "discard") {
        const tile = state.hands[0].find((held) => kindOf(held) === wanted.kind);
        assert.ok(tile !== undefined && options.discards.includes(tile), `${key} step ${step}: can't discard that`);
        if (wanted.riichi) assert.ok(options.riichi.includes(tile), `${key} step ${step}: can't riichi on that`);
        action = { type: "discard", tile, riichi: Boolean(wanted.riichi) };
      } else if (wanted.type === "pon") {
        assert.ok(options.pon?.length, `${key} step ${step}: no pon offered`);
        action = { type: "pon", tiles: options.pon[0] };
      } else {
        if (wanted.type === "pass") assert.ok(options.pon || options.chi, `${key} step ${step}: nothing to pass on`);
        if (wanted.type === "ron") assert.ok(options.ron, `${key} step ${step}: no ron offered`);
        if (wanted.type === "tsumo") assert.ok(options.tsumo, `${key} step ${step}: no tsumo offered`);
        action = { type: wanted.type };
      }
      assert.ok(tutorial.matchesStep(wanted, action, kindOf));
      round.act(state, 0, action);
      step += 1;
    } else {
      const seat = waiting[0];
      round.act(state, seat, bot.decide(state, seat, { level: "auto" }));
    }
    guard += 1;
    assert.ok(guard < 200, `${key}: the lesson doesn't end`);
  }
  assert.equal(step, lesson.steps.length, `${key}: the hand ended before the last step`);
  return state.result;
}

test("the riichi lesson ends in a self-drawn mangan: riichi, ippatsu, concealed hand and two dora", () => {
  const result = playLesson("riichi");
  assert.equal(result.type, "win");
  const win = result.wins[0];
  assert.equal(win.seat, 0);
  assert.equal(win.tsumo, true);
  assert.deepEqual(win.yaku.map((entry) => entry.key).sort(), ["ippatsu", "menzen-tsumo", "riichi"]);
  assert.equal(win.dora.dora, 2);
  assert.equal(win.han, 5);
  assert.equal(win.limit, "mangan");
  // A dealer's mangan by self-draw is 4,000 from each player; the riichi stick comes back too.
  assert.deepEqual(result.deltas, [13000, -4000, -4000, -4000]);
  assert.deepEqual(result.scores, [37000, 21000, 21000, 21000]);
});

test("the calls lesson ends in a ron on an open hand: white dragon and two dora", () => {
  const result = playLesson("calls");
  assert.equal(result.type, "win");
  const win = result.wins[0];
  assert.equal(win.seat, 0);
  assert.equal(win.from, 2);
  assert.deepEqual(win.yaku.map((entry) => entry.key), ["yakuhai-white"]);
  assert.equal(win.han, 3);
  assert.equal(win.fu, 30);
  // Dealer, 3 han 30 fu: 5,800.
  assert.deepEqual(result.deltas, [5800, 0, -5800, 0]);
});

test("a lesson only accepts its own next step", () => {
  const step = tutorial.lessonOf("riichi").steps[0];
  assert.equal(tutorial.matchesStep(step, { type: "discard", tile: 30 * 4, riichi: false }, kindOf), true);
  assert.equal(tutorial.matchesStep(step, { type: "discard", tile: 29 * 4, riichi: false }, kindOf), false);
  assert.equal(tutorial.matchesStep(step, { type: "discard", tile: 30 * 4, riichi: true }, kindOf), false);
  assert.equal(tutorial.matchesStep(step, { type: "tsumo" }, kindOf), false);
  assert.equal(tutorial.matchesStep(undefined, { type: "tsumo" }, kindOf), false);
  assert.equal(tutorial.lessonOf("constructor"), null);
});
