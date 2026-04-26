# BBB Proposal Implementation Analysis

Date: 2026-04-25

## Executive Summary

The BBB proposal is a game-economy redesign for NASFAQ's oshicoin market. It keeps YouTube channel performance as the root source of value, but changes the player experience from continuous manual trading around a daily fair value into a more structured stock-market simulation with scheduled price adjustments, credit/liquid currency separation, supply scarcity, buybacks, weekly dividends/fees, licenses, contracts, bonds, side content, and auto-trading.

The current system already has several strong foundations:

- YouTube stats from `yt.youtube_channel_daily_stats` are converted into per-channel market fundamentals.
- Each market asset has a fair value, mid/bid/ask quotes, circulating/treasury supply, and historical daily state.
- Trades already write orders, fills, holdings, cash balances, ledger entries, market state, charts, leaderboards, achievements, and websocket events.
- There is already a scheduled market cycle that closes the market, recalculates fundamentals, settles the day, then reopens trading.
- Games, gacha, achievements, and prediction markets provide reusable patterns for side systems and ledger-backed cash movement.

The main gap is that the current market mechanics are built around immediate market orders against a treasury quote, while BBB expects an interval-driven economy with delayed live orders, player-facing supply scarcity, buybacks, separate credit/liquid balances, weekly evaluation, and automation. That can be implemented, but it should be phased. The least risky path is to keep the current fundamental formula and persistence model, then add BBB mechanics around scheduling, accounting, and execution.

## Current Market Mechanics

### Fundamental Values From YouTube Stats

Raw data starts in the `ytscraper` schema:

- `yt.youtube_channels` stores active channel metadata, symbols, names, units, icons, colors, and YouTube IDs.
- `yt.youtube_channel_daily_stats` stores time-series channel stats: subscriber count, view count, video count, hidden subscriber flag, upload/live metadata, and scrape time.

The API's fundamental calculation reads daily channel stats in `api/src/services/fundamentals.js`:

- It resolves each scrape into a local market date using `MARKET_DATA_TIMEZONE` or `SCRAPE_TIMEZONE`, defaulting to `America/New_York`.
- It selects the latest stat row per channel per day.
- It densifies missing dates by carrying forward last-known counts, but marks carried-forward `video_count` as missing.
- It computes 1-day, 7-day, and 30-day view deltas; 7-day and 30-day estimated subscriber deltas; and upload activity signals.

The current fundamental formula is:

- `size_anchor_raw = subscribers^0.42 * 30d_view_delta^0.08`
- `view_signal = log(recent_7d_avg_views / prior_28d_avg_views)`, clamped between `-0.4` and `0.4`
- `sub_signal` comes from recent subscriber growth and subscriber acceleration, clamped between `-0.5` and `0.5`
- `upload_signal` rewards short upload streaks and penalizes inactivity
- `stagnation_signal` penalizes weak 30-day subscriber and view trends
- `momentum_raw = 0.58 * view_signal + 0.3 * sub_signal + 0.12 * upload_signal + stagnation_signal`, clamped between `-1.35` and `1.35`
- `momentum_multiplier = exp(0.35 * momentum_raw)`
- `fundamental_value_raw = size_anchor_raw * momentum_multiplier`
- `fundamental_value_smoothed = 40% previous smoothed + 60% current raw`, capped to move at most `0.75x` to `1.25x` per day

That produces rows in `market.channel_daily_snapshots`. Asset-level fair value is then:

```text
current_fair_value = fundamental_value_smoothed / max_supply * MARKET_PRICE_SCALE_MULTIPLIER
```

The default scale multiplier is `100`. This means the current system already separates channel value from market price: YouTube stats drive fair value, while trading can push live price away from fair value.

### Daily Settlement

The market scheduler in `api/src/services/marketScheduler.js` runs once per day by default:

- Default settlement time is 9:00 AM America/New_York.
- It checks whether complete raw snapshots exist for all active channels.
- It sets runtime state to `settling`, recalculates fundamentals, runs settlement, then reopens trading.

Settlement in `api/src/services/settlement.js`:

- Reads active assets and the completed channel snapshot for the market date.
- Computes each asset's fair value from the latest smoothed fundamental and `max_supply`.
- Carries forward prior trading pressure as offsets:
  - persistent offset decays by default to `90%`
  - transient offset decays by default to `10%`
