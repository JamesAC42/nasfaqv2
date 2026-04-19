# NASFAQ Games Implementation Plan

## Purpose

This document turns the architecture in [nasfaq-games-architecture.md](/home/james/code/NASFAQV2/docs/nasfaq-games-architecture.md) into an execution plan for this repo.

The target outcome is:

- one shared NASFAQ account and wallet
- a new `/api/games/*` backend domain
- a new `/games` area in `app-client`
- phase 1 launch with:
  - one cosmetic gacha
  - one short single-player score game
  - one asynchronous PvP game stub or MVP

## What Exists Today

### Backend

- Express API mounted in `api/src/server.js`
- request auth context populated globally through `authService.getAuthenticatedUser(...)`
- existing portfolio cash in `market.portfolio_cash_balances`
- existing money ledger in `market.ledger_entries`
- transactional money movement patterns in `api/src/services/trading.js`
- repo-local schema bootstrap in `api/src/migrations.js`

### Frontend

- Next app in `app-client`
- shared fetch helper in `app-client/app/lib/api.ts`
- auth bootstrap in `app-client/app/providers/auth-provider.tsx`
- product shell/nav in `app-client/app/components/layout/site-shell.tsx`
- existing user wallet state in `app-client/app/stores/profile-store.ts`

## Delivery Strategy

Ship the platform in layers.

### Layer 1

Backend foundation:

- schema
- wallet helpers
- catalog
- inventory
- game session primitives

### Layer 2

Frontend hub:

- `/games`
- catalog cards
- wallet visibility
- inventory display

### Layer 3

First monetized game:

- cosmetic gacha

### Layer 4

First skill game:

- one short single-player score game

### Layer 5

Social extension:

- async PvP match flow

Do not start with PvP infra first. The first release should prove the wallet, catalog, and inventory model.

## Proposed Repo Changes

## Backend Files

Add:

- `api/src/routes/games.js`
- `api/src/services/games/catalog.js`
- `api/src/services/games/wallet.js`
- `api/src/services/games/inventory.js`
- `api/src/services/games/sessions.js`
- `api/src/services/games/gacha.js`
- `api/src/services/games/pvp.js`
- `api/src/services/games/progression.js`
- `api/src/services/games/validation.js`

Likely touch:

- `api/src/server.js`
- `api/src/migrations.js`
- `api/src/profileDb.js`
- `api/src/services/netWorth.js`
- `api/src/services/trading.js` only as a reference pattern, not for direct game logic

## Frontend Files

Add:

- `app-client/app/games/page.tsx`
- `app-client/app/games/[game]/page.tsx`
- `app-client/app/components/games/games-hub-page.tsx`
- `app-client/app/components/games/game-detail-page.tsx`
- `app-client/app/components/games/gacha-panel.tsx`
- `app-client/app/components/games/ticker-tap-panel.tsx`
- `app-client/app/components/games/inventory-panel.tsx`
- `app-client/app/components/games/games-page.module.scss`
- `app-client/app/stores/games-store.ts`
- `app-client/app/lib/games.ts`

Likely touch:

- `app-client/app/components/layout/site-shell.tsx`
- `app-client/app/lib/types.ts`
- `app-client/app/lib/normalizers.ts`
- `app-client/app/components/profile/profile-page.tsx`

## Phase 1 Schema Plan

Because this repo applies local SQL in `api/src/migrations.js`, add the new tables there first.

### New schema

Create:

- `CREATE SCHEMA IF NOT EXISTS games`

### New tables

#### `games.game_catalog`

Purpose:

- authoritative game list
- pricing
- status flags
- game-type specific config

Suggested columns:

- `id BIGSERIAL PRIMARY KEY`
- `key TEXT NOT NULL UNIQUE`
- `name TEXT NOT NULL`
- `description TEXT NOT NULL DEFAULT ''`
- `game_type TEXT NOT NULL`
- `status TEXT NOT NULL DEFAULT 'draft'`
- `entry_fee_cash NUMERIC NOT NULL DEFAULT 0`
- `min_stake_cash NUMERIC NULL`
- `max_stake_cash NUMERIC NULL`
- `sort_order INTEGER NOT NULL DEFAULT 0`
- `icon_key TEXT NULL`
- `banner_key TEXT NULL`
- `config_json JSONB NOT NULL DEFAULT '{}'::jsonb`
- `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`
- `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`

