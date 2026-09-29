import type { Metadata } from "next";
import Link from "next/link";
import { Callout, Ext, LegalPage, Mail, type LegalSection } from "@/app/components/legal/legal-page";

export const metadata: Metadata = {
  title: "Usage Policy | NASFAQ",
  description:
    "The rules for playing NASFAQ: play money only, one account per person, fair play, community conduct, prediction markets and moderation.",
};

const YOUTUBE_TERMS = "https://www.youtube.com/t/terms";
const GOOGLE_PRIVACY = "https://policies.google.com/privacy";

const sections: LegalSection[] = [
  {
    id: "about",
    title: "About NASFAQ and these rules",
    body: (
      <>
        <p>
          NASFAQ is a <strong>fan-made game</strong> about hololive VTubers. It is <strong>not affiliated with</strong>,
          endorsed by or run by COVER Corp. or hololive production, and it isn’t affiliated with Google or YouTube.
        </p>
        <p>
          By using NASFAQ you agree to this Usage policy and our <Link href="/privacy">Privacy Policy</Link>. NASFAQ uses
          YouTube API Services, so by using it you also agree to be bound by the{" "}
          <Ext href={YOUTUBE_TERMS}>YouTube Terms of Service</Ext>. If you don’t agree, please don’t use the
          site.
        </p>
      </>
    ),
  },
  {
    id: "play-money",
    title: "Play money only",
    body: (
      <>
        <Callout title="Nothing on NASFAQ is worth real money">
          <p>
            In-game cash, talent stocks, prediction market shares, cards, shards, capsule prizes, cosmetics, badges and
            ranks have <strong>no real-world value</strong>. You can’t buy them with real money, and you can’t
            sell them, trade them for anything of value, or cash them out.
          </p>
        </Callout>
        <ul>
          <li>
            <strong>It’s a game, not investing or gambling.</strong> Talent “stocks” aren’t shares
            in anything. Their prices come from a formula on public YouTube numbers plus what players do on NASFAQ. Nothing
            you win or lose here is real.
          </li>
          <li>
            <strong>Not financial advice.</strong> Nothing on NASFAQ, including prices, articles, chat or prediction
            markets, is financial, investment or any other kind of professional advice.
          </li>
          <li>
            <strong>We can adjust things.</strong> Balances, prices, items and rankings can be reset, rebalanced, rolled
            back or removed at any time: to fix bugs, undo exploits, start a new season, or keep the economy playable.
          </li>
          <li>
            <strong>No real-money trading.</strong> Selling, buying or trading accounts, in-game cash or items for real
            money (or anything else of value) outside the game isn’t allowed.
          </li>
          <li>
            <strong>Your in-game stuff isn’t your property.</strong> You get to use it in the game while your account
            is in good standing, and that’s it.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: "donations",
    title: "Donations",
    body: (
      <p>
        You can support NASFAQ on Ko-fi. Donations are <strong>voluntary support</strong> for running the site and{" "}
        <strong>don’t buy anything in the game</strong>: no cash, items, cards, ranks or perks. Payments are handled
        by Ko-fi under its own terms, and we don’t see your payment details.
      </p>
    ),
  },
  {
    id: "accounts",
    title: "Your account",
    body: (
      <ul>
        <li>You must be at least 13 years old, or older if your country requires it to use online services on your own.</li>
        <li>
          <strong>One account per person.</strong> Don’t share, sell, or hand over your account, or use someone
          else’s.
        </li>
        <li>
          Use an email address you control. You’ll need to verify it before you can trade, play for cash or post.
        </li>
        <li>Keep your password to yourself. You’re responsible for what happens on your account.</li>
        <li>
          Usernames can’t impersonate anyone or break the <a href="#conduct">community rules</a>. We may change a
          username that does.
        </li>
      </ul>
    ),
  },
  {
    id: "fair-play",
    title: "Fair play",
    body: (
      <>
        <p>Everyone starts with the same play money. Keep it that way. Don’t:</p>
        <ul>
          <li>
            use <strong>bots, scripts, macros or other automation</strong> to trade, play games, claim rewards or post
          </li>
          <li>
            run <strong>more than one account</strong>, or use alts to farm cash, feed your main, pad leaderboards or dump
            on other players
          </li>
          <li>
            <strong>collude</strong>: throw table games, pass cash between accounts through wagers, or coordinate fake
            trades to move a price
          </li>
          <li>
            <strong>exploit bugs.</strong> If you find one, report it to <Mail /> or on Discord instead of using it. Gains
            from bugs will be removed.
          </li>
          <li>
            get around rate limits, security checks or bans, overload the site, or scrape it hard enough to slow it down
          </li>
        </ul>
        <p>
          We can roll back anything gained by breaking these rules, and suspend or reset the accounts involved.
        </p>
      </>
    ),
  },
  {
    id: "conduct",
    title: "Community rules",
    body: (
      <>
        <p>
          These apply everywhere you can write: chat, comments, articles, news edits, profile bios, usernames, market
          proposals and disputes. Banter and shitposting about the market are part of the fun. Keep it about the game, not
          about hurting people.
        </p>
        <h3>Don’t post</h3>
        <ul>
          <li>harassment, threats, bullying or pile-ons against anyone, players included</li>
          <li>hate speech or slurs aimed at people for who they are</li>
          <li>
            <strong>personal information</strong> about anyone (doxxing), including speculation about a talent’s
            real identity or private life
          </li>
          <li>sexual or NSFW content, gore, or anything sexualising minors</li>
          <li>spam, ads, referral links, scams or flooding</li>
          <li>anything pretending to be a talent, COVER staff, or NASFAQ staff</li>
          <li>leaks of paid or members-only content, pirated material, or anything illegal</li>
          <li>fake announcements or made-up news meant to move a price</li>
        </ul>
        <h3>Respect the talents</h3>
        <p>
          NASFAQ exists because people like the talents. Don’t use it to attack, harass or spread rumours about them,
          organise raids on their streams or channels, or post anything that could hurt them. Market talk about
          numbers is fine; going after the person isn’t.
        </p>
      </>
    ),
  },
  {
    id: "predictions",
    title: "Prediction markets",
    body: (
      <>
        <ul>
          <li>
            Markets are created by staff and by players who’ve been given permission. Player markets are reviewed
            before they open, and we can reject or edit any proposal. Markets about a talent’s private life, health or
            real identity won’t be approved.
          </li>
          <li>
            Every market has written rules and a resolution source. <strong>Staff resolve markets</strong> by those rules,
            using public sources. Automatic markets (like tick and stream markets) resolve themselves from NASFAQ and
            YouTube data.
          </li>
          <li>
            When staff propose a result, a <strong>dispute window</strong> opens (the length is shown on the market). If
            you hold a position you can dispute the result with a reason. Disputes are public.
          </li>
          <li>
            If a market can’t be resolved fairly (the question broke, the source vanished, or something went wrong),
            staff can void it.
          </li>
          <li>
            <strong>Once staff have reviewed a market and any disputes, their decision is final.</strong> Please
            don’t take it out on staff in chat.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: "moderation",
    title: "Moderation",
    body: (
      <>
        <p>To keep NASFAQ playable, staff can, with or without warning:</p>
        <ul>
          <li>remove or hide posts, articles, comments, bios and usernames</li>
          <li>mute or ban you from one chat room or all of them, for a while or for good</li>
          <li>roll back gains, reset balances or remove items</li>
          <li>suspend, reset or close accounts</li>
        </ul>
        <p>
          We use judgement: rule-breaking that isn’t on this list can still get moderated. You can report messages
          in chat. If you think we got something wrong, email <Mail /> and we’ll take another look.
        </p>
      </>
    ),
  },
  {
    id: "your-content",
    title: "Your content",
    body: (
      <>
        <p>
          You own what you write. By posting it on NASFAQ you give us a worldwide, non-exclusive, royalty-free licence to
          host, store, show, copy, format and share it on the site and in connection with running and promoting NASFAQ.
          The licence lasts while the content is on the site, plus a reasonable time after to clear copies out of our
          systems.
        </p>
        <p>
          News articles are edited as a group: other players can propose changes and staff can edit or merge them. You
          agree that people can quote and reply to what you post.
        </p>
        <p>
          Only post things you have the right to share. You’re responsible for what you post.
        </p>
      </>
    ),
  },
  {
    id: "ip",
    title: "Talents, trademarks and fan use",
    body: (
      <>
        <p>
          hololive, hololive production, talent names, likenesses, logos and official artwork belong to COVER Corp. and
          their other owners. NASFAQ uses them as a non-commercial fan project and doesn’t claim any ownership.
          Channel data comes from YouTube API Services.
        </p>
        <p>
          The NASFAQ site, game design, code and original art belong to NASFAQ. Don’t copy them wholesale.
        </p>
        <p>
          If you own something shown on NASFAQ and want it changed or taken down, email <Mail /> and we’ll deal with
          it quickly.
        </p>
      </>
    ),
  },
  {
    id: "third-parties",
    title: "Other services",
    body: (
      <p>
        NASFAQ relies on and links to other services: Google sign-in and YouTube, Cloudflare, Ko-fi and Discord. Using them
        means following their terms too. We’re not responsible for their sites. YouTube data on NASFAQ is covered by
        the <Ext href={YOUTUBE_TERMS}>YouTube Terms of Service</Ext> and the{" "}
        <Ext href={GOOGLE_PRIVACY}>Google Privacy Policy</Ext>.
      </p>
    ),
  },
  {
    id: "as-is",
    title: "Availability, no warranty",
    body: (
      <>
        <p>
          NASFAQ is a free fan project, provided <strong>“as is” and “as available”</strong>{" "}
          without warranties of any kind. It can go down, lose data, show wrong numbers, or change without notice. We can
          change the game’s rules, formulas, fees and features, reset the economy, or shut NASFAQ down.
        </p>
        <p>YouTube numbers come from YouTube and can be late or wrong. Don’t rely on NASFAQ for anything important.</p>
      </>
    ),
  },
  {
    id: "liability",
    title: "Liability",
    body: (
      <>
        <p>
          As far as the law allows, the people who run NASFAQ aren’t liable for any indirect or consequential loss,
          or for losing in-game items, balances, ranks or data. Since nothing in the game costs or is worth money, and
          donations aren’t purchases, we don’t owe anyone money over what happens in the game.
        </p>
        <p>
          Some places don’t allow these limits. Where they don’t, they apply as far as the law allows, and your
          statutory rights aren’t affected.
        </p>
      </>
    ),
  },
  {
    id: "ending",
    title: "Leaving, or being removed",
    body: (
      <p>
        You can stop playing at any time and ask us to delete your account (see the{" "}
        <Link href="/privacy#retention">Privacy Policy</Link>). We can suspend or close accounts that break these rules
        or put NASFAQ or its players at risk. Sections that make sense to keep, like play money, your content licence and
        liability, still apply after that.
      </p>
    ),
  },
  {
    id: "changes",
    title: "Changes to these rules",
    body: (
      <p>
        We’ll update this page and the date at the top when the rules change, and post a notice on the site for big
        changes. Using NASFAQ after an update means you accept the new rules.
      </p>
    ),
  },
  {
    id: "contact",
    title: "Contact",
    body: (
      <p>
        Questions, bug reports, appeals or takedown requests: <Mail />. You can also find us on the NASFAQ Discord
        (linked in the footer).
      </p>
    ),
  },
];

export default function TermsPage() {
  return (
    <LegalPage
      doc="terms"
      title="Usage policy"
      updated={{ iso: "2026-09-25", label: "September 25, 2026" }}
      art="legal-terms-spot"
      intro={
        <p>
          The house rules for NASFAQ. What we collect and what’s public is in the{" "}
          <Link href="/privacy">Privacy Policy</Link>.
        </p>
      }
      summary={[
        <>
          NASFAQ is a <strong>fan game</strong>. It isn’t affiliated with COVER Corp. or hololive production.
        </>,
        <>
          <strong>Everything is play money.</strong> No real value, no buying in, no cashing out. Not investing, not
          gambling, not financial advice.
        </>,
        <>
          <strong>One account per person.</strong> No bots, no alts, no exploiting bugs. Report them instead.
        </>,
        <>Be decent in chat and posts. No harassment, doxxing, NSFW or spam, and respect the talents.</>,
        <>
          Staff resolve prediction markets and moderate the site. After a dispute is reviewed,{" "}
          <strong>their call is final</strong>.
        </>,
        <>Ko-fi donations keep the lights on and buy nothing in the game.</>,
      ]}
      sections={sections}
    />
  );
}
