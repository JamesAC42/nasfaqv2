# Market worker status and rebuilds

The web and game API replicas intentionally disable market schedulers. Only `api-scheduler` runs them. Do not enable schedulers on web replicas to correct an admin status label.

## Scheduler status

The tick and live-order workers publish a Redis heartbeat every 15 seconds. The admin API reads that shared heartbeat instead of its own process environment. `SCHEDULER_STATUS_OWNER=true` is set only on `api-scheduler`, allowing it to report an explicitly disabled scheduler without disabled web/game replicas overwriting it.

- Running: a recent worker heartbeat, with no recorded tick failure or stalled tick.
- Off: the status-owner worker explicitly disabled the scheduler.
- Not reporting: the last heartbeat is at least 90 seconds old.
- Unknown: Redis or a heartbeat is unavailable. This does not prove the scheduler is off.
- Error: the latest loop attempt failed. Check scheduler logs and the returned error code.
- Stalled: an attempt has exceeded three polling intervals or two minutes, whichever is longer.

Running confirms worker activity, not that every scheduled adjustment/order succeeded. Check overdue counts, recent batches, and worker logs as well. Keys are `nasfaq:ops:scheduler:adjustment` and `nasfaq:ops:scheduler:live-orders`; each retains its last observation for 24 hours.

## Rebuild progress

The migration creates `market.rebuild_jobs`. All API replicas read the same job record. The admin client polls `/internal/market/rebuild-full?id=<uuid>` so another job cannot replace the one it is displaying. Without an ID, the endpoint returns the latest job. Existing admin authentication and explicit rebuild confirmation still apply.

A dedicated PostgreSQL session holds advisory lock `9204091` for each asynchronous job. Existing settlement/adjustment locks remain in place. Concurrent rebuild starts return HTTP 409. Progress writes are awaited; a persistence failure stops the worker at the next progress checkpoint.

If the job's owning session disappears, status reads mark it failed with `rebuild_interrupted`, preserving its last progress. Completed settlement days remain in the database. Jobs do not automatically resume after a restart: inspect market state and authorize any recovery/rebuild separately. Avoid releases while a rebuild is running; persistence makes interruptions visible, not restart-safe execution.

## Settlement I/O and timings

Financial calculations are unchanged. For 73 assets, the previous-state lookups and three per-asset writes formerly required 292 sequential SQL calls per day. They now require five: one history query, ordered asset locking, and three bulk writes. Supply columns remain owned by fills/weekly evaluation and are never replaced with stale settlement snapshots.

Rebuild progress includes `timings_ms.asset_io`, `timings_ms.settlement`, and `timings_ms.replay` for the latest completed day. Settlement completion timestamps use wall-clock time rather than transaction-start time. These measurements distinguish SQL round trips from other work; production speedup still needs measurement during a separately authorized rebuild.

## Weekly evaluation I/O

The weekly evaluation (`api/src/services/weeklyEvaluation.js`) used to lock every active stock, then loop over every holder of every stock with one to five statements each, convert Credit player by player and insert notifications one at a time, all in one transaction: at ~2,000 players, tens of thousands of statements, minutes against the cross-region database, with fills timing out on the locked stocks meanwhile. It now reads its inputs in a few set-based queries (stocks locked in id order, open buybacks, holdings and wallets), works the whole evaluation out in memory (`planEvaluation`, the same JS arithmetic as before, with wallets tracked as exact NUMERIC values) and writes it back in a few bulk statements (`applyEvaluation`, `economy.writeMoves`, `notifications.notifyMany`). Rows stay locked for about ten statements. Advisory lock `9204010`, the run-once rule and the 36-hour catch-up are unchanged.

While `MARKET_WEEKLY_EVALUATION_CLOSE_TRADING` is on (the default until it has run in production once), a real run also closes trading: it takes the settlement scheduler lock (`9204001`; skipped and retried while the daily settlement runs), waits up to a minute for a live-order batch holding `9204003` to finish, sets the market to `settling` with a message, and restores the previous state afterwards. A market an admin closed is left as it is. Dry runs (preview) take no row locks and write nothing.

`api/test/weekly-evaluation-batch.test.js` seeds a market through the real stats, fundamentals and settlement pipeline, clones it, and runs the frozen row-at-a-time evaluation (`api/test/fixtures/weekly-evaluation-reference.js`) and the batched one side by side over two Saturdays and a first evaluation, comparing balances, holdings, ledger rows, dividend lines, buybacks, stocks, the review and notifications exactly. `WEEKLY_EVAL_TEST_PLAYERS` sizes the market (300 by default).

## Achievement checks after fills

Each fill used to start its own streak and achievement transaction the moment it committed, with nothing waiting on it: about ten statements each, all at once, on the scheduler pod's pool alongside the live-order batch. Fills now queue a check by player (`api/src/services/achievements/index.js`). Two workers (`ACHIEVEMENT_WORKER_CONCURRENCY`, 1 or 2) each check one player at a time, with every fill they have waiting, and a live-order batch holds the queue until it finishes, so each player is checked once per batch. Awards are thresholds on running totals, so one check after several fills awards what a check after each would have. A failed check is retried twice, five seconds apart. The streak is read from its last trade day on, so a check that never ran (a restart) is caught up by the player's next fill. A shutdown waits for the queue within its drain window.

`api/test/achievement-queue.test.js` checks a batch of fills against the awards, rewards, notifications and streaks it should give, once per player, along with the hold, the retry and an out-of-order fill.

## Chat archive

Chat past the visible window (`CHAT_HISTORY_VISIBLE_DAYS`, keeping each room's newest `CHAT_HISTORY_MIN_MESSAGES`) moves to `chat.archived_messages` every 10 minutes on `api-scheduler`, under advisory lock `9204120` (`api/src/services/chatArchive.js`). Every history GET used to run this itself. Reads cover both tables with the same rules, so readers see the same history either way. The job reports as `chat-archive` on the admin heartbeats; the watchdog calls it failing after two hours without a clean tick. `CHAT_ARCHIVE_ENABLED=false` stops it, and `POST /api/chat/admin/archive` still runs one by hand.

## Validation

`api/test/market-ops.test.js` verifies cross-replica progress, singleton job ownership, completion/error persistence, disconnected-worker detection, and bulk-write equivalence with a frozen pre-change implementation. It checks all persisted financial fields for 73 assets, history ordering, atomic rollback, and unchanged supplies against PostgreSQL 16.

Run the API suite with the existing `CHAT_TEST_DATABASE_URL` pointing at a disposable localhost PostgreSQL database named `nasfaq_chat_test`, user `nasfaq_test`. The new integration test creates a separate disposable `nasfaq_ops_test` database. Never point tests at production. CI provides this local PostgreSQL service. Build `app-client` and run the existing `deploy/tests` checks before release.
