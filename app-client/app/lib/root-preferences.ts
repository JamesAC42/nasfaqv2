import { SEASONS } from "@/app/lib/seasons";

// The saved theme, seasonal theme and calm mode live on <html> as data-* attributes. The boot script
// in app/layout.tsx stamps them before first paint, but that only runs once per page load. If
// hydration ever fails, React rebuilds the document and resets <html> to what the layout's JSX says
// (dark, not calm, no season), so the player's choices are gone until they reload a page that
// hydrates cleanly. restoreRootPreferences() puts them back; AppProviders calls it on mount.
//
// It must stay in step with the boot script (app/layout.tsx) and seasonBootScript (lib/seasons.ts).

function stamp(root: HTMLElement, name: "theme" | "calm" | "season" | "seasonNow", value: string) {
  // Writing the same value still wakes every useRootAttribute subscriber, so only write a change.
  if (root.dataset[name] !== value) root.dataset[name] = value;
}

function marketDay() {
  const parts: Record<string, string> = {};
  for (const part of new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date())) {
    parts[part.type] = part.value;
  }
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function restoreRootPreferences() {
  const root = document.documentElement;
  let theme: string | null = null;
  try {
    theme = window.localStorage.getItem("nasfaq.theme");
    const calm = window.localStorage.getItem("nasfaq.calm");
    stamp(root, "calm", calm === "1" || (calm === null && window.matchMedia("(prefers-reduced-motion: reduce)").matches) ? "true" : "false");
  } catch {
    // storage can be unavailable (private mode): the defaults stand, as they do in the boot script
  }

  let base = theme === "light" ? "light" : "dark";
  try {
    const preview = /[?&]season=([a-z-]+)/.exec(window.location.search);
    const day = preview ? "" : marketDay();
    const offered: string[] = [];
    for (const season of SEASONS) {
      if (preview ? season.id === preview[1] : day >= season.start && day <= season.end) {
        offered.push(season.id);
        if (preview || theme === season.id) {
          stamp(root, "season", season.id);
          base = season.base;
        }
      }
    }
    if (offered.length) stamp(root, "seasonNow", offered.join(" "));
  } catch {
    // no Intl time zones: no seasons, as in the boot script
  }
  stamp(root, "theme", base);
}
