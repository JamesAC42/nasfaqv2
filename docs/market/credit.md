# Credit and Cash (BBB's plan, phase 2, started)

BBB's proposal ("Credits, Taxes, and Fees", `docs/bbb-proposal.md`) splits money in two:

- **Cash** (BBB's "Liquid"; `portfolio_cash_balances.cash_balance`) buys shares. Sales pay it.
- **Credit** (`credit_balance`) is the buffer most other money lands in, and what the side modes
  spend. Part of it turns into Cash every Saturday.

So gambling spends Credit while shares are bought with Cash, and the two don't cross: a player who
only plays the games can't lose their bags at the tables, and dividends can't be slept on forever
without the weekly conversion's pacing.

The code is `api/src/services/economy.js` (rules, `charge`, `pay`, the conversion). Every move
writes one ledger row with `cash_delta` and `credit_delta`.

## Where each flow lands

| Flow | Spends | Pays into |
|---|---|---|
| Buying shares | Cash (queued buys hold it: `trading.js`) | |
| Selling shares | | Cash, plus a little Credit (`sellCreditRate`) |
| Trading fee (1%) | Credit first, then Cash | |
| Games, capsule machine, card gacha (games wallet) | Credit (`sideModeFunds`) | Credit |
| Card exchange: bids, buys, trade escrow | Credit (`sideModeFunds`) | Credit |
| Predictions | Credit (`sideModeFunds`) | Credit |
| Dividends (Saturday) | | Credit |
| Share fees (Saturday) | Credit first, then Cash (can go below zero) | |
| Forced buybacks (Saturday) | | Cash (it's a share sale) |
| Weekly conversion (Saturday, after dividends): 5% or $10,000, whichever is more | Credit | Cash |
| Achievements | | Credit (`achievementRewards`) |
| New accounts, admin market reset | | Cash 10,000 and Credit (`ECONOMY_STARTER_CREDIT`) |

Shards stay their own currency.

## The rules, and what's still open

Every number and choice is in one place, `SETTINGS` in `api/src/services/economy.js` (plus the
starter Credit in `portfolioCash.js`), each overridable with an env var. The client reads the rules
in force from the portfolio (`economy`).

BBB answered (October 1):

| Question | Setting (env) | Now |
|---|---|---|
| Does Credit count toward net worth and the leaderboard? | `netWorth` (`ECONOMY_NET_WORTH`: `cash` / `cash_and_credit`) | **Yes** (`cash_and_credit`). Leaderboard cash columns stay Cash only; Credit goes into the totals, and all-time change starts from starter Cash plus starter Credit. |
| Weekly conversion rate before licenses | `weeklyConversionRate` (`ECONOMY_WEEKLY_CONVERSION_RATE`, capped at 0.5) | **5%** (5-10%, to tune after a few rounds) |
| A minimum conversion | `weeklyConversionMinimum` (`ECONOMY_WEEKLY_CONVERSION_MINIMUM`) | **$10,000**: "5% or $10k, whichever is more". A balance under $10,000 converts entirely, so the floor can go past the 50% cap. |
| Fees when Credit runs out | (code: `weeklyEvaluation.js`) | **Pull from Cash** for the difference (Cash can go below zero) |
| Games and the exchange (auctions) | `sideModeFunds` (`ECONOMY_SIDE_MODE_FUNDS`: `credit` / `credit_then_cash`) | "Primarily in credit": still **Credit only**. If he means Cash should top them up when Credit runs out, switch to `credit_then_cash`. |

Still placeholders:

| Question | Setting (env) | Placeholder |
|---|---|---|
| How much Credit does a new player start with? | `ECONOMY_STARTER_CREDIT` | 100,000 (BBB's 10:1 ratio to today's 10,000 Cash) |
| Credit a sale earns ("a small % of that coin's tax value") | `sellCreditRate` (`ECONOMY_SELL_CREDIT_RATE`) | 0.01 of the sale's value |
| Achievement rewards: Credit, Cash or both? | `achievementRewards` (`ECONOMY_ACHIEVEMENT_REWARDS`) | Credit |

Player-facing copy that states the rules (How to play, the glossary, the FAQ, the changelog) quotes
5% and $10k and says Credit counts toward net worth; change it with the settings.

## Not yet

- Licenses (raising the conversion rate, unlocking side modes).
- Superchats (BBB: issuing one gives Credit).
- Showing a player's own Credit history (the ledger has it; nothing reads it yet).

## Giving existing accounts Credit

New accounts and the admin market reset get starter Credit. Accounts that already exist when this
ships start with 0. Either reset the market from the admin page, or run (adjust the amount):

```sql
UPDATE market.portfolio_cash_balances SET credit_balance = 100000 WHERE credit_balance = 0;
```
