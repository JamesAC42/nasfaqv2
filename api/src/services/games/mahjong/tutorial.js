// The tutorial's guided hands. Each is one hand on an arranged wall (stackedWall.js) where the
// learner sits East against three seats that only discard what they draw, and the table accepts
// one move at a time: the next step of the lesson. The words that go with each step are the
// client's (app/components/games/mahjong/table/lesson-texts.ts); this file is what must happen on the table.
//
// A step is the move the learner has to make: { type: "discard", kind, riichi? }, "pass", "pon",
// "ron" or "tsumo". Anything else is refused with `tutorial_step`, which names the step.

const { stackWall } = require("./stackedWall");
const { NORTH, SOUTH, WEST } = require("./tiles");

const LESSONS = Object.freeze({
  // A closed hand: complete a run, pass up a pon, declare riichi, win by self-draw next turn.
  // 234m 9m 56p 789s 55s West North; dora 5s.
  riichi: {
    wall: () =>
      stackWall({
        dealer: 0,
        hands: ["2349m56p789s55s34z", "147m258p369s1267z", "258m369p147s1267z", "369m147p268s1567z"],
        draws: "4p9p1s5s8m1p2z6z7m",
        dora: "4s",
        ura: "1z",
        fill: 1,
      }),
    steps: [
      { type: "discard", kind: NORTH },
      { type: "pass" },
      { type: "discard", kind: WEST, riichi: true },
      { type: "tsumo" },
    ],
  },
  // An open hand: pon the white dragon for a yaku, then win on another player's discard.
  // 123m 678p 34s 77s white white South; dora 7s.
  calls: {
    wall: () =>
      stackWall({
        dealer: 0,
        hands: ["123m678p34s77s255z", "147m258p369s1367z", "258m369p148s1367z", "369m147p268s1467z"],
        draws: "4z5z9s5s",
        dora: "6s",
        ura: "1z",
        fill: 2,
      }),
    steps: [{ type: "discard", kind: SOUTH }, { type: "pon" }, { type: "discard", kind: NORTH }, { type: "ron" }],
  },
});

const lessonOf = (key) => (Object.hasOwn(LESSONS, key) ? LESSONS[key] : null);

/** Whether `action` is the lesson's step `index`. `kindOf` reads a tile id's kind. */
function matchesStep(step, action, kindOf) {
  if (!step || step.type !== action?.type) return false;
  if (step.type === "discard") return kindOf(action.tile) === step.kind && Boolean(action.riichi) === Boolean(step.riichi);
  return true;
}

module.exports = { LESSONS, lessonOf, matchesStep };
