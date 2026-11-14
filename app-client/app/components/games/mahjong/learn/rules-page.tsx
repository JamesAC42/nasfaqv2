"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { LearnFrame } from "@/app/components/games/mahjong/learn/learn-frame";
import { useMahjongRules } from "@/app/components/games/mahjong/learn/use-rules";
import { fmtInteger } from "@/app/lib/format";
import { LIMIT_ORDER, LIMITS } from "@/app/lib/games/mahjong/yaku";
import learn from "@/app/components/games/mahjong/learn/learn.module.scss";
import styles from "@/app/components/games/mahjong/learn/reference.module.scss";

// The rule sheet for players, in plain words. It follows docs/games/MAHJONG_DESIGN.md section by
// section. The numbers the server can change (clocks, ranks, fees, limits) are read from
// GET /api/games/mahjong/rules; the ones that are part of the rules themselves (25,000 points, the
// fu list) are written here.

const TOC = [
  ["game", "The game"],
  ["wall", "The wall"],
  ["calls", "Calls"],
  ["riichi", "Riichi"],
  ["winning", "Winning and furiten"],
  ["draws", "Draws"],
  ["scoring", "Yaku and scoring"],
  ["table", "The table"],
  ["play", "Ways to play, rating, seasons"],
  ["watching", "Watching"],
  ["money", "Money"],
] as const;

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className={learn.section}>
      <h2>{title}</h2>
      <div className={learn.prose}>{children}</div>
    </section>
  );
}

const dollars = (value: number) => `$${fmtInteger(value)}`;
const percent = (rate: number) => `${Number((rate * 100).toFixed(2))}%`;

