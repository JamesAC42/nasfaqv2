# Achievements System Design

## Goals

- Support any number of achievement types without schema churn for each new badge.
- Let newly defined achievements detect users who already qualified from historical data.
- Award a one-time monetary reward when an achievement is earned.
- Show earned achievements as badges on the profile page.
- Track and show `current_streak` and `longest_streak` on the profile page.
- Keep award logic deterministic and centered on existing authoritative write paths.

## Existing Backend Constraints

- Trades are written through [`executeOrder()`](/mnt/d/Documents/Github/NASFAQV2/api/src/services/trading.js#L408), which already:
  - creates a trade order
  - inserts a trade fill
  - inserts ledger entries
  - updates cash and holdings
  - records a net worth snapshot
- Profile data is assembled in [`getProfileBundle()`](/mnt/d/Documents/Github/NASFAQV2/api/src/profileDb.js#L346).
- Cash rewards should reuse [`market.ledger_entries`](/mnt/d/Documents/Github/NASFAQV2/ytscraper/internal/db/schema.sql#L499) and [`market.portfolio_cash_balances`](/mnt/d/Documents/Github/NASFAQV2/ytscraper/internal/db/schema.sql#L525), not a separate wallet.

That means the cleanest architecture is:

- achievement definitions live in code
- achievement state lives in SQL
- trade-triggered evaluation runs immediately after a committed trade
- periodic/backfill evaluation scans historical facts so new achievements can be added later

## Data Model

### 1. Achievement catalog

Create a durable catalog table for metadata and rollout state:

```sql
CREATE TABLE IF NOT EXISTS market.achievement_definitions (
  id BIGSERIAL PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  version INTEGER NOT NULL DEFAULT 1,
  category TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  badge_icon TEXT NULL,
  badge_color TEXT NULL,
  reward_cash NUMERIC NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  is_backfill_enabled BOOLEAN NOT NULL DEFAULT true,
  trigger_events TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  rule_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT achievement_definitions_reward_nonnegative_check CHECK (reward_cash >= 0)
);
```

Purpose:

- `key`: stable external identifier like `first_trade`, `trade_count_100`, `streak_7`
- `version`: allows definition changes without mutating old awards
- `trigger_events`: lets the evaluator know which runtime events should check the rule
- `rule_json`: stores threshold/configuration for admin visibility and future tooling

Definitions should still be authored in code as the source of truth, then synced into this table at boot/migration time.

### 2. Earned achievements

```sql
CREATE TABLE IF NOT EXISTS market.user_achievements (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES market.users(id) ON DELETE CASCADE,
  achievement_definition_id BIGINT NOT NULL REFERENCES market.achievement_definitions(id) ON DELETE CASCADE,
  achievement_key TEXT NOT NULL,
  achievement_version INTEGER NOT NULL,
  earned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reward_cash NUMERIC NOT NULL DEFAULT 0,
  source_event_type TEXT NOT NULL,
  source_event_id BIGINT NULL,
  evaluation_run_id BIGINT NULL,
  progress_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, achievement_key, achievement_version),
  CONSTRAINT user_achievements_reward_nonnegative_check CHECK (reward_cash >= 0)
);

CREATE INDEX IF NOT EXISTS market_user_achievements_user_earned_desc_idx
  ON market.user_achievements (user_id, earned_at DESC, id DESC);
```

Purpose:

- one row per earned badge
- supports versioned re-releases if needed
- stores enough source metadata to audit why a badge was awarded

### 3. User streak state

```sql
CREATE TABLE IF NOT EXISTS market.user_trade_streaks (
  user_id BIGINT PRIMARY KEY REFERENCES market.users(id) ON DELETE CASCADE,
  current_streak_days INTEGER NOT NULL DEFAULT 0,
  longest_streak_days INTEGER NOT NULL DEFAULT 0,
  last_trade_day DATE NULL,
  last_trade_fill_id BIGINT NULL,
  streak_started_day DATE NULL,
  longest_streak_started_day DATE NULL,
  longest_streak_ended_day DATE NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT user_trade_streaks_current_nonnegative_check CHECK (current_streak_days >= 0),
  CONSTRAINT user_trade_streaks_longest_nonnegative_check CHECK (longest_streak_days >= 0),
  CONSTRAINT user_trade_streaks_longest_ge_current_check CHECK (longest_streak_days >= current_streak_days OR last_trade_day IS NOT NULL)
);
```

This is denormalized state for fast profile reads. It can always be rebuilt from `market.trade_fills`.

### 4. Evaluation runs

```sql
CREATE TABLE IF NOT EXISTS market.achievement_evaluation_runs (
  id BIGSERIAL PRIMARY KEY,
  run_type TEXT NOT NULL,
  trigger_event_type TEXT NOT NULL,
  trigger_event_id BIGINT NULL,
  target_user_id BIGINT NULL,
  status TEXT NOT NULL DEFAULT 'started',
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ NULL,
  error_text TEXT NULL,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb
);
```

Purpose:

- auditability
- safe retries for backfill jobs
- visibility when a newly introduced achievement is being rolled out

## Definition Model In Code

Add a registry module, for example:

- `api/src/services/achievements/definitions.js`
- `api/src/services/achievements/index.js`
- `api/src/services/achievements/streaks.js`

Recommended shape:

```js
{
  key: "trade_count_100",
  version: 1,
  category: "trading",
  name: "Century Trader",
  description: "Complete 100 trades.",
  reward_cash: 500,
  badge_icon: "century",
  badge_color: "#D4A017",
  trigger_events: ["trade_fill", "backfill"],
  rule_json: { type: "trade_count", threshold: 100 },
  evaluate: async ({ pool, userId, event, facts }) => {
    return facts.trade_count >= 100
      ? { earned: true, progress: { current: facts.trade_count, target: 100 } }
      : { earned: false, progress: { current: facts.trade_count, target: 100 } };
  },
}
```

This keeps the system extensible:

- badge metadata is uniform
- evaluation is per-achievement and open-ended
- new achievement types only need a new definition and possibly a new fact query

## Fact Providers

Do not let each achievement hit the database independently. Build shared fact loaders keyed by event type.

Example facts for `trade_fill`:

- `trade_count`
- `buy_count`
- `sell_count`
- `distinct_assets_traded`
- `first_trade_at`
- `largest_trade_cash`
- `trade_days_count`
- `current_streak_days`
- `longest_streak_days`

Recommended module:

- `api/src/services/achievements/facts.js`

Example query groups:

- counts from `market.trade_fills`
- streak state from `market.user_trade_streaks`
- article stats from `content.articles`
- social stats from `market.user_friendships` / `market.user_rivals`
- portfolio stats from holdings and cash

This is what makes “any number of different types” practical. Achievements stay cheap because they reuse a small set of facts.

## Runtime Evaluation Flow

### Trade-triggered path

After [`executeOrder()`](/mnt/d/Documents/Github/NASFAQV2/api/src/services/trading.js#L408) commits successfully:

1. call `achievements.handleTradeFill({ pool, userId, fillId })`
2. update the user’s streak state from the new fill
3. load facts for the user
4. evaluate only active achievements whose `trigger_events` include `trade_fill`
5. insert newly earned badges into `market.user_achievements`
6. grant reward cash in the same achievement-award transaction

Important detail:

- run achievement evaluation after the trade commit, not inside the trade transaction
- award processing should use its own transaction and be idempotent via the unique `(user_id, achievement_key, achievement_version)` constraint

That avoids turning every trade into a long transaction while still guaranteeing that duplicate awards cannot happen.

### Award transaction

For each newly earned achievement:

1. lock or create the user cash row
2. insert into `market.user_achievements`
3. increment `market.portfolio_cash_balances.cash_balance`
4. insert a `market.ledger_entries` row with `entry_type = 'achievement_reward'`
5. optionally record a net worth snapshot

Recommended ledger reference:

- `reference_type = 'user_achievement'`
- `reference_id = user_achievements.id`

## Streak Rules

Definition for this product:

- a streak day is a UTC market day on which the user has at least one `market.trade_fills` row
- multiple trades on the same day count once
- if the user trades on consecutive days, streak increments
- if they miss one or more days, the next trade starts a new streak at `1`

Because the database and API already operate in UTC, use UTC days consistently. Do not compute streak days from America/New_York while the rest of the market state uses UTC; that will create edge-case bugs.

### Incremental streak update algorithm

When a new fill with `trade_day = fill.ts::date` arrives:

- if no streak row exists:
  - `current_streak_days = 1`
  - `longest_streak_days = 1`
  - `last_trade_day = trade_day`
- else if `trade_day = last_trade_day`:
  - no streak count change
  - update `last_trade_fill_id`
- else if `trade_day = last_trade_day + 1 day`:
  - increment `current_streak_days`
  - update `last_trade_day`
  - bump `longest_streak_days` if needed
- else if `trade_day > last_trade_day + 1 day`:
  - reset `current_streak_days = 1`
  - set `last_trade_day = trade_day`
  - preserve `longest_streak_days`

This supports streak achievements like:

- `streak_3`
- `streak_7`
- `streak_30`
- `streak_100`

## Backfill Strategy

New achievements must be able to detect already-qualified users. That requires a first-class backfill path, not only real-time triggers.

### Backfill modes

1. `single-achievement backfill`
   - evaluate one new definition against all users
2. `single-user rebuild`
   - recompute streaks and achievements for one user
3. `full rebuild`
   - rebuild all streaks and all achievements from historical facts

### Backfill implementation

Recommended admin job entrypoint:

- `api/src/services/achievements/backfill.js`

Recommended process:

1. sync code definitions into `market.achievement_definitions`
2. iterate users in batches
3. preload facts in batch where practical
4. evaluate the target achievement(s)
5. insert missing `market.user_achievements`
6. pay rewards only for newly inserted awards

The unique constraint on `market.user_achievements` is the safety net that makes reruns safe.

### Rebuilding streaks from history

Streak state can be rebuilt from:

```sql
SELECT DISTINCT user_id, ts::date AS trade_day
FROM market.trade_fills
ORDER BY user_id, trade_day;
```

Walk the ordered days per user and recompute:

- `current_streak_days`
- `longest_streak_days`
- boundary dates

This job should run once when the feature is introduced so profile reads do not depend on lazy first-use computation.

## Profile/API Shape

Extend [`getProfileBundle()`](/mnt/d/Documents/Github/NASFAQV2/api/src/profileDb.js#L346) to include:

```json
{
  "profile": {
    "achievements": [
      {
        "key": "streak_7",
        "name": "On Fire",
        "description": "Trade 7 days in a row.",
        "badge_icon": "flame",
        "badge_color": "#FF6A00",
        "earned_at": "2026-04-05T13:20:00.000Z",
        "reward_cash": 250
      }
    ],
    "streaks": {
      "current_streak_days": 4,
      "longest_streak_days": 9,
      "last_trade_day": "2026-04-05"
    }
  }
}
```

Recommended read helpers in `profileDb.js`:

- `listUserAchievements(pool, userId, { limit })`
- `getUserTradeStreak(pool, userId)`

Profile ordering:

- achievements by `earned_at DESC`
- optionally pin “featured” badges later with a separate field or client-side preference

## Suggested Initial Achievement Set

Trade milestones:

- `first_trade`: first completed trade
- `trade_count_10`
- `trade_count_100`
- `trade_count_1000`

Breadth:

- `trade_3_assets`: trade 3 distinct assets
- `trade_10_assets`: trade 10 distinct assets

Streaks:

- `streak_3`
- `streak_7`
- `streak_30`
- `streak_100`

Portfolio:

- `equity_25k`
- `equity_100k`

Social/content later:

- `first_article`
- `five_friends`

## Recommended Service Boundaries

### `trading.js`

Minimal change:

- after successful commit in [`executeOrder()`](/mnt/d/Documents/Github/NASFAQV2/api/src/services/trading.js#L408), trigger `achievements.handleTradeFill(...)`

Do not embed achievement-specific logic directly in `trading.js`.

### `achievements/service.js`

Responsibilities:

- sync definitions
- evaluate on runtime events
- award achievements idempotently
- expose batch backfill helpers

### `achievements/streaks.js`

Responsibilities:

- update streak state from a fill
- rebuild streak state from trade history

### `profileDb.js`

Responsibilities:

- join achievements and streak state into the profile bundle

## Operational Notes

- Use DB constraints for idempotency, not in-memory guards.
- Keep reward grants in the same transaction as the `user_achievements` insert.
- Prefer UTC dates everywhere for streak consistency.
- Record enough metadata to explain why a user got a badge.
- Treat definitions as code-owned, DB-synced records. Do not make raw DB rows the only definition source.

## Migration Plan

1. Add the four new tables.
2. Add support for `achievement_reward` ledger entries.
3. Build the achievement definition registry and sync routine.
4. Build streak rebuild job from historical `trade_fills`.
5. Build backfill runner for achievements.
6. Hook post-trade evaluation into `executeOrder()`.
7. Extend profile queries to return achievements and streaks.
8. Run one-time streak rebuild.
9. Run one-time backfill for initial achievement set.

## Why This Design Fits This API

- It uses the existing trade path as the runtime trigger.
- It uses the existing cash/ledger model for payouts.
- It keeps profile reads cheap with precomputed streak state and earned-achievement rows.
- It supports arbitrary new achievement types through code-defined evaluators plus shared fact loaders.
- It gives you a safe backfill path so future badges can reward historical users without custom one-off SQL each time.
