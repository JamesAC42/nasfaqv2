// NASFAQ's service worker: push notifications only (the daily check-in reminder, api/src/services/
// checkinReminders.js, and the bell's notifications, api/src/services/pushNotifications.js). It's
// registered only when a player turns notifications on in Settings
// (app/components/settings/notification-settings.tsx).
//
// It must never handle `fetch` or use the Cache API: a worker that serves pages or files from a cache
// can keep showing an old build after a deploy, and it's hard to take back from players' browsers.
// app/lib/service-worker.test.mjs fails if either shows up here.

self.addEventListener("install", () => {
  // Nothing to set up: take over from an older copy of this file straight away.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const title = typeof data.title === "string" && data.title ? data.title : "NASFAQ";
  const url = typeof data.url === "string" && data.url.startsWith("/") && !data.url.startsWith("//") ? data.url : "/";
  // A push the browser was sent must always show something (userVisibleOnly).
  event.waitUntil(
    self.registration.showNotification(title, {
      body: typeof data.body === "string" ? data.body : "",
      tag: typeof data.tag === "string" && data.tag ? data.tag : undefined,
      // A newer push with the same tag replaces the older one and still alerts.
      renotify: typeof data.tag === "string" && data.tag ? true : undefined,
      icon: "/android-chrome-192x192.png",
      badge: "/favicon-32x32.png",
      data: { url },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/", self.location.origin);
  event.waitUntil(
    (async () => {
      const open = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      // Reuse a tab that's already on the site: bring it forward and take it to the push's page.
      for (const client of open) {
        if (new URL(client.url).origin !== target.origin) continue;
        await client.focus();
        try {
          await client.navigate(target.href);
        } catch {
          // A tab this worker doesn't control can't be steered: open the page in a new one.
          await self.clients.openWindow(target.href);
        }
        return;
      }
      await self.clients.openWindow(target.href);
    })()
  );
});
