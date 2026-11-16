// This browser's push subscription (the check-in reminder, components/settings/notification-settings.tsx),
// for signing out: the endpoint goes with the logout request so the API forgets it for that player,
// then the subscription and the service worker are dropped here. Never registers anything, and never
// throws: signing out must work whatever the browser can do.

/** This browser's push endpoint, or null (no worker, no subscription, no support). */
export async function thisBrowserPushEndpoint(): Promise<string | null> {
  try {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
    const registration = await navigator.serviceWorker.getRegistration("/");
    const subscription = await registration?.pushManager?.getSubscription();
    return subscription?.endpoint ?? null;
  } catch {
    return null;
  }
}

/** Unsubscribes this browser and unregisters the push worker, if there is one. */
export async function dropThisBrowserPush(): Promise<void> {
  try {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    const registration = await navigator.serviceWorker.getRegistration("/");
    if (!registration) return;
    const subscription = await registration.pushManager?.getSubscription();
    await subscription?.unsubscribe().catch(() => false);
    await registration.unregister().catch(() => false);
    localStorage.removeItem("nasfaq.pushDevice"); // which device row is this browser (notification-settings.tsx)
  } catch {
    /* nothing to drop, or the browser won't say */
  }
}
