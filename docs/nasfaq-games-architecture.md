# NASFAQ Games Architecture

## Goal

Build a `nasfaq-games` system that:

- uses the existing NASFAQ user identity and in-game currency
- acts as a money sink first, not a free money printer
- increases session time inside the NASFAQ ecosystem
- supports multiple game types without each game inventing its own auth, wallet, or inventory model
- starts simple, then grows into multiplayer and cosmetics safely

## Current System Constraints

From the current codebase:

- Auth is already centralized in `/api` with cookie sessions via `/api/auth/*`.
- The frontend already calls the API with `credentials: "include"` from `app-client/app/lib/api.ts`.
- User cash is already authoritative in `market.portfolio_cash_balances`.
- Money movement is already tracked in `market.ledger_entries`.
- The market uses transaction-backed write paths in `api/src/services/trading.js`.
- Achievements already reuse the same cash balance and ledger instead of creating a second wallet.
- The profile system already exposes cash, holdings, achievements, and streak-like meta-progression.

That means the games system should not create:

- a second auth system
- a second wallet
- game-specific hidden balances
- frontend-only prize logic

## Recommendation

### Short version

Use:

- the existing `/api` as the system of record
- a new backend domain under `/api/games/*`
- the existing `app-client` Next app for phase 1 UI under routes like `/games`

Design it so the UI can later be split into a separate app or subdomain without changing the backend contract.

### Why this is the right first step

Putting games inside the current `app-client` first is the best option because:

- auth already works there
- the shell, navigation, and profile context already exist
- portfolio cash can be shown consistently beside game spend
- users stay in the same product instead of feeling like they were sent to another site
- implementation cost is much lower for the first few games

### Can this later become a separate subdomain?

Yes. A separate frontend like `games.nasfaq.biz` is possible if:

- the auth cookie is intentionally configured for the parent domain, such as `.nasfaq.biz`
- CORS allows the games origin with credentials
- both apps keep using the same `/api`

But that adds complexity now:

- cross-origin cookie and env setup
- more deployment coordination
- more chances for auth/session bugs
- duplicated shell/navigation work

So the right architecture is:

- shared backend contracts now
- same frontend app initially
- optional extraction to a dedicated games frontend later

## Proposed Platform Shape

Treat `games` as a new bounded domain alongside `market`, not as a loose set of one-off features.

### Backend domains

Add a new backend service area:

- `api/src/routes/games.js`
- `api/src/services/games/*`

Suggested service breakdown:

- `catalog.js`: game definitions, entry fees, availability, prize configs
- `wallet.js`: all game-related debits, credits, escrow, refunds
- `sessions.js`: single-player runs, puzzle seeds, attempts, outcomes
- `pvp.js`: matchmaking, rooms, stakes, result settlement
- `inventory.js`: cosmetics, unlocks, gacha rewards, equip state
- `progression.js`: daily tasks, game achievements, streaks, retention loops
- `provablyFair.js` or `rng.js`: server-authoritative randomness and roll recording

### Frontend domains

Within `app-client`, add:

- `app/games/page.tsx`
- `app/games/[game]/page.tsx`
- `app/components/games/*`
- `app/stores/games-store.ts`
- `app/lib/games.ts`

This keeps games as a first-class section in the product, like market/chat/news.

## Core Design Principle

The backend must own all economically meaningful actions.

That includes:

- charging entry fees
- rolling gacha outcomes
- creating or awarding cosmetics
- holding PvP stakes in escrow
- deciding winners and payouts
- refunding cancelled games

The frontend can animate and present a game, but it must never be trusted for currency or reward decisions.

## Shared Economy Model

Keep one unified NASFAQ cash balance.

### Wallet policy

Reuse `market.portfolio_cash_balances` as the single user currency balance.

Reuse `market.ledger_entries` for all money movement, but expand allowed `entry_type` usage for games, for example:

- `game_entry_fee`
- `game_prize_payout`
- `game_refund`
- `game_stake_escrow_debit`
- `game_stake_escrow_release`
- `gacha_pull_fee`
- `gacha_duplicate_compensation`
- `idle_game_purchase`
- `idle_game_harvest`

This is consistent with how trading and achievements already work.

### Important rule

Games should debit the same cash balance immediately. Do not create “game tokens” at first.

That keeps:

- economy visibility simple
- profiles truthful
- admin tooling simpler
- abuse analysis easier

## Data Model

Add a dedicated `games` schema or `market.games_*` tables. I would prefer a separate `games` schema for clarity.

### Recommended tables

#### 1. `games.game_catalog`

Defines available games and configuration.

Fields:

