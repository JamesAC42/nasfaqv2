// The game's vocabulary: the how-to-play glossary and every <Term> tooltip on the site read from here.
// `key` is what <Term k="..."> uses; the glossary anchors each entry as #term-<key>.

export type GlossaryEntry = { key: string; term: string; def: string; href?: string; /** A feature flag the entry needs; the how-to-play glossary only lists it for viewers it is on for. */ flag?: string };

export const GLOSSARY: ReadonlyArray<GlossaryEntry> = [
  { key: "ticker", term: "Ticker", def: "A talent's short symbol, like PEK or MIK. One ticker per talent." },
  { key: "oshimark", term: "Oshimark", def: "The little logo each talent uses. It sits next to their ticker everywhere on the site." },
  { key: "oshi", term: "Oshi", def: "The talent you pick on your profile. It shows next to your name, and you rank on their oshiboard.", href: "/profile" },
  { key: "fair-value", term: "Fair value", def: "What a talent is worth by their YouTube numbers: subscribers, recent views, sub growth and uploads. Repriced every morning, with a little growth on top (0.05% a day), and secret until that day's four ticks have landed; then the settlement report shows it." },
  { key: "spread", term: "Mid, bid, ask", def: "Mid is the price you see. Buys fill at the ask (0.75% above), sells at the bid (0.75% below). The 1.5% gap is the spread." },
  { key: "slippage", term: "Slippage", def: "Big orders fill a little worse than the quote. The more shares at once, the bigger the slip." },
  { key: "credit", term: "Credit", def: "Your second balance. Games, the capsule machine, the card exchange and predictions spend it and never your cash, so you always have something to trade with. The trading fee comes out of it first, then your cash. Dividends, winnings, achievements and a little of every sale land in it. It counts toward your net worth, and every Saturday part of it turns into cash. Margin can take it below zero." },
  { key: "fee", term: "Fee", def: "Buying is free. Selling shares within 24 hours of buying them costs 1% of the sale (your newest shares count first); shares held longer sell free. It comes out of your Credit first, then your cash, when the batch fills." },
  { key: "batch", term: "Batch", def: "Stock orders queue up and fill together every 10 minutes (:00, :10, :20…), first come, first filled." },
  { key: "tick", term: "Tick", def: "Four times a day (09:00, 15:00, 21:00, 03:00 ET) every price gets pulled toward its fair value." },
  {
    key: "share-limit",
    term: "Share limit",
    def: "Between one tick and the next, your orders can ask for only so many shares: buys and sells, every stock together. The order ticket shows how many you have left. Cancelled or turned-down orders give theirs back, and it all resets at the next tick.",
  },
  { key: "mark", term: "Mark", def: "A day's fair value, the target its four ticks pulled toward, shown once the last of them has landed. The dashed line on charts. Today's stays hidden until then." },
  { key: "settlement", term: "Settlement", def: "The 09:00 ET daily run that reprices every fair value from YouTube and sets the day's four tick strengths. Trading pauses while it runs." },
  { key: "float", term: "Float", def: "How much of a talent's max shares players hold. The rest is the broker's." },
  { key: "sold-out", term: "Sold out", def: "Players hold every share for sale (all but the broker's 2% buffer). New buys are turned down, and so are queued ones when their batch comes; an order for more than is left gets what's left. Wait for someone to sell or for the weekly evaluation to raise the max." },
  { key: "buyback", term: "Buyback", def: "When the weekly evaluation cuts max shares below what players hold, the stock freezes: no buys, no ticks. The broker buys at 120% of the frozen price, 10 points less each day. Whatever is still over at the next evaluation it takes from every holder, in proportion, at the last revealed fair value." },
  { key: "treasury", term: "Broker", def: "The house (a.k.a. the treasury). It holds every share players don't, sells from them except a 2% buffer, and takes back what you sell." },
  { key: "max-supply", term: "Max shares", def: "The most shares of a talent there can be this week, reset every Saturday from subscriber count on a bell curve: bigger channel, more shares." },
  { key: "dividend", term: "Dividends & share fees", def: "Every Saturday each channel's week is ranked against the rest. The top pay a dividend per share you hold (in Credit), the bottom charge a fee (from Credit first, then cash), the middle nothing, never more than 10% of the stock's value. On top of that, every holder of every stock gets 0.25% of its value per share, in Credit. Fees can put your cash below zero." },
  { key: "evaluation", term: "Weekly evaluation", def: "Saturday 00:00 ET: dividends and fees, part of everyone's Credit turning into cash, new max shares from subscribers, and buybacks for stocks now over their max. The Dividend Review shows it all.", href: "/market/dividends" },
  { key: "bailout", term: "Bailout", def: "The Saturday review's way back in. If it ends with you holding no shares, with no Credit left to turn into cash and too little cash to buy the cheapest share, your cash goes up to $1,000 and you get $1,000 Credit. You need a verified email and a visit to the site in the last two weeks." },
  {
    key: "ipo",
    term: "IPO",
    def: "How a new talent comes to market. Before she lists, there's a window to subscribe for her shares at the IPO price, set below her fair value. The cost is held from your Cash until listing. If more is asked for than offered, everyone gets a share in proportion, at least 1. She starts trading at the 09:00 ET settlement on listing day, opening at the IPO price.",
    href: "/market/ipo",
  },
  // 28 days is weeklyEvaluation.js ROOKIE_DAYS (IPO_ROOKIE_DAYS in how-to-play/content.ts).
  { key: "rookie", term: "Rookie", def: "A talent listed by an IPO in the last 28 days (her first four Saturday reviews). She isn't ranked: no dividend for a good week, no share fee for a bad one, just the 0.25% every holder gets. Her max shares never drop below what players hold." },
  { key: "net-worth", term: "Net worth", def: "Your cash (with what queued buys hold), your Credit and your shares at the current price. Money in an open pool isn't counted until it pays out. The leaderboard ranks this.", href: "/leaderboard" },
  { key: "momentum", term: "Momentum", def: "In the card duel, a card's bonus from its stock's move today, in whole percent, capped at ±8." },
  { key: "pity", term: "Pity", def: "The gacha's guarantee counter. Keep pulling and a high rarity is promised." },
  { key: "shards", term: "Shards", def: "Currency from duplicate cards, duplicate cosmetics and set rewards. Spend it crafting cards." },
  { key: "rake", term: "Rake", def: "The 5% the house keeps from a staked duel pot. Prediction pools have none." },
  { key: "pool", term: "Pool", def: "A prediction: a question with options, where everyone's bets go in one pot and the winners split it by how much each of them put in. If nobody backed the winner, every bet comes back.", href: "/predictions" },
  { key: "odds", term: "Odds", def: "What $1 on an option pays if it wins and the pool closed right then: 3.00× pays $3. It's the whole pot divided by what's on that option, and it moves with every bet until betting closes." },
  { key: "bookie", term: "Bookie", def: "A player with the role that opens pools and calls the winner, with a source. Bookies can't bet in their own pools." },
  { key: "margin", term: "Margin", def: "Borrowing for a pool bet once your Credit runs out: up to 25% of what your shares are worth, $100,000 at most. You opt in on each bet. It takes your Credit below zero, never touches your cash and has no interest." },
  { key: "in-the-red", term: "In the red", def: "Credit below zero, from margin or a payout staff took back. That's what you owe. Until it's paid back you can't bet or spend Credit, but stocks stay open. Any Credit that comes in pays it back, and cash never does." },
  { key: "void", term: "Void", def: "A cancelled pool. Every bet goes back where it came from, and a bet made on margin has that debt cancelled." },
  // ── Mahjong (behind the "mahjong" flag) ──
  { key: "mj-riichi", term: "Riichi", def: "Mahjong: with a closed hand one tile from winning, you say riichi and pay a 1,000-point stick. It is a yaku, and from then on you can only discard what you draw.", href: "/games/mahjong/learn/glossary#riichi", flag: "mahjong" },
  { key: "mj-tenpai", term: "Tenpai", def: "Mahjong: ready. Your 13 tiles need exactly one more tile to be a winning hand, and the tiles that finish it are your waits.", href: "/games/mahjong/learn/glossary#tenpai", flag: "mahjong" },
  { key: "mj-furiten", term: "Furiten", def: "Mahjong: if a tile you are waiting on is among your own discards, you can’t win on anyone’s discard, only by drawing it yourself.", href: "/games/mahjong/learn/glossary#furiten", flag: "mahjong" },
  { key: "mj-yaku", term: "Yaku", def: "Mahjong: a scoring pattern. A hand needs at least one to win, and dora are not yaku.", href: "/games/mahjong/learn/yaku", flag: "mahjong" },
  { key: "mj-han", term: "Han and fu", def: "Mahjong: han is the doubling unit of a hand’s value (each yaku and each dora adds some); fu are minipoints from its shape. Past a point a hand pays a fixed limit: mangan, haneman, baiman, sanbaiman, yakuman.", href: "/games/mahjong/learn/glossary#han", flag: "mahjong" },
  { key: "mj-dora", term: "Dora", def: "Mahjong: a bonus tile worth one han. The tile after the dora indicator on the wall is the dora, and every red five counts too.", href: "/games/mahjong/learn/glossary#dora", flag: "mahjong" },
  { key: "mj-calls", term: "Chi, pon, kan", def: "Mahjong: taking another player’s discard to finish a run (chi, only from the player on your left), a triplet (pon) or a four of a kind (kan). It opens your hand.", href: "/games/mahjong/learn/glossary#chi", flag: "mahjong" },
  { key: "mj-chips", term: "Chips", def: "Mahjong beta: the record of how you finish at chip tables. Each finished game adds or subtracts a fixed number of chips by place. Chips are never a balance, can’t be spent or sent, and are worth nothing outside the beta.", href: "/games/mahjong/learn/glossary#chips", flag: "mahjong" },
  { key: "mj-beta", term: "Beta (trial mode)", def: "Mahjong is in beta: no Cash or Credit is ever taken or paid, at any table or tournament.", href: "/games/mahjong/learn/rules#money", flag: "mahjong" },
  { key: "mj-honba", term: "Honba", def: "Mahjong: the repeat counter. It grows whenever a hand ends without the deal passing, and adds 300 to a win on a discard.", href: "/games/mahjong/learn/glossary#honba", flag: "mahjong" },
];

const BY_KEY = new Map(GLOSSARY.map((entry) => [entry.key, entry]));

export function glossaryEntry(key: string): GlossaryEntry | null {
  return BY_KEY.get(key) ?? null;
}
