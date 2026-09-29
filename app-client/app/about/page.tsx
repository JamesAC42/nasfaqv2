import type { Metadata } from "next";
import Link from "next/link";
import { Ext, Fact, Facts, LegalPage, Mail, type LegalSection } from "@/app/components/legal/legal-page";

export const metadata: Metadata = {
  title: "About | NASFAQ",
  description: "NASFAQ is a fan-made stock market game about hololive VTubers: what it is, how it works, who runs it and where to find the community.",
};

const KOFI = "https://ko-fi.com/L3L446W4T";
const DISCORD = "https://discord.gg/Bw4S6EbBNW";

const sections: LegalSection[] = [
  {
    id: "what",
    title: "What NASFAQ is",
    body: (
      <>
        <p>
          NASFAQ is a stock market game about hololive VTubers. Every talent is a stock. You start with $10,000 of play
          money and trade them against everyone else, with prices that move on their channels&apos; real numbers and on
          what the other players buy and sell.
        </p>
        <p>It&apos;s play money all the way down: nothing here can be bought with, or cashed out for, real money.</p>
      </>
    ),
  },
  {
    id: "how",
    title: "How the market moves",
    body: (
      <>
        <ul>
          <li>Orders queue up and fill in 10-minute batches; the price is set when the batch runs.</li>
          <li>Four ticks a day pull every stock toward a target set by its channel: subscribers, views, uploads and big streams.</li>
          <li>Every Saturday the weekly evaluation pays dividends or charges share fees, resets each stock&apos;s max shares from its subscribers, and runs buybacks.</li>
        </ul>
        <p>
          The whole thing, with diagrams, is in <Link href="/how-to-play">How to play</Link>.
        </p>
      </>
    ),
  },
  {
    id: "whats-here",
    title: "What else is here",
    body: (
      <Facts>
        <Fact term={<Link href="/predictions">Predictions</Link>}>
          <p>Markets on what happens next: streams, milestones, the market itself. Buy the outcome you believe in.</p>
        </Fact>
        <Fact term={<Link href="/games">Games</Link>}>
          <p>Talent cards and a card exchange, the capsule machine for hats and flair, duels, blackjack, high-low and ticker tap.</p>
        </Fact>
        <Fact term={<Link href="/chat">Chat</Link>}>
          <p>A room for the whole market, one for each unit and one for every talent.</p>
        </Fact>
        <Fact term={<Link href="/articles">Articles</Link>}>
          <p>HoloNews headlines as they land, and what players write about them.</p>
        </Fact>
        <Fact term={<Link href="/livestreams">Livestreams</Link>}>
          <p>Who&apos;s live, who&apos;s up next, and how the talents on air are doing on the board.</p>
        </Fact>
      </Facts>
    ),
  },
  {
    id: "who",
    title: "Who runs it",
    body: (
      <>
        <p>
          NASFAQ is made by fans, for fans. It is not affiliated with, or endorsed by, COVER Corp. or hololive production.
          Talent names and likenesses belong to their owners.
        </p>
        <p>
          Channel numbers come from public YouTube data through the YouTube API. The <Link href="/privacy">Privacy Policy</Link> covers what we keep about
          you, and the <Link href="/terms">Usage policy</Link> has the house rules.
        </p>
      </>
    ),
  },
  {
    id: "community",
    title: "Community and support",
    body: (
      <Facts>
        <Fact term="Discord">
          <p>
            Bug reports, ideas and market talk: <Ext href={DISCORD}>join the Discord</Ext>.
          </p>
        </Fact>
        <Fact term="Ko-fi">
          <p>
            NASFAQ has no ads. If you&apos;d like to help with the servers, <Ext href={KOFI}>support it on Ko-fi</Ext>.
          </p>
        </Fact>
        <Fact term="Email">
          <p>
            Anything else, including account and data requests: <Mail />.
          </p>
        </Fact>
      </Facts>
    ),
  },
];

export default function AboutPage() {
  return (
    <LegalPage
      doc="about"
      title="About NASFAQ"
      intro={<p>A fan-made stock market for hololive: trade the talents, call what happens next, collect the cards, argue in chat.</p>}
      summaryTitle="In one breath"
      summaryNote={null}
      summary={[
        <>Every hololive talent is a stock. You start with <strong>$10,000 of play money</strong>.</>,
        <>Prices follow each channel&apos;s <strong>real growth</strong>, plus whatever the other players buy and sell.</>,
        <>Predictions, cards, capsules and games on the side. No real money, ever.</>,
        <>Fan-made. Not affiliated with COVER Corp.</>,
      ]}
      sections={sections}
    />
  );
}