- `id`
- `key` like `ticker-tap`, `capsule-gacha`, `prediction-duel`
- `name`
- `game_type` such as `single_player`, `gacha`, `pvp`, `idle`
- `status` such as `draft`, `active`, `disabled`
- `entry_fee_cash`
- `min_stake_cash`
- `max_stake_cash`
- `config_json`
- `created_at`
- `updated_at`

#### 2. `games.game_sessions`

Authoritative run/session record for single-player or asynchronous games.

Fields:

- `id`
- `user_id`
- `game_id`
- `status` such as `created`, `active`, `completed`, `cancelled`, `refunded`
- `seed`
- `entry_fee_cash`
- `payout_cash`
- `score`
- `result_json`
- `started_at`
- `completed_at`

#### 3. `games.game_wallet_events`

Maps game events to ledger references and makes auditing easier.

Fields:

- `id`
- `user_id`
- `game_session_id`
- `ledger_entry_id`
- `event_type`
- `cash_delta`
- `metadata_json`
- `created_at`

This can be optional if you want to rely entirely on `market.ledger_entries`, but I recommend it for game-domain observability.

#### 4. `games.user_cosmetics`

User-owned cosmetic inventory.

Fields:

- `id`
- `user_id`
- `cosmetic_key`
- `cosmetic_type` such as `avatar_frame`, `profile_badge`, `chat_flair`, `market_theme`
- `rarity`
- `source_type` such as `gacha`, `event`, `admin`
- `source_reference_id`
- `granted_at`

#### 5. `games.user_equipped_cosmetics`

Current equipped cosmetics per slot.

Fields:

- `user_id`
- `slot_key`
- `user_cosmetic_id`
- `updated_at`

#### 6. `games.gacha_pulls`

Authoritative gacha transaction log.

Fields:

- `id`
- `user_id`
- `game_id`
- `cost_cash`
- `rng_seed_hash`
- `reward_type`
- `reward_key`
- `duplicate_compensation_cash`
- `created_at`

#### 7. `games.pvp_matches`

Multiplayer match state.

Fields:

- `id`
- `game_id`
- `status` such as `queued`, `active`, `completed`, `cancelled`
- `stake_cash`
- `prize_pool_cash`
- `result_json`
- `started_at`
- `completed_at`

#### 8. `games.pvp_match_players`

Fields:

- `id`
- `match_id`
- `user_id`
- `joined_at`
- `outcome` such as `win`, `loss`, `draw`, `forfeit`
- `payout_cash`

#### 9. `games.idle_entities`

Persistent state for farming/idle systems.

Fields:

- `id`
- `user_id`
- `game_id`
- `state_json`
- `last_tick_at`
- `created_at`
- `updated_at`

## API Contract

### Catalog and discovery

- `GET /api/games/catalog`
- `GET /api/games/catalog/:key`
- `GET /api/games/me/summary`

### Single-player sessions

- `POST /api/games/:key/sessions`
- `POST /api/games/:key/sessions/:id/submit`
- `GET /api/games/:key/sessions/:id`
- `GET /api/games/:key/leaderboard`

### Gacha and cosmetics

- `POST /api/games/:key/pull`
- `GET /api/games/me/inventory`
- `POST /api/games/me/cosmetics/equip`

### PvP

- `POST /api/games/:key/matches`
- `POST /api/games/:key/matches/:id/join`
- `POST /api/games/:key/matches/:id/submit`
- `GET /api/games/:key/matches/:id`

### Idle/farming

- `GET /api/games/:key/idle-state`
- `POST /api/games/:key/idle-state/purchase`
- `POST /api/games/:key/idle-state/harvest`

## Economic Rules

If this is meant to be a money sink, the expected value of most games must be negative.

### Recommended economy rules

- Single-player games: small entry fee, leaderboard prestige, occasional bounded payouts.
- Gacha: pure sink plus cosmetics, with no direct cash payout.
- PvP: rake the pot or charge match fees.
- Idle/farming: cap returns hard and make it mostly progression/cosmetic oriented, not a passive cash printer.

### Hard rules

- Do not let idle games mint unlimited net-new currency.
- Do not let users chain low-risk positive-EV loops.
- Do not allow client-submitted scores to directly determine payouts without server validation.
- Do not launch real-money-style randomness without clear disclosure and server-side auditability.

## What To Launch First

Start with games that are backend-simple and socially sticky.

### Phase 1: safest starting set

#### 1. Cosmetic gacha

Why first:

- strongest money sink
- easy to understand
- no balance inflation if rewards are cosmetic only
- plugs naturally into profiles, chat, leaderboard flair, and market identity

Good cosmetic slots:

- profile frames
- chat flair
- badge backplates
- username accents
- portfolio card themes

#### 2. Simple single-player score game

Example:

- `Ticker Tap`: a short reaction/timing game themed around hitting moving market windows

Structure:

