# Prediction Market Design

## Goal

Add a Polymarket/Kalshi-like prediction market to NASFAQ using the existing market, portfolio, ledger, auth, websocket, and charting foundations already present in:

- `api/src/services/trading.js`
- `api/src/services/portfolioCash.js`
- `api/src/services/marketState.js`
- `api/src/routes/market.js`
- `app-client/app/stores/market-store.ts`
- `app-client/app/components/pages/market-page.tsx`
- `app-client/app/components/charts/market-charts.tsx`

The system should feel like a real prediction market, but fit the current game architecture and avoid creating a second unrelated trading stack.

## High-Level Product Direction

The cleanest design is to treat each prediction market as a distinct tradable market type inside the existing exchange:

- Existing NASFAQ assets remain continuous spot-style assets.
- Prediction markets become binary event contracts with `YES` and `NO` outcomes.
- Users trade shares priced from `0.01` to `0.99` cash.
- One winning share settles to `1.00` cash, the losing side settles to `0.00`.
- Market price directly represents implied probability.

This matches how real prediction markets feel:

- `YES` at `0.63` means the market implies a `63%` chance.
- `NO` naturally prices near `0.37`.
- Users can buy, sell, exit early, hold to resolution, and view a probability chart over time.

## Important Constraint

If "money" means actual fiat or redeemable cash, this becomes a regulated real-money prediction market product and the design changes materially.

For the game, the recommended implementation is:

- `cash` means in-game cash balance, reusing `market.portfolio_cash_balances`.
- `coins` are non-cash collateral or leverage boosters inside the game economy.

That preserves realism in mechanics without stepping into real-money compliance requirements.

## Fit With Current Codebase

The repo already has the right primitives:

- Users and admin gating via `market.users` and `is_admin`.
- Per-user cash balances in `market.portfolio_cash_balances`.
- Ledger history in `market.ledger_entries`.
- Fill/order concepts in `market.trade_orders` and `market.trade_fills`.
- Market-wide runtime status in `market.market_runtime_state`.
- Websocket broadcasting of trade events in `api/src/services/trading.js`.
- Chart components and market stores in `app-client`.

The prediction market should reuse those patterns, but live in its own tables and service layer because the trading model is different:

- Existing assets use one-sided treasury execution and fair-value-driven quoting.
- Prediction markets need order books, binary share accounting, resolution, and payout settlement.

## Core Domain Model

### Entities

#### `prediction_market_categories`

Optional taxonomy:

- Politics
- NASFAQ events
- Livestream events
- Platform events
- Creator milestones
- Special tournaments

#### `prediction_markets`

One row per market.

Suggested fields:

- `id`
- `slug`
- `title`
- `subtitle`
- `description`
- `rules_text`
- `resolution_source_text`
- `category_id`
- `status`
- `trading_status`
- `visibility`
- `creator_user_id`
- `approver_user_id`
- `resolver_user_id`
- `resolution_outcome`
- `resolution_notes`
- `opens_at`
- `closes_at`
- `resolves_after`
- `resolved_at`
- `voided_at`
- `featured_image_url`
- `metadata_json`
- `created_at`
- `updated_at`

Recommended `status` lifecycle:

- `draft`
- `pending_approval`
- `open`
- `closed`
- `resolving`
- `resolved`
- `voided`

#### `prediction_market_outcomes`

For phase 1, every market is binary:

- one `YES`
- one `NO`

Still store these as rows so the schema supports future multi-outcome markets.

Suggested fields:

- `id`
- `market_id`
- `outcome_code` (`yes`, `no`)
- `label`
- `sort_order`
- `is_winner`

#### `prediction_market_orderbook`

Outstanding user orders.

Suggested fields:

- `id`
- `market_id`
- `outcome_id`
- `user_id`
- `side` (`buy`, `sell`)
- `order_type` (`limit`, later `market`)
- `price`
- `original_quantity`
- `open_quantity`
- `matched_quantity`
- `status`
- `time_in_force`
- `funding_type`
- `cash_reserved`
- `coin_collateral_reserved`
- `created_at`
- `updated_at`
- `cancelled_at`

#### `prediction_market_trades`

Executed matches.

Suggested fields:

- `id`
- `market_id`
- `outcome_id`
- `buy_order_id`
- `sell_order_id`
- `buy_user_id`
- `sell_user_id`
- `price`
- `quantity`
- `notional_cash`
- `fee_cash_buy`
- `fee_cash_sell`
- `matched_at`

