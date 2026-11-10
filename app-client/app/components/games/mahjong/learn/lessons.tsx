"use client";

import type { ReactNode } from "react";
import type { Exercise } from "@/app/components/games/mahjong/learn/exercises";
import { ExampleHand, Hand, MeldRow, Picture } from "@/app/components/games/mahjong/learn/learn-frame";
import { useMahjongRules } from "@/app/components/games/mahjong/learn/use-rules";
import { LIMIT_ORDER, LIMITS, YAKU } from "@/app/lib/games/mahjong/yaku";
import { fmtInteger } from "@/app/lib/format";
import learn from "@/app/components/games/mahjong/learn/learn.module.scss";

// The walkthrough: short lessons, each with pictured tiles and small exercises. The answers are
// fixed and were checked against the server's own hand functions (shanten and waits, the scorer for
// the yaku hands), so what a lesson says is what the table does. Rules wording follows
// docs/games/MAHJONG_DESIGN.md.

export type Lesson = { id: string; title: string; blurb: string; body: ReactNode; exercises: Exercise[] };

/** The same hint for every tile that is not the answer. */
const hintAll = (count: number, except: number[], text: string): Record<number, string> => {
  const hints: Record<number, string> = {};
  for (let index = 0; index < count; index += 1) if (!except.includes(index)) hints[index] = text;
  return hints;
};

function ClockFacts() {
  const { data } = useMahjongRules();
  const standard = data?.rules.speeds.standard;
  const relaxed = data?.rules.speeds.relaxed;
  if (!standard || !relaxed) return <p>Each move has a few seconds on the clock plus a time bank that refills every hand.</p>;
  return (
    <p>
      Each move has a few seconds on the clock plus a time bank that refills every hand. A standard table gives you <b>{fmtInteger(standard.turn)} seconds</b> a move and a <b>{fmtInteger(standard.bank)}-second</b>{" "}
      bank; a relaxed one gives <b>{fmtInteger(relaxed.turn)}</b> and <b>{fmtInteger(relaxed.bank)}</b>. Practice against bots and the guided hands aren’t timed at all.
    </p>
  );
}

