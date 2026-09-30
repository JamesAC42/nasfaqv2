"use client";

import Link from "next/link";
import { SceneArt } from "@/app/components/common/scene-art";
import { SiteShell } from "@/app/components/layout/site-shell";
import { ChibiTag, useMovers } from "@/app/components/how-to-play/demos";
import { FaqSection, FinePrint, GlossarySection } from "@/app/components/how-to-play/reference";
import { SectionNav } from "@/app/components/how-to-play/section-nav";
import { CommunitySection, GamesSection, MarketSection, PredictionsSection, TicksSection, TradingSection, WeeklySection } from "@/app/components/how-to-play/sections";
import { useAuth } from "@/app/providers/auth-provider";
import { useProfileStore } from "@/app/stores/profile-store";
import styles from "@/app/components/how-to-play/how-to-play.module.scss";

export function HowToPlayPage() {
  return (
    <SiteShell>
      <div className={styles.page}>
        <Hero />
        <StartHere />
        <div className={styles.body}>
          <SectionNav />
          <div className={styles.sections}>
            <MarketSection />
            <TradingSection />
            <TicksSection />
            <WeeklySection />
            <GamesSection />
            <PredictionsSection />
            <CommunitySection />
            <GlossarySection />
            <FaqSection />
            <FinePrint />
          </div>
        </div>
      </div>
    </SiteShell>
  );
}

// ── Hero ─────────────────────────────────────────────────────────────────────
function Hero() {
  const { user } = useAuth();
  const { up, down } = useMovers();
  return (
    <header className={styles.hero}>
      <SceneArt slot="howto-hero" fill position="75% 40%" priority width={1600} className={styles.heroArt} />
      <div className={styles.heroScrim} aria-hidden="true" />
      <div className={styles.heroCopy}>
        <span className={styles.kicker}>
          <i aria-hidden="true" />
          Field manual · new players start here
        </span>
        <h1>How to play</h1>
        <p className={styles.lede}>
          Every hololive talent is a stock. You get <b>$10,000</b>{" "}of play money. Buy the ones you believe in, dump the ones you don&apos;t, and climb the board.
        </p>
        <dl className={styles.heroStats}>
          <div>
            <dt>Starter cash</dt>
            <dd>$10,000</dd>
          </div>
          <div>
            <dt>Ticks a day</dt>
            <dd>4</dd>
          </div>
          <div>
            <dt>Order batches</dt>
            <dd>10 min</dd>
          </div>
          <div>
            <dt>Trading fee</dt>
            <dd>1%</dd>
          </div>
        </dl>
        <div className={styles.heroActions}>
          {user ? (
            <Link href="/market" className={styles.primary}>
              Open the market →
            </Link>
          ) : (
            <Link href="/register" className={styles.primary}>
              Claim your $10,000 →
            </Link>
          )}
          <a href="#market" className={styles.ghost}>
            Read the rules
          </a>
        </div>
      </div>
      {up || down ? (
        <div className={styles.heroCast} aria-label="Today's biggest movers">
          {up ? <ChibiTag asset={up} pose="moon" width={220} caption="Top gainer today" /> : null}
          {down ? <ChibiTag asset={down} pose="shock" width={220} caption="Rough day" /> : null}
        </div>
      ) : null}
    </header>
  );
}

// ── Start here in 60 seconds ──────────────────────────────────────────────────
function StartHere() {
  const { user } = useAuth();
  const portfolio = useProfileStore((state) => state.portfolio);
  const verified = Boolean(user?.email_verified);
  const traded = Boolean(portfolio?.holdings?.length);

  const steps = [
    {
      title: user ? (verified ? "Account ready" : "Verify your email") : "Sign up",
      body: user
        ? verified
          ? "You're in, with cash to spend."
          : "Click the link we emailed you. Trading, games and chat need it."
        : "Username, email, password. You start with $10,000.",
      href: user ? (verified ? "/profile" : "/verify-email") : "/register",
      cta: user ? (verified ? "Your profile" : "Verify email") : "Make an account",
      done: verified,
    },
    {
      title: "Pick an oshi",
      body: "Edit your profile and choose your talent. Their oshimark follows your name.",
      href: "/profile",
      cta: "Edit profile",
      done: false,
    },
    {
      title: "Make your first trade",
      body: "Find them on the stocks page, hit BUY, pick a share count. Fills in the next batch.",
      href: "/stocks",
      cta: "Browse stocks",
      done: traded,
    },
    {
      title: "Try the arcade",
      body: "Claim 5 free cards, pull the gacha, or sit at a blackjack table.",
      href: "/games",
      cta: "Open the arcade",
      done: false,
    },
  ];

  return (
    <section className={styles.start} aria-labelledby="start-title">
      <div className={styles.startHead}>
        <h2 id="start-title">Start here in 60 seconds</h2>
        <span className={styles.startSub}>Four steps. Then read on, or just wing it.</span>
      </div>
      <ol className={styles.steps}>
        {steps.map((step, index) => (
          <li key={step.title} className={styles.step} data-done={step.done || undefined}>
            <span className={styles.stepNum} aria-hidden="true">
              {step.done ? "✓" : String(index + 1).padStart(2, "0")}
            </span>
            <div className={styles.stepText}>
              <h3>
                {step.title}
                {step.done ? <span className={styles.sr}> (done)</span> : null}
              </h3>
              <p>{step.body}</p>
              <Link href={step.href} className={styles.stepLink}>
                {step.cta} →
              </Link>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
