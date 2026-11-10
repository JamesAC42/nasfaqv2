"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Hand, LearnFrame, Picture } from "@/app/components/games/mahjong/learn/learn-frame";
import learn from "@/app/components/games/mahjong/learn/learn.module.scss";
import styles from "@/app/components/games/mahjong/learn/reference.module.scss";

// Standard, sound advice in three tiers. Nothing here depends on a house rule beyond what the rule
// sheet says (docs/games/MAHJONG_DESIGN.md): the final-score numbers are §1, furiten is §1.

function Tip({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <article id={id} className={styles.tip}>
      <h3>{title}</h3>
      {children}
    </article>
  );
}

export function TipsPage() {
  return (
    <LearnFrame
      title="Tips"
      blurb={
        <>
          Advice in three tiers. Do the first tier for a few games before you worry about the second.
        </>
      }
    >
      <ul className={styles.toc} aria-label="On this page">
        <li>
          <a href="#first">First games</a>
        </li>
        <li>
          <a href="#better">Getting better</a>
        </li>
        <li>
          <a href="#sense">Table sense</a>
        </li>
      </ul>

      <section id="first" className={learn.section}>
        <span className={learn.kicker}>Tier 1</span>
        <h2>First games</h2>

        <Tip id="yaku-first" title="Know how you’ll win before you build">
          <p>
            A finished hand without a yaku is worth nothing. The three easy ones are <b>riichi</b> (closed, ready), a <b>set of dragons or your wind</b>, and <b>all simples</b> (nothing but 2s to 8s). Look at your first
            13 tiles and ask which of those you’re closest to. If it’s none, keep playing for shape and see what arrives.
          </p>
        </Tip>
        <Tip id="keep-middle" title="Keep the middle, throw the edges">
          <p>
            Tiles from 3 to 7 connect to more neighbors, so they build runs more easily than 1s and 9s. Early on, throw honors that are worthless to you, then terminals, and hold the connected middle. A pair of anything is
            worth keeping: it can become a triplet, or be the pair you need at the end.
          </p>
          <Picture caption="Tiles near the middle link up in many ways; a lone 1 or 9 only has one.">
            <Hand notation="3456p19m" size={26} gaps={[3]} />
          </Picture>
        </Tip>
        <Tip id="riichi-when-ready" title="Ready and closed? Declare riichi">
          <p>
            It’s the beginner’s yaku, it gets you ura dora and ippatsu chances, and the table shows you the moment you’re ready. The cost is that you can’t change the hand afterwards, so check the wait first: if it’s
            a good one (two-sided, with most of the winning tiles still unseen) then riichi is usually right.
          </p>
        </Tip>
        <Tip id="dont-call-blind" title="Don’t call without a yaku in mind">
          <p>
            Calling a chi or pon opens the hand, and an open hand with no yaku can’t win however finished it looks. Call when the set <i>is</i> the yaku (a pon of dragons, or the run in an all-simples hand), and not just
            to move faster.
          </p>
        </Tip>
        <Tip id="someone-riichi" title="When someone declares riichi, throw what they’ve thrown">
          <p>
            A tile a riichi player already discarded can’t win for them (that’s furiten), so it’s safe against them. When you don’t know what to throw, throw one of theirs. You’ll lose some hands to it. You’ll lose fewer to
            them.
          </p>
        </Tip>
        <Tip id="practice" title="Play bots first, then people">
          <p>
            Practice against bots is free, untimed and doesn’t touch your rating. Play it until counting your tiles into sets is quick. Then play a quick match, where a clock runs and the table moves. The{" "}
            <Link href="/games/mahjong/learn/tutorial">walkthrough</Link> and its two guided hands are the place to start.
          </p>
        </Tip>
      </section>

      <section id="better" className={learn.section}>
        <span className={learn.kicker}>Tier 2</span>
        <h2>Getting better</h2>

        <Tip id="efficiency" title="Tile efficiency: keep the hand that has the most ways to improve">
          <p>
            Every discard leaves a hand with some number of tiles that would help it. Prefer the discard that leaves the most. In practice that means: two-sided shapes (4-5 waiting on 3 or 6) beat edge and middle shapes, a
            floating tile with neighbors is worth more than one on the edge, and you don’t break a good shape to keep a bad one.
          </p>
          <div className={learn.pair}>
            <Picture label="Two-sided: 8 tiles help" caption="3 or 6 of circles.">
              <Hand notation="45p" size={28} />
            </Picture>
            <Picture label="Edge: 4 tiles help" caption="Only a 3 of circles.">
              <Hand notation="12p" size={28} />
            </Picture>
          </div>
          <p>
            Pairs and four-tile runs are flexible too. When you’re choosing between two tiles that both seem useful, count how many different tiles would improve the hand after each choice, and pick the bigger number.
          </p>
        </Tip>
        <Tip id="when-riichi" title="When to riichi, and when not to">
          <p>
            Riichi when you’re closed, ready and the wait is good: it adds a han, brings ura dora and ippatsu, and makes the others fold. Consider staying quiet (<b>dama</b>) when your hand already has a yaku and a decent
            value, because riichi would only add a little, locks the hand, and tells everyone to be careful. Don’t riichi on a wait where most of the tiles are already gone, and rethink it when the wall is nearly empty:
            you need four tiles left to declare, and a late riichi pays 1,000 for little chance.
          </p>
          <p>
            Being the dealer, being behind, and an early turn are all reasons to riichi. Being comfortably ahead late in a game is a reason to keep the hand quiet and move to defense.
          </p>
        </Tip>
        <Tip id="when-fold" title="When to fold">
          <p>
            Fold when someone is in riichi and your hand is far from ready or cheap. A rough guide: if you’re ready with a good wait and a hand worth pushing for, push. If you’re one step from ready with a cheap hand, fold.
            Everything in between depends on how dangerous the tile you’d throw is, and how many tiles you’d have to risk to get there.
          </p>
          <p>
            Remember what dealing in costs: the whole of their hand, plus the riichi stick and honba. One mistake against a riichi hand loses more than several small wins gain. Folding isn’t giving up; it’s keeping your
            points for the next hand.
          </p>
        </Tip>
        <Tip id="reading" title="Reading discards">
          <p>
            Everyone’s discards stay in front of them, in order. They tell you what each player is <i>not</i> collecting, and, after riichi, what their hand can’t be waiting on.
          </p>
          <ul>
            <li>
              <b>Discards that are safe from a riichi player</b> are the tiles they’ve already thrown, and any tile that was discarded after their riichi without them winning on it. A riichi hand that passes a winning tile
              can’t ron for the rest of the hand.
            </li>
            <li>
              <b>Tiles thrown from the hand, not the draw</b> (a tile discarded after a different tile was drawn) mean the hand changed. After riichi nothing changes, and every discard is the tile they drew.
            </li>
            <li>
              <b>Calls show value.</b> A pon of a dragon or of the round wind tells you their yaku. A pon of dora tells you the hand is worth more than it looks.
            </li>
            <li>
              <b>Count what’s visible.</b> If all four copies of a tile are on the table, nobody’s waiting on a shape that needs it, and tiles next to it are a little safer.
            </li>
          </ul>
        </Tip>
        <Tip id="safe-tiles" title="Safe tiles, safest first">
          <p>
            Against a riichi, the safest tile is one they’ve discarded. After that, honors that are already on the table, then terminals, then middle tiles that follow <b>suji</b>: if they threw a 4, then 1 and 7 are
            less likely to be their wait, because a 4 discard rules out the two-sided waits that include it. The most dangerous tiles are the middle ones (4, 5, 6) that nobody has thrown.
          </p>
          <Picture label="They discarded a 4 of circles" caption="1 and 7 of circles are less risky for you now. Less, not safe.">
            <Hand notation="4p" size={28} />
          </Picture>
        </Tip>
      </section>

      <section id="sense" className={learn.section}>
        <span className={learn.kicker}>Tier 3</span>
        <h2>Table sense</h2>

        <Tip id="placement" title="Your finish is what counts, so play the last hand for it">
          <p>
            The final score is your points minus 30,000 (in thousands) plus a bonus for your place: <b>+15, +5, −5, −15</b>, with first place also taking an extra 20 that the starting buy-ins leave. That puts first about 30 above second, and second only 10 above
            third. Your rating cares only about who you finished above, not by how much. So in the last hand ask one question: what do I need to change place?
          </p>
          <ul>
            <li>
              <b>Ahead:</b> win cheap and fast, or fold. A small win ends it. As the dealer in first with 30,000 or more, winning the last hand or being tenpai when it draws ends the game right there.
            </li>
            <li>
              <b>Behind:</b> work out the cheapest hand that passes the player ahead. It’s usually smaller than you think, and a riichi and a self-draw can do it.
            </li>
            <li>
              <b>Near the bottom:</b> avoiding fourth is worth 10 points over third, the same as third over second. Dropping from third to fourth costs as much as falling from second to third.
            </li>
          </ul>
        </Tip>
        <Tip id="dealer" title="The dealer is worth respecting">
          <p>
            A dealer’s win pays one and a half times as much, and winning keeps the deal, so the hand repeats and the counters grow. Defend against a dealer’s riichi like it’s a limit hand, and when you are the dealer,
            a cheap win is better than it looks.
          </p>
        </Tip>
        <Tip id="when-not-call" title="When not to call">
          <p>
            Don’t call when your closed hand is already close and has riichi and ura dora ahead of it, when the call would break a good two-sided shape, or when the hand would still have no yaku. A chi for a hand with one
            cheap han costs you the riichi, the closed-hand fu and the surprise. Do call for a value pon, for all simples with a dora, and when a flush or all triplets is clearly coming. Late in the game, when you’re behind and
            only need to place higher, a fast open hand is often the best way there.
          </p>
        </Tip>
        <Tip id="stay-honest" title="Stay on the clock">
          <p>
            A table plays at the speed of its slowest player. Decide while it isn’t your turn. If you must leave, leave: autopilot on a paid table only discards what it draws, so it can’t protect your seat from three people who are
            still playing.
          </p>
        </Tip>
      </section>
    </LearnFrame>
  );
}
