# NASFAQ games — design

Status: in build (September 2026). This is the working spec for the games rework: what each
system does, the numbers, and the money rules. Code comments point back here.

## Principles

- **Every game spends real in-game cash.** All debits and credits go through
  `services/games/wallet.js`, inside the same database transaction as the game state change, with a
  `market.ledger_entries` row per movement. A cash balance can always be reconciled from the ledger.
- **The server decides outcomes.** Randomness comes from `crypto` on the server. Clients send
  intents (pull, pick, hit, bet), never results.
- **Money is never stranded.** Stakes held for a multiplayer game sit in escrow on the match row.
  If the API restarts mid-game, unsettled matches and blackjack rounds are refunded at startup.
- **Sinks balance faucets.** Gacha, the 5% PvP rake, the blackjack house edge and 10% of Ticker Tap
  fees take cash out of circulation.

## 1. Talent cards and the card gacha

### Cards

Every listed talent has one card at each rarity, so the catalog is `talents × 5` and grows as
talents are listed. Card key: `card:{SYMBOL}:{rarity}`.

| Rarity | Name       | Base power | Drop rate | Shards on duplicate | Craft cost (shards) |
|--------|------------|-----------:|----------:|--------------------:|--------------------:|
| C      | Standard   | 10         | 55%       | 5                   | 50                  |
| R      | On stream  | 14         | 30%       | 15                  | 150                 |
| SR     | Outfit     | 19         | 11%       | 50                  | 500                 |
| SSR    | Idol       | 25         | 3.5%      | 200                 | 2,000               |
| UR     | Legend     | 32         | 0.5%      | 800                 | 8,000               |

- **Stars.** The first copy of a card is ★1. Each duplicate raises it one star up to ★5 and also
  pays the duplicate shards. Past ★5, duplicates pay double shards. Each star above ★1 adds +1 power
  in the card duel.
- **Art.** Card art comes from the art pipeline's manifest (`art-pipeline/dist/manifest.json`), keyed
  by talent and pose. Until a card has art, the site draws it from the talent's colour, oshimark and
  chibi slot. Rarity frames (foil for SSR, animated holo for UR) are CSS so art can drop in later.

### Banners

- **Standard banner.** Always on, every card in the pool.
- **Featured banner.** Time-boxed, one featured talent. When a pull lands SSR or UR, it is 50/50
  whether it's the featured talent's card of that rarity. Losing the 50/50 guarantees the next SSR+
  on a featured banner is the featured card.
- Pull costs: **$100** single, **$900** for ten.

### Pity (tracked per user per banner type)

- Every 10th pull is guaranteed SR or better.
- SSR+ soft pity: from pull 60 the SSR+ chance rises by 6 points per pull; pull 80 is guaranteed.
- A ten-pull runs the same per-pull logic ten times; pity and 50/50 carry across pulls.

### Shards, crafting, sets

- Shards are a per-user currency (`games.user_currencies`), earned from duplicates and set rewards.
- Craft any card in the pool for its craft cost. Crafted copies count like pulled copies (stars).
- **Unit sets.** For each unit: *Roster* (a card of every member, any rarity) pays 300 shards and a
  unit badge; *Spotlight* (every member at SR+) pays 1,500 shards and a unit frame. Rewards are
  claimed once, with a button, so the moment is visible.
- **Starter pack.** New collectors can claim 5 free C cards once, so everyone can play the duel.
- **Showcase.** Players pin up to 5 cards to their profile.

## 2. Cosmetic capsule (hats, frames, flair)

The existing capsule machine stays, with the same prize pool from `gachaprizes/` on the CDN, and
gains:

- ten-pull for $450 ($50 single, as before);
- pity: every 10th pull is guaranteed epic or better; pull 60 is guaranteed legendary;
- duplicates pay shards (common 3, rare 10, epic 40, legendary 150) instead of nothing.

## 3. Oshi Card Duel (2 players, staked)

