# NASFAQ predictions — design

Status: retired. Prediction pools (`docs/design/predictions-pools.md`) replace the market maker: no
new markets open this way, and this code stays only for markets left open and for history. Written
September 2026. Replaces the order-book design in `PREDICTION_MARKET_DESIGN.md`
for trading and resolution; the schema, permissions, comments and websocket from that build are
kept and extended. Code comments point back here.

The goal is Kalshi/Polymarket energy on a small site: every market always has a price, trades fill
instantly, prices move the moment anyone buys, new markets open on their own all day, and the
people who call outcomes do it in public.

## Principles

- **In-game cash only.** Every cash movement goes through the portfolio cash balance with a
  `market.ledger_entries` row in the same transaction, so balances reconcile from the ledger.
- **Always liquid.** An automated market maker (LMSR) quotes every outcome of every open market.
  Nobody waits for a counterparty.
- **The server decides.** Clients send intents (buy $50 of YES, sell 20 shares, limit at 40¢);
  prices, fills and payouts are computed server-side.
- **Resolution is public.** Every proposal, dispute, confirmation and void is an event on the
  market's timeline with who did it, when, and the source.
- **Nothing is stranded.** Resting limit orders reserve their cash/shares; closing, resolving or
  voiding a market releases every reservation.

## 1. Market shapes and kinds

- **Shapes.** `binary` (YES/NO) and `multi` ("which one?": 3–12 named outcomes, exactly one wins,
  e.g. "Top gainer on the Late tick?"). A multi outcome can link to a talent (`asset_id`) so the UI
  shows their oshimark and colour.
- **Kinds.** `event` markets are made by people (admins and players with the create permission)
  about real hololive happenings and resolved by people (§5). `auto` markets are opened by the
  system from site data and resolved by the system (§6).
- Each share pays **$1.00** if its outcome wins and **$0** otherwise. Prices are probabilities:
  YES at 62¢ means the market says 62%.

## 2. The market maker (LMSR)

Every market holds a liquidity parameter `b` and, per outcome, `q_i` = net shares the market maker
has sold. With `S = Σ_j e^(q_j/b)`:

- **Price** of outcome *i*: `p_i = e^(q_i/b) / S`. Prices always sum to 1.
- **Cost function**: `C(q) = b · ln S`.
- **Buying** Δ shares of *i* costs `C(q + Δ·e_i) − C(q)`; **selling** Δ shares pays
  `C(q) − C(q − Δ·e_i)`.
- **Buying by cash** (the default ticket: "spend $50"): the shares for a spend `c` are
  `Δ = b · ln(1 + S·(e^(c/b) − 1) / e^(q_i/b))`.
- **Starting prices.** A market opens at the creator's starting probabilities (default even) by
  setting `q_i = b · ln p_i`.
- **Price rails.** A trade may not push any outcome's price above 99¢ or below 1¢; an order that
  would is filled up to the rail (buy-by-cash spends less) or rejected if it can't fill at all.
- **House exposure.** The market maker is funded by the house. Its worst-case loss on a market is
  `b · ln N` (N outcomes): about $693 at b = 1000 on a binary market, $277 at b = 400. Fees (§3)
  and the spread the curve itself earns offset it. Each market tracks `house_net_cash` (cash in
  from trades and fees minus cash out to sells and payouts) so admins can see what liquidity costs.
- **Choosing b.** Bigger b = deeper market (a $100 trade moves the price less). At 50¢ a $100 buy
  moves a binary market about 20 points at b = 250 but about 5 at b = 1000, and players start with
  $10k, so thin markets are easy to pin. Defaults: event binary 1000, event multi 800, auto tick
  direction 400, top gainer and stream 500. Set per market at creation; auto templates carry their own.

Precision: shares are stored to 6 decimals; cash to cents. Buys round the cost **up** to the cent,
sells round proceeds **down**, so rounding never pays out more than the curve.

## 3. Trading

- **Buy** (by cash, $1 minimum) or **sell** (by shares, or "sell all") any outcome of an open
  market. Binary markets offer YES and NO; multi markets offer each outcome.
- **Slippage guard.** The ticket sends the average price it showed (`max_avg_price` for buys,
  `min_avg_price` for sells). If the price moved past it before the trade executes, the trade is
  rejected with `price_moved` and the new quote, and nothing is charged.
- **Fees.** `fee_bps` per market (default 100 = 1%) on the cash side of every AMM trade: added to a
  buy's cost, taken from a sell's proceeds. Fees are a cash sink.
- **Limits.** Max $25,000 per trade; per-user position cap per market of 25,000 shares per outcome.
- **Limit orders.** "Buy YES while it's 40¢ or less, spend up to $200" or "sell 150 NO once it's
  70¢ or more". A buy limit reserves its budget plus fee at placement; a sell limit reserves the
  shares. Resting orders fill **against the market maker** when the price reaches them, only as
  far as their limit (a buy fills until the price rises to the limit, then keeps resting). After
  every trade the engine sweeps the market's resting orders in placement order, repeatedly, until
  nothing triggers; the scheduler also sweeps every minute. Resting orders are cancelled and
  released when the market closes, resolves or is voided. Users can cancel any time.