- Opens the new day at `fair_value * exp(persistent_offset + transient_offset)`.
- Computes bid/ask quotes from spread basis points.
- Applies daily treasury emission from `base_emission`, increased by positive premium.
- Writes `market.asset_daily_market_state`.
- Updates `market.market_assets` with current fair value, current mid/bid/ask, premium, offsets, treasury/circulating supply, and liquidity depth.

In short: the current market performs one daily adjustment toward fundamentals at settlement. It does not have BBB's four intra-day adjustment intervals.

### Trading And Price Changes

Current spot trading is implemented in `api/src/services/trading.js` and exposed through:

- `POST /api/market/orders/buy`
- `POST /api/market/orders/sell`

Each trade is immediate:

- The API verifies the user, asset status, market open state, quantity, cash, and holdings.
- It locks the asset, cash account, and holding rows.
- It computes a live mid price from current fair value plus decayed offsets:

```text
live_mid = fair_value * exp(persistent_offset + transient_offset)
```

- It derives bid/ask from configured spread.
- It computes slippage from order size versus `liquidity_depth`.
- A buy executes at `ask * (1 + slippage)`.
- A sell executes at `bid * (1 - slippage)`.
- It charges a cash fee, defaulting to `1%`.
- It writes `market.trade_orders`, `market.trade_fills`, `market.ledger_entries`, `market.portfolio_holdings`, and `market.portfolio_cash_balances`.
- It updates the asset's offsets:

```text
shock = quantity / liquidity_depth
buy:  persistent += 0.15 * shock, transient += 0.7 * shock
sell: persistent -= 0.15 * shock, transient -= 0.7 * shock
```

- It recomputes mid/bid/ask from the updated offsets.
- It updates the current daily market state and publishes a websocket market event.

This means price changes come from two sources:

1. Daily fundamental settlement changes fair value and resets/opening price.
2. Live trading moves the market premium/discount through persistent and transient offsets.

The current order model is not an order book and is not delayed. The counterparty is always the treasury, not another player.

### Existing Economy Surface

The current economy uses one cash wallet:

- `market.portfolio_cash_balances.cash_balance`
- Starter cash defaults to `10000`.
- Trading, achievements, games, and prediction markets all reuse this wallet.
- `market.ledger_entries` is the common audit trail.

There is no separate `Credit` versus `Liquid` balance. There are also no licenses, taxes paid from credit, weekly credit conversion, dividends, maintenance fees, buyback state, contract market, bond market, auction house, or BBB-style auto-trader yet.

The current game system does provide useful scaffolding:

- Gacha and game fees already debit/credit cash through ledger-backed wallet helpers.
- Achievements already grant cash rewards.
- Prediction markets already introduce a separate orderbook-style subsystem, which is a useful reference for contracts and delayed matching.

## What The BBB Proposal Seeks To Achieve

The proposal is trying to turn NASFAQ from a simple simulated exchange into a more durable game economy. Its goals are:

- Keep channel performance as the source of expected value.
- Make outcomes predictable enough that players can reason about them.
- Keep enough randomness and schedule uncertainty that the market can surprise players.
- Reduce the advantage of users who camp the trade UI or script frequent API calls.
- Give players meaningful outlets for accumulated money beyond buying more shares.
- Create recurring risks at all levels of play, including maintenance fees, supply reductions, buybacks, contract exposure, and bad automation.
- Create player goals through licenses, achievements, contracts, bonds, side modes, and favored indexes/coins.
- Make liquidity and scarcity matter: when a coin's float is exhausted, players need contracts/options rather than infinite treasury fills.

The proposal does not require a literal stock-market clone. It is explicitly comfortable with game-first mechanics.

## Fit Against Current System

### Strong Fits

#### Daily Base Rate / Fair Value

BBB's "base rate" maps cleanly to current `current_fair_value`, which is already independent of market price. The system already computes a channel-driven fair value from YouTube stats and stores it separately from live mid price.

Recommended mapping:

- BBB base rate = `market.market_assets.current_fair_value`
- BBB baseline calculation = current `market.channel_daily_snapshots.fundamental_value_smoothed / max_supply * multiplier`
- BBB in-network comparison / bell curve = an optional replacement or augmentation of the current absolute formula

The proposal says the base rate should be updated only at Open. The current system already updates fair values at daily settlement/open, so this is mostly compatible.

#### Scheduled Adjustment Toward Base Rate