Constraints:

- `game_type IN ('single_player', 'gacha', 'pvp', 'idle')`
- `status IN ('draft', 'active', 'disabled')`
- `entry_fee_cash >= 0`

#### `games.game_sessions`

Purpose:

- paid runs for single-player and async games

Suggested columns:

- `id BIGSERIAL PRIMARY KEY`
- `game_id BIGINT NOT NULL REFERENCES games.game_catalog(id) ON DELETE CASCADE`
- `user_id BIGINT NOT NULL REFERENCES market.users(id) ON DELETE CASCADE`
- `status TEXT NOT NULL DEFAULT 'created'`
- `entry_fee_cash NUMERIC NOT NULL DEFAULT 0`
- `payout_cash NUMERIC NOT NULL DEFAULT 0`
- `seed TEXT NULL`
- `score NUMERIC NULL`
- `result_json JSONB NOT NULL DEFAULT '{}'::jsonb`
- `started_at TIMESTAMPTZ NOT NULL DEFAULT now()`
- `completed_at TIMESTAMPTZ NULL`
- `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`

Constraints:

- `status IN ('created', 'active', 'completed', 'cancelled', 'refunded')`
- `entry_fee_cash >= 0`
- `payout_cash >= 0`

Indexes:

- `(user_id, created_at DESC)`
- `(game_id, created_at DESC)`
- `(status, created_at DESC)`

#### `games.user_cosmetics`

Purpose:

- permanent inventory grants

Suggested columns:

- `id BIGSERIAL PRIMARY KEY`
- `user_id BIGINT NOT NULL REFERENCES market.users(id) ON DELETE CASCADE`
- `cosmetic_key TEXT NOT NULL`
- `cosmetic_type TEXT NOT NULL`
- `rarity TEXT NOT NULL DEFAULT 'common'`
- `source_type TEXT NOT NULL`
- `source_reference_id BIGINT NULL`
- `metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb`
- `granted_at TIMESTAMPTZ NOT NULL DEFAULT now()`

Indexes:

- `(user_id, granted_at DESC)`
- unique candidate depending on design:
  - either allow duplicates
  - or enforce `UNIQUE (user_id, cosmetic_key, source_type, source_reference_id)`

Recommendation:

- allow duplicates at the table level
- handle duplicate conversion in game logic

#### `games.user_equipped_cosmetics`

Purpose:

- selected cosmetics by slot

Suggested columns:

- `user_id BIGINT NOT NULL REFERENCES market.users(id) ON DELETE CASCADE`
- `slot_key TEXT NOT NULL`
- `user_cosmetic_id BIGINT NOT NULL REFERENCES games.user_cosmetics(id) ON DELETE CASCADE`
- `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`
- `PRIMARY KEY (user_id, slot_key)`

#### `games.gacha_pulls`

Purpose:

- auditable gacha transactions

Suggested columns:

- `id BIGSERIAL PRIMARY KEY`
- `game_id BIGINT NOT NULL REFERENCES games.game_catalog(id) ON DELETE CASCADE`
- `user_id BIGINT NOT NULL REFERENCES market.users(id) ON DELETE CASCADE`
- `game_session_id BIGINT NULL REFERENCES games.game_sessions(id) ON DELETE SET NULL`
- `cost_cash NUMERIC NOT NULL DEFAULT 0`
- `rng_seed_hash TEXT NOT NULL`
- `reward_type TEXT NOT NULL`
- `reward_key TEXT NOT NULL`
- `duplicate_compensation_cash NUMERIC NOT NULL DEFAULT 0`
- `metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb`
- `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`

#### `games.pvp_matches`

Purpose:

- async or real-time PvP container