- **Positions.** Per user, market and outcome: `shares`, `avg_entry_price` (cash paid per share,
  fees included), `net_cost_cash` (cash put in minus cash taken out, used for void refunds) and
  `realized_pnl_cash`.

## 4. Lifecycle

`draft → pending_approval → open → closed → resolving → proposed ⇄ disputed → resolved`, plus
`rejected` (from pending_approval) and `voided` (from any state before resolved).

- **Draft / approval.** Creators draft; an approver (can't be the creator, unless the approver is a
  site admin) approves or rejects with a reason. Approved markets open at `opens_at`.
- **Open.** Trading runs until `closes_at`. A resolver can **close early** ("it already happened")
  or **halt** trading (pause without closing, e.g. a rules problem) and resume.
- **Closed → resolving.** At `closes_at` trading stops and resting orders are released; once
  `resolves_after` passes (defaults to `closes_at`) the market waits for a call.

## 5. Resolution for event markets

1. **Propose.** A resolver (`can_resolve_prediction_markets`) proposes the winning outcome, or
   *void*, with a **source link** and a short note. The market enters `proposed` and a **dispute
   window** opens: `dispute_hours` per market (default 12, 1–72).
2. **Dispute.** During the window any verified player who holds or held a position in the market
   can dispute once per proposal with a reason (20+ characters). The first dispute moves the market
   to `disputed`. Disputes are public on the timeline.
3. **Finalize.**
   - No disputes: the proposal **finalizes automatically** when the window ends.
   - Disputed: a resolver must **confirm** it (settle as proposed) or **overturn** it (propose
     something else, which opens a fresh window). Confirming a disputed proposal needs a different
     resolver than the proposer, unless the confirmer is a site admin (the small-team case); a
     self-confirmation is flagged on the timeline.
   - A resolver can also **withdraw** a proposal (back to `resolving`).
4. **Settle.** Winning shares pay $1 each (`prediction_payout_win`), losing shares close at $0
   (`prediction_payout_loss`), positions go to zero, resting orders were already released. The
   market records the winning outcome, who proposed and confirmed, and when.
5. **Void.** A voider (`can_void_prediction_markets`) can void any unresolved market, or a
   proposal can be *void*. Everyone gets back their `net_cost_cash` for that market (never
   negative: someone who already cashed out more than they put in gets nothing back and keeps what
   they took). Fees are refunded as part of net cost. Resting orders are released.

## 6. Auto markets

The scheduler (every minute) opens and resolves these from site data. Each template can be toggled
and tuned from the admin console. Auto markets have no human creator (`creator_user_id` is null,
`kind = 'auto'`), are house-funded like any market, and resolve with the data snapshot recorded as
the source.

| Template | Market | Opens | Closes | Resolves |
|---|---|---|---|---|
| `tick-direction` (off) | "PEK up on the Lunch tick?" (binary) for the K most active talents (K = 3) | after settlement, about 09:00 ET | 5 min before the tick | from that asset's tick row: YES if `price_after > price_before`; void if the tick was skipped |
| `tick-top-gainer` | "Top gainer on the Lunch tick?" (multi): the K most active talents (K = 6) plus "Someone else" | after settlement, about 09:00 ET | 5 min before the tick | the largest % move among **all** assets on that tick |
| `stream-peak` | "Marine's stream peaks above 45k?" (binary) | up to 24 h before a scheduled stream, with at least 30 min of betting left, when the talent has 3+ past streams | 15 min before the scheduled start, or as soon as the tracker sees it live | YES as soon as the running peak reaches the line; NO when it ends under it; void if it hasn't started within 12 h of its scheduled time, runs 12 h unresolved, or ends with no peak on record |

- Ticks are Open 09:00, Lunch 15:00, Late 21:00, Overnight 03:00 ET (`marketAdjustments.js`).
- The stream line is the talent's median peak over their last 10 streams, rounded to two significant
  figures (within 5% of the median).
- "Most active" = most shares traded in the last 24 h, then most holders.
- Each auto market has a unique `auto_key` (e.g. `stream-peak:<video id>`), so the scheduler is
  idempotent and restarts never duplicate markets.

### Betting ends before the outcome can be known

This is the rule every auto market has to meet. A market is seeded near 50/50, so if the result can
be known or guessed well while it's open, the first bettor takes up to `b·ln N` from the house.

- **Checked on every bet.** `closes_at` is only the schedule. `guards.js` reads the data behind the
  market on every buy, sell and limit-order fill, with the market row locked, and refuses the bet if:
  the stream has started, is inside its close lead, moved, has no row or has stale data (three missed
  scraper polls); or any row of the tick has landed (an admin can force one early); or the template is
  off. The scheduler then closes whatever's locked, within 30 seconds, and releases resting orders.
- **A late bet can't pay.** The tracker can learn of a start after the fact. At settlement, a market
  with any trade at or after the stream's `actual_start_at` voids. Everyone gets their money back, so
  the worst a player can do with this is get a refund.
