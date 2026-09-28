// Copy for the how-to-play guide. Every number here is checked against the API:
// - market: api/src/services/{trading,marketAdjustments,settlement,fundamentals,portfolioCash}.js
// - games: api/src/services/games/** and GAMES_DESIGN.md
// - predictions: api/src/services/predictions/** and docs/predictions/PREDICTIONS_DESIGN.md
// If a rule changes there, change it here too.

export type SectionId = "market" | "trading" | "ticks" | "weekly" | "games" | "predictions" | "community" | "glossary" | "faq";

export const SECTIONS: ReadonlyArray<{ id: SectionId; label: string }> = [
  { id: "market", label: "Market" },
  { id: "trading", label: "Trading" },
  { id: "ticks", label: "Ticks" },
  { id: "weekly", label: "Dividends" },
  { id: "games", label: "Games" },
  { id: "predictions", label: "Predictions" },
  { id: "community", label: "Community" },
  { id: "glossary", label: "Glossary" },
  { id: "faq", label: "FAQ" },
];

export const STARTER_CASH = 10_000; // portfolioCash.js DEFAULT_STARTER_CASH
export const TRADE_FEE = 0.01; // trading.js DEFAULT_TRADING_FEE_RATE
export const SHARES_PER_WINDOW = 180; // trading.js DEFAULT_LIVE_ORDER_SHARE_LIMIT_PER_INTERVAL

export type Game = {
  key: string;
  name: string;
  href: string;
  price: string;
  line: string;
  rules: string[];
  tag?: string;
};

export const GAMES: Game[] = [
  {
    key: "cards",
    name: "Card gacha",
    href: "/games/cards",
    price: "$100 · ×10 $900",
    line: "Every talent has a card at five rarities. Pull, collect, flex.",
    rules: [
      "A ten-pull is ten single pulls; pity carries across them",
      "Every 10th pull is SR or better",
      "SSR+ odds climb from pull 60; pull 80 is a sure SSR+",
      "Featured banner: an SSR+ is 50/50 the featured talent. Lose it and the next one is guaranteed",
    ],
    tag: "gacha",
  },
  {
    key: "collection",
    name: "Collection",
    href: "/games/collection",
    price: "free",
    line: "Duplicates level cards up and turn into shards.",
    rules: [
      "Copies raise a card from ★1 to ★5; past ★5 dupes pay double shards",
      "Craft any card with shards (C 50 → UR 8,000)",
      "Unit sets: Roster pays 300 shards, Spotlight (all SR+) 1,500",
      "New? Claim 5 free C cards once. Pin 5 to your profile",
    ],
  },
  {
    key: "duel",
    name: "Oshi Card Duel",
    href: "/games/duel",
    price: "stake $0–$5,000",
    line: "Bring five cards, first to three rounds wins the pot.",
    rules: [
      "Power = rarity base + stars + today's stock move (±8)",
      "Each round draws a market condition: bull run, bear market, underdog…",
      "Both pick in secret (20 s), reveal together",
      "Winner takes 95% of the pot; a draw refunds both",
    ],
    tag: "pvp",
  },
  {
    key: "blackjack",
    name: "Blackjack",
    href: "/games/blackjack",
    price: "$10 to $10,000",
    line: "Up to five seats against the house dealer.",
    rules: [
      "Tables: Low $10–200 · Mid $100–2,000 · High $1,000–10,000",
      "Blackjack pays 3:2, a win 1:1, a push refunds",
      "Double on your first two cards; no split, no insurance",
      "Dealer stands on all 17s. 15 s to bet, 15 s per turn",
    ],
    tag: "table",
  },
  {
    key: "high-low",
    name: "High-Low Duel",
    href: "/games/high-low",
    price: "stake $0–$5,000",
    line: "Call the next card higher or lower against another player.",
    rules: [
      "Nine rounds, 10 s per call, same rank scores nobody",
      "One double down: +2 if right, −1 if wrong",
      "Highest score takes 95% of the pot",
    ],
    tag: "pvp",
  },
  {
    key: "ticker-tap",
    name: "Ticker Tap",
    href: "/games/ticker-tap",
    price: "$100 a run",
    line: "45 seconds. Tap green, dodge red, chase gold.",
    rules: [
      "Combos multiply, speed ramps up",
      "90% of the week's entry fees go to the top 10 runs",
      "Split 30 / 20 / 12 / 9 / 7 / 6 / 5 / 4 / 4 / 3 %",
      "The week closes Monday 00:00 ET. Your best run counts",
    ],
  },
  {
    key: "capsule",
    name: "Capsule gacha",
    href: "/games/capsule",
    price: "$50 · ×10 $450",
    line: "Hats, frames and chat flair that follow your name around.",
    rules: [
      "Every 10th pull is epic or better; pull 60 is a sure legendary",
      "Duplicates pay shards: 3 / 10 / 40 / 150",
      "Equip what you pull in the locker",
    ],
    tag: "cosmetic",
  },
];