Suggested columns:

- `id BIGSERIAL PRIMARY KEY`
- `game_id BIGINT NOT NULL REFERENCES games.game_catalog(id) ON DELETE CASCADE`
- `status TEXT NOT NULL DEFAULT 'queued'`
- `stake_cash NUMERIC NOT NULL DEFAULT 0`
- `prize_pool_cash NUMERIC NOT NULL DEFAULT 0`
- `result_json JSONB NOT NULL DEFAULT '{}'::jsonb`
- `started_at TIMESTAMPTZ NULL`
- `completed_at TIMESTAMPTZ NULL`
- `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`

#### `games.pvp_match_players`

Purpose:

- participants and result state

Suggested columns:

- `id BIGSERIAL PRIMARY KEY`
- `match_id BIGINT NOT NULL REFERENCES games.pvp_matches(id) ON DELETE CASCADE`
- `user_id BIGINT NOT NULL REFERENCES market.users(id) ON DELETE CASCADE`
- `status TEXT NOT NULL DEFAULT 'joined'`
- `outcome TEXT NULL`
- `payout_cash NUMERIC NOT NULL DEFAULT 0`
- `submitted_at TIMESTAMPTZ NULL`
- `joined_at TIMESTAMPTZ NOT NULL DEFAULT now()`

Constraints:

- unique `(match_id, user_id)`

#### Optional for phase 1.5: `games.game_wallet_events`

Use this only if ledger-only audit is too awkward.

My recommendation:

- skip initially
- add only if reporting becomes painful

## Phase 1 Seed Data

Add an idempotent sync routine similar to achievements.

Implement:

- `api/src/services/games/catalog.js`

Functions:

- `listDefinitions()`
- `syncCatalog(pool)`
- `listActiveGames(pool)`
- `getGameByKey(pool, key)`

Initial game definitions:

1. `capsule-gacha`
2. `ticker-tap`
3. `prediction-duel`

Keep these definitions in code first, then sync into `games.game_catalog`.

## Shared Wallet Plan

Create a dedicated wallet helper instead of spreading ledger writes across game services.

Implement in:

- `api/src/services/games/wallet.js`

Functions:

- `ensureSufficientCashWithClient(client, userId, amount)`
- `debitCashForGameWithClient(client, { userId, amount, entryType, referenceType, referenceId, assetId = null })`
- `creditCashForGameWithClient(client, { userId, amount, entryType, referenceType, referenceId, assetId = null })`
- `refundCashForGameWithClient(client, ...)`

This helper should reuse:

- `ensureUserCashAccount(...)` from `portfolioCash.js`

It should follow the transaction style already used in `trading.js`:

- lock balance row
- validate
- update cash
- write ledger entry

### New ledger entry types

Before implementation, confirm that downstream code does not assume a fixed enum list. If it does, expand it in all relevant display/normalization code.

Phase 1 entry types:

- `gacha_pull_fee`
- `gacha_duplicate_compensation`
- `game_entry_fee`
- `game_prize_payout`
- `game_refund`
- `pvp_stake_debit`
- `pvp_prize_payout`

## Backend API Plan

Add a new route module:

- `api/src/routes/games.js`

Mount it in `api/src/server.js` with:

- `api.use("/games", gamesRoutes);`

### Endpoints for initial release

#### Catalog

- `GET /api/games/catalog`
  - returns active games and lightweight metadata

- `GET /api/games/catalog/:key`
  - returns game detail, config safe for client, and status

#### User summary

- `GET /api/games/me/summary`
  - requires auth
  - returns:
    - current cash balance
    - cosmetic inventory summary
    - recent game sessions
    - optional active matches count

#### Inventory

- `GET /api/games/me/inventory`
  - requires auth
  - returns cosmetics by type and equipped state

- `POST /api/games/me/cosmetics/equip`
  - requires auth
  - body:
    - `slot_key`
    - `user_cosmetic_id`

#### Gacha