Current settlement already adjusts toward fair value once per day. BBB extends this to four intervals per day with random adjustment weights totaling `200`.

The existing offset model can support this if interval settlement modifies offsets or mid price rather than rewriting fundamentals.

Best implementation approach:

- Keep `current_fair_value` as base rate.
- Add `market.market_adjustment_sessions` for each market date.
- Add `market.market_adjustment_intervals` for each asset and interval.
- Generate four per-asset weights at Open, total `200`, with min/max guardrails.
- At each interval, move the live price toward base by the interval weight.
- Store the event in `market.asset_price_events` and update `asset_daily_market_state`.

The adjustment formula can be:

```text
next_mid = current_mid + (base_rate - current_mid) * (interval_weight / 100)
```

Then recompute:

```text
current_persistent_offset + current_transient_offset = ln(next_mid / current_fair_value)
```

To preserve current trading semantics, the cleanest version should adjust the transient offset first, then persistent offset only if the design wants the interval move to survive future daily decay.

#### Live Order Limits And Delayed Execution

BBB's live order cap of `180` per interval maps well to a new pending order queue. Current `market.trade_orders` already has fields for `pending`, `filled`, `cancelled`, and `rejected`, though current code only creates filled market orders.

Recommended approach:

- Extend `trade_orders.order_type` to include `live_market` or add a separate `market.live_orders` table.
- Store pending user orders during the interval.
- Enforce `180` orders per user per interval.
- Batch-execute eligible orders every 10 minutes.
- Do not publish all details publicly until the next interval if that rule is desired.

This is a meaningful change to UX and service code, but it is easier than contracts or buybacks because it can reuse current `executeOrder` internals after the queue has selected orders to execute.

#### Achievements And Side Content

Achievements and games already exist, and gacha already spends the current cash wallet. These are natural places to add BBB's early injections, cosmetics, gacha, arcade, and event games.

The hard part is not the content itself; it is currency semantics. If BBB Credit is introduced, all existing game wallet helpers need to know whether each cost/reward uses Credit, Liquid, or either.

### Partial Fits

#### Volume, Max Shares, Treasury Supply, And Scarcity

The schema already has:

- `max_supply`
- `circulating_supply`
- `treasury_supply`
- `base_emission`

Current behavior is not BBB behavior:

- The treasury is the market counterparty.
- Daily emission releases more shares from treasury into circulation.
- Buys do not appear to check or decrement treasury inventory per trade.
- Selling does not replenish treasury supply.
- Scarcity is visible in the schema but not yet enforced as a hard player-facing cap.

BBB wants max shares to scale from subscriber count, update weekly/monthly/quarterly, lock buys when max circulation is reached, and trigger buybacks when max supply decreases below shares outstanding.

This requires a supply accounting redesign:

- Define exactly what `circulating_supply` means: total minted shares, shares held by players, or float available to market.
- Track player-held shares separately from treasury-held shares.
- Enforce buy availability against broker/treasury inventory.
- Add reserved broker buffer shares that count for ownership percentages but are sold first during forced buybacks.
- Add buyback states and forced proportional reductions.

The existing schema is helpful, but the current trade execution model needs changes before BBB scarcity is real.

#### Weekly Evaluation

The scheduler already has daily settlement. BBB needs a weekly Saturday 12:00 AM ET evaluation that:

- Closes buybacks.
- Issues dividends and maintenance fees.
- Adjusts maximum shares.
- Converts a portion of Credit into Liquid.
- Computes weekly bell-curve rankings of metric shifts.

This should be a new weekly job, not a replacement for the daily open/interval cycle. Current net worth has daily and weekly leaderboard change calculations, but there is no weekly economic evaluation service.

Recommended implementation:

- Add `market.weekly_evaluation_runs`.
- Add `market.asset_weekly_evaluations`.
- Snapshot each asset's metrics at evaluation time.
- Compare metric shifts against the previous evaluation.
- Convert the shift ranking into dividend/fee rates, capped at the proposal's suggested `10%`.
- Apply player-level dividend/fee ledger entries.
- Apply Credit-to-Liquid conversion.
- Recompute max shares and initiate/close buybacks.

#### Taxes, Fees, Credit, And Liquid

BBB's currency model is much richer than the current one-wallet cash model:

