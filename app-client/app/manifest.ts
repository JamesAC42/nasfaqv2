import type { MetadataRoute } from "next";

// The web app manifest (/manifest.webmanifest). "standalone" is what lets iPhone and iPad take push
// notifications: iOS only offers web push to a site added to the Home Screen with a manifest like this
// (components/settings/notification-settings.tsx walks players through it). It's site-wide: anyone can
// add the site to their Home Screen, whatever the feature flags say. No service worker comes with it;
// public/sw.js is registered only when a player turns notifications on, and never caches.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "NASFAQ",
    short_name: "NASFAQ",
    description: "The hololive stock market. Every talent is a stock, priced on their real YouTube numbers.",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#0a0c11",
    theme_color: "#0a0c11",
    icons: [
      { src: "/android-chrome-192x192.png", sizes: "192x192", type: "image/png" },
      { src: "/android-chrome-512x512.png", sizes: "512x512", type: "image/png" },
      { src: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
  };
}