- `POST /api/games/capsule-gacha/pull`
  - requires auth
  - body:
    - optional `count`, default `1`
  - server:
    - validate banner active
    - debit cash
    - roll reward
    - create cosmetic
    - credit duplicate compensation if needed
    - return result

#### Single-player game

- `POST /api/games/ticker-tap/sessions`
  - requires auth
  - creates a paid session and returns session id plus seed/config

- `POST /api/games/ticker-tap/sessions/:id/submit`
  - requires auth
  - submits score payload
  - server validates
  - stores score
  - optionally grants small payout or leaderboard qualification

- `GET /api/games/ticker-tap/leaderboard`
  - public

#### PvP MVP

- `POST /api/games/prediction-duel/matches`
  - requires auth
  - creates a queued match and debits stake

- `POST /api/games/prediction-duel/matches/:id/join`
  - requires auth
  - joins match and debits stake

- `POST /api/games/prediction-duel/matches/:id/submit`
  - requires auth
  - submits result payload

- `GET /api/games/prediction-duel/matches/:id`
  - requires auth for participants

## Backend Service Responsibilities

## `catalog.js`

Owns:

- code definitions
- database sync
- public catalog responses

Should not own:

- wallet writes
- inventory grants

## `wallet.js`

Owns:

- debits
- credits
- refunds
- ledger consistency

Should be used by:

- `gacha.js`
- `sessions.js`
- `pvp.js`

## `inventory.js`

Owns:

- grant cosmetic
- list user inventory
- equip cosmetic
- validate user owns equipped item

Future extension:

- cosmetic metadata registry in code or SQL

## `gacha.js`

Owns:

- pull transaction
- banner config
- rarity roll logic
- duplicate compensation

Must be fully server authoritative.

## `sessions.js`

Owns:

- session creation
- score submission
- result persistence
- replay protection

## `pvp.js`

Owns:

- match creation and join
- stake escrow behavior
- submission collection
- resolution and refunds

## Frontend Plan

## Navigation

Update `app-client/app/components/layout/site-shell.tsx`.

Add a new category:

- `Games`

Initial links:

- `/games`
- `/games/capsule-gacha`
- `/games/ticker-tap`
- `/games/prediction-duel`

## Types and normalizers

Extend:

- `app-client/app/lib/types.ts`
- `app-client/app/lib/normalizers.ts`

Add types for:

- `GameCatalogEntry`
- `GameSummary`
- `GameSession`
- `UserCosmetic`
- `EquippedCosmetic`
- `GachaPullResult`
- `TickerTapSession`
- `TickerTapLeaderboardEntry`
- `PredictionDuelMatch`

## Store

Add:

- `app-client/app/stores/games-store.ts`

Responsibilities:

- fetch catalog
- fetch user summary
- fetch inventory
- perform gacha pull
- create game sessions
- submit scores
- handle loading/error state

Do not overload `profile-store.ts` with game state.

## Initial pages

### `/games`

Use as the hub page.

Sections:

- featured games
- current wallet snapshot
- owned cosmetics summary
- recent sessions
- CTA cards for the first three games

### `/games/capsule-gacha`

Sections:

- banner display
- cost per pull
- odds disclosure
- recent pull result
- owned cosmetics preview

### `/games/ticker-tap`

Sections:

- play panel
- explanation of fee and rewards
- leaderboard
- recent personal runs

The actual arcade component can start simple. The important first step is backend-authoritative session creation and score submission.

### `/games/prediction-duel`

Sections:

- create match
- join open match
- current matches
- match history

For MVP, make this async and turn-based. Do not start with websockets.

## Profile Integration

Phase 1 profile changes should be small.

Add:

- equipped cosmetics rendering in profile header
- cosmetic inventory count or featured cosmetic section
- optional recent game badges later

Recommended touched files:

- `api/src/profileDb.js`
- `app-client/app/components/profile/profile-page.tsx`

Do not block initial launch on deep profile customization. Inventory display on `/games` is enough for v1.

## Exact Build Order

## Milestone 1: schema and catalog

