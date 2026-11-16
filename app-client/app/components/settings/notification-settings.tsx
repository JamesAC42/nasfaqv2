"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/app/lib/api";
import { browserPushEnvironment, keyBytes, pushSupport, type PushSupport } from "@/app/lib/push-support.mjs";
import { timeAgo } from "@/app/lib/time";
import styles from "@/app/components/settings/settings.module.scss";

// The Notifications section of /settings (api/src/routes/settings.js). Reminders are listed one row
// each, with a switch per channel: push now, room for email later (a new key in `preferences` and a
// new column here). Everything starts off.
//
// Push works per browser: turning the reminder on in one asks that browser for permission, registers
// public/sw.js (push only, no caching) and saves its subscription. The service worker is registered
// only here, only when the player turns push on, and unregistered again when they turn it off in
// that browser. iPhone and iPad first need the site on the Home Screen (lib/push-support.mjs).

type Device = { id: number; label: string; created_at: string; last_success_at: string | null };
type Settings = {
  preferences: { checkin_reminder_push: boolean };
  push: { available: boolean; public_key: string | null };
  devices: Device[];
  /** The New York hour the check-in reminder goes out (api CHECKIN_REMINDER_HOUR). */
  schedule?: { checkin_reminder_hour: number };
  device_id?: number;
};

/** 18 → "6 PM", 0 → "12 AM". */
const hourText = (hour: number) => `${hour % 12 || 12} ${hour < 12 ? "AM" : "PM"}`;

const SW_PATH = "/sw.js";
const DEVICE_KEY = "nasfaq.pushDevice";

function rememberDevice(id: number | null) {
  try {
    if (id) localStorage.setItem(DEVICE_KEY, String(id));
    else localStorage.removeItem(DEVICE_KEY);
  } catch {
    /* storage blocked: the list just won't say which one is this browser */
  }
}

function rememberedDevice(): number | null {
  try {
    return Number(localStorage.getItem(DEVICE_KEY)) || null;
  } catch {
    return null;
  }
}

/** This browser's push subscription, without registering anything. */
async function currentSubscription(): Promise<PushSubscription | null> {
  if (!("serviceWorker" in navigator)) return null;
  const registration = await navigator.serviceWorker.getRegistration("/");
  return (await registration?.pushManager.getSubscription()) ?? null;
}

const save = (body: object) => apiFetch<Settings>("/api/settings/notifications", { method: "PUT", body: JSON.stringify(body) });
const saveDevice = (subscription: PushSubscription) =>
  apiFetch<Settings>("/api/settings/notifications/devices", { method: "POST", body: JSON.stringify({ subscription: subscription.toJSON() }) });

function errorText(reason: unknown) {
  const message = String((reason as Error)?.message || reason || "");
  if (message === "push_unavailable") return "Push isn’t available on the site right now.";
  if (message === "invalid_subscription") return "This browser gave a push address the site doesn’t accept.";
  return message || "Something went wrong.";
}

function HomeScreenSteps() {
  return (
    <div className={styles.callout}>
      <b>On iPhone and iPad, add NASFAQ to your Home Screen first</b>
      <p>iOS only sends web notifications to sites added to the Home Screen (iOS 16.4 or later).</p>
      <ol>
        <li>Open this page in Safari.</li>
        <li>
          Tap <b>Share</b> (the square with an arrow), then <b>Add to Home Screen</b>, then <b>Add</b>.
        </li>
        <li>Open NASFAQ from the new icon on your Home Screen. Sign in again if it asks: it can keep its own sign-in, apart from Safari.</li>
        <li>
          Go to <b>Settings</b> (<b>Me</b>, then <b>Settings</b>, or <b>More</b>, then <b>Settings</b>) and turn the reminder on.
        </li>
      </ol>
    </div>
  );
}

function SupportNote({ support }: { support: PushSupport }) {
  if (support === "ios-home-screen") return <HomeScreenSteps />;
  if (support === "ios-update") return <p className={styles.note}>Web notifications need iOS 16.4 or later, opened from the Home Screen. Update iOS, then add NASFAQ to your Home Screen.</p>;
  if (support === "insecure") return <p className={styles.note}>Notifications only work on the site’s secure (https) address.</p>;
  if (support === "unsupported") return <p className={styles.note}>This browser can’t show notifications from websites. Chrome, Edge, Firefox and Safari can.</p>;
  return null;
}

