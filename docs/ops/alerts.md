# Alerts

Production failures post to a Discord channel through a webhook. There's no other vendor. The code is
in `api/src/services/alerts.js` (posting, dedupe) and `api/src/services/watchdog.js` (the checks).

## Setup

1. In Discord, open the alerts channel's settings, then Integrations > Webhooks > New Webhook, and copy the URL.
2. Add it to the `nasfaq-app-secrets` Secret as `DISCORD_ALERT_WEBHOOK_URL`, then restart the API pods.
   Optionally add `DISCORD_ALERT_ROLE_ID` (a role's numeric ID) so each new alert @mentions that role.
3. Set the channel's notifications to "All messages" on the phones that should ring, or rely on the role mention.
4. The admin hub (`/admin`, Health > Heartbeats) says "Alerts go to Discord" once the webhook is set.

Without the webhook nothing is sent. Each API process logs that once at startup.

The watchdog can't see the site from outside. Add an external uptime check as well, on
`https://holo.nasfaq.biz/` and `https://holo.nasfaq.biz/api/health`. UptimeRobot or Better Stack
(free tiers) can post to the same Discord channel.

## How alerts behave

- Each condition has a key, shown in the post's footer. A key posts once, then at most once an hour
  while the condition lasts. It posts "Resolved: …" once the condition clears.
- The dedupe state is in Redis, so every pod shares it.
- A condition that flaps posts at most one alert and one "Resolved" an hour.
- The watchdog runs once a minute on the `api-scheduler` pod, under advisory lock 9204110. The other
  API pods stand by: if the scheduler pod's watchdog stops beating for a few minutes, one of them runs
  the checks instead. That's how "api-scheduler is down" gets reported.
- `WATCHDOG_ENABLED=false` turns the watchdog off. `WATCHDOG_ERROR_THRESHOLD` (default 20) sets the
  error-burst threshold.

## What each alert means

| Key | Fires when | First look |
| --- | --- | --- |
| `settlement-missing` | No completed `market_settlement_runs` row for the market day by 09:30 ET (30 minutes after `MARKET_SETTLEMENT_HOUR:MINUTE`). Silent while trading is paused by hand. | The scheduler logs on `api-scheduler`. Usually `scrape-incomplete` or `settlement-error` fired first and says why. |
| `settlement-error` | `market_runtime_state.last_cycle_error` is set, and still set after the scheduler's next retry. | The error text in the post. Trading stays open on the previous day. |
| `settlement-backoff` | Three or more settlement cycles in a row have failed. The scheduler now waits 2, 4, 8, 16, then 30 minutes between tries, instead of closing and reopening trading every minute. | Same as `settlement-error`. A pod restart resets the backoff and retries at once. |
| `scrape-incomplete` | After 01:20 ET, listed talents have no `youtube_channel_daily_stats` row for today. Settlement waits for every one of them. The ytscraper runs at `SCRAPE_AT_LOCAL_HOUR:MIN` (00:05 by default) and retries the channels still missing every `SCRAPE_RETRY_MINUTES` (60) until the day ends. The alert waits for the first retry, plus 15 minutes. | The post says what the scraper is doing. **Retrying**: it gives the next try's time, and leaves it alone. A used-up YouTube quota waits for the reset at midnight Pacific (03:00 ET). **No retry left today**, or **hasn't reported**: check the ytscraper logs (`scrape: … still missing stats`). Then fill the talent in with `ytscraper/cmd/backfill-missing-daily-stats`. |
| `scheduler-heartbeats` | A scheduler's heartbeat has been quiet for 3 minutes, a tick has stalled, or there has been no clean tick for that scheduler's limit (`SCHEDULERS` in `schedulerHealth.js`). The problem has to show on two checks in a row. Wire, Chatter and Exchange run on every API pod, which race for the lock, so a clean tick on any pod counts. A post listing every scheduler, the watchdog included, means `api-scheduler` is down. | The admin hub's Heartbeats panel, then `kubectl -n nasfaq get pods` and the pod's logs. |
| `api-errors` | More than `WATCHDOG_ERROR_THRESHOLD` unhandled errors (500 `internal_error`, or `unhandledRejection`) in 5 minutes, across all pods. Client errors (bad JSON, refused origins) don't count. | The latest error in the post, then the api-web logs. |
| `redis-unreachable` | The watchdog can't read heartbeats from Redis. | The `nasfaq-redis` pod. Chat and market events are down too. |
| `watchdog-checks` | A check couldn't run at all, usually because the database is unreachable. | The database. Uptime checks on `/api/health` should be failing too. |
