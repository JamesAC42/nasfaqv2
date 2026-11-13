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
| Games, capsule machine, card gacha (games wallet) | Credit only (`sideModeFunds`). Pulls, entry fees and stakes stop under the net worth floor (`sideModeMinNetWorth`, `services/sideModeFloor.js`) | Credit; refunds go back where they came from |
| Blackjack | Credit only, with its own limits (`services/games/tables/blackjackLimits.js`) and the same floor | Credit; refunds go back where they came from |
| Card exchange: bids, buys, trade escrow | Credit only (`sideModeFunds`). Buys, bids and trade offers stop under the net worth floor; selling stays open | Credit (sales, a trade's cash); refunds go back where they came from |
| Predictions | Credit only (`sideModeFunds`). Buys, limit orders and pool bets stop under the net worth floor | Credit (payouts, sales); releases and void refunds go back where they came from. A void also takes back what a player made selling, as Credit (can go below zero) |
| Dividends (Saturday) | | Credit |
| Margin on prediction pools | Credit only, going below zero. The debt counts against net worth and never stops stock trading | Only Credit pays it back, never Cash |
| Share fees (Saturday) | Credit first, then Cash (can go below zero) | |
| Forced buybacks (Saturday) | | Cash (it's a share sale) |
| Weekly conversion (Saturday, after dividends): 5% or $10,000, whichever is more | Credit | Cash |
| Auto-bailout (Saturday, last) | | Cash and Credit (see below) |
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
| Minigames, gacha, gambling, player trading | `sideModeFunds` (`ECONOMY_SIDE_MODE_FUNDS`: `credit` / `credit_then_cash`) | **Credit only** (`credit`; the owner, 2026-11-09, so losing at a side mode can't leave a player with no Cash to trade) |
| Net worth under which games, capsules and bets close | `sideModeMinNetWorth` (`ECONOMY_SIDE_MODE_MIN_NET_WORTH`) | **$50,000** (BBB and the owner, 2026-11-09) |

| Who gets an auto-bailout, and how much | `bailoutCash`, `bailoutCredit`, `bailoutActiveDays` (`ECONOMY_BAILOUT_CASH`, `ECONOMY_BAILOUT_CREDIT`, `ECONOMY_BAILOUT_ACTIVE_DAYS`) | **$1,000 and $1,000, seen in the last 14 days** (see below). `ECONOMY_BAILOUT_ACTIVE_DAYS=0` turns it off |

Still placeholders:

| Question | Setting (env) | Placeholder |
|---|---|---|
| How much does a new player start with? | `ECONOMY_STARTER_CREDIT`, `MARKET_STARTER_CASH` | 100,000 Credit and 10,000 Cash. BBB's proposal: Credit = the total of all base rates (about $896.56 now), Cash a tenth of that ($89.65); he's reworking the ratio. Game prices (a $100 card pull, $10-$10,000 blackjack) are sized for today's amounts and would need rescaling with a much smaller start. |
| Credit a sale earns ("a small % of that coin's tax value") | `sellCreditRate` (`ECONOMY_SELL_CREDIT_RATE`) | 0.01 of the sale's value |
| Achievement rewards: Credit, Cash or both? | `achievementRewards` (`ECONOMY_ACHIEVEMENT_REWARDS`) | Credit |

Player-facing copy that states the rules (How to play, the glossary, the FAQ, the changelog) quotes
5% and $10k, says Credit counts toward net worth, and quotes the auto-bailout's $1,000 and $1,000 and
its two weeks; change it with the settings.

## The auto-bailout

BBB, relayed by the owner (November 2026): a small amount of Cash and Credit "to get somebody's foot
back in the door if they have no shares and no money to buy shares with". It's the last safety net
under Credit-only side modes and the net worth floor, for anyone who still finds a way to brick an
account. Some players will lean on it to gamble, and BBB and the owner accepted that, so it has no
anti-abuse rules. The code is `api/src/services/autoBailout.js`.

**When.** At the Saturday review, in its transaction, after the fees, forced buybacks, conversion and
new max shares. A date's review runs once, so it pays once, and a preview writes nothing. An on-demand
(playtest) run pays nobody and only reports who would qualify. If one runs on a Saturday it takes
that date, so there's no real review and no bailouts that week.

**Bricked.** The player's shares, Cash and Credit are each worth less than one share of the cheapest
stock they could buy, fee included (about $5.12 in November 2026; a frozen or sold-out stock doesn't count):

| Balance | What counts |
|---|---|
| Shares | Stocks that trade, at their mid price. A leftover fraction doesn't block it, and a halted or delisted stock can't be sold, so it doesn't either |
| Cash | Spendable plus `held_cash`: queued buys and IPO subscriptions are on their way into shares or back |
| Credit | Whatever the conversion left. It keeps converting each Saturday, so that player gets back on their own, and clearing a Cash debt for them would be a windfall |

Open prediction positions and cards aren't counted, on purpose. Net worth doesn't count them either,
they can't buy a share today, and the cost of being wrong is a small payment rather than a stuck player.

**Who.** A verified email, no suspension, and a visit within `bailoutActiveDays` of the review
(`market.user_active_days`). There's no cooldown: the money can only go into shares (it leaves them far
under the floor), and holding it means they don't qualify next week.

**How much.** Cash goes up to `bailoutCash`, which clears anything share fees took below zero, and
`bailoutCredit` is added. Credit below zero (margin, a void) shrinks by that much and isn't forgiven,
because only Credit pays it back and buying shares doesn't need Credit. Cash is never set below twice
the cheapest share, so the player can always buy one. They end up with about $2,000.

**Records.** One ledger row a player (`weekly_bailout`, referencing the evaluation), a notification
pointing at the market, and totals in the report's `auto_bailout` block, which the review, the admin
preview and `scripts/weekly-evaluation.js preview` all show. `qualified` counts everyone the rules
cover, and `players` counts who's paid (none in an on-demand run).

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
