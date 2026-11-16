"use client";

import Link from "next/link";
import { useState } from "react";
import { makeTimeFormat, zoneCity } from "@/app/lib/display-time.mjs";
import { useNowEvery } from "@/app/lib/use-now";
import { useTimeZoneSetting, type TimeZoneChoice } from "@/app/lib/use-display-time";
import { withNext } from "@/app/lib/return-path.mjs";
import { useAuthStore } from "@/app/stores/auth-store";
import styles from "@/app/components/settings/settings.module.scss";

// The Display section of /settings (timezone-setting flag): clock times in New York market time or
// the player's own. Signed in, the pick is saved on the account (api/src/routes/settings.js); signed
// out, in this browser. lib/use-display-time.ts holds it and every time on the site reads it.

export function DisplaySettings() {
  const setting = useTimeZoneSetting();
  const signedIn = useAuthStore((state) => Boolean(state.user));
  const now = useNowEvery(30_000);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!setting.available) return null;

  const current: TimeZoneChoice = setting.choice ?? "market";
  const sample = (choice: TimeZoneChoice) => makeTimeFormat({ mode: choice, browserZone: setting.browserZone }).clock(now);
  const pick = async (choice: TimeZoneChoice) => {
    if (busy || (choice === current && setting.answered)) return;
    setBusy(true);
    setError(null);
    try {
      await setting.save(choice);
    } catch {
      setError("Couldn’t save that. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const options: Array<{ value: TimeZoneChoice; title: string; detail: string }> = [
    { value: "market", title: "New York market time (ET)", detail: "The market’s own clock." },
    {
      value: "local",
      title: "My local time",
      detail: setting.inMarketZone ? "Your browser is on New York time, so this looks the same." : `${zoneCity(setting.browserZone)}, from your browser.`,
    },
  ];

  return (
    <section className={styles.section} id="display" aria-labelledby="display-title">
      <h2 id="display-title">Display</h2>
      <div className={styles.choices} role="radiogroup" aria-label="Show times in">
        <span className={styles.label}>Show times in</span>
        {options.map((option) => (
          <label key={option.value} className={styles.choice} data-on={current === option.value || undefined}>
            <input type="radio" name="time-zone" value={option.value} checked={current === option.value} disabled={busy || !setting.mounted} onChange={() => void pick(option.value)} />
            <span>
              <b>{option.title}</b>
              <small>{option.detail}</small>
            </span>
            <time className={styles.sample} suppressHydrationWarning>
              {setting.mounted ? sample(option.value) : ""}
            </time>
          </label>
        ))}
      </div>
      <p className={styles.note}>Only the clock changes. Market days, the four ticks, the check-in reset and Saturday’s review still run on New York time.</p>
      {!signedIn ? (
        <p className={styles.note}>
          Saved in this browser. <Link href={withNext("/login", "/settings")}>Sign in</Link> to keep it on every device.
        </p>
      ) : null}
      {error ? <p className={styles.error}>{error}</p> : null}
    </section>
  );
}
