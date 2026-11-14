// A whole game: the hands of an East-only or East-South match, the points between them, and where
// everyone finished (docs/games/MAHJONG_DESIGN.md §1, "The game"). round.js plays each hand.
//
// Seat 0 deals first. `game.hand` is the hand in play; when it is over, next() scores it into the
// game and deals the following one, or ends the game.

const round = require("./round");
const { buildWall, seedHash } = require("./wall");

const START_POINTS = 25_000;
const TARGET_POINTS = 30_000;
const UMA = Object.freeze([15, 5, -5, -15]);
// What the four 5,000 buy-ins (30,000 less the 25,000 start) leave for first place, in thousands.
const OKA = ((TARGET_POINTS - START_POINTS) * 4) / 1000;
const LENGTHS = Object.freeze({ east: 1, south: 2 });
const WIND_NAMES = Object.freeze(["East", "South", "West", "North"]);

function createGame({ seed, length = "east", wallFor = null }) {
  if (!LENGTHS[length]) throw round.mjError("bad_length");
  const game = {
    seed,
    seed_hash: seedHash(seed),
    length,
    // The wind of the round (0 East, 1 South, 2 West) and which seat deals (0-3) within it.
    wind: 0,
    number: 0,
    honba: 0,
    sticks: 0,
    scores: [START_POINTS, START_POINTS, START_POINTS, START_POINTS],
    hand_index: 0,
    hand: null,
    hands: [],
    over: false,
    final: null,
    // Tests and the tutorial can hand in their own walls: (handIndex) => 136 tile ids.
    wallFor,
  };
  deal(game);
  return game;
}

function deal(game) {
  const wall = game.wallFor ? game.wallFor(game.hand_index) : buildWall(game.seed, game.hand_index);
  game.hand = round.createHand({ wall, dealer: game.number, roundWind: 27 + game.wind, honba: game.honba, sticks: game.sticks, scores: game.scores });
}

const roundLabel = (game) => `${WIND_NAMES[game.wind]} ${game.number + 1}`;

/** Where everyone finished: by points, ties to the seat nearer the first dealer. */
function standings(scores, sticks = 0) {
  const order = [0, 1, 2, 3].sort((a, b) => scores[b] - scores[a] || a - b);
  const points = [...scores];
  points[order[0]] += sticks * round.RIICHI_STICK;
  return order.map((seat, place) => ({
    seat,
    place: place + 1,
    points: points[seat],
    score: Math.round(((points[seat] - TARGET_POINTS) / 1000 + UMA[place] + (place === 0 ? OKA : 0)) * 10) / 10,
  }));
}

/**
 * Scores the finished hand into the game, then deals the next one or ends the game. Returns the
 * summary kept for that hand.
 */
function next(game) {
  const hand = game.hand;
  if (!hand || hand.phase !== "over") throw round.mjError("hand_not_over");
  const result = hand.result;
  const summary = {
    index: game.hand_index,
    wind: game.wind,
    number: game.number,
    label: roundLabel(game),
    honba: game.honba,
    dealer: hand.dealer,
    start_scores: hand.startScores,
    result,
    log: hand.log,
  };
  game.hands.push(summary);
  game.scores = [...hand.scores];
  game.sticks = hand.sticks;
  game.honba = result.honba_next;
  game.hand_index += 1;

  const lastWind = LENGTHS[game.length] - 1;
  const top = Math.max(...game.scores);
  const reached = top >= TARGET_POINTS;
  const dealerLeads = standings(game.scores)[0].seat === hand.dealer;
  const lastHand = game.wind > lastWind || (game.wind === lastWind && game.number === 3);
  let over = game.scores.some((score) => score < 0);

  if (!over && lastHand) {
    if (game.wind > lastWind) {
      // Extra round: the first hand that leaves anyone on the target ends it.
      if (reached) over = true;
      else if (!result.renchan && game.number === 3) over = true;
    } else if (result.renchan) {
      // The dealer stops in the last hand once they've won it, or drawn it tenpai, ahead and over the
      // target. An abortive draw is neither: the hand is dealt again.
      const aborted = result.type === "draw" && result.reason !== "exhaustive" && result.reason !== "nagashi";
      over = !aborted && reached && dealerLeads;
    } else {
      over = reached;
    }
  }

  if (!over && !result.renchan) {
    game.number += 1;
    if (game.number === 4) {
      game.number = 0;
      game.wind += 1;
    }
  }

  if (over) {
    game.over = true;
    game.hand = null;
    game.final = { standings: standings(game.scores, game.sticks), scores: [...game.scores], sticks: game.sticks };
  } else {
    deal(game);
  }
  return summary;
}

module.exports = { LENGTHS, OKA, START_POINTS, TARGET_POINTS, UMA, WIND_NAMES, createGame, next, roundLabel, standings };