- Liquid is spendable cash for investing and some licenses.
- Credit is the main income buffer and fee/tax payment source.
- Most rewards become Credit, not Liquid.
- Weekly conversion moves a capped percentage of Credit into Liquid.
- Buy taxes prefer Credit but fall back to Liquid.
- Sell proceeds partly become Credit.
- Dividends are Credit.

The current `portfolio_cash_balances` table can become Liquid, but Credit should be a separate balance. Trying to encode both in one `cash_balance` column will make the economy ambiguous and hard to audit.

Recommended schema:

- Rename in code semantics: current `cash_balance` = Liquid.
- Add `market.portfolio_credit_balances`.
- Add balance columns to `ledger_entries` only if needed for audit snapshots; otherwise encode with `entry_type`, `cash_delta`, and a new `credit_delta`.
- Update trading, games, achievements, prediction markets, net worth, profiles, and leaderboards to use explicit Liquid/Credit behavior.

This is a broad change because current code assumes one spendable currency.

#### Licenses

Licenses are not present, but they fit the current architecture:

- Use `market.licenses` catalog.
- Use `market.user_licenses`.
- Gate features in service-layer permission checks.
- Surface progress through achievements/profile/game pages.

Licenses should be introduced before gambits, contracts, indexes, and side modes because many proposed systems use licenses for progression and caps.

### Hard Fits

#### Contracts Market

Contracts let players temporarily trade using another user's shares, with premiums, execution windows, conditions, cancellation penalties, and buyouts. This introduces contingent claims on player holdings.

This is harder than normal trading because it requires:

- Underwriter share reservations or risk checks.
- Contract inventory ownership.
- Premium payment and refund logic.
- Execution condition evaluation at intervals/ticks.
- Partial availability/cancellation behavior if underwriter shares changed.
- Buyout support.
- Auction house transferability rules.

This should not be implemented by overloading current `trade_orders`. It needs its own subsystem.

#### Bond Market

Bond contracts insure a sale floor based on the user's mean purchase price or the prior week's average base rate. This requires:

- Reliable mean purchase price tracking by asset and user.
- Prior weekly average base-rate storage.
- Per-user weekly purchase limits.
- Transferability through auction.
- Settlement-time or sale-time floor calculation.
- Rules for which shares/quantity are covered.

This depends on weekly evaluation, contracts, auction inventory, and robust cost basis data. It should come late.

#### Market Gambits / Auto-Trader

Auto-trading sounds simple but is operationally complex because it becomes a programmable execution engine. It needs:

- A condition DSL or structured rule model.
- Validation and limits.
- Per-user slot caps.
- License gating.
- Long-term versus weekly-reset behavior.
- Execution ordering when many players trigger at the same tick.
- Protection against runaway loops and market manipulation.
- Integration with contracts, indexes, and live orders.

The current backend has no generic job runner for user-authored trading rules. This should be implemented after delayed order execution and interval adjustments are stable.

#### Player-To-Player Market Structure

BBB's contracts and scarcity rules assume some player-to-player market behavior. Current spot trading is treasury-executed. Prediction markets have an orderbook system, but spot oshicoin does not.

The team needs a product decision:

- Keep spot trades treasury-executed, and make player-to-player behavior only apply to contracts/auction house.
- Or move spot oshicoin toward a real order book.

The first path is much easier and better aligned with the current system.

## Easiest-To-Hardest Implementation Ranking

### 1. Documentation, Tuning Flags, And Admin Controls

Difficulty: Low

Add configuration and admin-visible fields for BBB tuning:

- interval times
- random adjustment thresholds
- per-asset adjustment min/max
- credit conversion defaults
- dividend/fee caps
- live-order limits
- max-supply evaluation cadence

This creates space to iterate without hardcoding economy values.

### 2. Base Rate Naming And Reporting

Difficulty: Low

Expose current fair value as BBB-style base rate in API responses and UI copy. Add report fields showing:

- base rate
- market price
- premium/discount
- next adjustment interval
- adjustment history

This is mostly presentation and analytics over existing data.

### 3. Four Daily Adjustment Intervals

Difficulty: Medium

Add interval scheduling and asset adjustment events around the existing fair-value/offset model. This changes price behavior but can preserve existing trade execution.

Key risk: deciding how interval moves interact with transient/persistent offsets and existing daily settlement decay.

### 4. Live Order Queue And 180-Order Interval Limit

Difficulty: Medium

