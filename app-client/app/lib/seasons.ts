// Seasonal themes (fall now, Christmas later). Players pick one like dark or light; it's never on by
// default. A season's date window decides when it's offered. The boot script in app/layout.tsx
// stamps <html> before first paint:
//   data-season-now="fall"  a season is on offer now (or previewed), so the theme switch shows it
//   data-season="fall"      the player picked it; its palette is [data-season="…"] in styles/_theme.scss,
//                           on top of data-theme=<base>
// The pick is stored in nasfaq.theme like dark/light. Once the window closes it falls back to dark.
// Preview any season with ?season=<id> on a page load, or hide the current one with ?season=none.
//
// Adding a season: one entry here, its [data-season] block in _theme.scss, and an icon in
// components/layout/theme-switch.tsx.

export type Season = {
  id: string;
  /** Player-facing name, used on the theme switch. */
  label: string;
  /** The light/dark palette it's built on; components that ask useTheme().theme get this. */
  base: "dark" | "light";
  /** First and last day it's offered, inclusive, as America/New_York calendar dates. */
  start: string;
  end: string;
};

export const SEASONS = [
  { id: "fall", label: "Fall colours", base: "dark", start: "2026-10-31", end: "2026-11-30" },
] as const satisfies readonly Season[];

export type SeasonId = (typeof SEASONS)[number]["id"];

export function findSeason(id: string | null | undefined) {
  return SEASONS.find((season) => season.id === id) ?? null;
}

// Plain ES5 for the inline boot script. Expects `d` (<html>) and `t` (the stored nasfaq.theme) from
// app/layout.tsx. The date is ET whatever the player's timezone.
export const seasonBootScript = `try{var S=${JSON.stringify(SEASONS.map(({ id, base, start, end }) => ({ id, base, start, end })))},n=null,q=/[?&]season=([a-z-]+)/.exec(location.search);if(q){for(var i=0;i<S.length;i++)if(S[i].id===q[1])n=S[i];}else{var p={};new Intl.DateTimeFormat("en-US",{timeZone:"America/New_York",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date()).forEach(function(x){p[x.type]=x.value;});var day=p.year+"-"+p.month+"-"+p.day;for(var j=0;j<S.length;j++)if(day>=S[j].start&&day<=S[j].end)n=S[j];}if(n){d.dataset.seasonNow=n.id;if(q||t===n.id){d.dataset.season=n.id;d.dataset.theme=n.base;}}}catch(e){}`;