1. add `games` schema and core tables in `api/src/migrations.js`
2. add `api/src/services/games/catalog.js`
3. sync initial game definitions on boot from `api/src/server.js`
4. add `GET /api/games/catalog`
5. verify migrations boot cleanly

Exit criteria:

- API returns active games from DB-backed definitions

## Milestone 2: wallet and inventory

1. add `wallet.js`
2. add `inventory.js`
3. add inventory tables and equip endpoint
4. add `GET /api/games/me/inventory`
5. add `GET /api/games/me/summary`

Exit criteria:

- cash debits/credits can be done safely in isolated helper code
- cosmetics can be granted and equipped

## Milestone 3: gacha MVP

1. add `gacha.js`
2. add `POST /api/games/capsule-gacha/pull`
3. define initial cosmetic pool in code
4. wire ledger entries and duplicate handling
5. add frontend `/games` hub
6. add frontend `/games/capsule-gacha`

Exit criteria:

- user can spend cash and receive cosmetic rewards through a fully server-owned flow

## Milestone 4: single-player MVP

1. add `sessions.js`
2. add `POST /api/games/ticker-tap/sessions`
3. add `POST /api/games/ticker-tap/sessions/:id/submit`
4. add leaderboard query
5. build `ticker-tap` frontend panel

Exit criteria:

- user can pay to play a session
- result persists
- leaderboard renders

## Milestone 5: async PvP MVP

1. add `pvp.js`
2. add create/join/submit/read endpoints
3. debit stakes safely
4. resolve winner and payout
5. add timeout/refund logic
6. build `/games/prediction-duel`

Exit criteria:

- two users can complete a full asynchronous stake match safely

## Validation and Safety Checklist

Before shipping any paid game:

- all wallet mutations are transactional
- all payout writes are idempotent
- all game actions require server-side auth
- all prices come from backend config, not client input
- score submission cannot be replayed for duplicate rewards
- refunds are defined for failure states
- inventory equip checks ownership

## Testing Plan

This repo does not currently show a mature test harness around these areas, so phase 1 should at minimum include targeted backend coverage or scriptable verification paths.

### Backend tests or verification targets

- debit with sufficient cash
- debit with insufficient cash
- gacha pull grants item and debits exact amount
- duplicate pull yields expected compensation
- session create/submit cannot double-submit payout
- PvP match cannot pay out twice
- equip endpoint rejects unowned cosmetics

### Frontend verification targets

- unauthenticated user sees sign-in CTA
- authenticated user sees wallet and inventory
- pull flow updates wallet and recent result
- failed pull surfaces error state cleanly
- game routes work within existing shell navigation

## Risks To Watch

### Risk 1: hidden enum assumptions around ledger entry types

Search and normalize any UI that assumes only trading and achievement entries exist.

### Risk 2: overcomplicating the first score game

The first single-player game should validate score and session lifecycle, not prove a fancy game engine.

### Risk 3: idle game inflation

Do not implement idle cash generation in the first release.

### Risk 4: real-time multiplayer scope creep

Start with async PvP only.

### Risk 5: profile customization scope explosion

Ship inventory first, deep cosmetic rendering second.

## Recommended First Ticket Breakdown

1. Add `games` schema and catalog/session/inventory tables to `api/src/migrations.js`.
2. Add `api/src/services/games/catalog.js` with code-defined game sync.
3. Add `api/src/services/games/wallet.js` for shared debit/credit/refund helpers.
4. Add `api/src/services/games/inventory.js` plus inventory/equip endpoints.
5. Add `api/src/routes/games.js` and mount it in `api/src/server.js`.
6. Add `/games` hub route and `games-store.ts` in `app-client`.
7. Implement `capsule-gacha` end-to-end.
8. Implement `ticker-tap` paid session and leaderboard.
9. Implement `prediction-duel` async PvP flow.

## Recommendation

If we start coding immediately, the best first slice is:

1. backend schema
2. catalog route
3. wallet helper
4. inventory model
5. gacha MVP

That slice proves the important platform decisions before we spend time on gameplay-specific UI or multiplayer complexity.
