# Resetting the market

A full reset wipes what players own and earned and rebuilds prices from the YouTube data. Use it
before launch or after a playtest, never on a live market people play for real. The code is
`marketAdmin.resetMarketState` and `api/scripts/rebuild-market.js`.

## What goes and what stays

| Goes | Stays |
| --- | --- |
| Trades, orders, holdings, the ledger, Cash and credit (everyone gets the starter amounts again) | Accounts: logins, sessions, emails, roles, suspensions |
| Price history, settlements, dividends, weekly evaluations, buybacks, fundamentals (all rebuilt) | Profiles: name, bio, picture, banner, colour, oshi |
| Leaderboards, net-worth history, trade streaks, achievements earned | Friends and rivals |
| Every prediction market, with its trades, positions and comments (the auto templates make new ones) | The stocks and their tuning (emission, spread, adjustment bounds) |
| Cards, pulls, pity, the card exchange, game currencies and shards, cosmetics, prize claims and payouts, game history | Catalogues: card banners, gacha prizes, games, achievements, emojis |
| IPO subscriptions | IPO events and their listings, so a scheduled IPO still happens |
| Notifications | Moderation history (mutes, bans, the admin log) and bug reports |
| With `--community`: chat messages and their reports, comments and votes, article likes and saves, article proposals | HoloNews articles, the Wire, chat rooms and who follows them |

A paused market stays paused through the reset and rebuild, so you can check before reopening.

## Locally

```
node scripts/rebuild-market.js --reset --dry-run      # counts what would go; changes nothing
node scripts/rebuild-market.js --reset --yes          # add --community to clear chat and comments
```

`--reset` refuses any database that isn't on this machine unless you add `--allow-remote-reset`.

## Production

Run it as a one-off Job with the API image, like the release's migrate Job, never from a laptop
(see production.md for access):

1. In `/admin`, **Pause trading** (say it's a reset) and turn on **Games maintenance**.
2. Run a Job with `node scripts/rebuild-market.js --reset --community --dry-run --allow-remote-reset`
   and read the counts.
3. Scale `api-scheduler` to 0: the rebuild needs its lock, and nothing should settle or pay out
   halfway through.
4. Run the same Job with `--yes` in place of `--dry-run`. The rebuild took 34 minutes for 272 days
   in September 2026; it grows with the history.
5. Scale `api-scheduler` back to 1 and restart `api-web` and `api-games` (they cache prices and
   game state in memory).
6. Check a few stocks, a portfolio and the leaderboard, then reopen trading and games in `/admin`.

If the rebuild fails after the reset, the reset has already happened: fix the cause and run
`rebuild-market.js --yes` (without `--reset`) to rebuild prices again. Avoid running it from 08:55
to 09:30 ET (settlement) or from Friday 23:00 to Saturday 01:00 ET (weekly evaluation).
