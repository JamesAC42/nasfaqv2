"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import Script from "next/script";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { ArtSlot } from "@/app/components/common/art-slot";
import { SceneArt } from "@/app/components/common/scene-art";
import { Oshimark } from "@/app/components/common/oshimark";
import { SiteShell } from "@/app/components/layout/site-shell";
import { apiFetch } from "@/app/lib/api";
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
  }
}

const turnstileSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || "";

const ERROR_MESSAGES: Record<string, string> = {
  invalid_username: "Usernames are 3–32 characters: letters, numbers, underscores and spaces.",
  invalid_email: "That doesn't look like an email address.",
  invalid_password: "Your password needs 8 to 200 characters. Anything goes: letters, numbers, spaces, symbols.",
  username_taken: "That username is taken. Try another.",
  email_taken: "There's already an account with that email. Sign in instead?",
  invalid_credentials: "Wrong username or password.",
  invalid_login: "Enter your username or your account's email.",
  invalid_reset_token: "That link has expired (they last an hour) or was already used.",
  missing_token: "Open this page from the link in your email.",
  turnstile_required: "Finish the security check first.",
  turnstile_failed: "The security check failed. Try it again.",
  rate_limited: "Too many tries. Wait a minute and try again.",
};

export type AuthMode = "login" | "register" | "forgot" | "reset";

const isLocalPath = (path: string) => path.startsWith("/") && !path.startsWith("//") && !/^\/(login|register|forgot-password|reset-password)/.test(path);

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

const HEADINGS: Record<AuthMode, string> = {
  login: "Welcome back",
  register: "Get your $10,000",
  forgot: "Forgot your password?",
  reset: "Choose a new password",
};

const LEDES: Record<AuthMode, string> = {
  login: "Sign in with your username or email.",
  register: "Play money, real talents. All you need is a username, an email and a password. Verify the email and you can trade, chat, comment and write.",
  forgot: "Enter your username or your account's email, and we'll email you a link to choose a new one. Signed up with Google? Use your Google email.",
  reset: "Setting it signs you out everywhere else.",
};

const SUBMIT_LABELS: Record<AuthMode, string> = {
  login: "SIGN IN",
  register: "CREATE ACCOUNT",
  forgot: "EMAIL ME A LINK",
  reset: "SET PASSWORD",
};

