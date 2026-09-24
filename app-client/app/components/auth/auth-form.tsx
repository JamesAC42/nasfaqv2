"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import Script from "next/script";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { ArtSlot } from "@/app/components/common/art-slot";
import { Oshimark } from "@/app/components/common/oshimark";
import { SiteShell } from "@/app/components/layout/site-shell";
import { signedPct, toneOf } from "@/app/lib/time";
import { useAuth } from "@/app/providers/auth-provider";
import { useMarketStore } from "@/app/stores/market-store";
import styles from "@/app/components/auth/auth-form.module.scss";

declare global {
  interface Window {
    turnstile?: {
      render: (container: HTMLElement, options: Record<string, unknown>) => string;
      reset: (widgetId?: string) => void;
    };
    google?: {
      accounts: {
        id: {
          initialize: (options: Record<string, unknown>) => void;
          renderButton: (container: HTMLElement, options: Record<string, unknown>) => void;
        };
      };
    };
  }
}

const turnstileSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || "";
const googleClientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || "";

const ERROR_MESSAGES: Record<string, string> = {
  invalid_username: "Usernames are 3–32 characters: letters, numbers, underscores and spaces.",
  invalid_email: "That doesn't look like an email address.",
  invalid_password: "Passwords need at least 8 characters.",
  username_taken: "That username is taken. Try another.",
  email_taken: "There's already an account with that email. Sign in instead?",
  invalid_credentials: "Wrong username or password.",
  turnstile_required: "Finish the security check first.",
  turnstile_failed: "The security check failed. Try it again.",
};

const isLocalPath = (path: string) => path.startsWith("/") && !path.startsWith("//") && !/^\/(login|register)/.test(path);