- **The tracker watches for early starts.** Every minute, a cheap `videos.list` checks streams due in
  the next 3 hours. If one has gone live or changed its time, its channel is polled at once. Before
  this, a stream starting early could go unnoticed for a full 30-minute poll. Streams with no schedule
  never get a market. In the 60 days to 2026-11-05, 6 of 2,506 streams started 15 or more minutes
  early, and the earliest by 67 minutes, so all of them fall inside that window.
- **Canceled and deleted streams void.** The tracker never hears of them again, so they sit as
  "upcoming" forever (76 in production on 2026-11-05, the oldest from 2025-12-24). One that's already
  past its time never gets a market. One that goes quiet after its market opened locks once its data
  is stale or its time comes, and voids 12 hours after the time it was scheduled for when it opened.
- **Why tick calls are off.** All four of a day's ticks pull toward one hidden target, and strengths
  are drawn so they total 200%. So a tick moves the same way as the tick before it unless the one
  before overshot the target, about 82% of the time with the default strength bounds and every time
  when a talent's bounds stay under 100%. A market seeded at 50/50 on that is close to free money.
  Production agreed (30 days to 2026-11-05): 81–83% of ticks moved the same way as the one before, and
  127 of 145 resolved tick calls (87.6%) followed the previous tick.
- **Why Lunch.** Open can't have a market: settlement creates its row at 09:00 and it lands a minute
  later. Lunch is the earliest tick that can, and the least given away. `TICKS_WITH_MARKETS` in
  `auto.js` is the one place to change this. The top gainer stays because it turns on the biggest %
  move across the whole market, with random strengths, which one earlier move doesn't give away.
- **Still possible, and small.** Someone holding a tick market can trade the stock after betting
  closes to push it across the target. They don't know the target, stock trades cost more than a thin
  market pays (`b·ln N`), and the only tick market left spans the whole market.

### How many get made

| Template | Most per day | Why | Change it |
|---|---|---|---|
| `tick-top-gainer` | 1 | One market a day people can follow | on/off |
| `stream-peak` | 5, one per talent, from the 15 most active talents | Enough to always have one open; thin markets on talents nobody holds just hand the first bettor free odds | `daily_cap`, `talents` |
| `tick-direction` | 0 (off); 3 if turned on | See above | on/off, `count` |

Before this: 7 tick markets on each of 3 ticks (21 a day), plus one for every stream of a talent with
enough history. All of these are set from `/predictions/manage` with no deploy. Turning a template off
stops new markets and shuts betting on open ones; they still settle.

## 7. Admin console (`/predictions/admin`)

- **Queue**: markets waiting for approval (approve / reject with reason).
- **Needs a call**: event markets in `resolving`, oldest first.
- **Proposals**: `proposed` and `disputed` markets with the window countdown, the proposal, source,
  disputes, and confirm / overturn / withdraw.
- **Live**: open markets with volume, house exposure; close early, halt/resume, void.
- **Auto templates**: on/off, liquidity `b`, K, stream line rounding; last run and counts.
- **New market**: binary or multi; title, rules, resolution source, category, outcomes (optional
  talent link each), starting probabilities, liquidity, fee, open/close/resolve-after times,
  dispute window.
- Permissions are the existing user flags: create, approve, resolve, void (site admins have all).

## 8. Player experience

- **Floor (`/predictions`)**: a live tape of trades across every market; tabs for *Live*, *Closing
  soon*, *Auto*, *Events*, *Resolved*; category chips; market cards with the price(s), a sparkline,
  24 h move, volume, time left, and one-tap YES/NO (or top outcomes) that open the ticket.
- **Market page (`/predictions/[slug]`)**: big price, live chart (one line per outcome), the ticket
  (buy/sell, outcome, amount, shares you get, average price, price after, payout if right, limit
  tab), your position and open orders, rules and source, the resolution timeline, trade feed, top
  holders, comments.
- **Portfolio (`/predictions/portfolio`)**: positions valued at current prices with P&L, resting
  orders, settled history.
- **Forecasters**: weekly leaderboard of realized prediction P&L on the floor.
- Live updates over `/api/prediction-markets/ws`: `prediction.trade` (every fill, with new prices),
  `prediction.market.updated` (status changes, new markets, resolutions).

## 9. Migration from the order-book build

- Tables are kept and extended (`prediction_markets`, `_outcomes`, `_positions`, `_trades`,
  `_price_history`, `_events`, comments). New: `prediction_limit_orders`,
  `prediction_resolution_proposals`, `prediction_disputes`, `prediction_auto_templates`.
- On first start, legacy resting order-book orders are cancelled and their reserved cash/shares
  released (idempotent, ledger-recorded), and every open legacy market gets market-maker state
  seeded at its last traded price with the default `b`. Existing positions carry over; their
  `net_cost_cash` is seeded from `avg_entry_price × shares`.
- The mint/redeem order book (`predictionOrderbook.js`) and its routes are retired.
- Existing list/detail/profile endpoints keep their fields (`last_traded_probability` is the YES
  price, or the leading outcome's price for multi) so the home page and profile keep working.
