# Prediction Market Implementation Plan

## Scope

This plan converts the design in `PREDICTION_MARKET_DESIGN.md` into an execution sequence for a first production-ready version inside NASFAQ.

The goal of phase 1 is:

- binary `YES/NO` prediction markets
- in-game cash settlement
- trusted-user creation flow
- trusted-user approval and resolution flow
- live order book and trade tape
- probability charts
- portfolio and ledger integration

This plan intentionally excludes coin-backed leverage from the first implementation.

## Delivery Strategy

Build this in vertical slices instead of trying to ship the entire system at once.

Recommended sequence:

1. permissions and schema foundations
2. market lifecycle and admin workflow
3. trading and matching engine
4. settlement and payout
5. public UI
6. creator/resolver UI
7. analytics, moderation, and hardening

## Phase 0: Foundation Decisions

Before writing feature code, lock these product rules:

### Decisions to finalize

- prediction markets are game-only, not real-money redeemable
- quote and settlement currency is in-game cash
- phase 1 markets are binary only
- phase 1 orders are limit orders only
- phase 1 is cash-only, no coin collateral
- markets require approval before opening
- markets require explicit human resolution
- creator and resolver should not be the same user by default

### Output

- short rules addendum in the design doc or a config constants file
- enumerated status values and allowed transitions
- final naming for routes and database tables

## Phase 1: Data Model and Permissions

## Backend Tasks

### 1. Extend `market.users`

Add user flags:

- `can_create_prediction_markets`
- `can_approve_prediction_markets`
- `can_resolve_prediction_markets`
- `can_void_prediction_markets`

Files:

- `api/src/migrations.js`
- auth/profile query surfaces that return user objects

### 2. Add prediction market tables

Create:

- `market.prediction_market_categories`
- `market.prediction_markets`
- `market.prediction_market_outcomes`
- `market.prediction_market_orders`
- `market.prediction_market_trades`
- `market.prediction_market_positions`
- `market.prediction_market_price_history`
- `market.prediction_market_events`

Recommended first-pass indexes:

- markets by `status`, `opens_at`, `closes_at`
- orders by `market_id`, `status`, `price`, `created_at`
- trades by `market_id`, `matched_at desc`
- positions by `user_id`, `market_id`
- price history by `market_id`, `outcome_id`, `bucket_ts`

### 3. Define enums/check constraints

Add check constraints or enum-style text checks for:

- market status
- order side
- order status
- outcome code
- visibility

### 4. Add transition-safe audit table

Every creator, approver, and resolver action should write to `prediction_market_events`.

## Deliverables

- migration code compiles and runs
- user objects expose new permission flags
- empty schema is queryable without UI work

## Phase 2: Backend Domain Services

## Backend Tasks

### 1. Add permission helpers

Create:

- `api/src/services/predictionPermissions.js`

Responsibilities:

- `requirePredictionCreator`
- `requirePredictionApprover`
- `requirePredictionResolver`
- transition validation helpers

### 2. Add market service

Create:

- `api/src/services/predictionMarketService.js`

Responsibilities:

- create draft market
- edit draft market
- submit for approval
- approve/reject market
- open/close market
- mark market resolving
- resolve market
- void market
- list markets
- fetch market detail

### 3. Add read models / DB access

Create:

- `api/src/predictionMarketDb.js`

Responsibilities:

- public list queries
- detail query with rich metadata
- order book query
- recent trades query
- candle query
- user positions query
- admin queue query

### 4. Add route surface

Create:

- `api/src/routes/predictionMarkets.js`

Wire into:

- `api/src/server.js`

Initial endpoints:

- `GET /api/prediction-markets`
- `GET /api/prediction-markets/:slug`
- `GET /api/prediction-markets/:slug/orderbook`
- `GET /api/prediction-markets/:slug/trades`
- `GET /api/prediction-markets/:slug/candles`
- `POST /api/prediction-markets`
- `POST /api/prediction-markets/:id/submit`
- `POST /api/prediction-markets/:id/approve`
- `POST /api/prediction-markets/:id/reject`
- `POST /api/prediction-markets/:id/close`
- `POST /api/prediction-markets/:id/resolve`
- `POST /api/prediction-markets/:id/void`

## Deliverables

- authenticated trusted users can create drafts
- approvers can approve or reject
- public can list and read open markets
- all lifecycle actions are audited

