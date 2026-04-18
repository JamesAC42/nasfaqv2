# NASFAQ Phase 1 Low-Level Design

## 1. Purpose

This document defines the Phase 1 implementation for the NASFAQ market system. The goal is to replace the legacy infinite-share, price-bump model with a market that:

* derives a daily **fundamental value** for each channel from YouTube statistics,
* maintains a separate live **market price** that can trade above or below fundamentals,
* introduces **treasury-controlled supply**, **daily settlement**, and **market reporting**,
* stores sufficient historical data for charts, audits, and future reprocessing,
* is structured so an AI implementation agent can build it with minimal ambiguity.

Phase 1 intentionally excludes:

* player-to-player order matching,
* margin/leverage,
* prediction markets,
* ETFs / guild funds,
* advanced market halts,
* automated subscriber interpolation beyond optional extension points.

Phase 1 includes:

1. Daily YouTube snapshot ingestion
2. Fundamental value calculation
3. Market asset state and treasury state
4. Daily market settlement
5. Treasury-backed instant buy/sell execution
6. Ledger-backed accounting
7. Candlestick / chart data
8. Read APIs, trade APIs, and a daily market report

---

## 2. Core Concepts

Each tradable asset maps 1:1 to a YouTube channel for now.

Important numbers:

* **YouTube stats**: subscriber count, view count, video count from daily snapshots
* **Fundamental value**: derived daily from the channel’s size and recent momentum
* **Fair value**: the asset’s current fundamental value used by the market engine
* **Mid price**: the live market price in the game
* **Bid / ask**: current executable treasury quotes
* **Treasury supply**: shares held back by the system
* **Circulating supply**: shares already in the market / user hands / treasury sell inventory
* **Daily emission**: shares released from treasury according to pricing rules

The system intentionally separates:

* **historical daily snapshots** from
* **current asset state** from
* **trade history** from
* **daily market state archives**

This separation is required for recalculation, charting, and audits.

---

## 3. Functional Requirements

### 3.1 Snapshot and fundamentals

* The scraper must ingest a daily snapshot per channel.
* Each snapshot must persist raw values and derived values.
* Fundamental calculation must be versioned.
* A backfill/recalculation process must be possible.

### 3.2 Market state

* Each asset must have a current fair value, mid price, bid, ask, premium, treasury supply, circulating supply, and daily emission.
* Daily settlement must update market state once per market day.
* Settlement must be idempotent.

### 3.3 Trading

* Users can buy/sell against the treasury at current quotes.
* Trading must create orders, fills, ledger entries, and update holdings.
* Fees must be recorded explicitly.
* Trade execution must update live price.

### 3.4 History and reporting

* Historical snapshots of both stats and market state must be queryable.
* Candlestick chart data must be available.
* A daily market report must summarize movers, momentum, value changes, volume, and treasury actions.

---

## 4. Non-Functional Requirements

* PostgreSQL is the system of record.
* TimescaleDB is used for time-series storage and candle aggregates.
* Redis is used only for hot caches / live quote caching / in-progress aggregates.
* The design must support safe reprocessing of fundamentals when formulas change.
* The design must avoid hidden or duplicated sources of truth.
* All cash/share mutations must be ledger-backed.

---

## 5. System Components

## 5.1 Scraper Service

Responsibilities:

* fetch daily YouTube stats per channel
* insert a `channel_daily_snapshots` row
* mark snapshot as `raw_ingested`
* enqueue or trigger the fundamentals calculator

Inputs:

* list of active YouTube channels

Outputs:

* raw daily snapshot row

## 5.2 Fundamentals Calculator Service

Responsibilities:

* read new snapshots
* compute derived deltas and fundamental values
* update snapshot row with derived metrics
* update current market asset with latest fair value fields

Inputs:

* new or recalculation-targeted snapshot rows
* prior historical snapshots for the same channel
* current formula version and parameters

Outputs:

* derived metrics on snapshot row
* updated current fair value in `market_assets`

## 5.3 Daily Market Settlement Service

Responsibilities:

* run once per market day after new snapshots are ready
* update fair values and live prices
* compute premium and daily emission
* apply treasury release rules
* write `asset_daily_market_state`
* write system price events
* update `market_assets.current_*`
* produce the daily market report summary

Inputs:

* latest completed snapshot per asset
* current `market_assets` row

Outputs:

* new daily market state rows
* updated market asset current state
* market report rows / cached artifacts

## 5.4 Trade Execution Service

Responsibilities:

* validate buy/sell request
* price order from current quotes
* compute fee and cash impact
* create order + fill rows
* write ledger entries
* update holdings
* update live price / quote cache
* optionally record price event

Inputs:

* authenticated user
* asset + side + quantity
* current market state and treasury availability

Outputs:

* order row
* fill row
* ledger entries
* updated holdings
* updated live quote / price

## 5.5 Market Read API Service

Responsibilities:

* expose asset list, asset detail, candles, trades, stats history, treasury state, market reports, portfolio views

## 5.6 Frontend / App

Responsibilities:

* asset list screen
* asset detail page with chart overlays
* trade ticket
* portfolio page
* daily market report

---

## 6. Domain Model

### 6.1 Channel vs Asset

Keep `youtube_channels` separate from `market_assets`.

Reason:

* a channel is a source entity / metadata object
* an asset is a tradable market object with supply, treasury, price, and market lifecycle

The mapping is 1:1 for now but should remain explicit.

---

## 7. Database Schema

All numeric price/value fields should use `numeric` rather than floating point.
All timestamps should use `timestamptz`.
All dates representing market days should use `date`.

## 7.1 youtube_channels

Purpose: identity and metadata for the YouTube source.

Suggested schema:

```sql
create table youtube_channels (
  id bigserial primary key,
  youtube_channel_id text not null unique,
  name text not null,
  slug text not null unique,
  thumbnail_url text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

## 7.2 fundamental_formula_versions

Purpose: version the algorithm and parameters used to compute fundamentals.

```sql
create table fundamental_formula_versions (
  version integer primary key,
  name text not null,
  description text not null,
  parameters_json jsonb not null,
  created_at timestamptz not null default now()
);
```

## 7.3 channel_daily_snapshots

Purpose: canonical daily historical record of raw stats and derived values.

```sql
create table channel_daily_snapshots (
  id bigserial primary key,
  channel_id bigint not null references youtube_channels(id),
  snapshot_date date not null,

  subscriber_count bigint not null,
  view_count bigint not null,
  video_count bigint not null,

  -- derived deltas
  view_delta_1d bigint,
  view_delta_7d bigint,
  view_delta_30d bigint,
  video_delta_7d integer,
  video_delta_30d integer,
  estimated_sub_delta_7d numeric,
  estimated_sub_delta_30d numeric,

  -- derived fundamentals
  size_anchor_raw numeric,
  view_signal numeric,
  upload_signal numeric,
  sub_signal numeric,
  momentum_raw numeric,
  momentum_multiplier numeric,
  fundamental_value_raw numeric,
  fundamental_value_smoothed numeric,

  calculation_version integer references fundamental_formula_versions(version),
  calculation_status text not null default 'pending',
  calculation_error text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique(channel_id, snapshot_date)
);
```

Recommended indexes:

```sql
create index idx_channel_daily_snapshots_channel_date
  on channel_daily_snapshots(channel_id, snapshot_date desc);