Add pending live orders and a 10-minute executor. Reuse current trade fill code after refactoring `executeOrder` into quote/validate/fill primitives.

Key risk: preserving transactional safety and preventing API spam.

### 5. Licenses

Difficulty: Medium

Add catalog/user-license tables and service-layer gates. This is straightforward but touches many features as they become gated.

### 6. Credit Balance And Weekly Conversion

Difficulty: Medium-High

Add Credit alongside Liquid and migrate rewards/costs gradually. This touches trading, games, achievements, leaderboards, net worth, and UI.

Key risk: inconsistent currency use if some paths continue treating `cash_balance` as generic money.

### 7. Weekly Evaluation, Dividends, And Fees

Difficulty: High

Requires a weekly scheduler, metric snapshot comparison, bell-curve ranking, dividend/fee calculation, and player-holding payouts/charges.

Key risk: fees can push users negative, but current cash balances have a nonnegative DB constraint. BBB explicitly wants players at risk of going red, so balance constraints and UI assumptions must change.

### 8. Max Shares, Hard Supply Caps, And Buybacks

Difficulty: High

Requires precise supply semantics, broker buffers, buy locks, voluntary buyback windows, forced proportional buybacks, and possibly negative/credit fallback behavior.

Key risk: current trading does not decrement treasury supply per buy, so scarcity is not currently enforceable.

### 9. Contract Market

Difficulty: Very High

Requires contingent claims on user holdings, premiums, execution windows, condition evaluation, buyouts, penalties, inventory transferability, and auction compatibility.

### 10. Bond Market

Difficulty: Very High

Requires mature weekly base-rate storage, contract/inventory systems, sale-floor settlement, and transferability.

### 11. Market Gambits / Auto-Trader

Difficulty: Very High

Requires a safe rule engine, scheduled execution, license/slot caps, reset behavior, and careful market-impact ordering. This should be built only after interval execution and live-order batching are stable.

## Recommended Implementation Plan

### Phase 1: Align Vocabulary And Data Model

Goals:

- Treat current fair value as BBB base rate.
- Preserve current fundamental calculation.
- Add API/reporting fields for base rate, premium/discount, and adjustment readiness.
- Add schema placeholders for per-asset BBB tuning.

Suggested changes:

- Add columns to `market.market_assets` or a new `market.asset_market_config` table:
  - `adjustment_min_pct`
  - `adjustment_max_pct`
  - `adjustment_enabled`
  - `supply_evaluation_cadence`
  - `broker_buffer_pct`
- Add docs/admin UI explaining current fair value as base rate.

### Phase 2: Interval Adjustment Engine

Goals:

- Implement Open/Lunch/Late/Close adjustments without changing trading yet.
- Generate four random strengths per asset at Open, totaling `200`.
- Apply interval moves toward base rate.

Suggested tables:

- `market.adjustment_sessions`
  - `id`
  - `market_date`
  - `status`
  - `generated_at`
  - `opened_at`
  - `completed_at`
- `market.asset_adjustment_intervals`
  - `id`
  - `session_id`
  - `asset_id`
  - `interval_key`
  - `scheduled_at`
  - `strength_pct`
  - `base_rate`
  - `price_before`
  - `price_after`
  - `status`
  - `applied_at`

Execution should update `market.market_assets`, `market.asset_daily_market_state`, and `market.asset_price_events`.

### Phase 3: Live Orders

Goals:

- Move manual trading from immediate execution toward interval/tick-based execution.
- Enforce per-user interval limits.
- Reduce advantage from sitting on the UI or scripting the API.

Implementation choices:

- Refactor current `executeOrder` into smaller helpers.
- Add `market.live_order_batches`.
- Add either a new `market.live_orders` table or extend `market.trade_orders`.
- Execute orders every 10 minutes using the same quote/shock/fill logic.

The current immediate endpoints can initially remain as admin/dev endpoints or be adapted to create live orders.

### Phase 4: Credit/Liquid Currency Split

Goals:

- Keep current `cash_balance` as Liquid.
- Add Credit as a separate wallet.
- Make new BBB rewards mostly issue Credit.
- Add weekly Credit-to-Liquid conversion.

Suggested tables/columns:

- `market.portfolio_credit_balances`
- `market.user_economy_settings` with conversion rate and caps
- `market.ledger_entries.credit_delta`

Refactor wallet helpers into a general economy service:

