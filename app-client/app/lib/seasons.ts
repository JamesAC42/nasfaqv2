// Seasonal looks (fall now, Christmas later). A date window turns a season on for everyone; the
// boot script in app/layout.tsx stamps it on <html> before first paint:
//   data-season-now="fall"  the season running now (or being previewed), even if this player turned it off
//   data-season="fall"      the season being shown; its palette is [data-season="…"] in styles/_theme.scss
// A player can turn the current season off (stored per season, so the next one still shows up).
// Preview any season with ?season=<id> on a page load, or ?season=none for the normal look.
//
// Adding a season: one entry here, its [data-season] block in _theme.scss, and an icon in
// components/layout/season-toggle.tsx.

export type Season = {
  id: string;
  /** Player-facing name, used on the toggle. */
  label: string;
  /** First and last day, inclusive, as America/New_York calendar dates. */
  start: string;
  end: string;
};

export const SEASONS = [
  { id: "fall", label: "Fall colours", start: "2026-10-31", end: "2026-11-30" },
] as const satisfies readonly Season[];

export type SeasonId = (typeof SEASONS)[number]["id"];

/** localStorage: the id of the season this player turned off. */
export const SEASON_OFF_KEY = "nasfaq.season.off";

export function findSeason(id: string | null | undefined) {
  return SEASONS.find((season) => season.id === id) ?? null;
}

// Plain ES5 for the inline boot script; the date is ET whatever the player's timezone.
export const seasonBootScript = `try{var S=${JSON.stringify(SEASONS.map(({ id, start, end }) => ({ id, start, end })))},n=null,q=/[?&]season=([a-z-]+)/.exec(location.search);if(q){for(var i=0;i<S.length;i++)if(S[i].id===q[1])n=S[i].id;}else{var p={};new Intl.DateTimeFormat("en-US",{timeZone:"America/New_York",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date()).forEach(function(x){p[x.type]=x.value;});var day=p.year+"-"+p.month+"-"+p.day;for(var j=0;j<S.length;j++)if(day>=S[j].start&&day<=S[j].end)n=S[j].id;}if(n){d.dataset.seasonNow=n;var o=null;try{o=localStorage.getItem(${JSON.stringify(SEASON_OFF_KEY)});}catch(e){}if(q||o!==n)d.dataset.season=n;}}catch(e){}`;
