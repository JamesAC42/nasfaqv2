import type { Metadata } from "next";
import Link from "next/link";
import { Callout, Ext, Fact, Facts, LegalPage, Mail, type LegalSection } from "@/app/components/legal/legal-page";

export const metadata: Metadata = {
  title: "Privacy Policy | NASFAQ",
  description:
    "What NASFAQ collects, why, what's public on the site, the services we use (including YouTube API Services), and how to get your data deleted.",
};

const GOOGLE_PRIVACY = "https://policies.google.com/privacy";
const YOUTUBE_TERMS = "https://www.youtube.com/t/terms";
const GOOGLE_PERMISSIONS = "https://security.google.com/settings/security/permissions";

const sections: LegalSection[] = [
  {
    id: "who-we-are",
    title: "Who we are",
    body: (
      <>
        <p>
          NASFAQ is a fan-made stock market game about hololive VTubers. You trade talent “stocks” with
          play money, bet on prediction markets, collect cards and chat with other fans. It is not affiliated with COVER
          Corp. or hololive production.
        </p>
        <p>
          This policy covers the NASFAQ website and its API. “We” and “us” means the people who
          run NASFAQ. If anything here is unclear, email <Mail />.
        </p>
      </>
    ),
  },
  {
    id: "what-we-collect",
    title: "What we collect",
    body: (
      <>
        <p>We only collect what the game needs to run. Here’s all of it.</p>
        <Facts>
          <Fact term="Your account">
            <p>
              Your <strong>username</strong>, <strong>email address</strong> and <strong>password</strong>. We never
              store the password itself, only a salted scrypt hash of it, so nobody (us included) can read it back.
              We also record when your account was created and whether you’ve verified your email.
            </p>
          </Fact>
          <Fact term="Your profile">
            <p>
              Your bio, the profile picture you pick from our set (you can’t upload your own), your profile colour,
              your oshi coin, and your friends and rivals.
            </p>
          </Fact>
          <Fact term="What you post">
            <p>Everything you write on the site, and the reactions around it:</p>
            <ul>
              <li>chat messages and replies</li>
              <li>comments on stocks, articles and prediction markets, plus your comment votes</li>
              <li>articles and drafts you write, edits you propose to news articles, and your votes on them</li>
              <li>article likes and saves</li>
              <li>prediction market disputes (with your reason) and markets you create, if you have that permission</li>
              <li>chat reports you file</li>
              <li>bug reports you send, with the page you were on and your browser (the one place we keep browser details)</li>
            </ul>
          </Fact>
          <Fact term="Your game activity">
            <p>
              Your stock orders and trades, cash balance and ledger, holdings, daily net worth, achievements and trading
              streaks; your prediction market orders, trades and positions; and your games: card collection, pulls,
              shards, pity counters, showcase, capsule prizes, cosmetics, table game bets and results, and scores.
            </p>
          </Fact>
          <Fact term="Sign-in sessions">
            <p>
              When you sign in we create a random session token. The database keeps only a hash of it, plus when it was
              created, when it expires, when it was last used, and whether you signed out.
            </p>
          </Fact>
          <Fact term="Moderation records">
            <p>
              Chat mutes and bans (with the reason), messages a moderator removed, and reports about messages.
            </p>
          </Fact>
        </Facts>
        <h3>What we don’t collect</h3>
        <p>
          No real name, address, phone number, birthday or payment details. We don’t read your YouTube account,
          Gmail, contacts or Drive. Our app doesn’t save your IP address to your account or our database, or your
          browser details either, unless you send a bug report. (The networks and servers that deliver any website do see your IP address when you connect; see{" "}
          <a href="#sharing">section 5</a> for the services involved.)
        </p>
      </>
    ),
  },
  {
    id: "how-we-use-it",
    title: "How we use it",
    body: (
      <>
        <ul>
          <li>
            <strong>To run your account:</strong> sign you in, keep you signed in, and send account emails: the link
            that verifies your address, and a password reset link when you ask for one.
          </li>
          <li>
            <strong>To run the game:</strong> fill trades, settle prediction markets, pay out prizes and achievements, and
            work out leaderboards and ranks.
          </li>
          <li>
            <strong>To show your stuff:</strong> your profile, posts, trades and collection, as described in{" "}
            <a href="#public">section 4</a>.
          </li>
          <li>
            <strong>To keep it fair and safe:</strong> stop bots at sign-up, rate-limit chat, handle reports, and
            moderate under the <Link href="/terms">Usage policy</Link>.
          </li>
          <li>
            <strong>To improve the site:</strong> count page visits in aggregate and fix what breaks.
          </li>
        </ul>
        <p>
          We don’t sell your data, rent it out, or use it for advertising. There are no ads on NASFAQ. The only
          emails we send are account emails, like the verification link.
        </p>
      </>
    ),
  },
  {
    id: "public",
    title: "What's public on NASFAQ",
    body: (
      <>
        <p>
          NASFAQ is a social game, so a lot of it is visible to everyone, including people who aren’t signed in.
          Post and trade with that in mind.
        </p>
        <Facts>
          <Fact term="Public">
            <ul>
              <li>
                your username, profile picture, colour, bio, oshi coin, join date, badges and achievements, trading
                streak, friends and rivals
              </li>
              <li>your rank, cash, total stock value, net worth and net worth history</li>
              <li>your stock trade history: each buy and sell, with the ticker, price and quantity</li>
              <li>your prediction market trades, disputes (with your reason) and forecaster leaderboard results</li>
              <li>
                your card collection and showcase, pulls in the live pull feed, cosmetics in your item locker, how much
                you’ve spent on capsules, and game leaderboards
              </li>
              <li>your seat, bets and hands at game tables (spectators can watch)</li>
              <li>your chat messages, comments and published articles</li>
            </ul>
          </Fact>
          <Fact term="Only you (and staff)">
            <ul>
              <li>your email address and password hash</li>
              <li>your current stock holdings and open orders</li>
              <li>your saved articles, drafts and pending friend requests</li>
              <li>reports you file</li>
            </ul>
          </Fact>
        </Facts>
        <p>
          Staff with moderation or admin access can see account details when they need to (for example to handle a
          report or fix a bug).
        </p>
      </>
    ),
  },
  {
    id: "sharing",
    title: "Services we use and who we share with",
    body: (
      <>
        <p>
          We share data only with the services that help run NASFAQ, and only what each one needs. Each has its own
          privacy policy.
        </p>
        <Facts>
          <Fact term="Google">
            <p>
              YouTube API Services for public channel data. When you play a
              stream on NASFAQ, the video is embedded from YouTube (privacy-enhanced mode), and video thumbnails load
              from YouTube’s servers. See <a href="#google">section 6</a>.
            </p>
          </Fact>
          <Fact term="Cloudflare Turnstile">
            <p>
              The security check on the sign-in and sign-up forms. Cloudflare looks at signals from your browser to tell
              people from bots, and we pass it your IP address to confirm the check.
            </p>
          </Fact>
          <Fact term="Resend">
            <p>Sends our account emails (email verification and password resets), so it receives your email address.</p>
          </Fact>
          <Fact term="Umami analytics">
            <p>
              Counts page views so we know what people use. It records things like the page, referring site, browser,
              device type and country, doesn’t use cookies, and isn’t tied to your account.
            </p>
          </Fact>
          <Fact term="Hosting and storage">
            <p>
              Our servers, database and image storage (Amazon Web Services S3, served from{" "}
              <code>images.nasfaq.biz</code>) are run by infrastructure providers who handle data only to keep the site
              running.
            </p>
          </Fact>
          <Fact term="Ko-fi and Discord">
            <p>
              We link to them, but they’re separate sites. Anything you give them (like a Ko-fi donation) is
              covered by their policies, not this one. We don’t get your payment details.
            </p>
            <p>
              Bug reports you send from the site are also posted to a channel on our Discord server, with your
              username if you’re signed in, the page and your browser.
            </p>
          </Fact>
        </Facts>
        <p>
          We may also disclose information if the law requires it, or if we need to protect NASFAQ, its players or the
          public from fraud, abuse or harm.
        </p>
      </>
    ),
  },
  {
    id: "google",
    title: "YouTube API Services",
    body: (
      <>
        <Callout title="NASFAQ uses YouTube API Services">
          <p>
            By using NASFAQ you agree to be bound by the <Ext href={YOUTUBE_TERMS}>YouTube Terms of Service</Ext>. Google’s
            handling of data is covered by the <Ext href={GOOGLE_PRIVACY}>Google Privacy Policy</Ext>.
          </p>
        </Callout>
        <h3>Public YouTube data</h3>
        <p>
          The stock prices and stream pages use public, non-authorised data from YouTube API Services: channel IDs,
          channel names and images, public subscriber and view counts, video titles and thumbnails, livestream status and
          viewer counts, and publish times. We don’t access your YouTube account, watch history, subscriptions or
          any other private YouTube data.
        </p>
        <h3>Revoking access</h3>
        <p>
          NASFAQ doesn’t ask for access to your Google or YouTube account. You can see and remove the apps that have
          access from your <Ext href={GOOGLE_PERMISSIONS}>Google security settings</Ext>; to delete what we’ve stored,
          see <a href="#retention">section 8</a>.
        </p>
      </>
    ),
  },
  {
    id: "cookies",
    title: "Cookies and local storage",
    body: (
      <>
        <p>
          We use <strong>one cookie</strong>, and no advertising or tracking cookies.
        </p>
        <Facts mono>
          <Fact term="nasfaq_session">
            <p>
              Keeps you signed in. It holds a random token, can’t be read by page scripts (HttpOnly), and lasts 30
              days or until you sign out.
            </p>
          </Fact>
        </Facts>
        <p>
          When the sign-in page loads Cloudflare’s security check, and when you play
          an embedded YouTube video, those services may set their own cookies under their own policies.
        </p>
        <h3>Settings saved on your device</h3>
        <p>
          Some preferences are kept in your browser’s local storage. They stay on your device and aren’t sent
          to us.
        </p>
        <Facts mono>
          <Fact term="nasfaq.theme">
            <p>Light or dark mode.</p>
          </Fact>
          <Fact term="nasfaq.calm">
            <p>Calm mode (fewer animations).</p>
          </Fact>
          <Fact term="nasfaq.newbieDismissed">
            <p>You closed the new-player banner on the home page.</p>
          </Fact>
          <Fact term="nasfaq.chat.pinned_channels">
            <p>Chat rooms you pinned.</p>
          </Fact>
          <Fact term="nasfaq.screener.views">
            <p>Your saved stock screener views.</p>
          </Fact>
          <Fact term="nasfaq:article-editor:draft">
            <p>An article you haven’t published yet, so you don’t lose it.</p>
          </Fact>
          <Fact term="nasfaq-thread-you-state-v1">
            <p>Which posts in the thread watcher are yours, so replies to you stand out.</p>
          </Fact>
          <Fact term="nasfaq.returnTo, nasfaq.tapeEpoch">
            <p>Session storage: the page to send you back to after signing in, and the price tape’s position. Cleared when you close the tab.</p>
          </Fact>
        </Facts>
        <p>You can clear any of this in your browser settings. Clearing cookies signs you out; clearing site data also resets your preferences.</p>
      </>
    ),
  },
  {
    id: "retention",
    title: "How long we keep it, and deleting it",
    body: (
      <>
        <ul>
          <li>
            <strong>Your account and game data</strong> are kept for as long as your account exists.
          </li>
          <li>
            <strong>Sessions</strong> stop working after 30 days or when you sign out. <strong>Verification links</strong>{" "}
            expire after 24 hours.
          </li>
          <li>
            <strong>Chat:</strong> older messages move out of the live chat into an archive. They aren’t deleted
            automatically. Messages removed by a moderator are hidden but kept as a moderation record.
          </li>
        </ul>
        <h3>Changing your data</h3>
        <p>
          You can change your username, bio, profile picture, colour and oshi coin in your profile settings. To change the
          email on your account, email us.
        </p>
        <h3>Getting a copy, or deleting your account</h3>
        <p>
          There’s no delete button yet. Email <Mail /> <strong>from the address on your account</strong> (so we
          know it’s you) and tell us your username and what you want: a copy of your data, a correction, or deletion.
        </p>
        <p>
          When we delete an account, your profile, posts, chat messages, comments, game data and sessions go with it.
          Articles you published may stay up without your name on them, and anonymous records that shaped the market (like
          past trades behind a price move) may be kept so the market history stays consistent.
        </p>
        <p>
          Depending on where you live, you may have other rights over your data, like objecting to how it’s used or
          complaining to your local data protection authority. Email us and we’ll help.
        </p>
      </>
    ),
  },
  {
    id: "children",
    title: "Children",
    body: (
      <p>
        NASFAQ isn’t for children under 13, and you shouldn’t sign up if you’re under 13 (or under the
        minimum age to use online services without a parent’s consent where you live). We don’t knowingly
        collect data from children. If you think a child has made an account, email <Mail /> and we’ll delete it.
      </p>
    ),
  },
  {
    id: "security",
    title: "Security",
    body: (
      <>
        <p>
          Passwords are stored as salted scrypt hashes. Session tokens, email verification tokens and password reset
          tokens are stored only as hashes, and the session cookie is HttpOnly, so page scripts can’t read it. Sign-up and sign-in go through a
          bot check, and posting and trading need a verified email.
        </p>
        <p>
          No website is perfectly secure. Use a password you don’t use anywhere else, and tell us straight away at{" "}
          <Mail /> if you think your account or a security hole has been found.
        </p>
      </>
    ),
  },
  {
    id: "changes",
    title: "Changes to this policy",
    body: (
      <p>
        When the site changes what it collects, we’ll update this page and the date at the top. For big changes
        we’ll also post a notice on the site. Using NASFAQ after an update means you accept the new version.
      </p>
    ),
  },
  {
    id: "contact",
    title: "Contact",
    body: (
      <p>
        Privacy questions and requests: <Mail />. You can also find us on the NASFAQ Discord (linked in the footer), but
        please send data requests by email so we can confirm it’s your account.
      </p>
    ),
  },
];

export default function PrivacyPage() {
  return (
    <LegalPage
      doc="privacy"
      title="Privacy Policy"
      updated={{ iso: "2026-09-29", label: "September 29, 2026" }}
      art="legal-privacy-spot"
      intro={
        <p>
          What NASFAQ collects, why, what everyone can see, and how to get it deleted. The rules for playing are in the{" "}
          <Link href="/terms">Usage policy</Link>.
        </p>
      }
      summary={[
        <>
          We keep what the game needs: your <strong>username</strong>, <strong>email</strong>, a{" "}
          <strong>hashed password</strong>, and what you do on the site.
        </>,
        <>
          Your <strong>username, profile, trades, posts and ranks are public</strong>. Your email and password never are.
        </>,
        <>No ads, no selling your data, no tracking cookies. One cookie keeps you signed in.</>,
        <>
          We only use <strong>public</strong> YouTube data.
        </>,
        <>
          Want your data or your account gone? Email <Mail /> from your account’s address.
        </>,
      ]}
      sections={sections}
    />
  );
}
