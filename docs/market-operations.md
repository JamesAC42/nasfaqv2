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

## Validation

`api/test/market-ops.test.js` verifies cross-replica progress, singleton job ownership, completion/error persistence, disconnected-worker detection, and bulk-write equivalence with a frozen pre-change implementation. It checks all persisted financial fields for 73 assets, history ordering, atomic rollback, and unchanged supplies against PostgreSQL 16.

Run the API suite with the existing `CHAT_TEST_DATABASE_URL` pointing at a disposable localhost PostgreSQL database named `nasfaq_chat_test`, user `nasfaq_test`. The new integration test creates a separate disposable `nasfaq_ops_test` database. Never point tests at production. CI provides this local PostgreSQL service. Build `app-client` and run the existing `deploy/tests` checks before release.
