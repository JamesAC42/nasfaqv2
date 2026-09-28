# Capacity: how many players the production setup holds

Measured September 2026 on the redesign branch. Setup: a 2-core sandbox, the API pinned to one
core (the same as one `api-web` pod's 1 vCPU limit), and a copy of the simulation database with
5,000 players, 38k positions and a session each. The API ran with production settings (schedulers
off, pool of 4). The scripts are in the session scratchpad, not the repo. For the real test, see
DEPLOYMENT.md §10 (k6 against staging).

DigitalOcean's shared vCPUs are usually slower than the sandbox's cores, so the estimates below
divide the measured throughput by 1.5.

## What production runs

| Piece | Size |
|---|---|
| `api-web` | 2 pods, 1 vCPU and 1 GiB each, no autoscaler; HTTP and every WebSocket |
| `api-scheduler` | 1 pod: ticks, settlement, the 10-minute order batches, the weekly evaluation |
| `api-games` (new) | 1 pod: game tables and `/api/games` |
| Postgres | `db-s-2vcpu-4gb`: 2 vCPU, 97 connections |
| Redis | in-cluster, 250m CPU: cache and pub/sub |
| Cloudflare | in front: TLS, gzip/brotli to browsers, DDoS protection |

## Where the load came from, and what changed

Every open tab keeps one market socket. The expensive part was what each tab did on every trade
fill anywhere on the site. Within ~0.7s it refetched three endpoints:

- the whole asset board: 266 KB, 8.6 ms of API CPU
- the daily report: 21 ms of database time, uncached
- the status

A batch fills orders back to back, so each tab did this up to 1.4 times a second. On top of that:

- The market socket sent the 266 KB board to every new connection.
- Signed-in tabs polled their orders every 10s, even when hidden.
- Every authenticated request also ran an `UPDATE` on the session.

| | Before | After |
|---|---|---|
| `/api/market/assets` | 8.6 ms CPU, 266 KB, 112 req/s per core | 0.12 ms, 18 KB gzipped, 8,261 req/s. The body is cached once in Redis and memory, built by one request at a time, and sent pre-gzipped with an ETag. |
| `/api/market/report/daily/latest` | 4.8 ms CPU + 21 ms DB, 91 req/s | 0.13 ms, 7,638 req/s (same cache) |
| `/api/market/hub` | 17 ms CPU + 67 ms DB, 20 req/s | 0.37 ms, 2,596 req/s (same cache, 5s) |
| After a fill, every tab | 3 requests within 0.7s | Nothing at once: the fill event already updates the board. One jittered reconcile 20–30s later. |
| `/market` order-queue panel | refetched 0.4s after every event | 3–5s, jittered |
| Signed-in orders poll | 10s, even in hidden tabs | 10s only while an order is waiting, otherwise 60s; paused while hidden |
| Market socket on connect | 266 KB board | status only (a reconnect refetches the board over HTTP) |
| Session `last_seen_at` | `UPDATE` on every authenticated request | at most every 5 minutes per session |
| Queuing an order | rebuilt the board (20 ms DB) | doesn't (the 5s cache picks up pending counts) |
| Market events on the socket | one message per event per socket | bundled per 100 ms for clients that ask for it |
| Dead sockets | kept until TCP gave up | ping every 30s; no answer, dropped |
| Leaderboard after trades | one refresh per fill, in parallel (these deadlocked) | serialized with one lock, coalesced every 2s |

**WebSocket fan-out** (one pod, 3,000 sockets, fill-sized events):

| | Steady 20 events/s | A batch: 100 fills at once, every second |
|---|---|---|
| One message per event | 38% CPU, p99 0.3s | fell behind: p99 5s, a quarter undelivered after the window, send buffers grew by hundreds of MB |
| Bundled per 100 ms | 18% CPU, p99 0.2s | 17% CPU, everything delivered, p99 0.7s |

**Other numbers**

- Authenticated reads (orders, portfolio, notifications): about 0.5–0.7 ms of CPU each.
- Queuing an order: 2 ms of CPU, about 330 a second per pod.
- The batch executor fills about 200 orders a second, so 10,000 queued orders clear in under a minute.

## Estimate

An active signed-in player averages about 0.25 requests a second, mostly page views. That costs:

- about 0.2 ms of API CPU and 0.3 ms of database time per second
- one market socket
- during a batch, bundled fill traffic on that socket, about 0.15 ms of CPU a second

"Concurrent" below means tabs open at the same time. Registered players can be many times that.

| Setup | Comfortable | Stretch | What gives first |
|---|---|---|---|
| **Before these changes** | about 50 | about 100 | Database and API CPU during every batch (each tab refetching the board and report) |
| **Now, as deployed** (2 × `api-web`, 2 vCPU database) | **about 1,500** | about 2,500–3,000 | `api-web` CPU: HTTP plus socket fan-out during batches. Then the database during batches (fills, leaderboard refresh). |
| 4 × `api-web` (or an autoscaler 2→6) | about 3,000 | about 4,500 | The database. Upgrade to `db-s-4vcpu-8gb` and add PgBouncer. |
| Beyond that | | | Fan-out cost grows with sockets × events. Next steps: a separate socket Deployment, or a pub/sub service. |

## Still open (not fixed here)

- **The leaderboard page costs about 60 ms of database time per view.** It's uncached, and each
  viewer sees a different "you" row. Cache the shared part if the Ranks page gets busy.
- **No autoscaler, and `api-web` is fixed at 2 pods.** Add an HPA (DOKS needs metrics-server) or
  raise the replica count before a big announcement.
- **DEPLOYMENT.md §6 assumes 47 connections.** The `db-s-2vcpu-4gb` plan has 97, so
  `PG_POOL_MAX` is now 8.
- **No `statement_timeout`.** One slow query can hold a pool connection indefinitely.
- **`/internal/*` isn't blocked at the ingress**, although DEPLOYMENT.md §5 says it is. The routes
  are admin-only in the app, and the admin pages use them.
- **Game tables are single-owner (`api-games`).** Two replicas of it would split tables again.
  Moving table state to Redis would lift that.
