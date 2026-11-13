"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { SceneArt } from "@/app/components/common/scene-art";
import { StockChip } from "@/app/components/common/stock-chip";
import { GAMES, SECTIONS, type SectionId } from "@/app/components/how-to-play/content";
import { ChibiTag, PoolDemo, PullDiagram, RarityFan, TalentStrip, TicketDemo, TickTimeline, useBusiestTalents } from "@/app/components/how-to-play/demos";
import { TickKoma } from "@/app/components/how-to-play/tick-koma";
import { GamesDiagram, MarketDiagram, PredictionsDiagram, TradingDiagram } from "@/app/components/how-to-play/diagrams";
import styles from "@/app/components/how-to-play/how-to-play.module.scss";
import { Term } from "@/app/components/common/tip";
import { useFeature } from "@/app/lib/features";

// ── Building blocks ─────────────────────────────────────────────────────────

type SectionProps = {
  id: SectionId;
  title: string;
  lede: ReactNode;
  art?: string;
  /** Per-talent art that replaces the `_shared` image when a talent has it (see SceneArt). */
  talentArt?: string;
  /** Drawn diagram for the art slot (a `_shared` image for the slot still replaces it). */
  diagram?: ReactNode;
  links?: Array<{ href: string; label: string }>;
  children: ReactNode;
};

export function Section({ id, title, lede, art, talentArt, diagram, links, children }: SectionProps) {
  const index = SECTIONS.findIndex((section) => section.id === id);
  return (
    <section id={id} className={styles.section} aria-labelledby={`${id}-title`}>
      <div className={styles.sectionHead} data-art={art ? "true" : undefined}>
        <div className={styles.sectionCopy}>
          <span className={styles.sectionKicker}>
            {String(index + 1).padStart(2, "0")} · {SECTIONS[index]?.label}
          </span>
          <h2 id={`${id}-title`}>{title}</h2>
          <div className={styles.sectionLede}>{lede}</div>
          {links?.length ? (
            <div className={styles.deepLinks}>
              {links.map((link) => (
                <Link key={link.href} href={link.href}>
                  {link.label} →
                </Link>
              ))}
            </div>
          ) : null}
        </div>
        {art ? <SceneArt slot={art} talentSlot={talentArt} className={`${styles.sectionArt} ${diagram ? styles.sectionDiagram : ""}`} width={520} fallback={diagram} /> : null}
      </div>
      {children}
    </section>
  );
}

export function Rules({ items, cols }: { items: Array<{ k: string; title: string; body: ReactNode }>; cols?: 2 | 3 | 4 }) {
  return (
    <ul className={styles.rules} data-cols={cols}>
      {items.map((item) => (
        <li key={item.title}>
          <span className={styles.ruleKey}>{item.k}</span>
          <h3>{item.title}</h3>
          <p>{item.body}</p>
        </li>
      ))}
    </ul>
  );
}