export { GLOSSARY } from "@/app/lib/glossary";

export const FAQ: ReadonlyArray<{ q: string; a: string }> = [
  {
    q: "Is any of this real money?",
    a: "No. Everything on NASFAQ is play money. You can't deposit, withdraw or cash out, and nothing here is worth anything outside the site.",
  },
  {
    q: "Is NASFAQ run by hololive or COVER?",
    a: "No. It's a fan-made game, not affiliated with or endorsed by COVER Corporation or hololive production. The talents are real people; be nice about them.",
  },
  {
    q: "Why can't I trade, play or post?",
    a: "Check three things: you're signed in, your email is verified (the link in your inbox), and the market isn't settling. Trading pauses for a few minutes around 09:00 ET while fair values reprice.",
  },
  {
    q: "My order filled at a different price than I saw. Why?",
    a: "Stock orders don't fill when you click. They wait for the next 10-minute batch and fill at the price then, plus the spread, slippage for big orders and the 1% fee. Orders ahead of you in the batch move the price too.",
  },
  {
    q: "My order got rejected. What happened?",
    a: "Cash and shares are checked when the batch runs, not when you queue. If you spent the cash elsewhere in the meantime, sold the shares, or the batch landed during settlement, the order is rejected and nothing is charged.",
  },
  {
    q: "Can I short a stock or set a limit price?",
    a: "Not on stocks: you can only sell shares you hold, and every stock order is a market order in the next batch. Limit orders exist on predictions.",
  },
  {
    q: "How many shares can I trade at once?",
    a: "Up to 180 shares per tick window (the six hours between ticks), buys and sells together. It keeps whales from pinning a price.",
  },
  {
    q: "What makes a talent's price go up?",
    a: "Players buying, and the four daily ticks pulling it toward fair value. Fair value rises when a channel's views pick up, subscribers grow and uploads keep coming. Quiet channels get marked down.",
  },
  {
    q: "How do I get more cash?",
    a: "Trade well, and hold stocks that have good weeks: Saturday's dividends pay per share. Achievements also pay: $100 for your first fill up to $2,500 for a 30-day trading streak. Games and predictions can pay out too, and they can also take it.",
  },
  {
    q: "Why is my cash negative?",
    a: "Share fees. Every Saturday, stocks whose channels had a bad week charge a fee per share held, and it comes out even if you're short on cash. In the red you can't buy; sell something or earn it back.",
  },
  {
    q: "Why can't I buy this stock?",
    a: "Either it's sold out (players hold every share for sale; buys wait for a seller or next Saturday's new max) or it's frozen for a buyback (max shares dropped below what players hold; you can only sell to the broker until it's over).",
  },
  {
    q: "Are the games rigged?",
    a: "The server rolls every result, and the rates and pity rules are posted on each game. Stakes sit in escrow while a table plays; if the server restarts mid-game, everyone is refunded.",
  },
  {
    q: "Can I watch without playing?",
    a: "Yes. Open duel, high-low and blackjack tables can be watched by anyone, even signed out. Hidden picks and the dealer's hole card stay hidden until they're revealed.",
  },
  {
    q: "Who decides how a prediction resolves?",
    a: "Auto markets resolve themselves from site data. Event markets get a proposed result with a source, then a dispute window. No disputes and it finalizes; a dispute sends it to a resolver to confirm or overturn.",
  },
  {
    q: "What if a prediction market gets voided?",
    a: "Everyone gets back what they put into that market, fees included. If you already took out more than you put in, you keep it and get nothing back.",
  },
  {
    q: "Why am I not on my oshi's oshiboard?",
    a: "Your oshi also has to be your biggest bag. Hold more shares of them than of anyone else and you'll show up, ranked by shares.",
  },
];
