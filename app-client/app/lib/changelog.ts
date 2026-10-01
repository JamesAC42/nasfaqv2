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
    date: "2026-10-01",
    title: "Credit",
    changes: [
      {
        kind: "new",
        text: "A second balance, Credit. Games, the capsule machine, the card exchange and predictions run on it, so a bad night at the tables can't touch the cash you buy shares with.",
      },
      { kind: "new", text: "Dividends, winnings, achievements and a little of every sale pay Credit, and the 1% trading fee comes out of it first." },
      { kind: "new", text: "Every Saturday, part of your Credit turns into cash. The Dividend Review shows how much." },
    ],
  },
  {
    date: "2026-09-30",
    title: "Queued buys hold their cash",
    changes: [
      {
        kind: "improved",
        text: "A buy order takes its cost out of your cash as soon as you place it, with a little extra in case the price moves, and gives back whatever it didn't use when it fills. Cash promised to orders can't be spent on games or the exchange in the meantime, so your orders don't fail behind your back.",
      },
      { kind: "improved", text: "You can't queue sells for shares that are already in another queued sell." },
      { kind: "improved", text: "If an order is turned down, you're told which one and why, and Queued orders lists anything that wasn't placed in the last day." },
    ],
  },
  {
    date: "2026-09-30",
    title: "Small fixes",
    changes: [
      { kind: "fixed", text: "The buy panel stayed open after you went back a page (to the market, say). Leaving the page closes it now." },
      { kind: "fixed", text: "The card exchange showed the art of cards you haven't pulled. Cards you don't own show locked, like in your binder, until you get one." },
      { kind: "fixed", text: "Paging to older fills on a profile broke the page." },
    ],
  },
  {
    date: "2026-09-30",
    title: "Blackjack table print",
    changes: [{ kind: "fixed", text: "The small print on the blackjack table (\"Dealer stands on all 17s · Double on any two\") lost its first and last letters. It's all there now." }],
  },
  {
    date: "2026-09-30",
    title: "Capsule items on the exchange",
    changes: [
      { kind: "new", text: "Sell, auction and trade what you pull from the capsule machine: the exchange has a Capsule items market, each item has its own price page, and your locker has Sell buttons." },
      { kind: "new", text: "Trades can include items on either side." },
      { kind: "improved", text: "Players hold one of each item, so you can't buy one you already have. Anything you buy or trade for can go back on the exchange after 24 hours. Set rewards stay with you." },
    ],
  },
  {
    date: "2026-09-30",
    title: "Tidier pages",
    changes: [
      { kind: "fixed", text: "Other players' profiles said \"All cash, no bags\" even when they held stocks. They show how much is in stocks now (which stocks stays private)." },
      { kind: "fixed", text: "Cards on the exchange no longer poke out of their listing." },
      { kind: "fixed", text: "On phones, the price tags at the top of How to play fit in their boxes." },
    ],
  },
  {
    date: "2026-09-30",
    title: "Practice against the NPC",
    changes: [{ kind: "new", text: "Oshi Card Duel and High-low have a free practice mode: play the NPC any time, no stake and nothing recorded." }],
  },
  {
    date: "2026-09-30",
    title: "Profile colour by hex",
    changes: [{ kind: "fixed", text: "Typing a profile colour's hex code in capitals (007FAB) set the wrong colour. Edit profile has its own hex box now, next to the swatch: any case, with or without #." }],
  },
  {
    date: "2026-09-29",
    title: "Forgot your password?",
    changes: [{ kind: "new", text: "\"Forgot it?\" on the sign-in page emails you a link to choose a new password." }],
  },
  {
    date: "2026-09-29",
    title: "Adjustment reports and settlement reports",
    changes: [
      { kind: "fixed", text: "The market report and stock charts could give away where the day's adjustments were heading before they landed." },
      { kind: "improved", text: "Market → Report is an adjustment report through the day: prices since the last close, and each adjustment as it lands." },
      {
        kind: "new",
        text: "Once the last adjustment is in, the day becomes a settlement report: each talent's new target, what every adjustment did and how hard it pulled, what trading did in between, and how close prices finished.",
      },
    ],
  },
  {
    date: "2026-09-29",
    title: "Tell us what's broken",
    changes: [{ kind: "new", text: "\"Report a bug\" at the bottom of every page sends what went wrong straight to us." }],
  },
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
