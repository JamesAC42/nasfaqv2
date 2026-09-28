"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { SceneArt } from "@/app/components/common/scene-art";
import { StockChip } from "@/app/components/common/stock-chip";
import { GAMES, SECTIONS, type SectionId } from "@/app/components/how-to-play/content";
import { ChanceDemo, ChibiTag, PullDiagram, RarityFan, TalentStrip, TicketDemo, TickTimeline, useBusiestTalents } from "@/app/components/how-to-play/demos";
import { TickKoma } from "@/app/components/how-to-play/tick-koma";
import { GamesDiagram, MarketDiagram, PredictionsDiagram, TradingDiagram } from "@/app/components/how-to-play/diagrams";
import styles from "@/app/components/how-to-play/how-to-play.module.scss";

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
            title: "Float & treasury",
            body: "Each talent has a max supply. The treasury releases new shares every day, and faster when the stock trades above fair value. Hype gets diluted.",
          },
          {
            k: "score",
            title: "Net worth",
            body: "Your cash plus your shares at the current price. It's what the leaderboard ranks, over a day, a week and all time.",
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
            { title: "Cash is checked at the fill", body: "Short on cash or shares when the batch runs? The order is rejected and nothing is charged." },
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
            body: "Trading pauses while the daily settlement runs around 09:00 ET (and if admins ever halt it). Orders that come due then are rejected.",
          },
        ]}
      />
    </Section>
  );
}

// ── 03 Ticks ────────────────────────────────────────────────────────────────

export function TicksSection() {
  const [first, second] = useBusiestTalents(2);
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
        { href: "/predictions", label: "Bet on the next tick" },
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
          { k: "09:00 ET", title: "Settlement", body: "Once a day, fair values reprice from the latest YouTube numbers and the treasury prints the day's new shares. The Open tick lands the same hour." },
          { k: "per talent", title: "Your stock's next tick", body: "Every stock page shows the next scheduled tick and what the last one did." },
          { k: "trades", title: "Between ticks", body: "Prices only move when players trade. The four ticks are the tide; the trades are the waves." },
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
            Every game plays with the same cash you trade with. The server rolls every result, rates are posted on each game, and multiplayer stakes sit in escrow until
            the hand is done.
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
      title="Prices are chances"
      art="howto-predictions"
      diagram={<PredictionsDiagram />}
      lede={
        <>
          <p>
            Prediction markets ask yes-or-no (or which-one) questions about hololive and the market. A share pays <b>$1</b>{" "}if its outcome happens and <b>$0</b>{" "}if it
            doesn&apos;t, so a YES at 62¢ means the floor thinks it&apos;s 62% likely.
          </p>
          <p>A house market maker always quotes a price, so every trade fills instantly. Sell any time before the market closes.</p>
        </>
      }
      links={[
        { href: "/predictions", label: "Open the floor" },
        { href: "/predictions/portfolio", label: "Your bets" },
      ]}
    >
      <div className={styles.split}>
        <ChanceDemo />
        <Steps
          items={[
            { title: "Buy YES or NO", body: "Spend $1 up to $25,000. Your buy moves the price; prices stay between 1¢ and 99¢. 1% fee." },
            { title: "Or set a limit", body: "\"Buy YES while it's 40¢ or less, up to $200.\" It rests, reserving your cash, and fills when the price gets there." },
            { title: "Trading closes", body: "Resting orders are cancelled and their cash released. Now it waits for the answer." },
            {
              title: "The result gets called",
              body: "A resolver proposes the outcome with a source. Holders get a dispute window (12 h by default). No disputes and it's final.",
            },
            { title: "Winners get $1 a share", body: "Losing shares close at $0. If a market is voided, everyone gets back what they put in, fees included." },
          ]}
        />
      </div>
      <SubHead>Markets that open themselves</SubHead>
      <Rules
        cols={3}
        items={[
          { k: "every tick", title: "Tick calls", body: "\"Up on the Late tick?\" for the six busiest talents. Opens right after a tick, closes 5 minutes before the next." },
          { k: "every tick", title: "Top gainer", body: "Which of them moves most on the next tick, or \"someone else\". Settles on the biggest % move across the whole market." },
          { k: "live", title: "Stream peaks", body: "When a talent goes live: will the stream peak above their usual viewer count? Settles when the stream ends." },
        ]}
      />
    </Section>
  );
}

// ── 06 Community ────────────────────────────────────────────────────────────

export function CommunitySection() {
  const [a, b] = useBusiestTalents(2);
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
          { k: "/profile", title: "Profile", body: "Bio, colour, your oshi, a showcase of five cards, your locker, badges and trade history." },
          {
            k: "oshi",
            title: "Oshi & oshiboards",
            body: "Pick your oshi on your profile. Make them your biggest bag too and you're ranked on their oshiboard by shares held.",
          },
          { k: "/leaderboard", title: "Leaderboard", body: "Net worth over a day, a week or all time. Filter to friends and rivals, or flip to a talent's oshiboard." },
          {
            k: "badges",
            title: "Achievements",
            body: "Pay cash: $100 for your first fill, $250 at 10 trades, $1,000 at 100, $300 for trading 3 talents, and $150 / $500 / $2,500 for 3, 7 and 30-day streaks.",
          },
          { k: "/threads", title: "/vt/ threads", body: "The general, mirrored, with tickers linked. Lurk the source." },
          { k: "/livestreams", title: "Livestreams", body: "Who's on air right now, with viewer counts. Streams feed the stream-peak predictions." },
        ]}
      />
    </Section>
  );
}
