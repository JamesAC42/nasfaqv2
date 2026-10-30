# When something breaks

One page for the first ten minutes. The details are in [alerts.md](alerts.md) (what each Discord
alert means), [releasing.md](releasing.md) (releases and rollbacks), [moderation.md](moderation.md)
(people problems) and `docs/ops/production.md` (access, kept outside Git). Production commands below
run where the prod tools are installed: `wsl -d Ubuntu -- /home/james/.local/bin/kubectl --context nasfaq-prod -n nasfaq ...`.

## 1. Stop the damage (admin hub, `/admin`)

| If | Do |
| --- | --- |
| Prices, orders or balances look wrong | **Pause trading…** with a short reason. Queued orders wait; nothing is lost. Reopen from the same place. |
| Games are paying out wrong or stuck | **Games maintenance…** pauses PvP and blackjack tables. |
| One player is abusing something | **People & roles:** freeze their exchange or suspend them (writes stop, reads still work). |
| Chat or comments are being raided | Mute or ban from chat, hide comments; see moderation.md. |
| Players need to know | **Post announcement** (warning tone): shows on every open page within seconds. Say what's affected and that you're on it; clear it when fixed. |

## 2. Find out what's wrong

1. **Is the site up?** UptimeRobot on `https://holo.nasfaq.biz/api/health` (every 5 min) and the
   Discord alerts channel. Requests only reach the cluster through Cloudflare: if Cloudflare is
   fine but `/api/health` fails, it's the cluster or the database.
2. **Pods:** `get pods` (Running, Ready, restarts), then `logs deploy/api-web --since=15m --tail=200`
   (or `api-scheduler`, `api-games`). Add `--previous` for a pod that restarted.
3. **The admin hub's Heartbeats panel** shows which scheduler stopped (settlement, adjustments, live
   orders, weekly evaluation, IPO, predictions, exchange, Wire, chatter).
4. **Database:** read-only `psql "service=nasfaq-prod-ro"` (see production.md). `/api/health`
   failing everywhere at once usually means the database or its connection budget (105 max).
5. **Was it the last release?** `get deploy -o wide` shows the running image SHA; compare with the
   latest merge to main and its GitHub Actions deploy run.

## 3. Fix or roll back

- **A bad release:** roll the affected deployments back (`rollout undo deployment/NAME`, details in
  releasing.md), then revert the PR on main so the next release doesn't bring it back. Migrations
  don't roll back: check the old code works with the new schema first.
- **Settlement failed or is late:** the alert says why (usually `scrape-incomplete`). Fix the cause;
  the scheduler retries with backoff, and a restart of `api-scheduler` retries at once
  (`rollout restart deployment/api-scheduler`).
- **A stuck pod:** `rollout restart deployment/NAME`. The API drains for up to 20 s; web has 3
  replicas, so players see nothing. `api-scheduler` and `api-games` run one copy each and pause
  briefly.
- **An exploit already paid out:** pause what's affected, keep the evidence (usernames, times,
  amounts), and fix the bug before clawing anything back: adjustments go through compensating
  ledger entries, never deleted rows.
- **The site is down and you can't tell why:** pause trading if you still can, post an announcement
  if the site loads at all, and say so in Discord. A quiet hour is better than a wrong fix.

## 4. Afterwards

Reopen trading, clear the announcement, and write three lines in `docs/ops/production.md`: what
happened, what you did, and what would have caught it sooner. Tell players in Discord, and in the
changelog if they noticed.

## Don't

- Run the local API, scrapers or test scripts against the production database: they can migrate,
  settle or write.
- Edit `nasfaq-app-secrets` without restarting the API deployments afterwards (they read it at start).
- Release between 08:55 and 09:30 ET (settlement), Friday 23:00 to Saturday 01:00 ET (weekly
  evaluation), or while a rebuild runs.
- Delete rows to undo player-facing mistakes; use the admin tools or a reviewed script with a dry run
  (like `api/scripts/revert-ipo-listing.js`).