## Phase 3: Trading Engine

This is the highest-risk backend phase and should be built after lifecycle APIs exist.

## Backend Tasks

### 1. Implement order placement

Create:

- `api/src/services/predictionOrderbook.js`

Supported first:

- `buy yes`
- `buy no`
- `sell yes`
- `sell no`

Canonicalization rule:

- match on one internal binary pricing model
- translate UI yes/no actions into canonical order representation

### 2. Add balance reservation

Reuse:

- `market.portfolio_cash_balances`
- `market.ledger_entries`

New behavior:

- reserve cash when order is posted
- release unused reserve on cancel or partial fill completion
- update realized cash after trade execution

### 3. Add position accounting

Update `prediction_market_positions` on each fill.

Need to support:

- average entry price
- increasing position
- reducing position
- flattening position

### 4. Add trade persistence

On every match:

- create trade rows
- update orders
- update positions
- write ledger entries
- emit websocket event
- append or roll up price history buckets

### 5. Add cancel flow

Users must be able to cancel resting orders and recover reserved cash immediately.

### 6. Add guardrails

Reject:

- orders on closed or resolved markets
- orders outside price bounds
- orders with insufficient cash
- sells larger than owned shares

## Recommended internal rules

- price min `0.01`
- price max `0.99`
- quantity min configurable
- price-time priority matching
- no shorting in phase 1 unless explicitly modeled

## Deliverables

- users can place orders
- orders match correctly
- market probability moves through executed trades
- balances remain consistent under partial fills and cancels

## Phase 4: Settlement and Resolution

## Backend Tasks

### 1. Add settlement service

Create:

- `api/src/services/predictionSettlement.js`

Responsibilities:

- close expired markets
- cancel remaining open orders
- finalize winning outcome
- settle winning and losing positions
- write payout ledger entries
- mark market resolved

### 2. Add resolution workflow

Recommended states:

- `closed`
- `resolving`
- `resolved`
- `voided`

Recommended flow:

1. resolver records outcome
2. system validates market is closed
3. system cancels open orders
4. system settles positions
5. system writes audit event

### 3. Add void flow

If market wording or source is invalid:

- cancel all open orders
- return reserved cash
- refund live position principal according to chosen policy
- mark market voided

### 4. Add scheduled jobs

Extend the scheduling pattern used by the market runtime.

Jobs:

- auto-open approved markets at `opens_at`
- auto-close markets at `closes_at`
- mark markets ready for resolution after `resolves_after`

## Deliverables

- approved markets open automatically
- expired markets close automatically
- resolved markets pay out correctly
- void path is safe and auditable

## Phase 5: Public Frontend

## Frontend Tasks

### 1. Add route structure

Create:

- `app-client/app/predictions/page.tsx`
- `app-client/app/predictions/[slug]/page.tsx`

### 2. Add types and normalizers

Update:

- `app-client/app/lib/types.ts`
- `app-client/app/lib/normalizers.ts`
- `app-client/app/lib/api.ts` as needed

Add types for:

- market list item
- market detail
- order book levels
- trade tape item
- candle series
- user position summary
- creator permissions

### 3. Add store

Create:

- `app-client/app/stores/prediction-market-store.ts`

Pattern should mirror the current market store:

- overview loading
- detail loading
- cache by slug
- websocket patching
- reconcile polling

### 4. Build list page

The list page should show:

- featured markets
- open markets
- closing soon
- recently resolved
- filters and sorting

### 5. Build detail page

Main modules:

- headline and status
- yes probability chart
- volume and spread stats
- order book
- recent trades
- buy/sell ticket
- rules and resolution source
- market timeline/events

### 6. Reuse charting

Use existing `lightweight-charts` setup in:

- `app-client/app/components/charts/market-charts.tsx`

Add a prediction-market chart wrapper instead of copying chart code.

### 7. Add websocket client support

Extend existing websocket helpers:

- `app-client/app/lib/ws.ts`

Recommended new socket:

- `/api/prediction-markets/ws`

## Deliverables

- public can browse and inspect markets
- live price and trade updates render correctly
- users can understand market rules before trading

## Phase 6: Creator and Resolver UI

## Frontend Tasks

### 1. Market creation flow

Create:

- `app-client/app/predictions/create/page.tsx`