export const LESSONS: Lesson[] = [
  // ── 1 ─────────────────────────────────────────────────────────────────────
  {
    id: "tiles",
    title: "The tiles",
    blurb: "136 tiles, three suits, honors and the red fives.",
    body: (
      <>
        <p>
          A set is <b>136 tiles</b>: four copies of 34 different ones. Twenty-seven of them are numbered 1 to 9 in <b>three suits</b>. The suits were money long before they were tiles, which suits a game about
          markets: <b>circles</b> are coins, <b>bamboo</b> are strings of coins (drawn here as green candlesticks, like a stock chart), and <b>characters</b> are the number over 萬, “ten thousand”.
        </p>
        <Picture label="Characters, circles, bamboo">
          <Hand notation="123456789m" size={28} />
          <Hand notation="123456789p" size={28} />
          <Hand notation="123456789s" size={28} />
        </Picture>
        <p>
          The other seven are <b>honors</b>: the four winds (East, South, West, North) and the three dragons (white, which is an empty frame, then green and red). Honors have no numbers, so they can only ever be
          pairs and triplets, never runs.
        </p>
        <Picture label="Winds, then dragons" caption="East, South, West, North, white, green, red.">
          <Hand notation="1234567z" size={28} gaps={[3]} />
        </Picture>
        <p>
          One five in each suit is <b>red</b>. It plays exactly like any other five, and it is worth a bonus han (more on that in the scoring lesson). The small letters and numbers in the tile corners are there to
          help while you learn; you can switch them off in the table’s settings.
        </p>
        <Picture label="The three red fives">
          <Hand notation="0m0p0s" size={28} />
        </Picture>
      </>
    ),
    exercises: [
      {
        id: "tiles-dragons",
        kind: "pick",
        prompt: "Tap the three dragons.",
        tiles: "3m5z8p2z6z1s7z4p",
        count: 3,
        answer: [1, 4, 6],
        explain: "White, green and red are the dragons. South is a wind, and the rest are numbered tiles.",
        hints: { ...hintAll(8, [1, 4, 6], "A numbered tile isn’t a dragon. Dragons are the honors that are white, green or red."), 3: "That’s South, a wind. The dragons are white (the empty frame), green and red." },
      },
      {
        id: "tiles-red",
        kind: "pick",
        prompt: "Tap the red five.",
        tiles: "5m0m5p7s",
        count: 1,
        answer: [1],
        explain: "The red five is drawn in red. The other fives are plain.",
        hints: { 0: "That five is plain. The red five is the one drawn in red.", 2: "That five is plain. The red five is the one drawn in red.", 3: "That isn’t a five at all." },
      },
    ],
  },
  // ── 2 ─────────────────────────────────────────────────────────────────────
  {
    id: "sets",
    title: "Sets",
    blurb: "Runs, triplets and the pair.",
    body: (
      <>
        <p>Hands are built from three kinds of group.</p>
        <div className={learn.pair}>
          <Picture label="A run" caption="Three in a row, one suit. 4-5-6 of circles. It never wraps: 8-9-1 isn’t a run.">
            <Hand notation="456p" size={30} />
          </Picture>
          <Picture label="A triplet" caption="Three of the very same tile. Honors can do this too.">
            <Hand notation="777s" size={30} />
          </Picture>
          <Picture label="A pair" caption="Two of the same tile. Every hand needs exactly one.">
            <Hand notation="99m" size={30} />
          </Picture>
        </div>
        <p>
          Runs and triplets are called <b>sets</b>. There is a fourth, rarer set, the <b>kan</b>: four of the same tile. It counts as one set, and we’ll get to it with calling.
        </p>
      </>
    ),
    exercises: [
      {
        id: "sets-run",
        kind: "pick",
        prompt: "Tap the three tiles that make a run.",
        tiles: "2m7s3m5p4m5p",
        count: 3,
        answer: [0, 2, 4],
        explain: "2-3-4 of characters. The two 5s of circles are a pair, and the 7 of bamboo belongs to nothing here.",
        hints: { 1: "A run stays in one suit. That’s bamboo, and the rest are characters and circles.", 3: "The two 5s of circles are a pair, not part of a run.", 5: "The two 5s of circles are a pair, not part of a run." },
      },
      {
        id: "sets-triplet",
        kind: "pick",
        prompt: "Tap the three tiles that make a triplet.",
        tiles: "6p4s6p8m6p9m",
        count: 3,
        answer: [0, 2, 4],
        explain: "Three 6s of circles. A triplet is three copies of exactly the same tile.",
        hints: { 1: "A triplet is three of the very same tile. That one is different.", 3: "A triplet is three of the very same tile. That one is different.", 5: "A triplet is three of the very same tile. That one is different." },
      },
    ],
  },
  // ── 3 ─────────────────────────────────────────────────────────────────────
  {
    id: "shape",
    title: "The winning shape",
    blurb: "Four sets and a pair.",
    body: (
      <>
        <p>
          A hand wins when its 14 tiles are <b>four sets and a pair</b>. You hold 13 tiles; on your turn you draw a fourteenth, and if it completes the shape you’ve won.
        </p>
        <Picture label="A winning hand" caption="Three runs, a triplet and a pair: four sets and a pair.">
          <Hand notation="123m456p789s777p55m" size={26} gaps={[2, 5, 8, 11]} />
        </Picture>
        <p>
          There are two special shapes besides this one: <b>seven pairs</b> and <b>thirteen orphans</b>. They’re on the yaku page when you’re ready. The standard shape is where nearly every win comes from.
        </p>
      </>
    ),
    exercises: [
      {
        id: "shape-complete",
        kind: "pick",
        prompt: "This hand is one tile short. Which tile completes it?",
        context: { label: "Your 13 tiles", notation: "123m456m789s99p57p", gaps: [2, 5, 8, 10] },
        tiles: "4p6p8p9s",
        count: 1,
        answer: [1],
        explain: "5-6-7 of circles is a run, and with the three runs and the pair of 9s, that’s four sets and a pair.",
        hints: { 0: "4, 5 and 7 aren’t in a row. The gap in 5-7 needs a 6.", 2: "5, 7 and 8 aren’t in a row. The gap in 5-7 needs a 6.", 3: "A different suit. The open spot is the gap between 5 and 7 of circles." },
      },
    ],
  },
  // ── 4 ─────────────────────────────────────────────────────────────────────
  {
    id: "turn",
    title: "Your turn",
    blurb: "Draw one, discard one.",
    body: (
      <>
        <p>
          On your turn you <b>draw</b> a tile from the wall, which takes you to 14, then <b>discard</b> one face up in front of you, back to 13. Play passes to your right. Everyone’s discards stay on the table in
          the order they were thrown, so everyone can read them.
        </p>
        <p>
          Keep tiles that work together (runs, partial runs, pairs) and throw the ones that don’t. A tile nothing else in your hand can ever pair with is the easiest to give up, and a lone honor that isn’t worth
          anything to you is usually first.
        </p>
      </>
    ),
    exercises: [
      {
        id: "turn-discard",
        kind: "pick",
        prompt: "You’re South in the East round and just drew. Which tile would you throw?",
        tiles: "234m99m567p45p789s4z",
        count: 1,
        answer: [13],
        explain: "North is a lone honor that is neither your seat wind nor the round wind, so it can’t become anything. Throwing it leaves you one tile from winning (3 or 6 of circles), the next lesson.",
        hints: hintAll(14, [13], "That tile is part of a run, a pair or a partial run. Look for the one that fits nowhere."),
      },
    ],
  },
  // ── 5 ─────────────────────────────────────────────────────────────────────
  {
    id: "ready",
    title: "Ready hands and waits",
    blurb: "Tenpai, and what you’re waiting on.",
    body: (
      <>
        <p>
          A hand that is one tile from winning is <b>tenpai</b>, or ready. The tiles that would finish it are your <b>waits</b>. The shape of the almost-set decides how many there are.
        </p>
        <div className={learn.pair}>
          <Picture label="Two-sided" caption="4-5 waits on 3 or 6. Up to eight tiles can finish it. The best wait.">
            <Hand notation="45p" size={30} />
          </Picture>
          <Picture label="Middle" caption="4-6 waits on 5 only.">
            <Hand notation="46p" size={30} />
          </Picture>
          <Picture label="Edge" caption="1-2 waits on 3 only. So does 8-9 on 7.">
            <Hand notation="12p" size={30} />
          </Picture>
          <Picture label="Two pairs" caption="55 and 99: either can become a triplet, so it waits on both.">
            <Hand notation="55p99p" size={30} gaps={[1]} />
          </Picture>
          <Picture label="Single tile" caption="Everything is done but the pair; one tile waits for its twin.">
            <Hand notation="8s" size={30} />
          </Picture>
        </div>
        <p>
          More waits means more tiles that win. And a tile only counts if some of it is left: if you hold all four of a tile yourself, nobody can ever give you the fifth.
        </p>
      </>
    ),
    exercises: [
      {
        id: "ready-waits",
        kind: "pick",
        prompt: "This hand is ready. Tap both tiles it is waiting on.",
        context: { label: "Your 13 tiles", notation: "123m456m678p23s99s", gaps: [2, 5, 8, 10] },
        tiles: "1s2s4s5s7s",
        count: 2,
        answer: [0, 2],
        explain: "2-3 of bamboo is a two-sided wait: 1 or 4 makes a run, and everything else is already four sets and the pair of 9s.",
        hints: { 1: "A second 2 doesn’t make a run with 2-3. A run needs three different numbers in a row.", 3: "2-3-5 isn’t a run: there’s a gap.", 4: "7 is too far from 2-3 to make a run." },
      },
      {
        id: "ready-best",
        kind: "choice",
        prompt: "Which wait is the best?",
        options: ["A middle wait: 4-6 waiting on 5", "A two-sided wait: 4-5 waiting on 3 or 6", "An edge wait: 1-2 waiting on 3"],
        answer: 1,
        explain: "Two different tiles win it, up to eight copies, against four for the others.",
        hints: { 0: "That’s one tile, so at most four copies. Is there a wait with two tiles?", 2: "That’s one tile, so at most four copies. Is there a wait with two tiles?" },
      },
    ],
  },
  // ── 6 ─────────────────────────────────────────────────────────────────────
  {
    id: "yaku",
    title: "You need a yaku",
    blurb: "A shape isn’t enough. Riichi, value tiles, all simples.",
    body: (
      <>
        <p>
          A complete hand can still be worth nothing. To win you need at least one <b>yaku</b>: a scoring pattern on top of the shape. Dora (bonus tiles, later) are not yaku, so a hand of only dora can’t win.
        </p>
        <p>There are dozens, all on the yaku page. Three are enough to start with.</p>
        <h3>Riichi</h3>
        <p>
          The beginner’s yaku. If your hand is closed (no called sets) and tenpai, you can say <b>riichi</b>: pay a 1,000-point stick, turn your discard sideways, and from then on discard whatever you draw. In return you
          get a han, and a chance at bonus dora. You need at least 1,000 points and at least four tiles left to draw. It locks your hand, so be sure it’s the one you want.
        </p>
        <h3>Value tiles</h3>
        <p>
          A set (a pon is enough) of any dragon, of your seat wind or of the round wind is a yaku, worth a han each. It also works on an open hand, which is why it is such an easy way to win.
        </p>
        <Picture label={`${YAKU["yakuhai-white"].name}, ${YAKU["yakuhai-white"].japanese}`} caption="A called pon of white dragons. One han.">
          <ExampleHand example={YAKU["yakuhai-white"].example} />
        </Picture>
        <h3>All simples</h3>
        <p>Every tile is a 2 through 8: no ones, nines or honors. An open hand can use it too.</p>
        <Picture label={`${YAKU.tanyao.name}, ${YAKU.tanyao.japanese}`} caption="Nothing but 2s through 8s. One han.">
          <ExampleHand example={YAKU.tanyao.example} />
        </Picture>
      </>
    ),
    exercises: [
      {
        id: "yaku-which",
        kind: "choice",
        prompt: "All three hands are complete and were won on someone’s discard. Only one can win. Which?",
        picture: (
          <div style={{ display: "grid", gap: "0.8rem" }}>
            <Picture label="Hand A">
              <ExampleHand example={{ hand: "456p789s234p5m", win: "5m", calls: [{ type: "chi", tiles: "123m", called: 0 }], caption: "" }} />
            </Picture>
            <Picture label="Hand B">
              <ExampleHand example={{ hand: "456p789s234p5m", win: "5m", calls: [{ type: "pon", tiles: "555z", called: 0 }], caption: "" }} />
            </Picture>
            <Picture label="Hand C">
              <ExampleHand example={{ hand: "456p678p234s9s", win: "9s", calls: [{ type: "chi", tiles: "345m", called: 0 }], caption: "" }} />
            </Picture>
          </div>
        ),
        options: ["Hand A", "Hand B", "Hand C"],
        answer: 1,
        explain: "Hand B holds a pon of white dragons: a value tile, so a yaku. A and C are open hands with nothing that scores.",
        hints: {
          0: "Hand A is open, all runs, and nothing in it scores. No yaku, no win.",
          2: "Hand C has a 9, so it isn’t all simples, and nothing else in it scores. No yaku, no win.",
        },
      },
      {
        id: "yaku-riichi",
        kind: "choice",
        prompt: "Your hand is closed and tenpai but has no yaku. What do you do?",
        options: ["Wait and ron: the shape is enough", "Declare riichi", "Pon something to open the hand"],
        answer: 1,
        explain: "Riichi is a yaku, and it needs a closed, ready hand: exactly what you have.",
        hints: { 0: "A complete shape without a yaku can’t win.", 2: "Calling opens the hand, which makes riichi impossible and doesn’t give you a yaku." },
      },
    ],
  },
  // ── 7 ─────────────────────────────────────────────────────────────────────
  {
    id: "calls",
    title: "Calling",
    blurb: "Chi, pon and kan, and what opening your hand costs.",
    body: (
      <>
        <p>
          You don’t have to wait for the wall. When someone discards a tile you want, you can take it to finish a set, and then you throw a tile. That’s <b>calling</b>, and the set goes face up beside your hand, the
          taken tile lying sideways.
        </p>
        <div className={learn.pair}>
          <Picture label="Chi" caption="A run, from the player on your left only (the one who plays just before you).">
            <MeldRow calls={[{ type: "chi", tiles: "456p", called: 0 }]} />
          </Picture>
          <Picture label="Pon" caption="A triplet, from anyone.">
            <MeldRow calls={[{ type: "pon", tiles: "777s", called: 1 }]} />
          </Picture>
          <Picture label="Kan" caption="Four of a kind: open from a discard, closed from your own hand (end tiles face down), or added to a pon.">
            <MeldRow calls={[{ type: "minkan", tiles: "2222m", called: 3 }, { type: "ankan", tiles: "9999p" }]} />
          </Picture>
        </div>
        <p>
          If several people want the same discard, the order is: <b>ron</b>, then <b>pon or kan</b>, then <b>chi</b>. A kan also gives you an extra draw from the end of the wall and turns a new dora indicator.
        </p>
        <p>
          After a chi or pon you can’t throw the same kind of tile you just took, or the tile at the other end of the run you just made. Taking a 4 for your 2-3 and throwing the 1 is out.
        </p>
        <h3>What opening costs</h3>
        <ul>
          <li>No riichi. It needs a closed hand, and so do several other yaku (pinfu, a self-draw win, seven pairs).</li>
          <li>Some yaku lose a han when open: a mixed triple run, a straight, the outside hands and the flushes.</li>
          <li>Fewer fu: you lose the bonus for winning a closed hand on a discard.</li>
          <li>Everyone can see what you’ve got, and a hand that has called still needs a yaku to win.</li>
        </ul>
        <p>Closed kans don’t open your hand.</p>
      </>
    ),
    exercises: [
      {
        id: "calls-chi",
        kind: "pick",
        prompt: "The player on your left discards a 5 of characters. Tap the two tiles you’d use to chi it.",
        context: { label: "Their discard", notation: "5m" },
        tiles: "4m8p6m2s7z",
        count: 2,
        answer: [0, 2],
        explain: "4 and 6 of characters with the 5 make 4-5-6.",
        hints: { 1: "A run stays in one suit. That’s circles.", 3: "A run stays in one suit. That’s bamboo.", 4: "Honors can’t make runs." },
      },
      {
        id: "calls-from",
        kind: "choice",
        prompt: "Whose discard can you chi?",
        options: ["Anyone’s", "Only the player on your left, who plays just before you", "Only the player across"],
        answer: 1,
        explain: "Chi is only from the player before you in turn. Pon and kan can be taken from anyone.",
        hints: { 0: "That’s pon. Chi has a stricter rule.", 2: "The player across is fine for pon and kan, not chi." },
      },
      {
        id: "calls-cost",
        kind: "choice",
        prompt: "You call a chi. What did that cost you?",
        options: ["Nothing: it’s free", "You can’t declare riichi any more, and some yaku are worth less", "Your next turn"],
        answer: 1,
        explain: "A hand with a called set is open: no riichi, a han less on several yaku, and fewer fu. Quick wins often still make it worth it.",
        hints: { 0: "There is always a cost. Think about what needs a closed hand.", 2: "You don’t lose a turn. After a call you just discard." },
      },
    ],
  },
  // ── 8 ─────────────────────────────────────────────────────────────────────
  {
    id: "furiten",
    title: "Furiten",
    blurb: "When a wait you can see still can’t win.",
    body: (
      <>
        <p>
          If a tile you’re waiting on is already in <b>your own discards</b>, you can’t win on anyone’s discard, only by drawing it yourself. That’s <b>furiten</b>. It holds even if another player took the tile
          you threw.
        </p>
        <Picture label="Waiting on 3 or 6 of circles, with a 3 in the discards" caption="You threw that 3 earlier, back when your hand was different. Now neither a 3 nor a 6 can win on a discard.">
          <Hand notation="234m567s789p45p99m" size={24} gaps={[2, 5, 8, 10]} />
          <Hand notation="9s3p1z7m" size={22} />
        </Picture>
        <p>It also comes up two other ways:</p>
        <ul>
          <li>You pass on a winning tile and it was discarded this go-around: no ron on a discard until your next discard.</li>
          <li>You’re in riichi and a winning tile goes by: no ron on a discard for the rest of the hand.</li>
        </ul>
        <p>Self-draws always work. If the game says you can’t ron, it’s one of these.</p>
      </>
    ),
    exercises: [
      {
        id: "furiten-pick",
        kind: "pick",
        prompt: "Your hand waits on 3 or 6 of circles. Tap the discard that makes you furiten.",
        context: { label: "Your 13 tiles", notation: "234m567s789p45p99m", gaps: [2, 5, 8, 10] },
        tiles: "9s3p1z7m",
        count: 1,
        answer: [1],
        explain: "The 3 of circles is one of your waits and it’s in your own discards. Now you can’t ron on a 3 or a 6.",
        hints: hintAll(4, [1], "That isn’t one of your waits. Your hand waits on 3 and 6 of circles."),
      },
      {
        id: "furiten-win",
        kind: "choice",
        prompt: "You’re furiten on 3 and 6 of circles. How can you still win?",
        options: ["By drawing a 3 or 6 of circles yourself", "By calling ron on a 6 anyway", "You can’t win at all this hand"],
        answer: 0,
        explain: "A self-draw is always allowed. It’s only winning on someone’s discard that furiten blocks.",
        hints: { 1: "That’s the exact thing furiten blocks.", 2: "Furiten blocks winning on discards only. Your own draw still wins." },
      },
    ],
  },
  // ── 9 ─────────────────────────────────────────────────────────────────────
  {
    id: "scoring",
    title: "Scoring, in one screen",
    blurb: "Han, dora, and why bigger hands pay more.",
    body: (
      <>
        <p>
          Every yaku is worth some <b>han</b>, and every dora in the winning hand adds one more. Each han roughly doubles what the hand pays, so a hand is worth far more than the sum of its parts. That’s why people
          chase one big hand over many small ones.
        </p>
        <p>
          There’s also <b>fu</b>, small points for the hand’s shape, but you can ignore it until you’re curious: the table’s result screen shows the whole sum. At 30 fu, a non-dealer who wins on a discard gets about
          1,000 for 1 han, 2,000 for 2, 3,900 for 3 and 7,700 for 4. On a self-draw the other three split the bill.
        </p>
        <h3>Dora</h3>
        <p>
          A tile is shown face up on the wall (the <b>dora indicator</b>). <b>The tile after it is the dora</b>: a 4 shows that 5s are dora, a 9 wraps to 1, winds go East South West North, dragons go white green
          red. Each dora in your winning hand is a bonus han, red fives too. If you won after declaring riichi, the tiles under the indicators are turned and count as well (<b>ura dora</b>).
        </p>
        <Picture label="The indicator, and what it makes dora" caption="With a 4 of bamboo showing, every 5 of bamboo is dora.">
          <Hand notation="4s5s" size={30} gaps={[0]} />
        </Picture>
        <h3>The limits</h3>
        <p>Past a point the number of han stops mattering and the hand pays a fixed amount. For a non-dealer winning on a discard:</p>
        <div className={learn.scroll}>
          <table className={learn.facts}>
            <thead>
              <tr>
                <th>Name</th>
                <th>Han</th>
                <th className={learn.n}>Pays</th>
              </tr>
            </thead>
            <tbody>
              {LIMIT_ORDER.filter((key) => key !== "kazoe").map((key) => (
                <tr key={key}>
                  <td>{LIMITS[key].name}</td>
                  <td>{key === "yakuman" ? "A yakuman hand, or 13 han or more" : LIMITS[key].when}</td>
                  <td className={learn.n}>{fmtInteger(LIMITS[key].base * 4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>The dealer gets one and a half times as much, and pays one and a half times as much too.</p>
      </>
    ),
    exercises: [
      {
        id: "scoring-dora",
        kind: "pick",
        prompt: "The dora indicator is the 4 of bamboo. Tap the dora.",
        context: { label: "Dora indicator", notation: "4s" },
        tiles: "3s4s5s6s",
        count: 1,
        answer: [2],
        explain: "The dora is the tile after the indicator, so 5 of bamboo.",
        hints: { 0: "That’s one below the indicator. The dora is the next tile up.", 1: "That’s the indicator itself. The dora is the next tile up.", 3: "That’s two above. The dora is the very next tile." },
      },
      {
        id: "scoring-han",
        kind: "choice",
        prompt: "You win with riichi and all simples, and your hand holds two dora. How many han?",
        options: ["2", "3", "4", "5"],
        answer: 2,
        explain: "One for riichi, one for all simples, one for each dora: 4 han.",
        hints: { 0: "Dora count too: each one is a han on its own.", 1: "Count both dora.", 3: "That would be a mangan. Count again: riichi 1, all simples 1, two dora 2." },
      },
    ],
  },
  // ── 10 ────────────────────────────────────────────────────────────────────
  {
    id: "etiquette",
    title: "The clock and autopilot",
    blurb: "How a table keeps moving.",
    body: (
      <>
        <ClockFacts />
        <p>
          When the clock runs out, the tile you just drew is discarded for you and any call on offer is passed. Time out twice in a row, or leave, and the seat goes on <b>autopilot</b> until you act again. At a free
          table autopilot is a bot, which plays properly. At a table with Credit on it, autopilot only throws whatever it draws, so walking away can never beat playing.
        </p>
        <p>
          The courtesy is the usual one: don’t sit on a decision you’ve already made, and if you have to go, leave rather than stalling three people. Nobody minds a real think about a riichi or a fold.
        </p>
      </>
    ),
    exercises: [
      {
        id: "etiquette-clock",
        kind: "choice",
        prompt: "Your clock runs out on your turn. What happens?",
        options: ["The game waits for you", "The tile you drew is discarded, and calls on offer are passed", "You lose the hand"],
        answer: 1,
        explain: "That’s what the time bank is for. Run through it twice in a row and you’re on autopilot.",
        hints: { 0: "Four people are waiting, so the table moves on.", 2: "Nothing so harsh: you just don’t get to choose this move." },
      },
      {
        id: "etiquette-autopilot",
        kind: "choice",
        prompt: "At a table with Credit on it, what does autopilot do?",
        options: ["Plays like a strong bot", "Throws whatever it draws", "Folds your hand and takes the loss"],
        answer: 1,
        explain: "It only discards what it draws, so a player who leaves can never come out ahead of one who stays.",
        hints: { 0: "That’s free tables. Where there’s money on the table, autopilot plays no better than it has to.", 2: "It doesn’t fold. It throws every tile it draws, which is worse for you." },
      },
    ],
  },
];
