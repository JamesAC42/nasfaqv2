# Predictions as pools, with margin (design)

Status: built behind the `prediction-pools` flag (`api/src/features`), at `staff` (2026-11-07). The
owner confirmed all five decisions below as recommended. §7 says what the build added or changed.

The ask, from a trusted v1 player via the owner: "V1 plus quality of life things, including
something like margin betting", meaning borrowing money and being allowed to go in the red.

Why change at all:

- Most v2 players are v1 regulars, and they liked v1's betting pools.
- The market maker (LMSR, `docs/predictions/PREDICTIONS_DESIGN.md`) is funded by the house, and the
  house loses when bettors know more than the price does. The November audit found the house down
  $5,966 on stream markets, mostly to one player (#109).
- In a pool, players pay players. The house can't lose, so nothing like #109's leak is possible.

## 1. Pools, like v1

v1's rules are in `NASFAQ/src/Bookmaker.ts`. v2 keeps them:

- **Who runs them.** A bookie opens a pool with a question, 2 to 100 options and a closing time
  from 2 minutes to 28 days ahead.
- **Betting.** Players stake money on an option. Bets can be raised, and a player can back more
  than one option. Bets can never be withdrawn.
- **Parimutuel payout with no rake.** When the bookie picks the winning option, everything staked
  on the pool is split among the winning side in proportion to stake. Write `P` for the pool total
  and `S_w` for the stake on the winner. A stake `s` on the winner pays `s × P / S_w`, and losing
  stakes pay nothing.
- **Rounding.** Payouts round down to the cent. The leftover, under a cent per winner, is recorded
  on the pool.
- **Refunds.** A void refunds every stake.

Example: a pool has $30,000 on A, $50,000 on B and $20,000 on C, so `P` is $100,000. If A wins, a
$6,000 stake on A pays $20,000 ($6,000 × 100,000 / 30,000).

Two fixes to v1:

- **Nobody backed the winner:** everyone is refunded. v1 kept the money.
- **One-sided pools:** if only one option has bets, everyone just gets their stake back.

## 2. Quality of life

- **Live odds and payout preview.** Each option shows its share of the pool and its multiplier
  (`P / S_k`, e.g. "3.33×"), live over the existing predictions websocket. The bet slip says what a
  stake would pay if the pool closed now: `x × (P + x) / (S_k + x)`. It also says plainly that
  odds keep moving until the pool closes.
- **Raising bets.** "Add to bet" on any option you've backed. The minimum bet and minimum raise is
  $1,000 (v1: $5,000). A bookie can set a higher minimum for a pool.
- **Who bet what.** Bets are public, as they were in v1. Each option lists its bettors and stakes.
- **Bookie tools.** A "My pools" panel shows totals, bettors per option and the time left. From it
  a bookie can:
  - close a pool early or extend its closing time (up to 28 days from opening);
  - duplicate a past pool;
  - resolve or void a pool.
- **A clear record of how each pool resolved.** A finished pool shows:
  - who resolved it and when;
  - the result, and the source link or note the bookie gave (one is required);
  - each option's final stake and multiplier;
  - any later correction or void, with the reason, as its own entry.
- **Notices.** You get a notification when a pool you bet on resolves (what you won, or that you
  lost), is voided (your refund), or is corrected (what changed). The existing notifications service
  sends them.
- **History.** `/predictions/history` lists every finished pool, newest first, with search. A
  "Pools I bet on" filter shows your net result on each. The portfolio page shows open stakes,
  margin owed and your margin line.

## 3. Margin

Margin lets a player bet more than they have. The borrowed part puts their Credit below zero, and
that is "in the red". All margin debt is negative Credit, so it already counts against net worth
and the leaderboard. The Saturday conversion only converts positive Credit.

**Who can borrow.**
- Accounts at least 7 days old, with a verified email, not suspended, and not already in the red.
- Bookies can't bet in their own pools at all.

**How much.**
- The margin line is 25% of the market value of the shares you hold, at current prices, up to
  $100,000.
- This is the design doc's "Coin-Backed Margin" (`PREDICTION_MARKET_DESIGN.md`), simplified to a
  flat 75% haircut. Shares only size the line, which keeps it to players with a stake in the market:
  nothing is sold or taken to repay it.

**How a bet draws money.** Credit first, then the margin line, and never Cash (the owner, 2026-11-09:
Cash stays untouched by anything but stocks).
- Margin is opt-in on each bet: the slip shows "Borrow up to $X" and a checkbox, off by default.
- Since borrowing makes Credit negative, you can only be borrowing on one bet at a time.

**In the red.**
- **Refused:** everything that spends Credit: new bets and raises, prediction buys, games, the capsule
  machine and card exchange spending.
- **Still allowed:** all stock trading, buys included (the owner, 2026-11-09: a debt affects net worth
  but never stops a player participating in the market), selling positions, cancelling orders, fees,
  and receiving money.
- **Repayment.** Every Credit payment repays the debt, because it lands on the negative balance: pool
  winnings, dividends, achievements, the little Credit a share sale earns. Cash never repays it.
- **No interest and no forced sales** for now. If share prices fall after you borrow, nothing
  happens until you sell.
- The same rules apply to Credit that a void already pushed below zero (#109): a debt is a debt.

Example: you have $2,000 Credit, $5,000 Cash and $80,000 in shares, so your line is $20,000. You bet
$15,000: $2,000 comes from Credit and $13,000 is borrowed, leaving Credit at −$13,000 and Cash at $5,000.
- Win a $30,000 payout and Credit goes to +$17,000.
- Lose, and you're in the red until $13,000 of Credit comes in. You can keep trading stocks meanwhile.

## 4. Existing LMSR markets

- **No new LMSR markets once pools ship.** The create form and the auto templates make pools.
- **Open LMSR markets keep trading and settle as they do now.** Auto ones end within a day. The
  LMSR code stays for them and for history, and a later PR can remove it once nothing open uses it.
- **Drafts and pending event markets** are recreated as pools by staff.
- **Auto pools.** Stream-peak becomes a YES/NO pool and tick-top-gainer an N-talent pool. The
  system opens and resolves them as now, and the result's data is the source.
- **Kept from #109:** `guards.js` checks every pool bet, so bets are refused once a stream starts
  or a tick lands. Tick-direction stays off. A void can still push Credit negative.

## 5. Currency

- **Credit,** same as predictions today. Bets spend Credit (`sideModeFunds`, Credit only since 2026-11-09), and
  winnings land in Credit.
- **Refunds** go back where the money came from (`economy.refund`), so a voided margin bet cancels
  its own debt.
- **Why not Cash:** it would pull money out of the share market and break BBB's split (gambling
  spends Credit, shares are bought with Cash).

## 6. Build outline

- **Data.** `prediction_markets.pricing` takes `lmsr` or `pool`, plus `pool_total` and `min_bet`.
  The outcomes table gets `pool_stake`, and outcome codes extend to o1–o100.
  - `market.prediction_pool_stakes` holds one row per user and option: stake, borrowed, payout.
  - `market.prediction_pool_bets` logs each bet and raise: from Credit, from Cash, borrowed.
  - New ledger types: `pool_bet`, `pool_payout`, `pool_refund` and `pool_payout_reversal`.
  - Migrations are appended to `applySchema`.
- **Roles.** A new `is_bookie` flag, granted from the admin users page. Admins count as bookies.
- **API.** Pool bet, raise and quote; bookie create, close, extend, resolve and void; staff correct;
  history; and the margin line in the portfolio.
  - The in-the-red block is one check in `economy.charge` (charges with no `shortfall`, so fees still
    go through). Stock orders don't pass through it.
- **Client.**
  - The pool page: options with odds, bettors and the bet slip.
  - The floor, with pool cards.
  - The bookie panel in `/predictions/manage`.
  - `/predictions/history`.
  - A red banner on the portfolio and bet slip when you're in the red.
- **Tests:**
  - payout math: proportional split, rounding, no winner backed, one-sided pools;
  - raises and multiple options;
  - margin limits: line from shares, ceiling, eligibility, opt-in;
  - negative balances: the block, repayment by Credit, stock trading staying open, the conversion skip;
  - voids before and after resolution, including a margin bet's debt;
  - guards on auto pools.

## 7. As built

- **The flag.** `api/src/features/prediction-pools.json` (the shared flags, see the README there)
  ships at `staff`, which means admins only. Bookies and prediction staff wait for `on` like
  everyone else. While pools are hidden from a player, nothing changes for them:
  - no pools on the floor;
  - the pool and margin routes return not-found (`requireFeature`), and so do pool comments and the
    generic close and void routes;
  - pool events on the predictions socket go only to viewers the flag covers;
  - the pages 404 (`requireFeature` in each page's server component);
  - none of the in-the-red rules apply. Credit a void pushed below zero works
    as before.
- **Auto pools** are their own templates, `stream-peak-pool` and `top-gainer-pool`. Both start off
  and carry #124's pause marker, so turning one on sticks. The market-maker templates stay as #124
  left them.
- **Retiring the market maker.** Once the flag is `on`, creating a market-maker market or turning
  one of their templates on is refused (`lmsr_retired`). Open ones finish as before.
- **Bookies.** `market.users.is_bookie` appears as "Bookie" on the admin people page.
- **Tables.** `prediction_pool_stakes`, `prediction_pool_bets` and `prediction_pool_resolutions`.
  The record is the last of these.
- **Pages.**
  - Each pool lives at `/predictions/pools/[slug]`, and an old link under `/predictions/` forwards
    there.
  - Finished pools are at `/predictions/history`, and the bookie tools at `/predictions/bookie`.
  - "My bets" gains a Pools section with margin.
- **Comments.** A stake counts as the position a player needs to post in a pool's thread.
- **Notices** reuse the won, lost and void kinds, including for corrections and no-winner refunds.
- **Tests.** `api/test/predictions-pools.test.js` covers:
  - payout math;
  - margin limits;
  - negative balances and repayment;
  - voids and corrections;
  - auto pools;
  - the flag.

## Decisions for the owner (all confirmed as recommended, 2026-11-06)

1. **Currency and sizes:** pools run on Credit and pay out in Credit. The minimum bet
   and raise is $1,000, and there's no rake. *Default: yes.*
2. **Bookies:** a new bookie flag that you grant. Bookies' pools open without approval and pay out
   the moment they resolve (with a source). Bookies can't bet in their own pools, and staff can
   correct or void a result within 7 days, which reverses payouts. *Default: yes.*
3. **LMSR:** no new LMSR markets. Open ones finish, stream-peak and top-gainer become auto pools,
   and tick-direction stays off. *Default: yes.*
4. **Who can bet and borrow:** a verified email to bet. Accounts under 7 days old can have at most
   $10,000 staked across open pools, since a pool moves money between players, as a PvP table does.
   Margin needs 7 days and a verified email. *Default: yes.*
5. **Margin size and the red:** the line is 25% of share value, up to $100,000, opted into per
   bet. In the red, you can't bet or spend Credit; only Credit repays it, never Cash; stock trading
   stays open (the owner changed these on 2026-11-09); and there's no interest and no forced sales.