export function RulesPage() {
  const { data, failed } = useMahjongRules();
  const rules = data?.rules ?? null;
  const dash = "…";
  const standard = rules?.speeds.standard;
  const relaxed = rules?.speeds.relaxed;
  const first = rules?.stakes[0];
  const multiples = first ? first.prizes.map((prize) => (prize === 0 ? "nothing" : `${Number((prize / first.fee).toFixed(2))}×`)).join(", ") : dash;
  const cut = rules ? percent(rules.tournament_rake_bps / 10_000) : dash;

  return (
    <LearnFrame
      title="Rules"
      blurb={
        <>
          The rules as this site plays them. Where riichi sets differ, this page says which way it goes.
        </>
      }
    >
      <ul className={styles.toc} aria-label="On this page">
        {TOC.map(([id, label]) => (
          <li key={id}>
            <a href={`#${id}`}>{label}</a>
          </li>
        ))}
      </ul>

      <Section id="game" title="The game">
        <p>
          Four players, 136 tiles: characters, circles and bamboo from 1 to 9, the four winds and the three dragons, four of each. One five in each suit is red. New to the tiles? The{" "}
          <Link href="/games/mahjong/learn/tutorial">walkthrough</Link> starts there.
        </p>
        <ul>
          <li>
            <b>Length.</b> East-only is one wind round (at least four hands). East-South is two (at least eight).
          </li>
          <li>
            <b>Points.</b> Everyone starts on <span className={learn.num}>25,000</span>. After the last scheduled hand the game is over if anyone has <span className={learn.num}>30,000</span> or more. If nobody does it goes on into the
            next wind round (South after East-only, West after East-South) and stops at the end of the first hand that leaves someone on 30,000 or more, or at the end of that extra round.
          </li>
          <li>
            <b>Bust.</b> The game ends at once when a hand leaves anyone below zero. Exactly zero plays on.
          </li>
          <li>
            <b>The dealer stays</b> (renchan) after winning, after being tenpai at an exhaustive draw, and after any abortive draw. Otherwise the deal passes. A counter (<b>honba</b>) goes on the table every time a hand
            ends without the deal passing or in a draw. It clears when a non-dealer wins.
          </li>
          <li>
            <b>The last hand.</b> If the dealer wins the last scheduled hand (or is tenpai when it draws) and is in first place with 30,000 or more, the game ends there.
          </li>
          <li>
            <b>Final standing.</b> By points. A tie goes to whoever sat closer to the first dealer. Riichi sticks left on the table go to first place. The final score is (points − 30,000) ÷ 1,000 plus a bonus for where you
            finished: <b>+15, +5, −5, −15</b>. First place also takes the 20 that the four 5,000-point buy-ins leave, so +35 in all. The four scores add up to zero.
          </li>
        </ul>
      </Section>

      <Section id="wall" title="The wall, and how to check it">
        <p>
          Every game has one secret 32-byte seed. Its SHA-256 hash is published when the game starts, and the seed itself when the game is over, on the replay page. Nobody, the house included, can change a wall in between
          without the check failing.
        </p>
        <ul>
          <li>
            The wall for hand <i>n</i> (counting every hand dealt, from 0) is a Fisher-Yates shuffle of the tile numbers 0 to 135. Its random numbers come from SHA-256 of the seed written as 64 hex characters, then{" "}
            <code>|</code>, the hand number, <code>|</code> and a block counter, read four bytes at a time, throwing away values that would bias the result.
          </li>
          <li>Tiles are dealt from the front. The last 14 are the dead wall: four replacement tiles, then five dora indicators, then the five ura indicators under them. There are no dice; the seed already decides everything dice would.</li>
          <li>
            Tile number <i>t</i> is kind <i>t</i> ÷ 4, rounded down: 0 to 8 characters, 9 to 17 circles, 18 to 26 bamboo, 27 to 30 East South West North, 31 white, 32 green, 33 red. Tiles 16, 52 and 88 are the red fives.
          </li>
        </ul>
        <p>
          <b>To check a game</b>, open its replay when it’s over. The page shows the published hash, hashes the revealed seed in your browser, and rebuilds every hand’s wall to compare with what was dealt and drawn. Or
          run the steps yourself: hash the seed’s bytes and compare it to the published hash, then shuffle and compare. The recipe above is all there is to it.
        </p>
      </Section>

      <Section id="calls" title="Calls">
        <ul>
          <li>
            <b>Chi</b> only from the player on your left (the one who plays just before you). <b>Pon</b> and <b>open kan</b> from anyone. <b>Closed kan</b> and <b>added kan</b> on your own turn. If several people want one
            discard, the order is ron, then pon or kan, then chi.
          </li>
          <li>
            <b>No swap-calling.</b> After a chi or pon you can’t discard the same kind of tile you just took, or the tile at the other end of a run you just completed (taking a 4 for 2-3 and throwing the 1).
          </li>
          <li>
            <b>Kan dora.</b> A closed kan turns its indicator at once. An open or added kan turns it after the discard that follows (or before the next kan, or before scoring if the replacement tile wins).
          </li>
          <li>
            <b>Four kans.</b> A fifth kan is never allowed. If the four belong to more than one player, the hand is an abortive draw once the fourth kan’s discard goes by.
          </li>
          <li>
            <b>Robbing a kan.</b> You can win on the tile someone adds to a pon to make a kan (chankan). A closed kan can’t be robbed, not even for thirteen orphans.
          </li>
          <li>
            <b>Kan in riichi.</b> Only a closed kan of the tile you just drew, and only when it doesn’t change what the hand waits on or how it reads.
          </li>
          <li>No kan when the wall is empty, and nothing but ron on the last discard.</li>
        </ul>
      </Section>

      <Section id="riichi" title="Riichi">
        <ul>
          <li>
            You need a closed hand, tenpai, at least <span className={learn.num}>1,000</span> points, and at least four tiles left to draw. It costs a 1,000-point stick, which the next winner takes.
          </li>
          <li>The stick is paid only if the riichi discard isn’t won on.</li>
          <li>
            <b>Double riichi</b> is riichi on your first discard, if nobody has called. <b>Ippatsu</b> is winning before your next discard, unless anyone calls in between.
          </li>
          <li>After riichi, every draw you don’t win or kan on is discarded.</li>
        </ul>
      </Section>

      <Section id="winning" title="Winning and furiten">
        <p>
          You need at least one yaku to win, and dora aren’t yaku. A winning hand is four sets and a pair, or seven pairs, or thirteen orphans.
        </p>
        <h3>Furiten</h3>
        <p>You can’t win on a discard (you can still win by self-draw) when:</p>
        <ul>
          <li>any tile you’re waiting on is among your own discards, including ones other players took;</li>
          <li>a tile you were waiting on was discarded this go-around and you didn’t win on it, until your next discard;</li>
          <li>you’re in riichi and a tile you were waiting on went by: for the rest of the hand.</li>
        </ul>
        <h3>Several winners</h3>
        <p>
          If two or three players win on the same discard, every one of them is paid. There is no head bump, and no draw for three. Each gets the honba bonus, and the riichi sticks on the table go to the winner who is next in
          turn after the discarder.
        </p>
        <h3>Responsibility</h3>
        <p>
          If you feed the pon or open kan that completes a visible big three dragons or big four winds, you pay the whole of a self-drawn win, and half of a win on someone else’s discard.
        </p>
      </Section>

      <Section id="draws" title="Draws">
        <ul>
          <li>
            <b>Exhaustive draw</b> (the wall runs out). Players who are tenpai receive, and those who aren’t pay, 3,000 in total: a lone tenpai player gets 3,000, two get 1,500 each, three get 1,000 each, and the others pay
            that between them. If nobody or everybody is tenpai, no points move. Waiting only on tiles you hold all four of isn’t tenpai. Tenpai hands are shown.
          </li>
          <li>
            <b>Nagashi mangan.</b> At an exhaustive draw, a player whose discards were all terminals and honors, and none of them called, is paid a mangan as if self-drawn, in place of the tenpai payments. It counts as a draw for
            the deal and the counters.
          </li>
          <li>
            <b>Abortive draws.</b> Nine different terminals and honors in your first draw with no calls before it (your choice); the same wind discarded by all four on the first go-around; all four in riichi; four kans by more
            than one player. No points move; the dealer stays and a counter is added.
          </li>
        </ul>
      </Section>

      <Section id="scoring" title="Yaku and scoring">
        <p>
          The patterns are on <Link href="/games/mahjong/learn/yaku">the yaku page</Link>, each with its han open and closed. Open hands lose one han where marked, and can’t use the ones marked closed. Every yakuman is worth
          one limit, and different yakuman in one hand add up. There are no double yakuman for special waits. 13 han or more from ordinary yaku and dora counts as a yakuman (kazoe). Not used: renhou, open riichi, local yaku,
          and rounding 4 han 30 fu up to mangan.
        </p>
        <h3>Fu</h3>
        <ul>
          <li>Every hand starts at 20.</li>
          <li>+10 for a closed win on a discard. +2 for a self-draw (not with pinfu).</li>
          <li>+2 for a pair of dragons, your seat wind or the round wind (+4 when it is both winds). +2 for an edge, middle or single-tile wait.</li>
          <li>Triplets: 2 open, 4 closed, doubled for terminals and honors. Kans are four times a triplet. A triplet finished by ron counts as open.</li>
          <li>An open hand worth only 20 counts as 30. Seven pairs is 25. Round up to the next 10.</li>
        </ul>
        <h3>Points</h3>
        <p>
          Base points = fu × 2<sup>han + 2</sup>, capped at the limits below. A non-dealer’s ron pays base × 4, a dealer’s base × 6. On a self-draw the dealer pays base × 2 and the others base × 1 (everyone pays a dealer base × 2).
          Each payment rounds up to the next 100. The hand is read whichever way scores most.
        </p>
        <div className={learn.scroll}>
          <table className={learn.facts}>
            <thead>
              <tr>
                <th>Limit</th>
                <th>When</th>
                <th className={learn.n}>Base</th>
                <th className={learn.n}>Non-dealer ron</th>
                <th className={learn.n}>Dealer ron</th>
                <th className={learn.n}>Non-dealer draw</th>
                <th className={learn.n}>Dealer draw</th>
              </tr>
            </thead>
            <tbody>
              {LIMIT_ORDER.filter((key) => key !== "kazoe").map((key) => {
                const base = LIMITS[key].base;
                return (
                  <tr key={key}>
                    <td>{LIMITS[key].name}</td>
                    <td>{key === "yakuman" ? "A yakuman hand, or 13 han or more" : LIMITS[key].when}</td>
                    <td className={learn.n}>{fmtInteger(base)}</td>
                    <td className={learn.n}>{fmtInteger(base * 4)}</td>
                    <td className={learn.n}>{fmtInteger(base * 6)}</td>
                    <td className={learn.n}>
                      {fmtInteger(base * 2)} / {fmtInteger(base)}
                    </td>
                    <td className={learn.n}>{fmtInteger(base * 2)} each</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p>
          <b>Honba:</b> 300 per counter on a ron, 100 from each player on a self-draw.
        </p>
      </Section>

      <Section id="table" title="The table">
        <ul>
          <li>
            <b>The server deals with everything.</b> It holds the wall and every hand. Your client sends what you want to do (discard this tile, call, pass) and the server checks it against the legal moves. A result never
            comes from a client.
          </li>
          <li>
            <b>What you see.</b> A player gets their own hand, their own legal moves and the public table: discards, calls, dora indicators, scores, riichi, how many tiles are left. Everyone else’s hand is just a count.
            Hands are shown when the rules show them (a win, tenpai at a draw). The full record, every hand and the seed, is published when the game is over.
          </li>
          <li>
            <b>The clock.</b> Each move gets a few seconds plus a time bank that refills every hand. Standard: <span className={learn.num}>{standard ? `${standard.turn} s and ${standard.bank} s` : dash}</span>. Relaxed:{" "}
            <span className={learn.num}>{relaxed ? `${relaxed.turn} s and ${relaxed.bank} s` : dash}</span>. Practice against bots and the guided hands are untimed. When the clock runs out the drawn tile is discarded and calls are passed.
          </li>
          <li>
            <b>Away seats.</b> Two timeouts in a row, or leaving, puts the seat on autopilot until the player acts again. On free tables autopilot is a bot. On paid tables it only discards what it draws, so walking away can
            never beat playing.
          </li>
          <li>
            <b>Reconnecting</b> is just loading the page: your seat’s view is the whole state.
          </li>
          <li>
            <b>Bots</b> fill empty seats on free tables, at three levels (easy, normal, hard). They play from what a player in that seat could see. A table that started with a bot seat never pays anyone anything.
          </li>
          <li>
            <b>Restarts.</b> Tables live in the memory of the game server. Games that are unfinished when it restarts are cancelled and their entry fees refunded.
          </li>
        </ul>
      </Section>

      <Section id="play" title="Ways to play, rating and seasons">
        <div className={learn.scroll}>
          <table className={learn.facts}>
            <thead>
              <tr>
                <th>Kind</th>
                <th>Seats</th>
                <th>Rated</th>
                <th>Money</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Guided hands, practice</td>
                <td>You and three bots</td>
                <td>No</td>
                <td>None</td>
              </tr>
              <tr>
                <td>Quick match</td>
                <td>Open seats; bots fill after {rules ? `${rules.bot_fill_seconds} seconds` : dash} of waiting</td>
                <td>Yes</td>
                <td>None</td>
              </tr>
              <tr>
                <td>Friend room</td>
                <td>By link; the host starts, bots optional</td>
                <td>No</td>
                <td>None</td>
              </tr>
              <tr>
                <td>Stakes table</td>
                <td>Four players, no bots</td>
                <td>Yes</td>
                <td>An entry fee into a fixed prize table</td>
              </tr>
              <tr>
                <td>Tournament table</td>
                <td>Set by the bracket</td>
                <td>Yes</td>
                <td>The tournament’s</td>
              </tr>
            </tbody>
          </table>
        </div>
        <h3>Rating and ranks</h3>
        <p>
          Everyone starts each season on <span className={learn.num}>1,500</span>. After a rated game your rating moves by how you placed against each of the other three, by less once you have played 30 games. Bots have fixed
          ratings
          {rules ? (
            <>
              {" "}
              (easy <span className={learn.num}>{fmtInteger(rules.bot_ratings.easy)}</span>, normal <span className={learn.num}>{fmtInteger(rules.bot_ratings.normal)}</span>, hard <span className={learn.num}>{fmtInteger(rules.bot_ratings.hard)}</span>)
            </>
          ) : null}{" "}
          and theirs never move. That means beating bots stops paying once you’re rated above them, and losing to them costs more the higher they are.
        </p>
        <p>
          You get a rank after {rules ? rules.ranked_after_games : dash} rated games in a season. Ranks are names for rating bands:
          {rules ? (
            <>
              {" "}
              {rules.ranks.map((rank, index) => (
                <span key={rank.key}>
                  {index ? ", " : ""}
                  {rank.name} (<span className={learn.num}>{rank.min === 0 ? "below 1,400" : `${fmtInteger(rank.min)}+`}</span>)
                </span>
              ))}
              .
            </>
          ) : (
            <> {dash}</>
          )}
        </p>
        <p>
          <b>Seasons</b> are calendar months, New York time{data ? <> (this one is {data.season})</> : null}. A new season starts each player halfway back to 1,500.
        </p>
        <h3>Tournaments</h3>
        <p>
          Staff create them: a name, seats (4, 8 or 16), a start time, a game length, an entry fee (or none) and optionally a weekly repeat. Sign-up is open until the start. It’s a knockout: four to a table, the top two go
          through, down to one final table. Seats nobody took are filled by bots, and a tournament with a bot in it is free: every fee is refunded and no prize is paid.
        </p>
        {failed ? <p className={learn.error}>The numbers on this page come from the server, and they couldn’t load. Reload to try again.</p> : null}
      </Section>

      <Section id="watching" title="Watching">
        <ul>
          <li>Anyone, signed in or not, can open a live table. Spectators see the public table with no delay. They are never sent a hidden tile, so there’s nothing a spectator could pass to a player.</li>
          <li>
            Signed-in, verified viewers can send reactions and talent stamps from a fixed list, cheer a seat, and pick who wins the game (free, before the second hand starts). Picks are counted on a leaderboard and never pay.
          </li>
          <li>Replays open to everyone once a game is over: every hand, every move, all four hands face up, and the seed.</li>
        </ul>
      </Section>

      <Section id="money" title="Money">
        <p>
          Mahjong follows the rules every side game does: <b>Credit only, never Cash</b>; no spending while your net worth is under {rules ? dollars(rules.min_net_worth) : dash}; no spending while you’re in the red. A table of four
          adds one more problem, two players agreeing to lose to each other, so these rules are tighter:
        </p>
        <ul>
          <li>
            <b>Only entry fees and fixed prizes.</b> Points are never worth money. A stakes table pays by finishing place, as a multiple of the fee: first to fourth, {rules ? multiples : dash}. The four fees make the pot, and what the prizes leave of it is a cut that leaves circulation.
          </li>
          <li>
            <b>A weekly cap, up or down.</b> Your net result from mahjong for the week (Saturday 00:00 New York, like blackjack) stays within what your Credit converts to Cash at a review: {rules ? percent(rules.weekly_rate) : dash}{" "}
            of it or {rules ? dollars(rules.weekly_minimum) : dash}, whichever is more. Sitting down needs room for the fee on the way down and for first prize on the way up, counting fees already out. It’s its own budget,
            separate from blackjack’s.
          </li>
          <li>
            <b>Paid games a day:</b> {rules ? rules.paid_games_per_day : dash}.
          </li>
          <li>
            <b>Who may pay.</b> A verified email and an account as old as staking Credit on a duel needs.
          </li>
          <li>
            <b>Same network.</b> You can’t sit at a paid table, or enter a paid tournament, with an account that has shared a network address with yours.
          </li>
          <li>
            <b>Bots never pay.</b> Paid tables need four players. A tournament that needs a bot turns free.
          </li>
          <li>
            <b>Tournament prizes</b> are a fixed split of the fees less a {cut} cut
            {rules ? <> (first {percent(rules.tournament_prize_shares[0] ?? 0)}, second {percent(rules.tournament_prize_shares[1] ?? 0)}, third {percent(rules.tournament_prize_shares[2] ?? 0)}, fourth {percent(rules.tournament_prize_shares[3] ?? 0)} of what’s left)</> : null}
            . First prize, less the fee, can’t be more than the weekly minimum cap, or the tournament can’t be created.
          </li>
        </ul>
        <h3>Stakes tables</h3>
        {rules ? (
          <div className={learn.scroll}>
            <table className={learn.facts}>
              <thead>
                <tr>
                  <th className={learn.n}>Entry fee</th>
                  <th className={learn.n}>Pot</th>
                  <th className={learn.n}>1st</th>
                  <th className={learn.n}>2nd</th>
                  <th className={learn.n}>3rd</th>
                  <th className={learn.n}>4th</th>
                  <th className={learn.n}>Cut</th>
                </tr>
              </thead>
              <tbody>
                {rules.stakes.map((tier) => (
                  <tr key={tier.fee}>
                    <td className={learn.n}>{dollars(tier.fee)}</td>
                    <td className={learn.n}>{dollars(tier.pot)}</td>
                    {[0, 1, 2, 3].map((place) => (
                      <td key={place} className={learn.n}>
                        {dollars(tier.prizes[place] ?? 0)}
                      </td>
                    ))}
                    <td className={learn.n}>{dollars(tier.cut)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p>{failed ? "The table couldn’t load." : "Loading the fees…"}</p>
        )}
        <p>
          Everything else you earn at mahjong isn’t money: rating and rank, titles, a record on your profile, your name on a leaderboard and a headline on the Wire.
        </p>
      </Section>
    </LearnFrame>
  );
}
