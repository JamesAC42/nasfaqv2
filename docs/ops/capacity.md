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

## Second pass (same day)

**More caching.** These now go through the same shared cache (Redis plus memory, one build at a
time) with short TTLs:

- status, the tick summary (cleared by every tick), the order-queue summary and flow
- per-stock detail, candles, trades, stats and treasury
- rankings
- the front page's `/overview/latest`, `/overview/timeseries` (was one query per channel) and `/overview/wire`
- the all-channels livestream list (was a Redis `SCAN` per visit)
- browsing news (searches still go to the database)
- the signed-out leaderboard

The order-flow charts got indexes, so they no longer scan every order ever placed.

**Writes taken off read paths:**

- The article list re-synced every news article on each view; it no longer writes.
- Chat rebuilt its channel table on every chat request and socket subscribe. It now syncs at most
  every 5 minutes, and a socket can subscribe to at most 20 rooms.
- The leaderboard counted every user on each request, and rebuilt the whole board whenever someone
  new had signed up. It now adds only the missing players, at most once a minute.
- A fill only rescans the player's trade history for achievements when they still have one to earn.
- The orders poll only looks up fills for filled orders, inside recent chunks of the fills table.

**Other fixes:**

- Clients no longer refetch an unused "asset detail" at every tick.
- The live-order scheduler can't crash the pod on a pool timeout.
- Only the settlement owner reopens the market at boot.

**Game tables:**

- A Postgres lease guarantees one owner.
- A match or blackjack round refunds or settles exactly once, even across a restart.

**Security (from a review of the API):**

- Channel writes are admin-only. Before, anyone could add, edit, delete, upload icons or trigger detection.
- `/api/admin/assets` requires an asset manager.
- Every socket caps frames at 16 KB and has an error handler. Before, one oversized frame crashed the process.
- Socket upgrades check the Origin.
- The email check can no longer be used to freeze a pod (ReDoS).
- The fields that gave today's target away exactly are hidden (`size_anchor_raw`,
  `momentum_multiplier`, and the other target ingredients).
- Rate limits, in Redis and shared by pods:
  - sign-in: per IP and per account name
  - sign-up, password reset requests and verification emails
  - chat (one post in flight per player), comments, articles and friend requests
- Request bodies are capped at 1 MB, except the admin image uploads.
- The session cookie is Secure by default in production. Dev CORS origins are off in production.
- A login to an unknown account takes as long as a wrong password.
- Draft and private prediction markets are hidden on the chart, trades and quote routes.
- Other people's profiles no longer show staff permission flags. The ADMIN tag stays, on purpose.
- Security headers on the site (no framing by other sites, nosniff) and on the API.

## Still open

- **Ticker Tap sends the whole seeded run to the client up front.** A bot could compute a perfect
  run. Stream the targets as the run plays, or reveal the seed only after submission.
- **Password hashing** uses scrypt N=2^14. Raise it, and rehash on the next login.
- **Every signed-in request still looks up the session in Postgres.** It's one indexed query; a
  short in-memory cache would need invalidation on logout and on profile or permission changes.
- **The stock page fetches some endpoints twice** (two components each call stats, tick history
  and rankings). The server caches now absorb it, but a shared hook would halve the requests.
- **No autoscaler, and `api-web` is fixed at 2 pods.** Add an HPA (DOKS needs metrics-server) or
  raise the replica count before a big announcement.
- **No `statement_timeout`.** One slow query can hold a pool connection indefinitely.
- **`/internal/*` isn't blocked at the ingress**, although DEPLOYMENT.md §5 says it is. The routes
  are admin-only in the app, and the admin pages use them.
- **Game tables are single-owner (`api-games`).** Moving table state to Redis would let it scale out.
