"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { SiteShell } from "@/app/components/layout/site-shell";
import { useAuth } from "@/app/providers/auth-provider";
import styles from "@/app/components/auth/auth-form.module.scss";

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const router = useRouter();
  const { login, register, error, isLoading, user } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      if (mode === "login") {
        await login(username, password);
      } else {
        await register(username, password);
      }
      router.push("/profile");
    } catch {}
  }

  return (
    <SiteShell>
      <section className={styles.panel}>
        <h2 className={styles.title}>{mode === "login" ? "Login" : "Register"}</h2>
        <p className={styles.copy}>
          {mode === "login"
            ? "Auth state now lives in a dedicated context plus Zustand store."
            : "Registration is split onto its own route so the home page can focus on market surfaces."}
        </p>
        {user ? <div className="statusMessage statusMessageSuccess">Already signed in as {user.username}.</div> : null}
        <form className={styles.form} onSubmit={(event) => void handleSubmit(event)}>
          <label className={styles.label}>
            <span>Username</span>
            <input className={styles.input} value={username} onChange={(event) => setUsername(event.target.value)} />
          </label>
          <label className={styles.label}>
            <span>Password</span>
            <input className={styles.input} type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
          </label>
          <button type="submit" className={styles.submit} disabled={isLoading}>
            {mode === "login" ? "Sign In" : "Create User"}
          </button>
        </form>
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