- Each player brings **5 cards** from their collection (or the starter deck). Both decks are open:
  you see what your opponent brought.
- **Power** = base power by rarity + (stars − 1) + **momentum**. Momentum is the card's stock move
  today in whole percent, clamped to ±8, snapshotted when the match starts.
- Up to **5 rounds, first to 3 wins.** Each round reveals a **market condition**, then both players
  secretly pick one unused card (20 s timer; a random pick on timeout). Picks reveal together;
  higher power wins the round, and equal power is a tied round.
- Market conditions (one drawn per round, no repeats):

  | Condition         | Effect                                            |
  |-------------------|---------------------------------------------------|
  | Bull run          | +5 to cards whose stock is up today               |
  | Bear market       | +5 to cards whose stock is down today             |
  | Unit spotlight: X | +6 to members of unit X (from either deck)        |
  | Underdog          | +7 to the lower base-power card                   |
  | Whale day         | +4 to the higher-priced stock                     |
  | Volatility        | momentum counts double                            |
  | Quiet market      | momentum doesn't count                            |
  | Rookie night      | +5 to C and R cards                               |

- **Stakes.** The host sets the stake ($0 friendly up to $5,000). The joiner matches it. Both stakes
  are escrowed; the winner receives 95% of the pot (5% rake). A draw refunds both in full.
- Open tables expire after 10 minutes without an opponent (the host is refunded). The host can
  cancel before anyone joins.
- Anyone can spectate a table; picks stay hidden until both players lock in.

## 4. Blackjack table (up to 5 seats, against the house)

- Three standing tables: **Low** $10–$200, **Mid** $100–$2,000, **High** $1,000–$10,000.
- A 6-deck shoe, reshuffled past 75% penetration. The dealer hits soft 16, stands on all 17s.
- Blackjack pays 3:2, a win pays 1:1, and a push refunds the bet. You can double on your first two
  cards. No splitting or insurance in v1.
- Rounds: 15 s betting window → deal → each seat acts in order (15 s timer, auto-stand) → dealer →
  settle. Bets are debited when placed; payouts are credited at settle.
- Each round is recorded in `games.blackjack_rounds`. A round still open at startup refunds its bets.

## 5. High-low duel (2 players, staked)

- One shared, shuffled deck. Over **9 rounds**, the current card is face up and both players secretly
  call *higher* or *lower* for the next one (10 s timer; auto-pass on timeout).
- A correct call scores 1 point. If the next card has the same rank, nobody scores.
- Each player can **double down** once, making that round worth 2 (or −1 if wrong).
- The highest score wins 95% of the pot; a draw refunds both.

## 6. Ticker Tap v2 (single player, weekly pool)

- A $100 entry fee per run. A 45 s run of tickers popping across five lanes: tap **green** (up)
  tickers, avoid **red** ones, and catch rare **gold** tickers for a bonus. Speed ramps through the
  run, and combos multiply.
- The server generates the timeline from a seed. The client submits its tap log (`lane`, `t_ms`),
  and the server replays it against the timeline to compute the score, so claimed scores can't be
  forged.
- **Weekly pool:** 90% of the week's entry fees are split among the top 10 best runs (one entry per
  player) when the week ends (Monday 00:00 ET). The split is 30 / 20 / 12 / 9 / 7 / 6 / 5 / 4 / 4 / 3.
  Payouts are recorded in `games.weekly_prize_payouts` so settling is idempotent.

## 7. Multiplayer engine

- `services/games/tables/`: an in-process table manager holds live table state and timers. It is
  authoritative, and every money movement happens in a DB transaction before state advances.
- **HTTP** for anything that moves money or changes a seat (create, join, leave, bet, pick, act);
  a **WebSocket** at `/api/games/ws` pushes lobby and table state to players and spectators.
- The state sent to clients is the same for everyone except hidden information (duel picks before
  the reveal, the dealer's hole card), which is withheld until it's public.
- Single API process assumption: tables live in memory. If the API ever runs more than one process,
  table ownership moves to Redis.
