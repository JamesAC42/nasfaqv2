// The game's vocabulary: the how-to-play glossary and every <Term> tooltip on the site read from here.
// `key` is what <Term k="..."> uses; the glossary anchors each entry as #term-<key>.

export type GlossaryEntry = { key: string; term: string; def: string; href?: string };

export const GLOSSARY: ReadonlyArray<GlossaryEntry> = [
  { key: "ticker", term: "Ticker", def: "A talent's short symbol, like PEK or MIKO. One ticker per talent." },
  { key: "oshimark", term: "Oshimark", def: "The little logo each talent uses. It sits next to their ticker everywhere on the site." },
  { key: "oshi", term: "Oshi", def: "The talent you pick on your profile. It shows next to your name, and you rank on their oshiboard.", href: "/profile" },
  { key: "fair-value", term: "Fair value", def: "What a talent is worth by their YouTube numbers: subscribers, recent views, sub growth and uploads. Repriced every morning and secret until that day's four ticks have landed; then the settlement report shows it." },
  { key: "spread", term: "Mid, bid, ask", def: "Mid is the price you see. Buys fill at the ask (a bit above), sells at the bid (a bit below). The gap is the spread." },
  { key: "slippage", term: "Slippage", def: "Big orders fill a little worse than the quote. The more shares at once, the bigger the slip." },
  { key: "credit", term: "Credit", def: "Your second balance. Games, the capsule machine, the card exchange and predictions spend it first, and your cash only once it runs out; the trading fee does too. Dividends, winnings, achievements and a little of every sale land in it. It counts toward your net worth, and every Saturday part of it turns into cash." },
  { key: "fee", term: "Fee", def: "1% of every stock trade, on buys and sells. It comes out of your Credit first, then your cash, when the batch fills." },
  { key: "batch", term: "Batch", def: "Stock orders queue up and fill together every 10 minutes (:00, :10, :20…), first come, first filled." },
  { key: "tick", term: "Tick", def: "Four times a day (09:00, 15:00, 21:00, 03:00 ET) every price gets pulled toward its fair value." },
  {
    key: "share-limit",
    term: "Share limit",
    def: "Between one tick and the next, your orders can ask for only so many shares: buys and sells, every stock together. The order ticket shows how many you have left. Cancelled or turned-down orders give theirs back, and it all resets at the next tick.",
  },
  { key: "mark", term: "Mark", def: "The settled price with short-term order pressure stripped out: where the stock stands once the pushing stops. The dashed line on charts." },
  { key: "settlement", term: "Settlement", def: "The 09:00 ET daily run that reprices every fair value from YouTube and sets the day's four tick strengths. Trading pauses while it runs." },
  { key: "float", term: "Float", def: "How much of a talent's max shares players hold. The rest is the broker's." },
  { key: "sold-out", term: "Sold out", def: "Players hold every share for sale (all but the broker's 2% buffer). Buys wait until someone sells or the weekly evaluation raises the max." },
  { key: "buyback", term: "Buyback", def: "When the weekly evaluation cuts max shares below what players hold, the stock freezes: no buys, no ticks. The broker buys at 120% of the frozen price, 10 points less each day. Whatever is still over at the next evaluation it takes from every holder, in proportion, at the base rate." },
  { key: "treasury", term: "Broker", def: "The house (a.k.a. the treasury). It holds every share players don't, sells from them except a 2% buffer, and takes back what you sell." },
  { key: "max-supply", term: "Max shares", def: "The most shares of a talent there can be this week, reset every Saturday from subscriber count on a bell curve: bigger channel, more shares." },
  { key: "dividend", term: "Dividends & share fees", def: "Every Saturday each channel's week is ranked against the rest. The top pay a dividend per share you hold (in Credit), the bottom charge a fee (from Credit first, then cash), the middle nothing, never more than 10% of the stock's value. Fees can put your cash below zero." },
  { key: "evaluation", term: "Weekly evaluation", def: "Saturday 00:00 ET: dividends and fees, part of everyone's Credit turning into cash, new max shares from subscribers, and buybacks for stocks now over their max. The Dividend Review shows it all.", href: "/market/dividends" },
  { key: "net-worth", term: "Net worth", def: "Your cash (with what queued buys hold), your Credit and your shares at the current price. The leaderboard ranks this.", href: "/leaderboard" },
  { key: "momentum", term: "Momentum", def: "In the card duel, a card's bonus from its stock's move today, in whole percent, capped at ±8." },
  { key: "pity", term: "Pity", def: "The gacha's guarantee counter. Keep pulling and a high rarity is promised." },
  { key: "shards", term: "Shards", def: "Currency from duplicate cards, duplicate cosmetics and set rewards. Spend it crafting cards." },
  { key: "rake", term: "Rake", def: "The 5% the house keeps from a staked duel pot." },
  { key: "lmsr", term: "LMSR / market maker", def: "The house bot on predictions. It always quotes a price, so every trade fills instantly, and each buy moves the price." },
  { key: "limit-order", term: "Limit order", def: "Predictions only: \"buy YES at 40¢ or less\". It rests until the price gets there, then fills against the market maker." },
  { key: "dispute-window", term: "Dispute window", def: "After a result is proposed, holders get a window (12 h by default) to challenge it before it's final." },
  { key: "void", term: "Void", def: "A cancelled prediction market. Everyone gets back what they put in, fees included." },
];

const BY_KEY = new Map(GLOSSARY.map((entry) => [entry.key, entry]));

export function glossaryEntry(key: string): GlossaryEntry | null {
  return BY_KEY.get(key) ?? null;
}
