# Launching the redesign (`redesign/terminal-floor`) to production

A checklist for shipping the redesign branch: the new site, the art on the CDN, capsule prizes, the
hidden tick target, and the core market (weekly evaluation, real supply, buybacks). The normal
release path is in [releasing.md](releasing.md); this page lists what is specific to this launch.
Tick items off as you go.

Commands that touch production use `DATABASE_URL` set **in your shell only** (never in a committed
file); `api/.env` keeps the local database. AWS keys stay in the gitignored `api/.env`.

## 0. Before merging

- [ ] Branch is up to date with `origin/main` (it contains main as of Sep 20; re-check with
      `git fetch && git log --oneline HEAD..origin/main`, which should print nothing).
- [ ] `cd api && npm test` passes; `cd app-client && npx tsc --noEmit` is clean.
- [ ] Open the PR into `main` and let CI pass. Merging starts the production release.
- [ ] Decide on the economy (see "Playtest economy" below) and set the ConfigMap values in the same
      release if you're changing them.

## 1. Before the release (from your machine)

- [ ] **Art on the CDN.** After picking any new images:
      ```bash
      cd art-pipeline && py scripts/build.py --copy-to ../app-client/public/art
      cd ../api && node scripts/upload-art.js --dry-run   # then without --dry-run
      ```
      Includes the ticks 4koma, the FAQ Lamy and the "floor talks" podium once picked.
- [ ] **Capsule prize images** (CDN only, safe any time): `node scripts/seed-gacha-prizes.js upload`.
- [ ] **Art base URL.** The client image is built with
      `NEXT_PUBLIC_ART_BASE_URL=https://images.nasfaq.biz/art` (default in `app-client/Dockerfile`;
      it is a build-time value). Nothing to do unless the CDN moves.

## 2. The release

Merging to `main` runs `deploy/release.sh`: CI, images, the **migration Job** (`npm run migrate`),
then the rollout. The migration adds, all backward compatible with the old pods still running:

- notifications, exchange wishlist, profile banner column (earlier redesign work)
- the core market: `trading_state` on stocks; tables `weekly_evaluations`,
  `weekly_asset_evaluations`, `dividend_payouts`, `asset_buybacks`; drops the "cash can't be
  negative" and "held ≤ max" constraints (weekly fees and buybacks need both)
- a **one-time supply recount**: each stock's circulating supply becomes the shares players hold,
  the old daily share print is switched off (`base_emission = 0`), and max shares are raised only
  where players already hold more than the max. Runs once (skips itself afterwards).

Watch: migration Job completes, all Deployments roll out, `https://holo.nasfaq.biz/api/health` is OK.

