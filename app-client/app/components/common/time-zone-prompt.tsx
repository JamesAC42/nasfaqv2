"use client";

import { useState } from "react";
import { FaClock } from "react-icons/fa6";
import { zoneCity } from "@/app/lib/display-time.mjs";
import { useTimeZoneSetting } from "@/app/lib/use-display-time";
import styles from "@/app/components/common/site-status-bar.module.scss";

/**
 * A one-time bar in the site's notice stack (timezone-setting flag) for a player whose browser isn't
 * on New York time: times are in market time, want them in yours? Either button is the answer, saved
 * like a pick on the Settings page (on the account when signed in, else in this browser), so it never
 * asks again. It waits until the pick has loaded, so it doesn't flash for someone who already chose.
 */
export function TimeZonePrompt() {
  const setting = useTimeZoneSetting();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  if (!setting.available || !setting.mounted || setting.answered !== false || setting.inMarketZone) return null;

  const answer = async (choice: "market" | "local") => {
    setBusy(true);
    setFailed(false);
    try {
      await setting.save(choice);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.stack}>
      <div className={styles.bar} data-tone="info" role="status">
        <span className={styles.tag}>
          <FaClock aria-hidden /> Time
        </span>
        <p className={styles.message}>
          {failed ? "Couldn’t save that. " : ""}Times are in New York market time. Show them in your time ({zoneCity(setting.browserZone)})?
        </p>
        <div className={styles.actions}>
          <button type="button" className={styles.primary} disabled={busy} onClick={() => void answer("local")}>
            Use my time
          </button>
          <button type="button" className={styles.later} disabled={busy} onClick={() => void answer("market")}>
            Keep ET
          </button>
        </div>
      </div>
    </div>
  );
}