- debit Liquid
- credit Liquid
- debit Credit
- credit Credit
- debit Credit then fallback to Liquid

### Phase 5: Weekly Evaluation

Goals:

- Add Saturday weekly evaluation.
- Snapshot metric shifts.
- Apply dividends/fees.
- Convert Credit to Liquid.
- Prepare for supply changes.

Suggested tables:

- `market.weekly_evaluation_runs`
- `market.asset_weekly_evaluations`
- `market.user_weekly_economy_events`

Start with dividends only, then add fees after the UI and negative-balance behavior are decided.

### Phase 6: Licenses And Side Content Expansion

Goals:

- Add licenses as the progression layer.
- Gate higher conversion rates, side modes, indexes, live-order features, and future gambit slots.
- Expand achievements to give early Credit/Liquid injections and later cosmetics.

This can overlap with Phase 4 after the currency split exists.

### Phase 7: Supply Caps And Buybacks

Goals:

- Make max shares scale from subscriber count on weekly/monthly cadence.
- Enforce broker/treasury availability.
- Lock buys when max circulation is reached.
- Implement voluntary and forced buybacks.

This phase should wait until the team has decided exact supply semantics and tested interval/live-order behavior.

### Phase 8: Contracts, Bonds, Auction House, And Gambits

Goals:

- Add advanced risk tools and automation after the core economy is stable.
- Reuse prediction-market orderbook ideas where appropriate, but keep contracts separate from spot trading.

Order:

1. Auction inventory primitives.
2. Contract market.
3. Bond contracts.
4. Gambit rule engine.

## Product Impact If Implemented

### Player Behavior

The market would become less about repeated button pressing and more about planning around intervals, expected base-rate moves, supply scarcity, and weekly risk. Players could participate meaningfully without logging in at exact daily reset times, especially once live orders and gambits exist.

### Economy Health

Credit/Liquid separation gives the system a way to reward players frequently without flooding the investable money supply. Weekly conversion, fees, licenses, gacha, auction house, and side modes become money sinks and pacing controls.

### Market Readability

Base rate versus market price makes the market easier to reason about:

- If price is below base rate and a strong interval remains, players expect upward pressure.
- If price is above base rate, players understand premium risk.
- Random interval strength keeps that expectation from becoming deterministic.

### Risk And Volatility

Weekly fees, buybacks, overadjustments, contracts, bonds, and supply changes create the proposal's intended risk profile. This is a major shift from today's market, where risk mostly comes from trade-induced premium/discount, fair-value drift, and normal buy/sell timing.

### Engineering Cost

The proposal is implementable, but it is not a single feature. It is a multi-phase economy rebuild. The first three phases are mostly compatible with current code. Credit/Liquid, buybacks, contracts, bonds, and auto-trading are larger architectural changes.

## Open Design Decisions

- The proposal lists intervals as `9a, 3p, 9p, 3p`; this likely means `9a, 3p, 9p, 3a`.
- Should interval strengths be generated per asset, per market, or per asset category? The proposal recommends per coin, which provides flexibility but more variance.
- Should interval adjustments affect transient offset, persistent offset, or directly set mid price?
- Should current immediate trading remain available, or should all user trading become delayed live orders?
- Can users have negative Liquid, negative Credit, or both? Current cash balances disallow negatives.
- What exactly counts as shares "in circulation": all minted shares, all player-held shares, or player-held plus broker buffer?
- Should the treasury remain the counterparty for spot trades, or should scarce coins require player-to-player execution?
- How should superchats map into Credit, and does that connect to existing `yt.youtube_superchats` data or a new user-issued superchat feature?
- Are indexes already planned as tradable assets, or should they be synthetic portfolio products?

## Bottom Line

BBB fits the current system best as an evolution of the existing fair-value market, not a replacement. The current fundamental pipeline can remain largely intact. The immediate next implementation should be interval adjustments toward base rate, followed by delayed live orders. Those two changes would already deliver the proposal's core market feel: predictable base-rate pressure, uncertain interval strength, less manual-trading grind, and clearer strategic timing.

The larger economy features should come after that foundation. Credit/Liquid and weekly evaluation are the next most important because they unlock the proposal's pacing and risk model. Supply caps/buybacks, contracts, bonds, and gambits are achievable but should be treated as late-stage systems because they require new accounting, scheduling, inventory, and execution semantics beyond the current spot market.