**New Deployment: `api-games`.** Game tables (duels, high-low, blackjack) live in one process's
memory, and a starting process refunds every unfinished match. With two `api-web` replicas they
were split between pods, and any pod starting could refund a match another pod was still playing
(so it could pay twice). Now one pod owns them: `api-games` (1 replica, Recreate), the ingress sends
`/api/games` there, and every other API pod runs with `GAMES_TABLES_OWNER=false`. Games pushes
(tables, lobbies, the bell's notifications) go through Redis, so they reach a socket on any pod.
The old pods still own tables until they're replaced, so **release when no table is mid-game**
(Games → the lobbies show no playing tables). `PG_POOL_MAX` goes from 4 to 8 per pod (the 4 GB
database allows 97 connections). Capacity numbers: [`capacity.md`](capacity.md).

## 3. Right after the rollout

- [ ] **Supply recount.** Old pods may have filled orders between the migration and the rollout:
      ```bash
      cd api
      DATABASE_URL="$PROD_DATABASE_URL" node scripts/resync-supply.js         # lists stocks that are off
      DATABASE_URL="$PROD_DATABASE_URL" node scripts/resync-supply.js --fix   # only if it listed any
      ```
- [ ] **Capsule prizes in the database** (retires the old pool; players keep what they own):
      ```bash
      DATABASE_URL="$PROD_DATABASE_URL" node scripts/seed-gacha-prizes.js db --dry-run
      DATABASE_URL="$PROD_DATABASE_URL" node scripts/seed-gacha-prizes.js db --retire-others
      ```
- [ ] **Invariants** (admin): `GET /internal/market/invariants` shows no `asset_held_mismatch`,
      `asset_supply_invalid` or `negative_holding_quantity`.
- [ ] **Smoke test** in a browser (signed in, verified email):
  - [ ] front page, a stock page, How to play: talent art loads (from images.nasfaq.biz);
        `https://holo.nasfaq.biz/art-manifest.json` returns JSON
  - [ ] queue a small buy and a sell; both fill at the next 10-minute batch; the fill card shows
  - [ ] Market → Report: today's fair values are hidden ("secret until Overnight"), the last
        finished day's are shown; `curl -s https://holo.nasfaq.biz/api/market/report/daily/latest | grep -c fair_value`
        only counts the `revealed_targets` block
  - [ ] Market → Dividends shows "The first Dividend Review lands Saturday" and a countdown
  - [ ] the bell (notifications) opens; capsule gacha shows the new prizes
  - [ ] a stock page's Holders & supply panel shows held / for sale / max shares
  - [ ] two accounts sit at the same blackjack table (two browsers): both see each other's hands
        update live; `kubectl -n nasfaq get pods` shows one `api-games` pod

## 4. Before the first Saturday 00:00 ET

The first evaluation never sets a max below what players already hold, but it does pay dividends
and charge fees, and it sets max shares from subscribers.

- [ ] Preview it against production (read only: no row locks, rolled back):
      ```bash
      DATABASE_URL="$PROD_DATABASE_URL" node scripts/weekly-evaluation.js preview
      ```
      Check: the dividend and fee rates look sane (±10% at most), few or no stocks would sell out,
      nothing unexpected under "buyback".
- [ ] If max shares need tuning, set them in `deploy/k8s/05-configmap.yaml` and release:
      `MARKET_MAX_SHARES_MIN` / `MARKET_MAX_SHARES_MAX` (defaults 6000 / 30000). Other knobs:
      `MARKET_DIVIDEND_RATE_PER_SIGMA` (0.04), `MARKET_DIVIDEND_DEADZONE_SIGMA` (0.35),
      `MARKET_DIVIDEND_CAP` (0.10), `MARKET_BUYBACK_START` / `_DAILY_STEP` / `_FLOOR` (1.2 / 0.1 / 0.5).
      Rules: [docs/market/core-market.md](../market/core-market.md).
- [ ] Post in the thread / Discord what's coming (Saturday dividends, fees can put you in the red,
      sell-outs, buybacks). How to play → "Saturday: dividends" explains it.

## 5. The first Saturday

- The `api-scheduler` pod runs it at 00:00 ET (catches up for 36 hours if the pod was down). Its log
  says `weekly evaluation YYYY-MM-DD: N paying, N charging, N buybacks`.
- [ ] Market → Dividends shows the review; holders got a notification; the Wire has a
      "Dividend Review" item.
- [ ] Re-run `resync-supply.js` (should report nothing) and the invariants check.
- **If something is wrong:** an evaluation runs once per Saturday and is never re-run (a re-run
  would pay twice). To stop the next one, set `MARKET_WEEKLY_EVALUATION_ENABLED=false` in the
  ConfigMap and restart `api-scheduler`; fix forward.

## Rolling back

Application rollback is safe for the schema (only additions and dropped constraints). Two caveats
once the new code has run: players can have negative cash (the old code's prediction payouts refuse
to credit them), and a stock can be in a buyback (the old code ignores the freeze). Prefer fixing
forward after the first Saturday.

## Playtest economy

Max shares of 6,000–30,000 per stock only bite with a big player base. With a small playtest group
no stock will ever sell out or trigger a buyback, so those mechanics go untested. For a playtest,
consider `MARKET_MAX_SHARES_MIN=300` / `MARKET_MAX_SHARES_MAX=3000` (or whatever the preview shows
lands a handful of stocks near sold out), and raise them for the public launch.