- pay `X` cash to enter
- play a 30-60 second game
- get a score
- no direct payout, or only very small tiered payouts capped daily
- weekly leaderboard gives cosmetics or titles, not much cash

#### 3. PvP prediction duel

Example:

- two users enter a low-stakes contest
- both pay a stake
- answer the same short market/media prediction prompt or play the same micro-skill round
- winner gets most of the pool, system takes a fee

Why third:

- good retention/social loop
- still manageable if asynchronous
- easier than full real-time action multiplayer

### Phase 2

- seasonal event passes
- limited banner gachas
- guild/team competitions
- asynchronous tournament ladders
- simple idle room decorators or collectible farming

### Phase 3

- real-time multiplayer if there is enough demand
- a separate dedicated games frontend only if the games section becomes large enough to justify it

## Suggested First Three Games

### 1. Capsule Gacha

Type:

- cosmetic sink

Loop:

- user spends cash
- backend rolls reward
- reward goes to inventory
- duplicates convert to dust or small consolation value

Why it works:

- direct sink
- collectible progression
- easy to theme around idols, market eras, units, events

### 2. Ticker Tap

Type:

- single-player arcade

Loop:

- pay small fee
- 45-second session
- score points by hitting targets aligned to moving ticker bands
- weekly high scores give profile flair, small titles, or very small cash prizes

Why it works:

- fast sessions
- highly replayable
- cheap to build
- no dependency on real-time multiplayer infra

### 3. Prediction Duel

Type:

- asynchronous PvP

Loop:

- player creates or joins a duel with fixed stake
- both get the same prompt or puzzle seed
- backend resolves by score or prediction result
- payout is stake pool minus rake

Why it works:

- social competition
- simple concurrency model
- meaningful sink because the house can take a fee

## UI Placement Recommendation

### Phase 1

Add games to the current `app-client`.

Suggested nav placement in `SiteShell`:

- new top-level category: `Games`
- routes:
  - `/games`
  - `/games/gacha`
  - `/games/ticker-tap`
  - `/games/prediction-duel`

Why:

- same account context
- same visual identity
- same shell
- easier discovery from market/profile/chat pages

### Future extraction path

If games later outgrow the main app, move the UI to a new frontend while keeping:

- the same API
- the same auth cookie model
- the same wallet/ledger
- the same profile inventory system

That means the backend contracts should be app-agnostic from day one.

## Backend Write Pattern

Mirror the rigor already used in `trading.js`.

### Example: creating a paid session

1. authenticate user
2. lock or load cash balance
3. validate game availability and fee
4. debit entry fee from `portfolio_cash_balances`
5. insert `market.ledger_entries` row
6. insert `games.game_sessions` row
7. commit

### Example: paying out a winner

1. lock match/session
2. verify it is unresolved
3. compute payout
4. credit user cash balance
5. insert ledger row
6. mark session/match resolved
7. commit

Make all payout paths idempotent. A second resolution attempt must do nothing.

## Anti-Abuse and Fairness

Needed from the start:

- server-generated seeds for scoreable runs
- replay or payload validation where feasible
- daily payout caps for early games
- admin visibility into wallet deltas by game
- suspicious activity logs
- cooldowns or rate limits on game creation/pulls/submits

For gacha:

- record the roll result and seed hash
- keep banner odds in config
- keep pull economics fully server-side

For PvP:

- escrow both players before match start
- define clear timeout and forfeit rules
- refund cleanly on cancellation or unresolved failures

## Observability and Admin

Add admin reporting early.

You will want:

- gross sink by game
- gross payouts by game
- net sink by day
- DAU/WAU by game
- repeat sessions per user
- gacha conversion and duplicate rates
- PvP completion and forfeit rates

This should be visible before expanding the catalog.

## Rollout Plan

### Step 1

Build the backend foundation:

- `games` schema
- catalog
- session model
- shared wallet helpers
- ledger entry types
- inventory tables

### Step 2

Build the `Games` hub in `app-client` and ship one cosmetic gacha.

### Step 3

Ship one short single-player game with leaderboard and cosmetic rewards.

### Step 4

Ship asynchronous PvP with small stakes and strong guardrails.

### Step 5

Re-evaluate whether a separate `nasfaq-games` frontend is justified.

Do not split the frontend before there is real proof that:

- games traffic is large enough
- the UI surface is diverging heavily
- the current shell is becoming a constraint

## Final Recommendation

Build `nasfaq-games` as:

- a new backend domain inside `/api`
- a new product section inside the current `app-client`
- a shared-wallet, shared-auth, server-authoritative game platform

Ship first:

1. cosmetic gacha
2. one fast single-player score game
3. one asynchronous low-stakes PvP game

Architect it so a separate `games` frontend can be added later, but do not pay that complexity cost now.