/** Sign in, sign up, forgot password, and the new-password page the reset email links to (`token`). */
export function AuthForm({ mode, token = "" }: { mode: AuthMode; token?: string }) {
  const router = useRouter();
  const { login, register, refreshSession, resendVerification, error, isLoading, user } = useAuth();
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
  // Forgot / reset go straight to the API rather than through the auth store.
  const [ownError, setOwnError] = useState<string | null>(mode === "reset" && !token ? "missing_token" : null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const turnstileRef = useRef<HTMLDivElement | null>(null);
  const turnstileWidget = useRef("");

  const usesStore = mode === "login" || mode === "register";
  const newPassword = mode === "register" || mode === "reset";
  const needsCaptcha = Boolean(turnstileSiteKey) && mode !== "reset";
  const captchaDone = !needsCaptcha || Boolean(turnstileToken);
  const errorCode = usesStore ? (submitted ? error : null) : ownError;
  const ogeyWrong = errorCode === "invalid_ogey";
  const shownError = errorCode && !ogeyWrong ? ERROR_MESSAGES[errorCode] || `Something went wrong (${errorCode}). Try again.` : null;
  const working = usesStore ? isLoading : busy;

  const movers = useMemo(
    () =>
      [...assets]
        .filter((asset) => asset.move_24h_pct !== null)
        .sort((a, b) => Math.abs(b.move_24h_pct ?? 0) - Math.abs(a.move_24h_pct ?? 0))
        .slice(0, 5),
    [assets],
  );

  // The face in the pitch panel: today's biggest gainer (a sign-up page should look happy), in her
  // "to the moon" pose on a big day; the biggest loser, coping, only when nothing is up.
  const featured = useMemo(() => {
    const up = [...assets].filter((asset) => (asset.move_24h_pct ?? 0) > 0).sort((a, b) => (b.move_24h_pct ?? 0) - (a.move_24h_pct ?? 0))[0];
    if (up) return { asset: up, pose: (up.move_24h_pct ?? 0) >= 0.03 ? ("moon" as const) : ("hype" as const) };
    return movers[0] ? { asset: movers[0], pose: "cope" as const } : null;
  }, [assets, movers]);

  function resetTurnstile() {
    if (!turnstileWidget.current || !window.turnstile) return;
    window.turnstile.reset(turnstileWidget.current);
    setTurnstileToken("");
  }

  function renderTurnstile() {
    if (!needsCaptcha || !window.turnstile || !turnstileRef.current || turnstileWidget.current) return;
    turnstileWidget.current = window.turnstile.render(turnstileRef.current, {
      sitekey: turnstileSiteKey,
      appearance: "always",
      theme: document.documentElement.dataset.theme === "light" ? "light" : "dark",
      callback: (value: string) => {
        setTurnstileToken(value);
        setNotice(null);
      },
      "expired-callback": () => setTurnstileToken(""),
      "error-callback": () => setTurnstileToken(""),
    });
  }

  useEffect(() => {
    renderTurnstile();
  });

  async function callApi(path: string, body: Record<string, unknown>) {
    setBusy(true);
    setOwnError(null);
    try {
      await apiFetch(path, { method: "POST", body: JSON.stringify(body) });
      return true;
    } catch (reason) {
      setOwnError(String((reason as Error).message || reason));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!captchaDone) {
      setNotice("Finish the security check first.");
      return;
    }
    setSubmitted(true);
    if (mode === "forgot") {
      if (await callApi("/api/auth/forgot-password", { login: username.trim(), turnstile_token: turnstileToken })) {
        // The form (and its check) goes away; "Try again" brings a fresh one.
        turnstileWidget.current = "";
        setTurnstileToken("");
        setDone(true);
      } else resetTurnstile();
      return;
    }
    if (mode === "reset") {
      if (!token) return;
      if (await callApi("/api/auth/reset-password", { token, password })) {
        await refreshSession();
        setDone(true);
      }
      return;
    }
    try {
      if (mode === "login") await login(username.trim(), password, turnstileToken);
      else await register(username.trim(), email.trim(), password, ogey, turnstileToken);
      router.push(mode === "register" ? "/profile" : nextPath());
    } catch {
      resetTurnstile();
    }
  }

  const form = (
    <form className={styles.form} onSubmit={(event) => void submit(event)}>
      {mode !== "reset" ? (
        <label>
          <span className={styles.label}>{mode === "register" ? "Username" : "Username or email"}</span>
          <input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete={mode === "forgot" ? "email" : "username"} maxLength={mode === "register" ? 32 : 254} required autoFocus />
          {mode === "register" ? <small>3–32 characters. Letters, numbers, underscores, spaces.</small> : null}
        </label>
      ) : null}
      {mode === "register" ? (
        <label>
          <span className={styles.label}>Email</span>
          <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required />
          <small>We send a link to verify it before you can trade or post. It&apos;s also how you get back in if you forget your password.</small>
        </label>
      ) : null}
      {mode !== "forgot" ? (
        <label>
          <span className={styles.labelRow}>
            <span className={styles.label}>{mode === "reset" ? "New password" : "Password"}</span>
            {mode === "login" ? <Link href="/forgot-password">Forgot it?</Link> : null}
          </span>
          <span className={styles.pw}>
            <input
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete={newPassword ? "new-password" : "current-password"}
              minLength={newPassword ? 8 : undefined}
              maxLength={200}
              required
              autoFocus={mode === "reset"}
            />
            <button type="button" onClick={() => setShowPassword(!showPassword)} aria-pressed={showPassword} aria-label={showPassword ? "Hide password" : "Show password"}>
              {showPassword ? "HIDE" : "SHOW"}
            </button>
          </span>
          {newPassword ? <small className={password && password.length < 8 ? styles.warnText : undefined}>{password && password.length < 8 ? `${8 - password.length} more character${8 - password.length === 1 ? "" : "s"} to go (8 minimum).` : `At least 8 characters${password ? ` · ${password.length} ✓` : ""}.`}</small> : null}
        </label>
      ) : null}
      {mode === "register" ? (
        <label>
          <span className={styles.label}>ogey?</span>
          <input value={ogey} onChange={(event) => setOgey(event.target.value)} autoComplete="off" spellCheck={false} required className={ogeyWrong ? styles.bad : undefined} />
          {ogeyWrong ? <small className={styles.warnText}>that&apos;s not ogey</small> : null}
        </label>
      ) : null}

      {needsCaptcha ? <div ref={turnstileRef} className={styles.captcha} /> : null}
      {notice ? <p className={styles.notice}>{notice}</p> : null}
      {shownError ? (
        <p className={styles.error} role="alert">
          {shownError}
          {errorCode === "invalid_reset_token" || errorCode === "missing_token" ? (
            <>
              {" "}
              <Link href="/forgot-password">Get a new link →</Link>
            </>
          ) : null}
        </p>
      ) : null}

      <button type="submit" className={styles.submit} disabled={working || !captchaDone || (mode === "reset" && !token)}>
        {working ? "…" : SUBMIT_LABELS[mode]}
      </button>
    </form>
  );

  return (
    <SiteShell>
      {needsCaptcha ? <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" strategy="afterInteractive" onLoad={renderTurnstile} /> : null}
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
            {done && mode === "forgot" ? (
              <>
                <h1>Check your email</h1>
                <p className={styles.lede}>
                  If <b>{username.trim()}</b>{" "}matches an account, a link to choose a new password is on its way to that account&apos;s email. It works once, for an hour.
                </p>
                <p className={styles.lede}>Nothing after a few minutes? Check your spam folder, or ask again in a minute.</p>
                <div className={styles.doneActions}>
                  <button type="button" onClick={() => setDone(false)}>
                    TRY AGAIN
                  </button>
                  <Link href="/login">SIGN IN</Link>
                </div>
              </>
            ) : done && mode === "reset" ? (
              <>
                <h1>Password changed</h1>
                <p className={styles.lede}>
                  You&apos;re signed in{user ? (
                    <>
                      {" "}as <b>{user.username}</b>
                    </>
                  ) : null}
                  . Anywhere else you were signed in, you&apos;ll need the new password.
                </p>
                <div className={styles.doneActions}>
                  <Link href="/profile">YOUR PROFILE</Link>
                  <Link href="/stocks">THE MARKET</Link>
                </div>
              </>
            ) : (
              <>
                <h1>{HEADINGS[mode]}</h1>
                <p className={styles.lede}>{LEDES[mode]}</p>

                {user && usesStore ? (
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

                {form}
              </>
            )}

            <p className={styles.switch} hidden={done}>
              {mode === "login" ? (
                <>
                  New here? <Link href="/register">Make an account</Link>.
                </>
              ) : mode === "register" ? (
                <>
                  Already have one? <Link href="/login">Sign in</Link>.
                </>
              ) : (
                <>
                  Remembered it? <Link href="/login">Sign in</Link>.
                </>
              )}
            </p>
          </div>
        </section>

        <aside className={styles.pitch} aria-label="What is nasfaq">
          {/* The day's top gainer stands in the art panel, faded into it (like the trade ticket's art). */}
          <div className={styles.pitchStage}>
            <SceneArt slot="site-auth-pitch" width={420} className={styles.pitchArt} />
            {featured ? (
              <ArtSlot kind="chibi" pose={featured.pose} symbol={featured.asset.symbol} icon={featured.asset.icon} accent="var(--blue)" width={360} fade vignette fadeLength={0.3} className={styles.chibi} />
            ) : null}
          </div>
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