function Steps({ items }: { items: Array<{ title: string; body: ReactNode }> }) {
  return (
    <ol className={styles.flow}>
      {items.map((item, index) => (
        <li key={item.title}>
          <span className={styles.flowNum} aria-hidden="true">
            {index + 1}
          </span>
          <div>
            <h3>{item.title}</h3>
            <p>{item.body}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

function SubHead({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className={styles.subHead}>
      <h3>{children}</h3>
      {aside}
    </div>
  );
}

// ── 01 Market ───────────────────────────────────────────────────────────────

export function MarketSection() {
  return (
    <Section
      id="market"
      title="Talents are stocks"
      art="howto-market"
      diagram={<MarketDiagram />}
      lede={
        <>
          <p>
            Every listed hololive talent has a ticker. The price is whatever players pay for it, but underneath there&apos;s a <b>fair value</b>{" "}built from their real
            YouTube channel. Big streams count too: a 3D live, a new outfit or an original song lifts fair value for a day. Prices wander on hype, and four
            times a day they get dragged back toward what the numbers say.
          </p>
          <p>You win by owning the right talents before everyone else figures it out.</p>
        </>
      }
      links={[
        { href: "/market", label: "Open the market" },
        { href: "/stocks", label: "All stocks" },
        { href: "/market/report", label: "Daily report" },
      ]}
    >
      <SubHead aside={<Link href="/stocks">screener →</Link>}>Busiest on the floor right now</SubHead>
      <TalentStrip />
      <Rules
        cols={4}
        items={[
          {
            k: "hidden",
            title: "Fair value",
            body: "Repriced every morning from subscribers, recent views against their usual, sub growth and upload streaks. Quiet channels get marked down. It moves 25% a day at most, and you never see the exact number.",
          },
          {
            k: "live",
            title: "Price",
            body: "Every buy pushes the price up and every sell pushes it down. Most of that push fades within hours; a little of it sticks around for days.",
          },
          {
            k: "supply",
            title: "Shares can sell out",
            body: "Each talent has max shares, reset every Saturday from their subscriber count. Buying takes shares from the broker, selling gives them back. When nothing's left for sale, buys wait for a seller.",
          },
          {
            k: "score",
            title: "Net worth",
            body: "Your cash, your Credit and your shares at the current price. It's what the leaderboard ranks, over a day, a week and all time.",
          },
        ]}
      />
    </Section>
  );
}

// ── 02 Trading ──────────────────────────────────────────────────────────────

export function TradingSection() {
  return (
    <Section
      id="trading"
      title="Orders fill in batches"
      art="howto-trading"
      diagram={<TradingDiagram />}
      lede={
        <p>
          There&apos;s no instant fill on stocks. Your order joins a queue, and every 10 minutes (:00, :10, :20…) the whole queue fills at once, first in, first filled.
          Every fill nudges the price, so being early in a batch matters.
        </p>
      }
      links={[
        { href: "/stocks", label: "Pick a talent" },
        { href: "/market/activity", label: "Your pending orders" },
      ]}
    >
      <div className={styles.split}>
        <Steps
          items={[
            { title: "Pick a talent, hit BUY or SELL", body: "Type a share count. Sells need shares you actually own: no shorting." },
            { title: "Wait for the batch", body: "The ticket shows which batch you're in. Cancel from Activity any time before it runs." },
            {
              title: "It fills at the price then",
              body: "Buys pay the ask, sells get the bid. Big orders slip a little further, and there's a 1% fee both ways.",
            },
            {
              title: "Buys hold their cash",
              body: "Queuing a buy sets its cost aside, with a little extra in case the price moves, and the fill gives back what it didn't use. If the price jumps past that and your spare cash, the order is turned down and you get it all back.",
            },
          ]}
        />
        <TicketDemo />
      </div>
      <Rules
        cols={3}
        items={[
          { k: "1%", title: "Fee on every fill", body: "Taken on buys and sells. Round trips cost you 2%, so churning bleeds." },
          { k: "180 sh", title: "Per tick window", body: "You can queue up to 180 shares between two ticks, buys and sells together." },
          {
            k: "09:00",
            title: "Market closed?",
            body: "Trading pauses while the daily settlement runs around 09:00 ET (and if admins ever halt it). Queued orders wait and fill in the first batch after it reopens; new orders can't be placed until then.",
          },
        ]}
      />
    </Section>
  );
}

// ── 03 Ticks ────────────────────────────────────────────────────────────────

export function TicksSection() {
  const [first, second] = useBusiestTalents(2);
  const tickReasons = useFeature("tick-reasons");
  return (
    <Section
      id="ticks"
      title="Four ticks a day"
      lede={
        <>
          <p>
            At <b>Open 09:00</b>, <b>Lunch 15:00</b>, <b>Late 21:00</b>{" "}and <b>Overnight 03:00</b>{" "}(New York time), every talent&apos;s price gets pulled toward their fair
            value. Trading above fair? The tick drags it down. Below? It gets yanked up.
          </p>
          <p>
            Each talent draws four random pull strengths a day that add up to 200%. A 30% tick closes 30% of the gap; a 120% tick overshoots right past fair value. That&apos;s why
            people buy dips right before a tick.
          </p>
        </>
      }
      links={[
        { href: "/market/report", label: "See today's ticks" },
      ]}
    >
      <TickKoma className={styles.ticksBand} />
      <TickTimeline />
      <div className={styles.pulls}>
        <div className={styles.pullCard} data-tone="up">
          {first ? <ChibiTag asset={first} pose="hype" width={140} /> : <span className={styles.pullArtEmpty} />}
          <div>
            <span className={styles.ruleKey}>under fair</span>
            <h3>Pulled up</h3>
            <p>Price below what the channel is worth. The tick lifts it.</p>
            <PullDiagram direction="up" />
          </div>
        </div>
        <div className={styles.pullCard} data-tone="down">
          {second ? <ChibiTag asset={second} pose="cope" width={140} /> : <span className={styles.pullArtEmpty} />}
          <div>
            <span className={styles.ruleKey}>over fair</span>
            <h3>Pulled down</h3>
            <p>Hype ran ahead of the numbers. The tick lets the air out.</p>
            <PullDiagram direction="down" />
          </div>
        </div>
      </div>
      <Rules
        cols={3}
        items={[
          { k: "09:00 ET", title: "Settlement", body: "Once a day, fair values reprice from the latest YouTube numbers and each stock draws its four tick strengths. The Open tick lands the same hour." },
          { k: "per talent", title: "Your stock's next tick", body: `Every stock page shows the next scheduled tick and what the last one did${tickReasons ? ", with what moved it" : ""}.` },
          { k: "trades", title: "Between ticks", body: "Prices only move when players trade. The four ticks are the tide; the trades are the waves." },
        ]}
      />
    </Section>
  );
}

// ── Weekly evaluation ───────────────────────────────────────────────────────

export function WeeklySection() {
  const oshiProtection = useFeature("oshi-protection");
  const dividendSpotlight = useFeature("dividend-spotlight");
  return (
    <Section
      id="weekly"
      title="Saturday: dividends"
      lede={
        <>
          <p>
            Every <b>Saturday at 00:00</b>{" "}New York time the market takes stock. Each channel&apos;s week is ranked against every other channel on a bell curve. The best weeks pay a{" "}
            <Term k="dividend">dividend</Term> on every share you hold; the worst charge a <b>share fee</b>. The middle pays nothing. Never more than 10% of the stock&apos;s value either way.
          </p>
          <p>
            Dividends are paid in <Term k="credit">Credit</Term>. Fees come out of your Credit first, then your cash, even if that takes your cash below zero. With cash below zero, you
            can&apos;t buy until you sell something or earn it back. Pick your bags like it matters. The same night, part of everyone&apos;s Credit turns into cash: 5%, or $10k if that&apos;s more.
          </p>
          {oshiProtection ? (
            <p>
              <b>Your oshi never charges you a fee</b> on the shares you held all week (the fewest you held at any point since the last Saturday), as long as they were
              your oshi all week. New account? Your first pick counts as held all week at its first Saturday, so every share of it you hold that night skips the fee. A good week still pays a
              dividend on every share. Your oshi can change once every 30 days; your first pick is free.
            </p>
          ) : null}
          <p>
            <b>Nothing left to trade with?</b> If the review ends with you holding no shares, with no Credit left to turn into cash and too little cash to buy the cheapest share, you get a{" "}
            <Term k="bailout">bailout</Term>: your cash goes up to $1,000, clearing anything fees took below zero, and you get $1,000 Credit. You need a verified email and a visit to the site in
            the last two weeks.
          </p>
          {dividendSpotlight ? (
            <p>
              <b>After each review,</b> Home shows your week for a few days, and <Link href="/market/dividends">the Dividend Review</Link> has every stock. The{" "}
              <Link href="/leaderboard?tab=dividends">Dividends leaderboard</Link> ranks everyone from the most earned down to the highest fees.
            </p>
          ) : null}
        </>
      }
      links={[{ href: "/market/dividends", label: "The Dividend Review" }]}
    >
      <Rules
        cols={3}
        items={[
          { k: "dividends", title: "Good weeks pay", body: "A channel whose numbers grew faster than the rest of the market this week pays you per share. It's a race against every other channel, every week." },
          { k: "share fees", title: "Bad weeks cost", body: "A channel that slipped against the rest charges holders per share. Holding a stock through a dead week costs you." },
          { k: "max shares", title: "Supply resets", body: "Max shares reset from subscriber count: bigger channels, more shares. A stock can go from plenty for sale to sold out overnight." },
          {
            k: "buyback",
            title: "Too many shares",
            body: "If max shares drop below what players hold, the stock freezes: no buys, no ticks. The broker buys at 120% of the frozen price, 10 points less each day.",
          },
          { k: "forced", title: "Or else", body: "Whatever's still over at the next Saturday, the broker takes from every holder in proportion, at the base rate." },
          { k: "the review", title: "Dividend Review", body: "Every payout, fee, max-share change and buyback, stock by stock, plus your own week, on the Market page." },
        ]}
      />
    </Section>
  );
}

// ── 04 Games ────────────────────────────────────────────────────────────────

export function GamesSection() {
  return (
    <Section
      id="games"
      title="The arcade"
      art="howto-games"
      diagram={<GamesDiagram />}
      lede={
        <>
          <p>
            Every game spends <Term k="credit">Credit</Term> and never your cash. Games, bets and buying cards close while your net worth is under $50,000 or you’re <Term k="in-the-red">in the red</Term>{" "}on margin; free cards and selling your cards stay open. Winnings come back as Credit; refunds go back where they came
            from. The server rolls every result, rates are posted on each game, and multiplayer stakes sit in escrow until the hand is done.
          </p>
          <p>Open tables can be watched by anyone, even signed out. Hidden picks stay hidden until the reveal.</p>
        </>
      }
      links={[
        { href: "/games", label: "Open the arcade" },
        { href: "/games/collection", label: "Your collection" },
      ]}
    >
      <SubHead aside={<Link href="/games/cards">pull →</Link>}>One talent, five rarities</SubHead>
      <RarityFan />
      <ul className={styles.games}>
        {GAMES.map((game) => (
          <li key={game.key} className={styles.game}>
            <div className={styles.gameTop}>
              <h3>
                <Link href={game.href}>{game.name}</Link>
              </h3>
              <span className={styles.gamePrice}>{game.price}</span>
            </div>
            <p className={styles.gameLine}>{game.line}</p>
            <ul className={styles.gameRules}>
              {game.rules.map((rule) => (
                <li key={rule}>{rule}</li>
              ))}
            </ul>
            <Link href={game.href} className={styles.gameGo}>
              Play →
            </Link>
          </li>
        ))}
        <li className={`${styles.game} ${styles.gameLocker}`}>
          <div className={styles.gameTop}>
            <h3>
              <Link href="/games/item-locker">Locker</Link>
            </h3>
            <span className={styles.gamePrice}>free</span>
          </div>
          <p className={styles.gameLine}>Where your cosmetics and trophies live.</p>
          <ul className={styles.gameRules}>
            <li>Equip a hat, a frame and chat flair</li>
            <li>They show next to your name across the site</li>
            <li>Anyone can visit your locker from your profile</li>
          </ul>
          <Link href="/games/item-locker" className={styles.gameGo}>
            Open →
          </Link>
        </li>
      </ul>
    </Section>
  );
}

// ── 05 Predictions ──────────────────────────────────────────────────────────

export function PredictionsSection() {
  return (
    <Section
      id="predictions"
      title="Winners split the pot"
      art="howto-predictions"
      diagram={<PredictionsDiagram />}
      lede={
        <>
          <p>
            Prediction <Term k="pool">pools</Term> ask a question about hololive or the market, with 2 to 100 options to pick from. Everyone’s bets go in one pot. When the result is called, the winners
            split the whole pot by how much each of them put in. There’s no rake and no house on the other side: players pay players.
          </p>
          <p>
            The <Term k="odds">odds</Term> are just the bets so far. <b>3.00×</b>{" "}on an option means every $1 on it pays $3 if it wins and the pool closed right then, and they move with every bet until
            betting closes.
          </p>
        </>
      }
      links={[
        { href: "/predictions", label: "Open the floor" },
        { href: "/predictions/portfolio", label: "Your bets" },
        { href: "/predictions/history", label: "Finished pools" },
      ]}
    >
      <div className={styles.split}>
        <PoolDemo />
        <Steps
          items={[
            { title: "Pick an option and bet", body: "$1,000 of Credit or more (a bookie can ask for more). Bets spend Credit and never your cash, and they need a verified email. Accounts under 7 days old can have $10,000 in open pools." },
            { title: "Raise it while it's open", body: "Add to your bet or back another option. Bets can't be withdrawn. The slip shows what yours would pay if the pool closed right after it, and the odds keep moving." },
            { title: "Betting closes", body: "At the time on the pool, or sooner if the bookie closes it early. A bookie can reopen one they closed early, once, until its closing time. Auto pools shut before the answer can be known: stream pools before the stream starts, tick pools 5 minutes before the tick." },
            { title: "The result gets called", body: "A bookie calls their own pool with a source link or a note, and auto pools call themselves from NASFAQ data. Admins can call or void any pool. Other staff can't call, correct or void a pool they have money in." },
            { title: "Winners get paid", body: "Right away, in Credit, by their share of the winning side. If nobody backed the winner, every bet comes back." },
          ]}
        />
      </div>
      <Rules
        cols={4}
        items={[
          { k: "bookies", title: "Who runs them", body: "Bookies are players with the role. Their pools open straight away, and they can close, reopen, extend or void one that hasn't been called. They can't bet in their own." },
          { k: "7 days", title: "If a call is wrong", body: "Staff can correct or void a result for 7 days. A correction takes back what the first result paid, from Credit, even below zero, then pays the right side. A void gives every bet back." },
          { k: "public", title: "On the record", body: "Who bet what is public, and so is every early close, reopen, call, correction and void, with who made it and the source or reason. Pool history lists every finished pool and how you did." },
          { k: "net worth", title: "While it rides", body: "Money in an open pool isn't in your net worth until it pays out. Bets close while your net worth is under $50,000." },
        ]}
      />
      <SubHead>Margin: betting more than you have</SubHead>
      <Rules
        cols={4}
        items={[
          { k: "25%", title: "The line", body: "Out of Credit? A pool bet can borrow the rest, up to 25% of what your shares are worth and $100,000 at most. You tick the box on the slip each time. It takes an account 7 days old and a verified email." },
          { k: "below $0", title: "In the red", body: "Borrowing takes your Credit below zero, and that's what you owe. It counts against your net worth. Until it's paid back you can't bet, play games, pull capsules or buy cards." },
          { k: "repay", title: "Paying it back", body: "Any Credit that comes in goes toward it: winnings, dividends, achievements, the little a share sale earns. Cash never repays it. There's no interest, and nothing gets sold for you." },
          { k: "stocks", title: "Stocks stay open", body: "Margin never touches your cash, and in the red you can still buy and sell shares. If a pool you borrowed for is voided, the void cancels that debt." },
        ]}
      />
      <p className={styles.worked}>
        <b>For example:</b>{" "}you have $2,000 Credit, $5,000 cash and $80,000 in shares, so your line is $20,000. You bet $15,000: $2,000 comes from Credit and $13,000 is borrowed, which leaves Credit at <span className={styles.nowrap}>−$13,000</span>{" "}and cash
        at $5,000. Win $30,000 and Credit lands at +$17,000. Lose, and you’re <Term k="in-the-red">in the red</Term>{" "}until $13,000 of Credit comes in.
      </p>
    </Section>
  );
}

// ── 06 Community ────────────────────────────────────────────────────────────

export function CommunitySection() {
  const [a, b] = useBusiestTalents(2);
  const oshiProtection = useFeature("oshi-protection");
  const checkin = useFeature("daily-checkin");
  const calendar = useFeature("stream-calendar");
  const invites = useFeature("referrals");
  const oshiWire = useFeature("oshi-wire");
  return (
    <Section
      id="community"
      title="The floor talks"
      art="howto-community"
      talentArt="floor"
      lede={
        <p>
          Half the game is the people. Shill your oshi in chat, write the due diligence, argue on the stock pages, and climb a leaderboard that everyone can see.
          {a && b ? (
            <>
              {" "}
              Tickers like <StockChip symbol={a.symbol} /> and <StockChip symbol={b.symbol} /> link straight to their stock page everywhere.
            </>
          ) : null}
        </p>
      }
      links={[
        { href: "/chat", label: "Chat" },
        { href: "/leaderboard", label: "Leaderboard" },
        { href: "/articles", label: "Articles" },
      ]}
    >
      <Rules
        cols={3}
        items={[
          { k: "/chat", title: "Chat", body: "Rooms for the whole market, each unit and each talent. Your oshimark and flair ride next to your name." },
          { k: "stocks", title: "Stock comments", body: "Every stock page has a comment board where you tag your mood: Bullish, Bearish, Diamond Hands, Dump Eet… Read the room before you buy." },
          {
            k: "/articles",
            title: "HoloNews & articles",
            body: "Headlines import on their own. Anyone can draft the full story, players vote, and an editor picks the official version. Or write your own DD.",
          },
          { k: "/profile", title: "Profile", body: "Bio, color, your oshi, a showcase of five cards, your locker, badges and trade history." },
          {
            k: "oshi",
            title: "Oshi & oshiboards",
            body: oshiProtection
              ? "Pick your oshi on your profile: their shares you hold all week skip Saturday's share fee. Make them your biggest bag too and you're ranked on their oshiboard by shares held."
              : "Pick your oshi on your profile. Make them your biggest bag too and you're ranked on their oshiboard by shares held.",
          },
          { k: "/leaderboard", title: "Leaderboard", body: "Net worth over a day, a week or all time. Filter to friends and rivals, or flip to a talent's oshiboard." },
          {
            k: "badges",
            title: "Achievements",
            body: "Pay Credit: $100 for your first fill, $250 at 10 trades, $1,000 at 100, $300 for trading 3 talents, and $150 / $500 / $2,500 for 3, 7 and 30-day streaks.",
          },
          ...(checkin
            ? [
                {
                  k: "check-in",
                  title: "Daily check-in",
                  body: "Check in on the front page once a day for $50 Credit, or $100 while you're on a trading streak (you traded yesterday). Days turn over at 00:00 ET.",
                },
              ]
            : []),
          ...(invites
            ? [
                {
                  k: "invites",
                  title: "Invite friends",
                  body: "Your profile has your invite link. When a friend signs up through it and makes their first stock trade, you each get $250 and 2,500 Credit, up to 3 times a week. Accounts that have used the same network don't count.",
                },
              ]
            : []),
          {
            k: "/wire",
            title: "The Wire",
            body: `Headlines as they happen: big price moves, sell-outs, buybacks, records, rare pulls, card sales, called pools and IPOs${oshiWire ? ", and who changed their oshi" : ""}.`,
          },
          { k: "/threads", title: "/vt/ threads", body: "The general, mirrored, with tickers linked. Lurk the source." },
          { k: "/livestreams", title: "Livestreams", body: `Who's on air right now, with viewer counts${calendar ? ", and a calendar of what's coming up" : ""}.` },
        ]}
      />
    </Section>
  );
}
