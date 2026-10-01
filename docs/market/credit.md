# Credit and Cash (BBB's plan, phase 2, started)

BBB's proposal ("Credits, Taxes, and Fees", `docs/bbb-proposal.md`) splits money in two:

- **Cash** (BBB's "Liquid"; `portfolio_cash_balances.cash_balance`) buys shares. Sales pay it.
- **Credit** (`credit_balance`) is the buffer most other money lands in, and what the side modes
  spend. Part of it turns into Cash every Saturday.

So gambling spends Credit first while shares are bought with Cash: a player has to run through their
Credit before the tables touch their Cash, and dividends can't be slept on forever without the
weekly conversion's pacing.

BBB's split (October 1):

- **Cash only:** buying shares; later, licenses, donating superchats (which turns the Cash into
  Credit), creating contracts, and buying from the broker (bond contracts, market gambits).
- **Credit first, then Cash once it runs out:** taxes and fees on trading; minigames, gacha and
  gambling (predictions); player trading (the card exchange).

The code is `api/src/services/economy.js` (rules, `charge`, `pay`, the conversion). Every move
writes one ledger row with `cash_delta` and `credit_delta`.

## Where each flow lands

| Flow | Spends | Pays into |
|---|---|---|
| Buying shares | Cash (queued buys hold it: `trading.js`) | |
| Selling shares | | Cash, plus a little Credit (`sellCreditRate`) |
| Trading fee (1%) | Credit first, then Cash | |
| Games, capsule machine, card gacha (games wallet) | Credit, then Cash (`sideModeFunds`) | Credit; refunds go back where they came from |
| Card exchange: bids, buys, trade escrow | Credit, then Cash (`sideModeFunds`) | Credit (sales, a trade's cash); refunds go back where they came from |
| Predictions | Credit, then Cash (`sideModeFunds`) | Credit (payouts, sales); releases and void refunds go back where they came from |
| Dividends (Saturday) | | Credit |
| Share fees (Saturday) | Credit first, then Cash (can go below zero) | |
| Forced buybacks (Saturday) | | Cash (it's a share sale) |
| Weekly conversion (Saturday, after dividends): 5% or $10,000, whichever is more | Credit | Cash |
| Achievements | | Credit (`achievementRewards`) |
| New accounts, admin market reset | | Cash 10,000 and Credit (`ECONOMY_STARTER_CREDIT`) |

Shards stay their own currency.

**Refunds** (an outbid bid, a refunded stake, a cancelled trade, a released or voided prediction)
use `economy.refund`: Cash back up to what the player's Cash put into that thing (the ledger rows
sharing its reference, net of what already came back), the rest as Credit. So falling back on Cash
never quietly turns it into Credit. Winnings and sale proceeds are always Credit.

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
| Minigames, gacha, gambling, player trading | `sideModeFunds` (`ECONOMY_SIDE_MODE_FUNDS`: `credit` / `credit_then_cash`) | **Credit first, then Cash** (`credit_then_cash`) |

Still placeholders:

| Question | Setting (env) | Placeholder |
|---|---|---|
| How much does a new player start with? | `ECONOMY_STARTER_CREDIT`, `MARKET_STARTER_CASH` | 100,000 Credit and 10,000 Cash. BBB's proposal: Credit = the total of all base rates (about $896.56 now), Cash a tenth of that ($89.65); he's reworking the ratio. Game prices (a $100 card pull, $10-$10,000 blackjack) are sized for today's amounts and would need rescaling with a much smaller start. |
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