export function NotificationSettings() {
  const [data, setData] = useState<Settings | null>(null);
  const [support, setSupport] = useState<PushSupport | null>(null);
  const [here, setHere] = useState<number | null>(null);
  const [subscribedHere, setSubscribedHere] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loaded = useCallback(async (settings: Settings) => {
    setData(settings);
    const env = browserPushEnvironment();
    const supported = pushSupport(env);
    setSupport(supported);
    if ("Notification" in window) setPermission(Notification.permission);
    if (supported !== "supported" || !settings.push.available) return;
    const subscription = await currentSubscription().catch(() => null);
    setSubscribedHere(Boolean(subscription));
    if (subscription && settings.preferences.checkin_reminder_push) {
      // Saved again so the site has it (a push service can drop one), and so it's this player's.
      const synced = await saveDevice(subscription).catch(() => null);
      if (synced) {
        setData(synced);
        rememberDevice(synced.device_id ?? null);
      }
    }
    setHere(rememberedDevice());
  }, []);

  useEffect(() => {
    apiFetch<Settings>("/api/settings/notifications", { cache: "no-store" })
      .then(loaded)
      .catch((reason) => setError(errorText(reason)));
  }, [loaded]);

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  };

  /** Asks for permission, registers the worker and saves this browser. Must start from a click. */
  const subscribeHere = async (settings: Settings) => {
    const answer = await Notification.requestPermission();
    setPermission(answer);
    if (answer !== "granted") throw new Error(answer === "denied" ? "Notifications are blocked for this site. Allow them in your browser’s site settings, then try again." : "Notifications weren’t allowed.");
    const registration = await navigator.serviceWorker.register(SW_PATH, { scope: "/", updateViaCache: "none" });
    await navigator.serviceWorker.ready;
    const subscription =
      (await registration.pushManager.getSubscription()) ??
      (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(settings.push.public_key ?? "") }));
    const saved = await saveDevice(subscription);
    rememberDevice(saved.device_id ?? null);
    setHere(saved.device_id ?? null);
    setSubscribedHere(true);
    setData(saved);
  };

  /** Drops this browser's subscription here and on the site, and the worker with it. */
  const unsubscribeHere = async () => {
    const registration = await navigator.serviceWorker.getRegistration("/");
    const subscription = await registration?.pushManager.getSubscription();
    if (subscription) {
      setData(await apiFetch<Settings>("/api/settings/notifications/devices/remove", { method: "POST", body: JSON.stringify({ endpoint: subscription.endpoint }) }));
      await subscription.unsubscribe().catch(() => {});
    }
    await registration?.unregister().catch(() => {});
    rememberDevice(null);
    setHere(null);
    setSubscribedHere(false);
  };

  const togglePush = (on: boolean) =>
    run(async () => {
      if (!data) return;
      if (on && !subscribedHere) await subscribeHere(data);
      setData(await save({ preferences: { checkin_reminder_push: on } }));
    });

  const removeDevice = (device: Device) =>
    run(async () => {
      if (device.id === here && subscribedHere) return unsubscribeHere();
      setData(await apiFetch<Settings>(`/api/settings/notifications/devices/${device.id}`, { method: "DELETE" }));
    });

  if (!data) {
    return (
      <section className={styles.section} id="notifications" aria-labelledby="notifications-title">
        <h2 id="notifications-title">Notifications</h2>
        <p className={styles.note}>{error ? `Couldn’t load your settings (${error}).` : "Loading…"}</p>
      </section>
    );
  }

  const pushOn = data.preferences.checkin_reminder_push;
  const canToggle = data.push.available && support === "supported";

  return (
    <section className={styles.section} id="notifications" aria-labelledby="notifications-title">
      <h2 id="notifications-title">Notifications</h2>
      <p className={styles.note}>
        Reminders from the site, off until you turn them on. The bell, chat popups and muted players are on <Link href="/notifications#chat">Notifications</Link>.
      </p>

      <div className={styles.table} role="table" aria-label="Reminders">
        <div className={styles.tableHead} role="row">
          <span role="columnheader">Reminder</span>
          <span role="columnheader">Push</span>
          {/* Email goes here as its own column once it exists. */}
        </div>
        <div className={styles.tableRow} role="row">
          <span role="cell">
            <b>Daily check-in</b>
            <small>Once a day at {hourText(data.schedule?.checkin_reminder_hour ?? 18)} ET, if you haven’t checked in yet. The check-in resets at midnight ET.</small>
          </span>
          <span role="cell">
            {canToggle ? (
              <label className={styles.switch}>
                <input type="checkbox" checked={pushOn} disabled={busy} onChange={(event) => void togglePush(event.target.checked)} />
                <span>{pushOn ? "On" : "Off"}</span>
              </label>
            ) : (
              <span className={styles.dim}>{data.push.available ? "Not here" : "Unavailable"}</span>
            )}
          </span>
        </div>
      </div>

      {!data.push.available ? <p className={styles.note}>Push notifications aren’t set up on the site yet.</p> : support ? <SupportNote support={support} /> : null}
      {canToggle && permission === "denied" ? (
        <p className={styles.note}>Notifications are blocked for this site in your browser. Allow them in its site settings to get reminders here.</p>
      ) : null}
      {canToggle && pushOn && !subscribedHere ? (
        <p className={styles.note}>
          Reminders go to the devices below.{" "}
          <button type="button" className={styles.linkButton} disabled={busy} onClick={() => void run(() => subscribeHere(data))}>
            Send them to this browser too
          </button>
        </p>
      ) : null}
      {error ? <p className={styles.error}>{error}</p> : null}

      {data.devices.length ? (
        <div className={styles.devices} aria-label="Devices with push on">
          <span className={styles.label}>Devices</span>
          {data.devices.map((device) => (
            <div key={device.id} className={styles.device}>
              <span>
                {device.label}
                {device.id === here && subscribedHere ? <em> · this browser</em> : null}
                <small>
                  added {timeAgo(device.created_at)}
                  {device.last_success_at ? ` · last reminder ${timeAgo(device.last_success_at)}` : ""}
                </small>
              </span>
              <button type="button" className={styles.button} disabled={busy} onClick={() => void removeDevice(device)}>
                Remove
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
