"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import Script from "next/script";
import { FormEvent, useEffect, useRef, useState } from "react";
import { SiteShell } from "@/app/components/layout/site-shell";
import { useAuth } from "@/app/providers/auth-provider";
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

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const router = useRouter();
  const { login, register, loginWithGoogle, resendVerification, error, isLoading, user } = useAuth();
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [turnstileToken, setTurnstileToken] = useState("");
  const [verificationSent, setVerificationSent] = useState(false);
  const [authNotice, setAuthNotice] = useState<string | null>(null);
  const [googleScriptReady, setGoogleScriptReady] = useState(false);
  const turnstileRef = useRef<HTMLDivElement | null>(null);
  const turnstileWidgetRef = useRef<string>("");
  const googleButtonRef = useRef<HTMLDivElement | null>(null);
  const turnstileTokenRef = useRef("");
  const googleButtonRenderedRef = useRef(false);

  const turnstileIsRequired = Boolean(turnstileSiteKey);
  const turnstileIsVerified = !turnstileIsRequired || Boolean(turnstileToken);

  function resetTurnstile() {
    if (!turnstileWidgetRef.current || !window.turnstile) return;
    window.turnstile.reset(turnstileWidgetRef.current);
    setTurnstileToken("");
    turnstileTokenRef.current = "";
  }

  function renderTurnstile() {
    if (!turnstileSiteKey || !window.turnstile || !turnstileRef.current || turnstileWidgetRef.current) return;
    turnstileWidgetRef.current = window.turnstile.render(turnstileRef.current, {
      sitekey: turnstileSiteKey,
      appearance: "interaction-only",
      callback: (token: string) => {
        turnstileTokenRef.current = token;
        setTurnstileToken(token);
        setAuthNotice(null);
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

  function renderGoogleButton() {
    if (!googleScriptReady || !googleClientId || !window.google || !googleButtonRef.current || googleButtonRenderedRef.current) return;
    window.google.accounts.id.initialize({
      client_id: googleClientId,
      callback: async (response: { credential?: string }) => {
        if (!response.credential) return;
        const token = turnstileTokenRef.current;
        if (turnstileIsRequired && !token) {
          setAuthNotice("Complete the Turnstile check before signing in with Google.");
          return;
        }
        try {
          await loginWithGoogle(response.credential, token);
          router.push("/profile");
        } finally {
          resetTurnstile();
        }
      },
    });
    window.google.accounts.id.renderButton(googleButtonRef.current, {
      theme: "outline",
      size: "large",
      text: mode === "login" ? "signin_with" : "signup_with",
      width: 320,
    });
    googleButtonRenderedRef.current = true;
  }

  useEffect(() => {
    renderTurnstile();
    renderGoogleButton();
  });

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!turnstileIsVerified) {
      setAuthNotice("Complete the Turnstile check before continuing.");
      return;
    }
    try {
      if (mode === "login") {
        await login(username, password, turnstileToken);
      } else {
        await register(username, email, password, turnstileToken);
        setVerificationSent(true);
      }
      router.push("/profile");
    } catch {
      resetTurnstile();
    }
  }

  return (
    <SiteShell>
      {turnstileSiteKey ? <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" strategy="afterInteractive" onLoad={renderTurnstile} /> : null}
      {googleClientId ? <Script src="https://accounts.google.com/gsi/client" strategy="afterInteractive" onLoad={() => setGoogleScriptReady(true)} /> : null}
      <section className={styles.panel}>
        <h2 className={styles.title}>{mode === "login" ? "Login" : "Register"}</h2>
        <p className={styles.copy}>
          {mode === "login"
            ? "Sign in with a password or Google. Email must be verified before trading or posting."
            : "Create an account, verify your email, then you can trade, chat, comment, and write articles."}
        </p>
        {user ? <div className="statusMessage statusMessageSuccess">Already signed in as {user.username}.</div> : null}
        {user && !user.email_verified ? (
          <div className="statusMessage statusMessageError">
            Email verification is required before trading or posting.{" "}
            <button type="button" className={styles.inlineButton} onClick={() => void resendVerification()}>
              Resend verification email
            </button>
          </div>
        ) : null}
        {verificationSent ? <div className="statusMessage statusMessageSuccess">Verification email sent. Open the link before posting or trading.</div> : null}
        {authNotice ? <div className="statusMessage statusMessageWarn">{authNotice}</div> : null}
        <form className={styles.form} onSubmit={(event) => void handleSubmit(event)}>
          <label className={styles.label}>
            <span>{mode === "login" ? "Username or email" : "Username"}</span>
            <input className={styles.input} value={username} onChange={(event) => setUsername(event.target.value)} />
          </label>
          {mode === "register" ? (
            <label className={styles.label}>
              <span>Email</span>
              <input className={styles.input} type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
            </label>
          ) : null}
          <label className={styles.label}>
            <span>Password</span>
            <input className={styles.input} type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
          </label>
          {turnstileSiteKey ? <div ref={turnstileRef} className={styles.turnstile} /> : null}
          <button type="submit" className={styles.submit} disabled={isLoading || !turnstileIsVerified}>
            {mode === "login" ? "Sign In" : "Create User"}
          </button>
        </form>
        {googleClientId ? (
          <div className={styles.googleWrap}>
            <div className={styles.divider}>or</div>
            <div className={styles.googleButtonFrame}>
              <div ref={googleButtonRef} className={styles.googleButton} />
              {!turnstileIsVerified ? <div className={styles.googleButtonShield} aria-hidden="true" /> : null}
            </div>
            {!turnstileIsVerified ? <div className={styles.googleHint}>Complete captcha to continue.</div> : null}
          </div>
        ) : null}
        {mode === "register" ? (
          <p>Already have an account? <Link href="/login" className={styles.altLink}>Go to login</Link>.</p>
        ) : (
          <p>Need an account? <Link href="/register" className={styles.altLink}>Go to registration</Link>.</p>
        )}
        {error ? <div className="statusMessage statusMessageError">Auth error: {error}</div> : null}
      </section>
    </SiteShell>
  );
}
