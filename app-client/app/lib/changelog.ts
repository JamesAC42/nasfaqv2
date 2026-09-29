// What's new, for players: the /changelog page (and the refresh notice links to it). Newest first.
// One entry per release that changes something a player would notice, in plain language; no
// developer notes. Each PR with player-visible changes adds or extends an entry here.

export type ChangeKind = "new" | "improved" | "fixed";

export type ChangelogEntry = {
  /** The day it went out (ET), ISO. */
  date: string;
  title: string;
  changes: Array<{ kind: ChangeKind; text: string }>;
};

export const CHANGELOG: ChangelogEntry[] = [
  {
    date: "2026-09-29",
    title: "Profile themes, properly",
    changes: [
      { kind: "new", text: "Pick your theme in Edit profile, next to your banner." },
      { kind: "improved", text: "Themes now style your whole profile: a backdrop in the theme's pattern, tinted panels, and accents on headings, tabs and your avatar." },
      { kind: "improved", text: "With banner art on, the theme still shades the banner and colours the rest of the page." },
    ],
  },
  {
    date: "2026-09-29",
    title: "Who's around",
    changes: [{ kind: "new", text: "The front page shows how many people are on the site right now." }],
  },
  {
    date: "2026-09-29",
    title: "Updates without the interruptions",
    changes: [
      { kind: "new", text: "Updates don't cut games off anymore. While one goes out, new games wait a few minutes and the ones in play finish first." },
      { kind: "new", text: "When a new version is out, a bar at the top offers a refresh. Tabs you aren't looking at update on their own." },
      { kind: "new", text: "This page: what changed in each update." },
    ],
  },
  {
    date: "2026-09-29",
    title: "Launch day fixes",
    changes: [
      { kind: "fixed", text: "Stock pages wouldn't load for a while after launch." },
      { kind: "fixed", text: "The Wire's mood of /vt/ wasn't reading posts. It is now, and it says how many it hasn't read yet." },
    ],
  },
  {
    date: "2026-09-29",
    title: "The new NASFAQ",
    changes: [
      { kind: "new", text: "A redesigned site, with the Wire as the front page: headlines written from real channel and market numbers." },
      { kind: "new", text: "New stock pages with channel charts, supply, and each week's dividend review." },
      { kind: "new", text: "Saturday dividend reviews: holders are paid, or charged, on each channel's week, and max shares reset." },
      { kind: "new", text: "Games: talent cards and a collection, card duels, High-Low, multiplayer blackjack, the capsule machine, and a card exchange." },
      { kind: "new", text: "Prediction markets, notifications, profile banners and portfolio themes." },
    ],
  },
];
