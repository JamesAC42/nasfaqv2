# HoloBets — Prediction Markets Player Guide

> *How the NASFAQ prediction markets work, and how to play them.*

---

## What Is a Prediction Market?

A prediction market lets you bet in-game cash on the outcome of a yes/no question. Each market is a binary event contract with two outcomes — **Yes** and **No**. You buy shares of the outcome you believe will happen. If you're right, each share pays $1.00 at settlement. If you're wrong, the shares expire worthless.

The price of a Yes share directly represents the market's implied probability. If Yes trades at $0.63, the crowd thinks there's a 63% chance the event happens. No naturally prices near $0.37 (1 − 0.63).

Every market runs through a lifecycle: created by a trusted user, approved by a reviewer, opened for trading, closed at the deadline, then resolved by a designated resolver who declares the winning outcome.

---

## Market Lifecycle — End to End

```lifecycle
Draft ──> Pending Approval ──> Open ──> Closed ──> Resolving ──> Resolved
                                                                   or
                                                                Voided
```

### 1. Draft
A user with **Creator** permissions drafts a market — writes the question, rules, resolution source, open/close times. Only the creator and admins can see it.

### 2. Pending Approval
The creator submits the draft for review. An **Approver** (different person from the creator) checks the wording, rules, and resolution criteria. They can approve or reject it.

### 3. Open
Approved markets open for trading at their scheduled `opens_at` time. Trading happens on a live order book. Anyone can trade while the market is open.

### 4. Closed
When `closes_at` arrives, the market closes automatically. No more orders. All open orders on the book are cancelled and reserved cash is refunded.

### 5. Resolving
After a cooldown period (`resolves_after`), a **Resolver** can declare the outcome. The system marks it `resolving` to signal an outcome is imminent.

### 6. Resolved
The resolver declares Yes or No as the winner. The system:
- Cancels any remaining open orders
- Pays $1.00 per winning share to holders
- Writes ledger entries for everything
- Zeros out positions

### Voided (alternative ending)
If the market question was ambiguous, the resolution source was unreliable, or something went wrong — an authorized voider can void the market. Everyone gets their original stake back (refunded at their average entry price), no one wins or loses.

---

## How Trading Works

### Orders

You place **limit orders** only (phase 1). A limit order says "I want to buy/sell X shares at price Y or better."

Every order has:
- **Outcome**: Yes or No
- **Side**: Buy or Sell
- **Price**: 0.01 to 0.99 (in cents: 1c to 99c)
- **Quantity**: Number of shares

### Buying Yes at $0.55

If you buy 100 Yes shares at $0.55:
- $55.00 is reserved from your cash balance
- If matched, you get 100 Yes shares at average cost $0.55
- At settlement: Yes wins → you get $100 ($45 profit). No wins → $0 ($55 loss).

### Buying No

Buying No at $0.45 is equivalent to betting against Yes at a 45% implied probability. Same mechanics, opposite outcome.

### Selling

You can sell shares you already hold. Selling Yes means you're offering your Yes shares to someone who wants to buy them. A sell order must be backed by shares you actually own — no shorting in phase 1.

### The Matching Engine (How Orders Find Each Other)

When you place an order, the engine checks for matching orders on three possible paths:

**1. Secondary match (same outcome, opposite side)**
You want to buy Yes at $0.60. There's a resting sell order for Yes at $0.58. The engine matches you at $0.58 (the better price). You buy Yes shares, the seller sells Yes shares. Simple bid/ask match.

**2. Mint match (cross-outcome buys)**
You want to buy Yes at $0.60. Someone else is resting a buy order for No at $0.35. The engine matches you both — creating Yes shares for you and No shares for them simultaneously. This is called a "mint" because new shares are created from nothing when a Yes buyer and No buyer agree on complementary prices.

**3. Redeem match (cross-outcome sells)**
You want to sell Yes at $0.60. Someone else is resting a sell order for No at $0.35. The engine matches you, both positions are reduced. This is called a "redeem" — shares are destroyed because both sides are closing out.

The engine always picks the best available price for you, whether it comes from the same-outcome book or the opposite-outcome book.

### Price-Time Priority

Orders match in this order:
1. Best price first (highest bid / lowest ask)
2. Oldest order wins ties (first in, first out)

This is how real financial exchanges work. If you offer a better price than everyone else, you get matched first.

### Order States

- **Open**: Resting on the book, waiting to be matched
- **Partially filled**: Some quantity matched, rest still on the book
- **Filled**: All quantity matched
- **Cancelled**: You cancelled it on purpose
- **Expired**: Market closed while the order was still on the book

---

## Order Book

Each market has a live order book showing:

| Side | Meaning | Example |
|------|---------|---------|
| **Yes bids** | People offering to buy Yes | 500 sh @ $0.55 |
| **Yes asks** | People offering to sell Yes | 300 sh @ $0.62 |
| **No bids** | People offering to buy No | 400 sh @ $0.38 |
| **No asks** | People offering to sell No | 200 sh @ $0.45 |

The **spread** is the gap between the best bid and best ask. A tight spread means a liquid market.

The **last traded probability** updates whenever a trade executes and shows you where the market last cleared.

---

## Settling a Position

When a market resolves, here's how your P&L works:

| Scenario | Yes won | No won |
|----------|---------|--------|
| You held Yes @ $0.55 | +$0.45/share | -$0.55/share |
| You held No @ $0.40 | -$0.40/share | +$0.60/share |

Your **realized P&L** is tracked per position. It updates when you sell shares or when the market resolves.

---

## Comments & Discussion

After a market opens for trading, only stakeholders (users who hold at least one share of any outcome) can post comments. Each comment displays your current stake — showing other traders you have skin in the game.

Your net worth rank is also shown beside comments if available.

---

## Fees

Currently fees are set to 0% (charge disabled in the code but configurable). If activated:
- Maker fee: 0% to 0.5% (you get paid for adding liquidity)
- Taker fee: ~1% (you pay for taking liquidity)

---

## Roles & Permissions

Not everyone can create, approve, or resolve markets. These are controlled by admin-managed flags on your user account.

| Role | What you can do |
|------|----------------|
| **Creator** | Draft new markets and submit them for review |
| **Approver** | Approve or reject pending markets. Cannot approve your own markets |
| **Resolver** | Declare the winning outcome of closed markets |
| **Voider** | Void markets that were ambiguous or erroneous |

Regular players can trade any open market and comment on markets where they hold shares.

---

## Strategy Tips

**Understand implied probability.** If Yes is at $0.85, the market is 85% confident. That means the payout is small if you're right (15c per share) but the loss is big if you're wrong (85c). Low-probability bets ($0.10 Yes) are risky but pay 90c per share if you're right.

**Watch the spread.** Markets with wide spreads have low liquidity. Your order might not fill immediately, or might fill at a worse price.

**Use limit orders, not market orders.** Since phase 1 only supports limit orders, you control your entry price. A buy at $0.50 won't execute unless someone is selling at $0.50 or lower.

**The order book reveals sentiment.** A wall of Yes bids at $0.55 means there's support at that price level. A thin ask side means sellers are scarce — prices might move up.

**Cross-outcome matching is your friend.** Sometimes your Yes buy matches a No resting buy (mint) instead of a Yes sell. This can give you a better price than the same-outcome book would — the engine always picks the best option.

**Watch the close time.** If you're holding shares when a market closes, they're locked until resolution. You can't sell them anymore. If you want to exit early, do it before the deadline.

**Void protection.** If a market is voided, you get your original purchase price back — not a loss. This protects against bad markets.