Form sections:

- title
- short subtitle
- full description
- rules text
- resolution source
- open time
- close time
- resolve-after time
- category
- visibility

### 2. Review queue

Create:

- `app-client/app/admin/predictions/page.tsx`

Views:

- pending approval
- scheduled/open markets
- awaiting resolution
- resolved/voided history

### 3. Resolution panel

Trusted resolvers need:

- market summary
- final outcome selector
- notes field
- visible rules context
- confirmation step

## Deliverables

- trusted creators can draft markets
- approvers can process queue
- resolvers can settle markets safely

## Phase 7: Portfolio and Profile Integration

## Backend Tasks

- add prediction positions to portfolio summary
- add prediction PnL to profile stats if desired
- add recent prediction trades to profile activity

## Frontend Tasks

- show prediction positions in portfolio
- show resolved-market history
- optionally distinguish stock holdings vs prediction positions

## Recommended approach

Do not merge prediction holdings into the same visual block as long-lived NASFAQ assets without labels.

Use separate sections:

- asset holdings
- prediction positions

## Deliverables

- users can see open prediction exposure
- users can inspect resolved gains/losses

## Phase 8: Hardening and Observability

## Backend Tasks

### 1. Consistency checks

Add invariant checks for:

- reserved cash never negative
- position share totals match executed trades
- winning payouts reconcile with exposure
- cancelled orders release full reserves

### 2. Logging and monitoring

Track:

- market creation events
- approvals and rejections
- failed order placements
- settlement failures
- websocket publish failures

### 3. Abuse controls

Consider:

- per-user order rate limits
- resolver action logging
- market title/rules moderation

## Deliverables

- confidence that balances and payouts stay correct under load

## Testing Plan

## Unit Tests

Target:

- permission checks
- lifecycle transitions
- canonical yes/no translation
- partial fill accounting
- average cost updates
- cancel release logic
- resolution payouts
- void behavior

## Integration Tests

Target:

- creator drafts -> approver approves -> market opens
- multiple users match on same market
- users cancel partially filled orders
- market closes -> resolver resolves -> payouts land in cash

## UI Tests

Target:

- list page renders mixed statuses correctly
- detail page updates via websocket
- order ticket validation
- creator/reviewer workflows

## Recommended Milestones

## Milestone 1: Schema + Permissions

Success criteria:

- migrations land cleanly
- trusted-user flags work
- markets can be drafted and approved through API

## Milestone 2: Read-Only Public Markets

Success criteria:

- public list and detail APIs work
- frontend pages render with mock or seeded data

## Milestone 3: Trading

Success criteria:

- users can place/cancel orders
- matching and balances reconcile
- live tape and chart update

## Milestone 4: Resolution

Success criteria:

- markets open/close/resolve correctly
- payouts are correct and auditable

## Milestone 5: Creator/Admin Surfaces

Success criteria:

- trusted users can run the full workflow without database intervention

## Implementation Order by File Area

Recommended order of work in the repo:

1. `api/src/migrations.js`
2. `api/src/services/predictionPermissions.js`
3. `api/src/predictionMarketDb.js`
4. `api/src/services/predictionMarketService.js`
5. `api/src/routes/predictionMarkets.js`
6. `api/src/server.js`
7. `api/src/services/predictionOrderbook.js`
8. `api/src/services/predictionSettlement.js`
9. `app-client/app/lib/types.ts`
10. `app-client/app/lib/normalizers.ts`
11. `app-client/app/stores/prediction-market-store.ts`
12. `app-client/app/predictions/page.tsx`
13. `app-client/app/predictions/[slug]/page.tsx`
14. `app-client/app/predictions/create/page.tsx`
15. `app-client/app/admin/predictions/page.tsx`

## Recommended First Implementation Slice

The best first coding slice is:

1. migrations for user flags and prediction tables
2. market draft/create/list/detail APIs
3. read-only `/predictions` list/detail UI with seeded or admin-created markets

That gives visible progress quickly and de-risks the data model before trading logic starts.

## Not In Phase 1

Do not include these in the initial implementation:

- coin-backed leverage
- liquidations
- short selling beyond owned position reductions
- multi-outcome markets
- automated market maker liquidity
- complex order types
- social ranking mechanics tied to prediction outcomes

These are all valid later, but they would slow down the first correct release substantially.