#### `prediction_market_positions`

Net user exposure by market and outcome.

Suggested fields:

- `user_id`
- `market_id`
- `outcome_id`
- `shares`
- `avg_entry_price`
- `realized_pnl_cash`
- `updated_at`

#### `prediction_market_price_history`

Time-series for charts.

Suggested fields:

- `market_id`
- `outcome_id`
- `bucket_ts`
- `open`
- `high`
- `low`
- `close`
- `last`
- `volume_shares`
- `volume_cash`
- `trade_count`
- `best_bid`
- `best_ask`

Granular buckets:

- `1m`
- `5m`
- `1h`
- `1d`

#### `prediction_market_events`

Audit log for non-trade lifecycle actions:

- market created
- submitted for approval
- approved
- rejected
- close time changed
- market closed
- resolution proposed
- resolution finalized
- market voided

#### `prediction_market_comments`

Optional dedicated market comments if asset comments are too asset-specific.

#### `prediction_permissions`

Recommended to avoid overloading `is_admin`.

Add flags directly to `market.users`:

- `can_create_prediction_markets`
- `can_approve_prediction_markets`
- `can_resolve_prediction_markets`
- `can_void_prediction_markets`

This is better than using `is_admin` for everything. Admins can manage flags, but trusted market operators do not need full admin access.

## Market Mechanics

## Pricing Model

Binary markets should use normalized share prices:

- `YES` share price range: `0.01` to `0.99`
- `NO` implied price: `1 - YES`

Store both outcomes for UI clarity, but use one canonical book internally:

- Canonical matching book on `YES`
- `NO` is derived from complement pricing

This keeps the market internally consistent and avoids crossed books between separate `YES` and `NO` ladders.

Example:

- If Alice bids `YES` at `0.62`
- She is economically equivalent to bidding `NO` at `0.38`

Recommended implementation:

- Backend stores and matches on a canonical probability price.
- UI lets users click either `Buy Yes` or `Buy No`.
- API translates `Buy No @ 0.38` into the equivalent canonical order.

## Matching Engine

Use price-time priority limit order matching.

Phase 1:

- Limit orders only
- Immediate matching against resting opposite orders
- Unfilled remainder rests on the book
- Users can cancel open orders

Why this is the right first version:

- Feels realistic
- Enables real price discovery
- Supports charts, depth, spreads, and liquidity panels
- Simpler and more correct than inventing an AMM inside the existing exchange

Phase 2 optional:

- Add a liquidity bot or house market maker
- Add IOC/FOK orders
- Add market orders with slippage guard

## Settlement Semantics

At resolution:

- Winning shares pay `1.00` cash each
- Losing shares pay `0.00`
- Open orders are cancelled
- Reserved collateral is released
- Positions are settled into cash
- Ledger entries are written for full auditability

If the market is ambiguous or invalid:

- `void`
- Refund based on entry price or cancel all positions at last valid accounting rule

Recommended void policy:

- return original principal
- reverse unmatched reserves
- zero trading fees only if desired by game design

## Fees

Recommended:

- maker fee: `0%` to `0.5%`
- taker fee: `1%`
- optional resolution fee: `0%`

Start simple:

- charge fee in cash at trade time
- record in `market.ledger_entries` with prediction-specific reference types

## Cash and Coin Funding

## Cash

Cash should be the base unit of account.

- Buying `YES` uses cash.
- Selling owned `YES` returns cash.
- Settlement pays out in cash.

This maps directly onto the existing portfolio cash system.

## Coins as Leverage or Collateral

Coins can work, but they should not be the quote asset for settlement. Their fluctuating price makes them poor payout units.

Recommended design:

- Users still trade and settle in cash.
- Users may pledge approved coins as collateral to increase buying power.
- Each coin gets a risk haircut.

Example:

- Coin market value: `1,000`
- Haircut: `60%`
- Collateral credit: `400`

This is much more realistic than settling markets directly in a volatile coin.

### Recommended Margin Model

For phase 1, support:

- `cash-only` orders
- `cash + coin collateral` orders for approved users or all users

Rules:

- Collateralizable assets are explicitly allowlisted.
- Each asset has:
  - `haircut_pct`
  - `max_collateral_ratio`
  - `liquidation_buffer`
- Buying power is calculated as:
  - `cash_balance + sum(collateral_market_value * (1 - haircut_pct)) - reserved_margin`

If coin prices drop:

