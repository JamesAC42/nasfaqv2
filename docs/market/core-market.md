# The core market (BBB's plan, phase 1)

How a talent's stock is priced, how many shares exist, and what happens every week. This follows
`docs/bbb-proposal.md` ("Adjustments & Valuation", "Volume", "Weekly Evaluation & Dividends").
Where it differs, it says so. Credit and Cash are in `credit.md`; licenses, contracts, bonds and
gambits are later phases.

## Every day

**Base rate (fair value).** Settled at 09:00 ET from the channel's YouTube numbers (subscribers, view
and sub growth, uploads, big streams). Trading never moves it. It is secret until that day's four
ticks have landed; after that the settlement report shows it, and so does that day's settlement mark
(`mid_close_mark`, which equals the day's base rate: see below).

*Differs from BBB:* BBB ranks each channel against every other listed channel. The code doesn't. Each
channel's base rate comes from its own numbers alone (`fundamentals.js` `computeDerivedSnapshot`):
- a size anchor from subscribers and 30-day views,
- times a momentum multiplier from view and sub growth, uploads, stagnation and big streams,
- blended 40/60 with the day before and capped at ±25% a day (debuts excepted),
- priced against a fixed reference supply of 10,000 shares, so a weekly share change never reprices a
  stock by itself.

Only dividends and fees, and max shares, are ranked across the market (below).

**Settlement mark.** Settlement writes each day's `mid_close_mark` as the base rate times
exp(persistent offset). Every day opens at the previous close and the offset it carries forward is
0.9 × ln(mark ÷ base rate) of the day before, which starts at 0, so the mark is the day's base rate.
`MARKET_PERSISTENT_DAILY_DECAY` multiplies that zero and `MARKET_TRANSIENT_SETTLEMENT_DECAY` applies
only to a day with no price to carry, which never happens, so neither changes anything. Charts draw the mark
as the revealed target; price lines and changes use closing prices.

**Four ticks.** Open 09:00, Lunch 15:00, Late 21:00, Overnight 03:00 ET. Each stock draws four random
strengths that add up to 200%; each tick moves the price that share of the way to the base rate
(over 100% overshoots). Per-stock min/max strengths are editable in the admin tuning page.

**Trading.** Orders queue and fill in 10-minute batches. Buys and sells move the live price; the ticks
pull it back.

**The 180-share limit** (`MARKET_LIVE_ORDER_SHARE_LIMIT_PER_INTERVAL`, default 180):
- It counts per player, across every stock and both sides together.
- It counts per *tick window*: from one tick to the next (Open → Lunch → Late → Overnight → Open), so
  four windows of about six hours a day. The window comes from the day's tick schedule, or from the
  New York clock (09:00, 15:00, 21:00, 03:00) when settlement hasn't advanced the market day.
- An order counts in the window it was *submitted* in, at its requested size, while it's queued or
  filled. A cancelled or turned-down order gives its shares back. A partial fill still counts what it
  asked for.
- The ticket shows what's left (`GET /api/portfolio/me/orders` → `allowance`), and the count resets
  at the next tick.
- *Differs from BBB:* BBB allows 180 shares per 10-minute execution tick. The code allows 180 per
  six-hour tick window.
- One consequence: an order submitted just before a tick counts in the old window but fills in the
  batch at the tick, so a player can queue 180 shares just before a tick and another 180 just after it.
 Prices and fills stay live and public
(BBB suggested hiding orders until the next tick window; we keep them live because the live floor
is most of the fun).

## Shares

- **Max shares** is set every week from the channel's subscriber count, on a bell curve across the
  listed channels (bigger channel, more shares: 6,000 to 30,000 by default).
- **Held** is the shares players own. **Broker's buffer** is 2% of max shares that never go on sale.
  **For sale** = max shares − held − buffer.
- **Buying takes shares from the broker, selling gives them back.** When a stock has nothing for sale
  it is *sold out*: buys are refused until someone sells. A batch order bigger than what's left fills
  what's left. (BBB: purchases lock at the next tick; we lock the moment the last share goes, which
  is simpler to read and can't overshoot the max.)
- **Orders are for whole shares.** A sale may also be exactly everything a player has left (held
  minus queued sells), so a fraction already held can be sold. Fractions can still be held: a
  forced buyback takes each holder's share of the excess to six decimals, and a buy that takes the
  last shares for sale gets what's left, which can be a fraction of the broker's 2% buffer.
- The old daily share print at settlement is gone. Shares only change weekly, in the open.

## Buybacks

When a weekly evaluation sets max shares below what players hold:

1. The stock **freezes**: no buys, its price stops moving and the ticks skip it (the base rate still
   updates every morning). The frozen price is the lower of the price at the evaluation and that
   day's open, so a late pump can't raise the offer.
2. The broker **offers to buy shares back** at 120% of the frozen price, 10 points less every 24 hours
   from the start: 120%, 110%, 100%, … never under 50% (a Saturday buyback reaches 60% on its last
   day). Only the shares still over the max get the offer; a sell past them fills at the frozen
   price, so selling out and buying back at the Open isn't free money. The offer also pays only on
   shares a player held before the last tick ahead of the buyback (Friday's Late tick, 21:00 ET, for
   Saturday's evaluation; the last tick before an on-demand one): shares bought after it sell at the
   frozen price, so buying on Friday a stock that is about to be cut and selling it into the offer
   pays nothing. When a buyback starts, each holder's shares added since that tick are written down
   from the ledger (`asset_buyback_late_shares`, the most they added from any moment since, as oshi
   protection counts it); a holding only shrinks while frozen, so the shares still at the offer are
   the holding less those.
3. If players sell enough to get back under max shares, the buyback ends at the next Open and the
   stock trades normally again.
4. Otherwise, at the next weekly evaluation the broker **forces** the rest: it buys the excess back
   from every holder in proportion to what they hold, at the last revealed base rate. Ownership shares
   stay the same.

Max shares can move again at that evaluation, so a buyback can leave a bigger gap than expected
(BBB calls this an intended market risk).

Every asset payload carries its buyback (`supplyView`: the frozen price, today's offer, the schedule
`start` / `daily_step` / `floor`, the next step and the shares still over). A player's own holdings
(`/api/portfolio/me`) carry `buyback_offer_shares`, how many of theirs can still get the offer, which
the banner's line and the trade ticket's estimate use. Behind the
`buyback-spotlight` flag the client makes them hard to miss (`app/lib/buyback.ts`,
`buyback-plan.mjs`): a BUYBACK badge with today's offer wherever a stock shows, Buybacks now on Home
and the market floor, a banner on the stock page (the offer against the market price, the daily
step-down, countdowns, the shares left at the offer), a bar for players who hold one, and How to
play's walkthrough. Holders also get the evaluation's inbox notification when one starts.

## Every week: the Weekly Evaluation (Saturday 00:00 ET)

In BBB's order:

1. **Close buybacks** (forced buybacks as above).
2. **Dividends and share fees.** Each channel's value now against a week ago (the smoothed YouTube
   fundamental behind its base rate), ranked across the market and turned into a bell curve (each
   rank becomes a normal score, so every week has the same spread of payers and fee-takers however
   lopsided the raw numbers are). Within ±0.35 of the middle: nothing. Past that, 4% of the stock's
   value for every standard deviation, never more than 10% either way. Above the middle pays a
   dividend per share held; below charges a fee per share held. "Value" is the stock's average base
   rate over the week's days whose ticks have landed (never a secret one). Dividends pay Credit;
   fees take Credit first, then Cash (`credit.md`). A frozen stock's holders are paid or charged
   too. **Fees can push cash below zero**: a player in the red can't buy until they sell or earn it
   back. Then part of every Credit balance turns into Cash.
3. **Max shares** reset from subscriber counts; stocks now over their max start a buyback. Then a
   player left with no shares and no money to buy any gets a little Cash and Credit (the auto-bailout,
   `credit.md`).
4. **The Dividend Review** (Market → Dividends): a public report (total pool, biggest payers and
   fee-takers, max share changes, buybacks, every stock), each player's own week, a notification to
   every holder, and a Wire post. Buybacks and sell-outs get Wire posts too.
   Behind the `dividend-spotlight` flag (`services/dividendBoard.js`): Home shows each player's week for
   four days after a review and counts down over the last three before the next, and the leaderboard's
   Dividends tab ranks players from the most earned down to the highest fees, for the latest week or all
   time, by the Wire's rule for who can be named.

The very first evaluation never shrinks a stock below what players already hold (no surprise
buybacks on launch day).

**Trading pauses while it runs.** The evaluation reads everything in a few queries, works it out in
memory and writes it back in a few more, so it takes seconds and holds the stocks, holdings and
wallets locked for about ten statements. As a safety switch, trading also closes for those seconds
(the daily settlement's pause: buys, sells and new orders are refused with a message, queued orders
fill in the first batch after). It waits for a live-order batch that is filling, never runs while
the daily settlement does, and leaves a market an admin closed as it was.
`MARKET_WEEKLY_EVALUATION_CLOSE_TRADING=false` turns the pause off; it stays on until the batched
evaluation has run in production once.

## Tuning (env, API)

| Setting | Default |
|---|---|
| `MARKET_PRICE_REFERENCE_SUPPLY` | 10000 |
| `MARKET_MAX_SHARES_MIN` / `MARKET_MAX_SHARES_MAX` | 6000 / 30000 |
| `MARKET_DIVIDEND_RATE_PER_SIGMA` / `MARKET_DIVIDEND_DEADZONE_SIGMA` / `MARKET_DIVIDEND_CAP` | 0.04 / 0.35 / 0.10 |
| `MARKET_BUYBACK_START` / `MARKET_BUYBACK_DAILY_STEP` / `MARKET_BUYBACK_FLOOR` | 1.20 / 0.10 / 0.50 |
| `MARKET_WEEKLY_EVALUATION_ENABLED` | true |
| `MARKET_WEEKLY_EVALUATION_CLOSE_TRADING` (pause trading while it runs) | true |
| per stock: `broker_buffer_pct` | 0.02 |

`node scripts/weekly-evaluation.js preview` prints what the next evaluation would do (max shares per
stock against shares held, dividend and fee rates) without writing anything: it reads without row
locks, writes nothing and rolls back, so it is safe against production. Admins can also open
`/api/market/evaluations/preview`, and `POST /internal/market/weekly-evaluation/run` runs one by hand.

**On demand, for playtests.** Admin → Market tuning → Weekly evaluation previews and runs one right
now (`POST /internal/market/weekly-evaluation/run-now`, `{ dry_run }` or `{ confirmation: "evaluate" }`).
It is dated today in New York, so each date still runs once, and its report says `on_demand: true`.
Saturday's evaluation still runs on schedule afterwards and, with the same revealed days behind it,
pays about the same again, so it is a playtest tool, not something to press in the live game. It
never pays an auto-bailout; its report only says who would qualify.

Code: `api/src/services/marketSupply.js` (shares, buybacks), `api/src/services/weeklyEvaluation.js`
(the evaluation), `api/src/services/trading.js` (fills), `api/src/services/settlement.js` (no daily
print; buybacks end at the Open), tests in `api/test/core-market.test.js` and
`api/test/weekly-evaluation-batch.test.js` (the batched evaluation against the row-at-a-time one it
replaced, kept in `api/test/fixtures/weekly-evaluation-reference.js`).