/** Where to go after signing in: ?next=, else the last page you were on, else the profile. */
function nextPath() {
  const next = new URLSearchParams(window.location.search).get("next") || "";
  if (isLocalPath(next)) return next;
  let last = "";
  try {
    last = window.sessionStorage.getItem("nasfaq.returnTo") || "";
  } catch {
    /* storage blocked */
  }
  return isLocalPath(last) && last !== "/" ? last : "/profile";
}

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const router = useRouter();
  const { login, register, loginWithGoogle, resendVerification, error, isLoading, user } = useAuth();
  const assets = useMarketStore((state) => state.assets);
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [ogey, setOgey] = useState("");
  const [turnstileToken, setTurnstileToken] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [resent, setResent] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [googleReady, setGoogleReady] = useState(false);
  const turnstileRef = useRef<HTMLDivElement | null>(null);
  const turnstileWidget = useRef("");
  const turnstileTokenRef = useRef("");
  const googleRef = useRef<HTMLDivElement | null>(null);
  const googleRendered = useRef(false);

  const needsCaptcha = Boolean(turnstileSiteKey);
  const captchaDone = !needsCaptcha || Boolean(turnstileToken);
  const ogeyWrong = error === "invalid_ogey";
  const shownError = submitted && error && !ogeyWrong ? ERROR_MESSAGES[error] || `Something went wrong (${error}). Try again.` : null;

  const movers = useMemo(
    () =>
      [...assets]
        .filter((asset) => asset.move_24h_pct !== null)
        .sort((a, b) => Math.abs(b.move_24h_pct ?? 0) - Math.abs(a.move_24h_pct ?? 0))
        .slice(0, 5),
    [assets],
  );

  function resetTurnstile() {
    if (!turnstileWidget.current || !window.turnstile) return;
    window.turnstile.reset(turnstileWidget.current);
    turnstileTokenRef.current = "";
    setTurnstileToken("");
  }

  function renderTurnstile() {
    if (!turnstileSiteKey || !window.turnstile || !turnstileRef.current || turnstileWidget.current) return;
    turnstileWidget.current = window.turnstile.render(turnstileRef.current, {
      sitekey: turnstileSiteKey,
      appearance: "always",
      theme: document.documentElement.dataset.theme === "light" ? "light" : "dark",
      callback: (token: string) => {
        turnstileTokenRef.current = token;
        setTurnstileToken(token);
        setNotice(null);
      },
      "expired-callback": () => {
        turnstileTokenRef.current = "";
        setTurnstileToken("");
      },
      "error-callback": () => {
        turnstileTokenRef.current = "";
        setTurnstileToken("");
      },
    });
  }

  function renderGoogle() {
    if (!googleReady || !googleClientId || !window.google || !googleRef.current || googleRendered.current) return;
    window.google.accounts.id.initialize({
      client_id: googleClientId,
      ux_mode: "popup",
      use_fedcm_for_prompt: false,
      use_fedcm_for_button: false,
      callback: async (response: { credential?: string }) => {
        if (!response.credential) return;
        const token = turnstileTokenRef.current;
        if (needsCaptcha && !token) {
          setNotice("Finish the security check before using Google.");
          return;
        }
        setSubmitted(true);
        try {
          await loginWithGoogle(response.credential, token);
          router.push(nextPath());
        } finally {
          resetTurnstile();
        }
      },
    });
    window.google.accounts.id.renderButton(googleRef.current, {
      theme: "filled_black",
      size: "large",
      shape: "rectangular",
      text: mode === "login" ? "signin_with" : "signup_with",
      width: 300,
    });
    googleRendered.current = true;
  }

  useEffect(() => {
    renderTurnstile();
    renderGoogle();
  });

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!captchaDone) {
      setNotice("Finish the security check first.");
      return;
    }
    setSubmitted(true);
    try {
      if (mode === "login") await login(username.trim(), password, turnstileToken);
      else await register(username.trim(), email.trim(), password, ogey, turnstileToken);
      router.push(mode === "register" ? "/profile" : nextPath());
    } catch {
      resetTurnstile();
    }
  }

  return (
    <SiteShell>
      {turnstileSiteKey ? <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" strategy="afterInteractive" onLoad={renderTurnstile} /> : null}
      {googleClientId ? <Script src="https://accounts.google.com/gsi/client" strategy="afterInteractive" onLoad={() => setGoogleReady(true)} /> : null}
      <div className={styles.page}>
        <section className={styles.card}>
          <nav className={styles.tabs} aria-label="Account">
            <Link href="/login" aria-current={mode === "login" ? "page" : undefined}>
              SIGN IN
            </Link>
            <Link href="/register" aria-current={mode === "register" ? "page" : undefined}>
              MAKE AN ACCOUNT
            </Link>
          </nav>

          <div className={styles.body}>
            <h1>{mode === "login" ? "Welcome back" : "Get your $10,000"}</h1>
            <p className={styles.lede}>
              {mode === "login" ? "Sign in with your username or email." : "Play money, real talents. Verify your email and you can trade, chat, comment and write."}
            </p>

            {user ? (
              <div className={styles.info}>
                <span>
                  Already signed in as <b>{user.username}</b>. <Link href="/profile">Go to your profile →</Link>
                </span>
                {!user.email_verified ? (
                  <span className={styles.infoRow}>
                    Your email isn&apos;t verified yet.{" "}
                    <button
                      type="button"
                      onClick={async () => {
                        await resendVerification();
                        setResent(true);
                      }}
                      disabled={resent}
                    >
                      {resent ? "Sent. Check your inbox." : "Resend the link"}
                    </button>
                  </span>
                ) : null}
              </div>
            ) : null}

            <form className={styles.form} onSubmit={(event) => void submit(event)}>
              <label>
                <span className={styles.label}>{mode === "login" ? "Username or email" : "Username"}</span>
                <input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" maxLength={mode === "register" ? 32 : 254} required autoFocus />
                {mode === "register" ? <small>3–32 characters. Letters, numbers, underscores, spaces.</small> : null}
              </label>
              {mode === "register" ? (
                <label>
                  <span className={styles.label}>Email</span>
                  <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required />
                  <small>We send a link to verify it before you can trade or post.</small>
                </label>
              ) : null}
              <label>
                <span className={styles.label}>Password</span>
                <span className={styles.pw}>
                  <input type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={mode === "login" ? "current-password" : "new-password"} minLength={mode === "register" ? 8 : undefined} required />
                  <button type="button" onClick={() => setShowPassword(!showPassword)} aria-pressed={showPassword} aria-label={showPassword ? "Hide password" : "Show password"}>
                    {showPassword ? "HIDE" : "SHOW"}
                  </button>
                </span>
                {mode === "register" ? <small className={password && password.length < 8 ? styles.warnText : undefined}>At least 8 characters{password ? ` · ${password.length}` : ""}.</small> : null}
              </label>
              {mode === "register" ? (
                <label>
                  <span className={styles.label}>ogey?</span>
                  <input value={ogey} onChange={(event) => setOgey(event.target.value)} autoComplete="off" spellCheck={false} required className={ogeyWrong ? styles.bad : undefined} />
                  {ogeyWrong ? <small className={styles.warnText}>that&apos;s not ogey</small> : null}
                </label>
              ) : null}

              {turnstileSiteKey ? <div ref={turnstileRef} className={styles.captcha} /> : null}
              {notice ? <p className={styles.notice}>{notice}</p> : null}
              {shownError ? (
                <p className={styles.error} role="alert">
                  {shownError}
                </p>
              ) : null}

              <button type="submit" className={styles.submit} disabled={isLoading || !captchaDone}>
                {isLoading ? "…" : mode === "login" ? "SIGN IN" : "CREATE ACCOUNT"}
              </button>
            </form>

            {googleClientId ? (
              <div className={styles.google}>
                <span className={styles.or}>or</span>
                <div className={styles.googleFrame}>
                  <div ref={googleRef} />
                  {!captchaDone ? <div className={styles.googleShield} aria-hidden="true" /> : null}
                </div>
                {!captchaDone ? <small>Finish the security check to use Google.</small> : null}
              </div>
            ) : null}

            <p className={styles.switch}>
              {mode === "login" ? (
                <>
                  New here? <Link href="/register">Make an account</Link>. No Google needed.
                </>
              ) : (
                <>
                  Already have one? <Link href="/login">Sign in</Link>.
                </>
              )}
            </p>
          </div>
        </section>

        <aside className={styles.pitch} aria-label="What is nasfaq">
          <ArtSlot kind="chibi" pose="hype" symbol={movers[0]?.symbol ?? "NASFAQ"} icon={movers[0]?.icon} accent="var(--blue)" width={160} className={styles.chibi} />
          <h2>Every hololive talent is a stock.</h2>
          <ul>
            <li>Start with $10,000 of play money.</li>
            <li>Prices follow each channel&apos;s real growth, plus whatever the other players buy and sell.</li>
            <li>Orders fill in 10-minute batches. Four ticks a day pull every stock toward its hidden target.</li>
            <li>Climb the leaderboard, run up your oshi&apos;s board, argue in chat.</li>
          </ul>
          {movers.length ? (
            <div className={styles.movers}>
              <span className={styles.label}>Moving today</span>
              {movers.map((asset) => (
                <Link key={asset.symbol} href={`/stocks/${encodeURIComponent(asset.symbol)}`} className={styles.mover}>
                  <Oshimark icon={asset.icon} symbol={asset.symbol} size={18} />
                  <b>{asset.symbol}</b>
                  <span>{asset.current_mid_price?.toFixed(2)}</span>
                  <span className={styles[toneOf(asset.move_24h_pct)]}>{signedPct(asset.move_24h_pct)}</span>
                </Link>
              ))}
            </div>
          ) : null}
          <Link href="/how-to-play" className={styles.how}>
            How to play →
          </Link>
        </aside>
      </div>
    </SiteShell>
  );
}