- user can become undercollateralized
- account enters `margin_call`
- open orders are cancelled first
- if still under water, positions are force-reduced

This is realistic, but it is materially more complex than cash-only. It should be phase 2, not day 1.

### Recommendation

Phase 1:

- cash-only prediction markets

Phase 2:

- coin-backed margin on prediction positions

Phase 3:

- advanced leverage and liquidations

## Permissions and Governance

## User Flags

Admin-managed user flags on `market.users`:

- `can_create_prediction_markets`
- `can_approve_prediction_markets`
- `can_resolve_prediction_markets`
- `can_manage_prediction_risk`

## Workflow

1. Creator with `can_create_prediction_markets` creates a draft market.
2. Creator submits market for approval.
3. Reviewer with `can_approve_prediction_markets` approves it.
4. Market opens at `opens_at`.
5. Trading closes at `closes_at`.
6. Resolver with `can_resolve_prediction_markets` records the outcome after `resolves_after`.
7. Optional second approver confirms resolution for high-trust markets.
8. Settlement job distributes winnings.

## Resolution Integrity

To avoid abuse, do not let the same person both create and unilaterally resolve all markets by default.

Recommended rule:

- creator may draft
- approver must be different user
- resolver may be same as approver only if explicitly permitted

For the highest-integrity markets:

- require two-step resolution:
  - `resolution_proposed`
  - `resolution_confirmed`

## API Design

Create a new route family instead of overloading `/api/market`.

Recommended routes:

- `GET /api/prediction-markets`
- `GET /api/prediction-markets/:slug`
- `GET /api/prediction-markets/:slug/orderbook`
- `GET /api/prediction-markets/:slug/trades`
- `GET /api/prediction-markets/:slug/candles?interval=1m&range=24h`
- `GET /api/prediction-markets/:slug/positions`
- `GET /api/prediction-markets/:slug/comments`
- `POST /api/prediction-markets/:slug/orders`
- `DELETE /api/prediction-markets/:slug/orders/:orderId`
- `POST /api/prediction-markets`
- `POST /api/prediction-markets/:id/submit`
- `POST /api/prediction-markets/:id/approve`
- `POST /api/prediction-markets/:id/reject`
- `POST /api/prediction-markets/:id/close`
- `POST /api/prediction-markets/:id/resolve`
- `POST /api/prediction-markets/:id/void`

Admin/risk routes:

- `POST /api/admin/prediction/users/:userId/permissions`
- `POST /api/admin/prediction/config/collateral`

## Service Layer Design

Suggested backend modules:

- `api/src/services/predictionMarketService.js`
- `api/src/services/predictionOrderbook.js`
- `api/src/services/predictionSettlement.js`
- `api/src/services/predictionRisk.js`
- `api/src/services/predictionPermissions.js`
- `api/src/routes/predictionMarkets.js`

Responsibilities:

- `predictionMarketService`
  - create/update/fetch markets
  - lifecycle transitions
- `predictionOrderbook`
  - place order
  - match engine
  - cancel order
  - reserve/release funds
- `predictionSettlement`
  - close expired markets
  - resolve winners
  - settle positions
- `predictionRisk`
  - buying power
  - collateral haircuts
  - margin checks
- `predictionPermissions`
  - gate creator/approver/resolver actions

## Ledger Integration

Continue using `market.ledger_entries`, but add new reference types and entry types.

Suggested `reference_type` values:

- `prediction_order`
- `prediction_trade`
- `prediction_resolution`
- `prediction_void`
- `prediction_liquidation`

Suggested `entry_type` values:

- `prediction_cash_reserve`
- `prediction_cash_release`
- `prediction_trade_buy`
- `prediction_trade_sell`
- `prediction_fee`
- `prediction_payout_win`
- `prediction_payout_loss`
- `prediction_collateral_lock`
- `prediction_collateral_release`
- `prediction_liquidation`

This keeps all user balance movement auditable in one ledger system.

## UI Design

## Navigation

Add a dedicated area instead of forcing this into existing stock pages:

- `/predictions`
- `/predictions/[slug]`
- `/predictions/create`
- `/predictions/manage`

The homepage and market hub can later feature selected prediction markets.

## List Page

`/predictions` should show:

- featured markets
- open markets
- closing soon
- recently resolved
- category filters
- search
- sort by volume, activity, close time, implied probability

Each market card should include:

