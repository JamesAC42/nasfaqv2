# Adjustment system UI / UX checklist

This checklist tracks the player-facing and admin-facing surfaces for the new interval adjustment system.

## Market report page

- [x] **Next / last tick statement**: plain text summary of next tick + last tick + times (ET context as needed).
- [x] **Tick recap cards**: post-tick summary cards (scope/impact TBD: global + highlights).
- [x] **Adjustment leaderboards**: rankings derived from adjustment outcomes (movers, gap compression, etc.—define metrics when implementing).
- [x] **Explainer module**: short educational block explaining base rate vs market price + how ticks pull toward base (**no strength reveal**).

## Activity page

- [x] **Next tick countdown timer**: live countdown to next scheduled tick.
- [x] **Clock wall**:
  - [x] Large analog clock for **US Eastern** (market clock timezone).
  - [x] Row of smaller analog clocks for additional zones (at minimum: **Japan, Indonesia, Austria, Australia, UK**, plus “others” as stretch).
- [x] **Daily tick timeline**: four ticks with a current-position marker on the day’s progression.
- [x] **Live activity feed**: stream of tick/applied events (and related market events if useful).
- [x] **Global subtle tick toast**: top-center transient notification when a tick happens, auto-dismiss.

## Asset detail page

- [x] **Pressure meter**: visual gap between market price and base rate (premium/discount framing).
- [x] **Adjustment panel v2**: richer layout for next/last tick context + outcomes (still **no strength reveal**).
- [x] **Session audit trail**: per-asset history list for interval applications / skips (from existing event/interval data).
- [x] **Adjustment enabled state**: clearly show if adjustments are enabled/disabled for the asset + what it implies.

## Admin tools (full pass)

- [x] **Admin adjustment dashboard**: sessions by date, statuses, progress/completion.
- [x] **Per-session interval grid**: assets × intervals with scheduled time, status, before/after, metadata/skip reasons.
- [x] **Force tooling UI**: human-readable results for forced ticks (and safer operational copy).
- [x] **Health / ops indicators**: scheduler freshness, stuck rows, lock contention signals (as available).
- [x] **Drill-downs**: click cell → details drawer (metadata, linked price event).

## Explicitly out of scope

- [ ] ~~Strength reveal / showing the four random weights up front~~ **Not doing** (randomness is intentional).