```

## 7.4 market_assets

Purpose: current tradable state for each asset.

```sql
create table market_assets (
  id bigserial primary key,
  channel_id bigint not null unique references youtube_channels(id),
  symbol text not null unique,
  display_name text not null,
  status text not null default 'active', -- prelaunch, active, halted, delisted

  max_supply numeric not null,
  circulating_supply numeric not null,
  treasury_supply numeric not null,

  latest_snapshot_date date,
  current_fair_value numeric,
  current_fair_value_raw numeric,
  current_mid_price numeric,
  current_bid_price numeric,
  current_ask_price numeric,
  current_premium_pct numeric,
  current_daily_emission numeric,

  liquidity_depth numeric not null,
  spread_bps integer not null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

## 7.5 asset_price_events

Purpose: system-driven price changes that should be historically visible and optionally charted.

```sql
create table asset_price_events (
  id bigserial primary key,
  asset_id bigint not null references market_assets(id),
  ts timestamptz not null,
  event_type text not null, -- daily_reset, ipo_open, admin_adjustment, etc.
  old_mid_price numeric,
  new_mid_price numeric not null,
  fair_value_at_event numeric,
  metadata_json jsonb,
  created_at timestamptz not null default now()
);
```

## 7.6 trade_orders

Purpose: order-level request record.

```sql
create table trade_orders (
  id bigserial primary key,
  user_id bigint not null,
  asset_id bigint not null references market_assets(id),
  side text not null, -- buy, sell
  order_type text not null, -- market
  requested_quantity numeric not null,
  filled_quantity numeric not null default 0,
  status text not null default 'pending', -- pending, filled, cancelled, rejected
  quote_bid_at_submit numeric,
  quote_ask_at_submit numeric,
  rejection_reason text,
  metadata_json jsonb,
  requested_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

## 7.7 trade_fills

Purpose: execution record and source of truth for trade-based volume.

TimescaleDB hypertable candidate.

```sql
create table trade_fills (
  id bigserial primary key,
  order_id bigint not null references trade_orders(id),
  asset_id bigint not null references market_assets(id),
  user_id bigint not null,
  ts timestamptz not null,
  side text not null,
  price numeric not null,
  quantity numeric not null,
  gross_cash numeric not null,
  fee_cash numeric not null,
  net_cash numeric not null,
  counterparty_type text not null, -- treasury, player
  created_at timestamptz not null default now()
);
```

If using TimescaleDB:

```sql
select create_hypertable('trade_fills', 'ts', if_not_exists => true);
```

## 7.8 ledger_entries

Purpose: immutable accounting trail for all balance changes.

```sql
create table ledger_entries (
  id bigserial primary key,
  user_id bigint not null,
  asset_id bigint references market_assets(id),
  entry_type text not null,
  quantity_delta numeric not null default 0,
  cash_delta numeric not null default 0,
  reference_type text not null,
  reference_id bigint not null,
  created_at timestamptz not null default now()
);
```

Examples:

* buy cash debit
* buy asset credit
* sell asset debit
* sell cash credit
* trade fee
* starter cash grant
* admin adjustment

## 7.9 portfolio_holdings

Purpose: materialized current position state for fast reads.

```sql
create table portfolio_holdings (
  user_id bigint not null,
  asset_id bigint not null references market_assets(id),
  quantity numeric not null,
  avg_cost_basis numeric not null,
  updated_at timestamptz not null default now(),
  primary key(user_id, asset_id)
);
```

## 7.10 asset_daily_market_state

Purpose: historical daily archive of per-asset market state after settlement and through the market day.

```sql
create table asset_daily_market_state (
  id bigserial primary key,
  asset_id bigint not null references market_assets(id),
  market_date date not null,
  snapshot_id bigint not null references channel_daily_snapshots(id),

  fair_value numeric not null,
  fair_value_raw numeric,

  mid_open numeric not null,
  mid_close numeric,
  mid_high numeric,
  mid_low numeric,
  bid_close numeric,
  ask_close numeric,
  premium_close_pct numeric,

  daily_emission numeric not null,
  treasury_supply_start numeric not null,
  treasury_supply_end numeric,
  circulating_supply_start numeric not null,
  circulating_supply_end numeric,

  volume_shares numeric not null default 0,
  volume_cash numeric not null default 0,
  trade_count integer not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique(asset_id, market_date)
);
```

## 7.11 market_settlement_runs

Purpose: operational tracking and idempotency support.

```sql
create table market_settlement_runs (
  id bigserial primary key,
  market_date date not null,
  status text not null, -- started, completed, failed
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  error_text text,
  unique(market_date)
);
```

## 7.12 daily_market_reports

Purpose: cached or persisted daily market report summary.

```sql
create table daily_market_reports (
  market_date date primary key,
  report_json jsonb not null,
  created_at timestamptz not null default now()
);
```

---

## 8. Fundamental Value Algorithm

## 8.1 Goal

The formula should behave as follows:

* subscriber count anchors long-term size
* short-term value should move primarily from views and posting activity
* value should go down when growth is slower than the channel’s own recent norm
* value should spike when a channel has a breakout period
* after a spike, if the next period cools down, value should fall back
* cumulative monotonic metrics should not make value monotonically increase forever

## 8.2 Constraint: YouTube subscriber granularity

For large channels, subscriber count often only updates in steps of 10,000.
Therefore:

* raw daily subscriber delta must **not** be used as the primary short-term momentum signal
* subscriber count is used primarily as a **size anchor**
* view-based momentum should dominate day-to-day changes
* an optional future enhancement may infer smoothed subscriber growth between step changes

## 8.3 Required derived values

Given snapshot day `t`:

* `subs_t = subscriber_count[t]`
* `views_t = view_count[t]`
* `videos_t = video_count[t]`

Derived rolling deltas:

* `view_delta_1d = views_t - views_(t-1)`
* `view_delta_7d = views_t - views_(t-7)`
* `view_delta_30d = views_t - views_(t-30)`
* `video_delta_7d = videos_t - videos_(t-7)`
* `video_delta_30d = videos_t - videos_(t-30)`

Derived rolling averages:

* `view_recent = view_delta_7d / 7`
* `view_base = max((views_(t-7) - views_(t-35)) / 28, 100)`
* `upload_recent = video_delta_7d / 7`
* `upload_base = max((videos_(t-7) - videos_(t-35)) / 28, 0.05)`

The floors (`100`, `0.05`) prevent instability for small channels.

## 8.4 Size anchor

Use subscriber count as the dominant size anchor, with 30-day views as a smaller secondary weight so dead channels do not coast indefinitely.

Recommended v1 formula:

```text
size_anchor_raw = subscriber_count^0.85 * max(view_delta_30d, 1)^0.15
```

Notes:

* subscribers dominate scale
* recent view activity still matters
* total cumulative view count is intentionally not used heavily

## 8.5 Momentum signals

View signal:

```text
view_signal = ln( max(view_recent, 100) / max(view_base, 100) )
```

Upload signal:

```text
upload_signal = ln( max(upload_recent, 0.05) / max(upload_base, 0.05) )
```

Optional future subscriber signal:

```text
sub_signal = null for v1
```

## 8.6 Combine momentum

Recommended v1 weights:

```text
momentum_raw = 0.85 * view_signal + 0.15 * upload_signal
```

Clamp to avoid pathological spikes:

```text
momentum_raw = clamp(momentum_raw, -1.0, 1.0)
```

Convert to multiplier:

```text
momentum_multiplier = exp(0.7 * momentum_raw)
```

Interpretation:

* momentum `0` => multiplier `1.0`
* strong positive momentum => value > anchor
* strong negative momentum => value < anchor

## 8.7 Raw fundamental value

```text
fundamental_value_raw = size_anchor_raw * momentum_multiplier
```

## 8.8 Smoothed fundamental value

To avoid noisy daily jumps, apply partial smoothing against the prior day’s smoothed value.

If prior day exists:

```text
fundamental_value_smoothed = 0.75 * previous_fundamental_value_smoothed
                           + 0.25 * fundamental_value_raw
```

If no prior day exists:

```text
fundamental_value_smoothed = fundamental_value_raw
```

## 8.9 Practical interpretation

* If a channel has a big view spike, `view_recent / view_base` rises sharply and the multiplier jumps.
* If the next week cools off, the ratio falls and value drops back even though cumulative views still increased.
* This creates desirable “surprise / cooldown” behavior.

## 8.10 Future extensions

Possible later improvements:

* inferred daily subscriber growth from 10,000-step changes
* engagement/sentiment metrics
* upload recency decay
* seasonal normalization
* rank-relative adjustments

---

## 9. Market Pricing Model

Phase 1 should use a simple treasury-backed quote model, not a player order book.

## 9.1 Current state variables per asset

* `fair_value`
* `mid_price`
* `bid_price`
* `ask_price`
* `premium_pct`
* `daily_emission`
* `liquidity_depth`
* `spread_bps`

## 9.2 Daily reset toward fair value

At daily settlement, update the live mid price by pulling it partially toward fair value.

```text
new_mid_price = old_mid_price + 0.25 * (fair_value - old_mid_price)
```

Interpretation:

* only 25% of the gap closes per day
* players can sustain premium/discount regimes
* fundamentals remain a center of gravity

If asset is new and has no prior market price:

```text
new_mid_price = fair_value
```

## 9.3 Premium calculation

```text
premium_pct = (mid_price - fair_value) / fair_value
```

## 9.4 Daily emission

Phase 1 treats emission primarily as treasury inventory release and anti-squeeze liquidity control.

Base formula:

```text
daily_emission = base_emission * (1 + 2 * max(0, premium_pct))
```

This means:

* assets trading above fair value get more daily supply release
* assets at or below fair value stay near base emission

Each asset should have a configured `base_emission` derivable from launch configuration. For phase 1, it may be stored on `market_assets` or in a related config table if preferred.

If the current schema needs it, add:

```sql
alter table market_assets add column base_emission numeric;
```

Recommended clamp:

```text
daily_emission = clamp(daily_emission, base_emission * 0.25, base_emission * 4.0)
```

## 9.5 Spread and quotes

For v1, use a simple spread around mid price.

```text
spread_pct = spread_bps / 10000
ask_price = mid_price * (1 + spread_pct / 2)
bid_price = mid_price * (1 - spread_pct / 2)
```

Suggested initial spread: `400 bps` (4%) for thin/early markets.

Possible later refinement:

* widen spread as premium increases
* widen spread as treasury inventory tightens

## 9.6 Intraday trade impact

Each executed trade moves `mid_price` based on order size relative to `liquidity_depth`.

Buy:

```text
impact_pct = quantity / liquidity_depth
new_mid_price = old_mid_price * (1 + impact_pct)
```

Sell:

```text
impact_pct = quantity / liquidity_depth
new_mid_price = old_mid_price * (1 - impact_pct)
```

Then recompute bid/ask from the new mid.

Suggested initial liquidity depth model:

```text
liquidity_depth = max(5000, 0.02 * circulating_supply)
```

This can be precomputed into `market_assets.liquidity_depth`.

## 9.7 Treasury inventory update

At daily settlement, release `daily_emission` from treasury into tradable inventory by decreasing `treasury_supply` and increasing `circulating_supply`, subject to max constraints.

```text
emission_applied = min(daily_emission, treasury_supply)
new_treasury_supply = treasury_supply - emission_applied
new_circulating_supply = circulating_supply + emission_applied
```

If `treasury_supply` is exhausted, emission is effectively zero.

---

## 10. Daily Market Settlement Algorithm

## 10.1 Preconditions

* all expected daily snapshots for active channels have been ingested
* fundamentals calculator has completed for those snapshots
* no successful settlement already exists for the target market date unless explicit rerun mode is used

## 10.2 Settlement steps per market day

1. Create `market_settlement_runs` row with status `started`
2. For each active asset:

   * find latest snapshot for `market_date`
   * read previous `market_assets` current state
   * set `fair_value = snapshot.fundamental_value_smoothed`
   * set `fair_value_raw = snapshot.fundamental_value_raw`
   * compute `mid_open` using daily reset formula
   * compute `premium_pct`
   * compute `daily_emission`
   * compute updated treasury/circulating supplies
   * compute bid/ask from spread
   * insert `asset_price_events` row of type `daily_reset`
   * upsert `asset_daily_market_state` for the market date
   * update `market_assets.current_*`
3. Build and persist the daily market report
4. Mark settlement run `completed`

## 10.3 Idempotency

Use unique constraints and transaction boundaries to ensure reruns are controlled.

* `market_settlement_runs.market_date` unique
* `asset_daily_market_state(asset_id, market_date)` unique

Rerun behavior should either:

* refuse if already complete unless `force=true`, or
* create an explicit recompute mode that deletes/replaces daily state for the date

---

## 11. Trade Execution Algorithm

## 11.1 Buy flow

Inputs:

* `user_id`
* `asset_id`
* `quantity`

Steps:

1. Read current `market_assets` row
2. Validate asset status = active
3. Validate quantity > 0
4. Compute executable price from current `ask_price`
5. Compute gross cash = `ask_price * quantity`
6. Compute fee = `gross_cash * trading_fee_rate`
7. Compute total debit = gross + fee
8. Validate user cash balance sufficient
9. Create `trade_orders` row
10. Create `trade_fills` row
11. Write ledger entries:

    * cash debit
    * asset credit
    * fee debit
12. Update / upsert `portfolio_holdings`
13. Update `mid_price` with impact formula
14. Recompute bid/ask and premium
15. Update `market_assets`
16. Mark order filled
17. Return execution payload

## 11.2 Sell flow

Inputs:

* `user_id`
* `asset_id`
* `quantity`

Steps:

1. Read current `market_assets` row
2. Validate asset status = active
3. Validate quantity > 0
4. Validate user holding quantity sufficient
5. Compute executable price from current `bid_price`
6. Compute gross credit = `bid_price * quantity`
7. Compute fee = `gross_credit * trading_fee_rate`
8. Compute net credit = gross - fee
9. Create `trade_orders` row
10. Create `trade_fills` row
11. Write ledger entries:

    * asset debit
    * cash credit
    * fee debit or fee withheld from proceeds
12. Update holdings
13. Update `mid_price` downward using impact formula
14. Recompute bid/ask and premium
15. Update `market_assets`
16. Mark order filled
17. Return execution payload

## 11.3 Trading fees

Phase 1 recommendation:

* single flat trading fee rate, e.g. 1%
* applied on both buys and sells
* recorded explicitly in ledger and fill rows

## 11.4 Invariants

Every trade must preserve:

* bid <= ask
* treasury_supply >= 0
* circulating_supply >= 0
* holding quantity >= 0
* no silent balance mutation outside ledger

---

## 12. Candlestick and Volume Data

## 12.1 Source of truth

The source of truth for volume and trade-based candles is `trade_fills`.

System-driven daily opening price changes should be optionally reflected in charts using `asset_price_events`.

## 12.2 Candle resolutions

Recommended derived resolutions:

* 1 minute
* 5 minute
* 1 hour
* 1 day

Fields:

* open
* high
* low
* close
* volume_shares
* volume_cash
* trade_count
* vwap

## 12.3 Retention policy

Recommended:

* raw `trade_fills`: forever
* 1-minute candles: 14 days
* 5-minute candles: 90 days
* 1-hour candles: 2 years
* 1-day candles: forever

## 12.4 No-trade buckets

For chart continuity, if no trade occurs in a bucket, carry forward previous close as open/high/low/close and set volume to zero in the query layer or aggregate layer.

## 12.5 Timescale continuous aggregates

Create the `trade_fills` hypertable and define continuous aggregates for OHLCV.

Exact SQL may vary by Timescale version, but conceptually:

* bucket by time and asset_id
* compute first price, max price, min price, last price
* sum quantity and gross cash
* count fills

---

## 13. Redis Usage

Redis is not the source of truth.

Use Redis for:

* latest asset quote cache (`mid`, `bid`, `ask`, `premium`)
* in-progress candle cache
* recent trades feed cache
* daily market report cache
* top movers / leaderboards

Suggested keys:

* `asset:quote:{asset_id}`
* `asset:trades:{asset_id}`
* `market:report:daily:latest`
* `asset:candle:current:{asset_id}:{interval}`

If Redis data is lost, the system must recover from Postgres/Timescale.

---

## 14. API Design

## 14.1 Public read APIs

### GET `/api/market/assets`

Returns list view data.

Response per asset:

* asset id
* symbol
* display name
* current fair value
* current mid price
* current bid price
* current ask price
* current premium pct
* volume_24h
* daily emission
* treasury supply
* circulating supply
* latest snapshot date

### GET `/api/market/assets/:symbol`

Returns asset detail summary.

Includes:

* channel metadata
* current market state
* latest fundamentals
* latest daily market state
* latest snapshot raw stats
* chart summary metrics

### GET `/api/market/assets/:symbol/candles?interval=5m&range=24h`

Returns candle series.

### GET `/api/market/assets/:symbol/trades?limit=50`

Returns recent fills.

### GET `/api/market/assets/:symbol/stats?range=30d`

Returns historical snapshot stats and fair value series.

### GET `/api/market/assets/:symbol/treasury`

Returns treasury and supply metrics.

### GET `/api/market/report/daily/latest`

Returns latest daily market report.

### GET `/api/market/report/daily/:date`

Returns historical report for the date.

## 14.2 Authenticated trade APIs

### POST `/api/market/orders/buy`

Body:

```json
{
  "symbol": "GURA",
  "quantity": 25
}
```

Response:

* order id
* fill id
* filled quantity
* executed price
* fee
* total cost
* updated holdings
* updated quote

### POST `/api/market/orders/sell`

Body:

```json
{
  "symbol": "GURA",
  "quantity": 10
}
```

Response similar to buy.

## 14.3 Portfolio APIs

### GET `/api/portfolio/me`

Returns:

* cash balance
* total market value
* total unrealized pnl
* holdings summary

### GET `/api/portfolio/me/ledger`

Returns ledger entries.

### GET `/api/portfolio/me/orders`

Returns recent orders.

## 14.4 Internal/admin APIs

### POST `/internal/market/settle/:date`

Run settlement for the target market date.

### POST `/internal/market/recalculate-fundamentals`

Body:

```json
{
  "from": "2026-01-01",
  "to": "2026-03-01",
  "version": 1
}
```

### GET `/internal/market/jobs`

Returns recent settlement/calculation runs.

---

## 15. Frontend Requirements

## 15.1 Asset List Page

Show:

* symbol
* name
* current price
* fair value
* premium/discount
* 24h move
* 24h volume
* daily emission
* top movers / filters

## 15.2 Asset Detail Page

Show:

* current bid / ask / mid
* fair value
* premium or discount vs fair value
* candlestick chart
* fair value overlay line
* recent trades
* treasury supply / circulating supply / max supply
* daily emission
* latest YouTube stats
* 7d/30d stat deltas
* daily market notes

## 15.3 Trade Ticket

Show:

* buy / sell toggle
* quantity
* estimated fill price
* fee
* total / proceeds
* holdings after trade
* warning if trading at high premium above fair value

## 15.4 Portfolio Page

Show:

* cash balance
* holdings table
* cost basis
* market value
* unrealized PnL
* recent fills
* allocation breakdown

## 15.5 Daily Market Report Page

Show:

* biggest fair value increases
* biggest fair value decreases
* largest premiums
* largest discounts
* top volume
* top price movers
* notable treasury emissions

---

## 16. Recommended Processing Order for Phase 1 Implementation

This section is the build order the agent should follow.

### Step 1: Finalize v1 fundamental formula and validate offline

Tasks:

* implement historical derivation of deltas from existing daily stats
* compute the v1 formula offline over historical data
* inspect top/bottom channels and time series behavior
* tune weights/floors/clamps if necessary

Deliverables:

* formula implementation
* test script / notebook / job
* approved v1 parameters

### Step 2: Add core schema

Tasks:

* create `youtube_channels`
* create `fundamental_formula_versions`
* create `channel_daily_snapshots`
* create `market_assets`
* create `trade_orders`
* create `trade_fills`
* create `ledger_entries`
* create `portfolio_holdings`
* create `asset_daily_market_state`
* create `asset_price_events`
* create `market_settlement_runs`
* create `daily_market_reports`

Deliverables:

* migration files
* indexes
* Timescale hypertable setup for `trade_fills`

### Step 3: Update scraper pipeline

Tasks:

* upsert channels into `youtube_channels`
* insert daily snapshot row into `channel_daily_snapshots`
* set `calculation_status = 'pending'`
* enqueue fundamentals calculation job

Deliverables:

* scraper changes
* job trigger / event enqueue

### Step 4: Build fundamentals calculator and backfill runner

Tasks:

* implement delta derivation logic
* implement v1 formula
* read prior snapshots for smoothing
* update snapshot row with derived fields
* update `market_assets.latest_snapshot_date`, `current_fair_value`, `current_fair_value_raw`
* expose internal backfill command

Deliverables:

* calculation service
* backfill service / CLI

### Step 5: Build daily settlement service

Tasks:

* implement idempotent settlement workflow
* compute new mid/open price, premium, emission, bid/ask
* update treasury/circulating supply
* write `asset_daily_market_state`
* write `asset_price_events`
* update `market_assets.current_*`
* write daily report row

Deliverables:

* settlement service
* internal trigger endpoint / scheduler integration

### Step 6: Build read-only APIs and asset detail data flows

Tasks:

* asset list endpoint
* asset detail endpoint
* candles endpoint
* recent trades endpoint
* stats history endpoint
* treasury endpoint
* daily report endpoint

Deliverables:

* API routes
* response contracts

### Step 7: Build trading endpoints and ledger-backed execution

Tasks:

* buy endpoint
* sell endpoint
* cash validation
* holding validation
* create orders/fills/ledger entries
* update holdings
* update live market state after each fill

Deliverables:

* trading service
* portfolio APIs

### Step 8: Build frontend screens

Tasks:

* asset list page
* asset detail page
* trade ticket
* portfolio page
* daily report page

Deliverables:

* UI screens wired to APIs
* chart integration

### Step 9: Add admin/recompute and safety tooling

Tasks:

* manual settlement trigger
* recalculation trigger
* job status page/endpoint
* invariant checks and logging
* alerting hooks

Deliverables:

* internal admin endpoints
* ops visibility

---

## 17. Invariants and Validation Rules

These must be enforced in code and tested.

### 17.1 Supply invariants

* `treasury_supply >= 0`
* `circulating_supply >= 0`
* `circulating_supply + treasury_supply <= max_supply`

### 17.2 Quote invariants

* `bid_price <= ask_price`
* `mid_price > 0`
* `fair_value > 0`

### 17.3 Holdings/accounting invariants

* user cash may not go negative unless explicitly allowed (Phase 1: not allowed)
* user holdings may not go negative
* all balance mutations must be explainable by ledger entries

### 17.4 Snapshot invariants

* one snapshot per channel per date
* derived values should only be computed once per formula version unless recalculated intentionally

### 17.5 Settlement invariants

* one settlement per market day unless rerun mode
* all active assets should have a resolved daily market state row for settled days

---

## 18. Suggested Initial Configuration Values

These are defaults only and may be tuned after offline simulation.

* daily reset pull factor: `0.25`
* spread: `400 bps`
* trading fee rate: `1%`
* momentum weights: views `0.85`, uploads `0.15`
* momentum clamp: `[-1.0, 1.0]`
* momentum multiplier scale: `0.7`
* smoothing: previous smoothed `0.75`, new raw `0.25`
* liquidity depth: `max(5000, 0.02 * circulating_supply)`
* daily emission multiplier: `1 + 2 * max(0, premium_pct)` clamped to `[0.25x, 4x]`

These should be stored in config rather than hard-coded where practical.

---

## 19. Testing Strategy

## 19.1 Unit tests

* snapshot delta calculations
* fundamental formula calculations
* smoothing logic
* daily reset price logic
* premium calculation
* spread calculation
* trade impact calculation
* buy/sell fee and ledger math

## 19.2 Integration tests

* ingest snapshot -> compute fundamentals -> update asset state
* settlement for one day across multiple assets
* buy and sell flow end-to-end
* candle generation from fills
* report generation from daily market state

## 19.3 Simulation tests

Run the system over historical data in replay mode:

* compute fundamentals over historical snapshots
* simulate settlement per day
* inspect resulting fair value series
* validate that large channels remain large
* validate that spikes cool off appropriately
* validate that no asset produces pathological values due to missing data

## 19.4 Invariant checks

Add recurring queries / monitors for:

* negative balances
* invalid supplies
* missing daily market state rows
* assets with null fair value after settlement

---

## 20. Open Questions / Explicit Deferrals

These items are intentionally deferred from Phase 1 but should remain visible:

* inferred subscriber growth smoothing from 10k-step updates
* how launch `max_supply`, `circulating_supply`, and `base_emission` are chosen per asset
* whether no-trade candles should be materialized or only synthesized in query results
* player-to-player order book / limit orders
* prediction markets
* ETFs / guild funds
* dividends / buybacks
* margin / leverage

---

## 21. Minimum Agent Implementation Checklist

An implementation agent should complete the following in order:

1. Create DB migrations for all schema in this doc
2. Implement historical snapshot backfill + v1 fundamental formula calculation
3. Implement scraper-to-snapshot ingestion flow
4. Implement fundamentals calculator service and mark snapshots complete
5. Implement market asset current-state updater
6. Implement daily settlement service and report generation
7. Implement trade execution + ledger + holdings update flow
8. Implement candle generation / Timescale aggregates
9. Implement read APIs, trade APIs, and portfolio APIs
10. Implement frontend market pages and charts
11. Implement admin endpoints and invariant checks

---

## 22. Summary

Phase 1 establishes a complete market foundation:

* daily YouTube snapshots
* a versioned and historically re-runnable fundamental value algorithm
* treasury-backed live market prices that react to both fundamentals and player trading
* ledger-backed accounting
* timeseries storage for charts and reporting
* operationally safe daily settlement

This is intentionally the narrowest version that still yields a coherent market system. Future phases should build on this rather than replacing it.
