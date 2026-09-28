# The core market (BBB's plan, phase 1)

How a talent's stock is priced, how many shares exist, and what happens every week. This follows
`docs/bbb-proposal.md` ("Adjustments & Valuation", "Volume", "Weekly Evaluation & Dividends").
Where it differs, it says so. Credit/Liquid, licenses, contracts, bonds and gambits are later phases.

## Every day

**Base rate (fair value).** Settled at 09:00 ET from the channel's YouTube numbers (subscribers, view
and sub growth, uploads, big streams), ranked against every other listed channel. Trading never moves
it. It is secret until that day's four ticks have landed; after that the settlement report shows it.
The per-share base rate no longer depends on the stock's share count (it is priced against a fixed
reference supply of 10,000), so a weekly share change never reprices a stock by itself.

**Four ticks.** Open 09:00, Lunch 15:00, Late 21:00, Overnight 03:00 ET. Each stock draws four random
strengths that add up to 200%; each tick moves the price that share of the way to the base rate
(over 100% overshoots). Per-stock min/max strengths are editable in the admin tuning page.

**Trading.** Orders queue and fill in 10-minute batches, up to 180 shares per player per tick window.
Buys and sells move the live price; the ticks pull it back. Prices and fills stay live and public
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
- The old daily share print at settlement is gone. Shares only change weekly, in the open.

## Buybacks

When a weekly evaluation sets max shares below what players hold:

1. The stock **freezes**: no buys, its price stops moving and the ticks skip it (the base rate still
   updates every morning).
2. The broker **offers to buy shares back** at 120% of the frozen price, 10 points less each day
   (four ticks): 120%, 110%, 100%, … down to 50%. Sells during a buyback fill at that price.
3. If players sell enough to get back under max shares, the buyback ends at the next Open and the
   stock trades normally again.
4. Otherwise, at the next weekly evaluation the broker **forces** the rest: it buys the excess back
   from every holder in proportion to what they hold, at the base rate. Ownership shares stay the same.

Max shares can move again at that evaluation, so a buyback can leave a bigger gap than expected
(BBB calls this an intended market risk).

## Every week: the Weekly Evaluation (Saturday 00:00 ET)

In BBB's order:

1. **Close buybacks** (forced buybacks as above).
2. **Dividends and share fees.** Each channel's value now against a week ago (the smoothed YouTube
   fundamental behind its base rate), ranked across the market and turned into a bell curve (each
   rank becomes a normal score, so every week has the same spread of payers and fee-takers however
   lopsided the raw numbers are). Within ±0.35 of the middle: nothing. Past that, 4% of the stock's
   value for every standard deviation, never more than 10% either way. Above the middle pays a
   dividend per share held; below charges a fee per share held. "Value" is the stock's average base
   rate over the week's days whose ticks have landed (never a secret one). Paid in cash (Credit comes
   in a later phase). A frozen stock's holders are paid or charged too. **Fees can push cash below
   zero**: a player in the red can't buy until they sell or earn it back.
3. **Max shares** reset from subscriber counts; stocks now over their max start a buyback.
4. **The Dividend Review** (Market → Dividends): a public report (total pool, biggest payers and
   fee-takers, max share changes, buybacks, every stock), each player's own week, a notification to
   every holder, and a Wire post. Buybacks and sell-outs get Wire posts too.

The very first evaluation never shrinks a stock below what players already hold (no surprise
buybacks on launch day).

## Tuning (env, API)

| Setting | Default |
|---|---|
| `MARKET_PRICE_REFERENCE_SUPPLY` | 10000 |
| `MARKET_MAX_SHARES_MIN` / `MARKET_MAX_SHARES_MAX` | 6000 / 30000 |
| `MARKET_DIVIDEND_RATE_PER_SIGMA` / `MARKET_DIVIDEND_DEADZONE_SIGMA` / `MARKET_DIVIDEND_CAP` | 0.04 / 0.35 / 0.10 |
| `MARKET_BUYBACK_START` / `MARKET_BUYBACK_DAILY_STEP` / `MARKET_BUYBACK_FLOOR` | 1.20 / 0.10 / 0.50 |
| `MARKET_WEEKLY_EVALUATION_ENABLED` | true |
| per stock: `broker_buffer_pct` | 0.02 |

`node scripts/weekly-evaluation.js preview` prints what the next evaluation would do (max shares per
stock against shares held, dividend and fee rates) without writing anything: it runs in a
transaction that is rolled back, so it is safe against production. Admins can also open
`/api/market/evaluations/preview`, and `POST /internal/market/weekly-evaluation/run` runs one by hand.

Code: `api/src/services/marketSupply.js` (shares, buybacks), `api/src/services/weeklyEvaluation.js`
(the evaluation), `api/src/services/trading.js` (fills), `api/src/services/settlement.js` (no daily
print; buybacks end at the Open), tests in `api/test/core-market.test.js`.
