import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { SiteShell } from "@/app/components/layout/site-shell";
import styles from "@/app/rules/rules.module.scss";

export const metadata: Metadata = {
  title: "Community rules | NASFAQ",
  description: "How to behave on NASFAQ, the hololive fan stock market game: be decent, respect the talents, one account each, play fair, and how moderation and appeals work.",
};

// TODO(owner): where appeals and moderation questions go (a Discord channel or ticket link, or an
// email), with its link in href. The Usage policy (/terms#moderation) sends appeals to
// nasfaqsite@gmail.com today, so keep the two saying the same thing.
const APPEALS_CONTACT: { label: string; href?: string } = { label: "[contact channel]" };

const Contact = () =>
  APPEALS_CONTACT.href ? (
    <a href={APPEALS_CONTACT.href} target="_blank" rel="noopener noreferrer">
      {APPEALS_CONTACT.label}
    </a>
  ) : (
    <strong>{APPEALS_CONTACT.label}</strong>
  );

// The short version of /terms (#conduct, #fair-play, #play-money, #moderation). Keep it readable in
// two minutes; the legal detail belongs there. Anchor ids are linked from elsewhere, so keep them.
const RULES: Array<{ id: string; title: string; points: ReactNode[] }> = [
  {
    id: "decent",
    title: "Be decent",
    points: [
      <>No slurs, hate or harassment, and no threats or pile-ons. Roast the market, not the people in it.</>,
      <>No doxxing: don&apos;t share anyone&apos;s personal info, players included.</>,
    ],
  },
  {
    id: "talents",
    title: "Respect the talents",
    points: [
      <>NASFAQ is an unofficial fan game. It isn&apos;t affiliated with COVER Corp. or hololive production.</>,
      <>Don&apos;t harass VTubers, their staff or their chats, and don&apos;t organise raids from here.</>,
      <>Don&apos;t post their private info, guesses about who they are off stream, or leaks of members-only or paid content.</>,
      <>Talk about the numbers all you like. Leave the person alone.</>,
    ],
  },
  {
    id: "content",
    title: "Names and content",
    points: [
      <>No NSFW or offensive usernames, bios, banners, articles or comments.</>,
      <>Don&apos;t pretend to be a talent, NASFAQ staff or another player.</>,
      <>No spam, ads or referral links, and no made-up news meant to move a price.</>,
    ],
  },
  {
    id: "one-account",
    title: "One account per person",
    points: [
      <>No alts. Don&apos;t move Cash, Credit, cards or items between accounts you control, whether by trades, the exchange, wagers or anything else.</>,
    ],
  },
  {
    id: "fair-play",
    title: "Play fair",
    points: [
      <>No bots, scripts or macros, for trading or for the games (Ticker Tap and the rest included).</>,
      <>
        Found a bug? Don&apos;t use it. Tell us with <strong>Report a bug</strong> at the bottom of the page. Good-faith reports never get
        anyone in trouble.
      </>,
      <>No coordinated market manipulation: no fake trades between friends and no groups organised to pump and dump on other players. Hyping your oshi in chat is fine.</>,
    ],
  },
  {
    id: "play-money",
    title: "Play money only",
    points: [
      <>Cash and Credit have no real-world value, and neither does anything else in the game.</>,
      <>No buying or selling accounts, currency, cards or items for real money or anything outside the game.</>,
    ],
  },
  {
    id: "moderation",
    title: "How moderation works",
    points: [
      <>
        A few volunteer moderators review what gets reported. To report a chat message, open its <strong>⋯</strong> menu and choose{" "}
        <strong>Report message</strong>. For anything else, use <Contact />.
      </>,
      <>The usual ladder: a warning, then a chat mute, then a suspension, then a permanent ban.</>,
      <>Serious cases skip steps. Doxxing, hate, threats, bots and alts can go straight to a suspension or a ban.</>,
      <>Anything gained from a bug exploit or an alt gets taken back.</>,
      <>A suspended account can still sign in and look around, but can&apos;t trade, post, chat or play until the suspension ends.</>,
    ],
  },
  {
    id: "appeals",
    title: "Appeals and contact",
    points: [
      <>
        Think we got it wrong? Reach us at <Contact /> with your username and what happened, and someone will take another look.
      </>,
      <>Please don&apos;t argue it out in chat. It won&apos;t speed anything up.</>,
    ],
  },
];

const pad = (n: number) => String(n).padStart(2, "0");

export default function RulesPage() {
  return (
    <SiteShell>
      <article className={styles.page}>
        <header className={styles.head}>
          <h1>Community rules</h1>
          <p>
            NASFAQ is a fan game run by a few volunteers. These rules apply everywhere you can write: chat, comments, articles, news edits,
            profiles and usernames. The <Link href="/terms">Usage policy</Link> has the full version.
          </p>
        </header>
        <ol className={styles.rules}>
          {RULES.map((rule, index) => (
            <li key={rule.id} id={rule.id} className={styles.rule}>
              <span className={styles.num} aria-hidden="true">
                {pad(index + 1)}
              </span>
              <h2>{rule.title}</h2>
              <ul className={styles.points}>
                {rule.points.map((point, pointIndex) => (
                  <li key={pointIndex}>{point}</li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
        <nav className={styles.more} aria-label="More about the site">
          <span>Also read</span>
          <Link href="/terms">Usage policy</Link>
          <Link href="/privacy">Privacy Policy</Link>
          <Link href="/about">About</Link>
        </nav>
      </article>
    </SiteShell>
  );
}