- title
- close time
- current `YES` probability
- `YES` and `NO` price pills
- 24h move
- volume
- total open interest
- small sparkline
- resolution source badge

## Detail Page

`/predictions/[slug]` should include:

### Main header

- title
- status pill
- market category
- close/resolution timestamps
- current probability
- total volume
- open interest
- creator and resolver metadata if appropriate

### Price chart

Use the existing chart primitives in `app-client/app/components/charts/market-charts.tsx`.

Primary views:

- `YES probability`
- `NO probability`
- volume histogram
- selectable ranges: `1H`, `1D`, `1W`, `1M`, `ALL`

For binary markets, the main line chart should represent `YES` probability because that is what users expect.

### Order entry panel

Tabs:

- `Buy Yes`
- `Buy No`
- `Sell`

Fields:

- quantity
- limit price
- estimated cost
- fee
- max payout
- worst-case loss
- available buying power

If margin is enabled later:

- collateral source summary
- margin usage
- liquidation threshold

### Market depth and trade tape

- best bid / best ask
- order book ladder
- recent trades
- spread
- midpoint

### Rules and resolution section

- resolution criteria
- official source
- examples of what counts and does not count
- void conditions

This is critical. Realistic prediction markets are mostly a rules product.

### Research and rich data

This is where the game can be better than generic prediction markets.

Attach optional rich modules per market:

- related news/articles
- relevant NASFAQ assets
- livestream clips
- event timeline
- statistical context
- creator commentary
- linked chat channel

## Real-Time Updates

Mirror the existing market websocket model with a separate channel:

- `/api/prediction-markets/ws`

Push events for:

- trade executed
- order book changed
- market status changed
- market approved
- market closed
- market resolved

Client-side store should follow the same pattern as `market-store.ts`:

- overview store
- detail cache
- websocket patching
- periodic reconcile

## Data and Analytics

Expose realistic market metrics:

- last traded price
- best bid
- best ask
- midpoint
- spread bps
- 24h volume
- cumulative volume
- open interest
- unique traders
- time to close
- realized volatility
- resolution confidence flag

Per-user analytics:

- realized PnL
- unrealized PnL
- win rate
- average edge vs settlement
- best market
- worst market

## Background Jobs

Add prediction-market-specific scheduled jobs alongside the current market scheduler approach.

Jobs:

- auto-open approved markets at `opens_at`
- auto-close markets at `closes_at`
- flag markets ready for resolution at `resolves_after`
- run settlement after resolution
- rebuild candle aggregates
- recompute open interest and leaderboard stats
- run risk checks if margin is enabled

## Recommended Rollout Plan

## Phase 1: Cash-Only Binary Markets

Build:

- market creation
- approval flow
- binary `YES/NO` markets
- limit order book
- trade matching
- probability charts
- manual resolution
- settlement to cash
- market list/detail pages
- websocket trade feed

Do not build yet:

- coin collateral
- forced liquidations
- multi-outcome markets
- parlay products

## Phase 2: Governance and Rich Data

Build:

- better rules editor
- linked articles/news/streams
- comments or dedicated chat
- featured markets
- moderation tools
- dual-control resolution for sensitive markets

## Phase 3: Coin-Backed Margin

Build:

- collateral allowlist
- haircut config
- buying power engine
- margin health
- forced de-risking
- liquidation events

Only do this after phase 1 is stable, because it introduces real balance-sheet risk into the game economy.

## Recommended Technical Decision Summary

The best implementation for this repo is:

- a new prediction-market subsystem, not a hack inside existing `market_assets`
- cash-settled binary contracts with realistic order-book trading
- admin-managed user flags for create/approve/resolve permissions
- dedicated market rules and resolution metadata
- websocket-driven live tape and probability charts
- phase 1 cash-only, phase 2 rich governance/data, phase 3 coin-backed collateral

## Why This Design

This design fits the current architecture because it:

- reuses auth, cash balances, ledgers, and websocket patterns
- avoids corrupting the current asset pricing model with binary-event logic
- delivers a realistic prediction market UX
- gives you a clean path to rich market pages and historical charts
- leaves room for coin collateral without forcing it into the first implementation

## Concrete Next Step

Implement phase 1 first:

1. add prediction permission flags to `market.users`
2. add prediction market tables
3. add `/api/prediction-markets` routes
4. build binary order matching and settlement
5. add `/predictions` and `/predictions/[slug]` UI
6. reuse chart components for probability history
7. add resolver workflow and admin moderation screens

