# Mahjong: design and rule sheet

Four-player Japanese (riichi) mahjong, played live on the games socket. Behind the `mahjong` feature
flag (`api/src/features/mahjong.json`). Code: `api/src/services/games/mahjong/`,
`api/src/routes/mahjong.js`, `app-client/app/components/games/mahjong/`, pages under
`/games/mahjong`.

This file is the rule sheet the engine is written against, then the table manager, the competition
formats, the spectator rules and the money rules. Riichi mahjong is a traditional game; the rules
below are the common online defaults ("ari-ari"), chosen where sets differ and listed so nobody has
to guess.

## 1. The game

- Four seats, 136 tiles: characters (man), circles (pin) and bamboo (sou) 1 to 9, four winds, three
  dragons, four of each. One five in each suit is red.
- **East-only** (one wind round, at least four hands) or **East-South** (two wind rounds).
- Everyone starts on **25,000** points. A game is over after the last scheduled hand if anyone has
  **30,000** or more. Otherwise it goes on into the next wind round (South after East-only, West
  after East-South) and stops at the end of the first hand that leaves someone on 30,000 or more, or
  at the end of that extra round.
- **Bust:** the game ends at once when a hand leaves anyone below zero. Exactly zero plays on.
- **The dealer stays** (renchan) after winning, after being tenpai at an exhaustive draw, and after
  any abortive draw. Otherwise the deal passes. A counter (honba) goes on the table every time a hand
  ends without the deal passing or in a draw; it clears when a non-dealer wins.
- **Last hand:** if the dealer wins the last scheduled hand (or is tenpai when it draws) and is in
  first place with 30,000 or more, the game ends there.
- **Final standing:** by points; a tie goes to whoever sat closer to the first dealer. Riichi sticks
  left on the table go to first place. The final score is `(points − 30,000) / 1,000` plus the
  placement bonus: **+15 / +5 / −5 / −15**, and first place also takes the 20 that the four 5,000
  buy-ins leave (so +35 in all). Scores sum to zero.

### The wall

- Each game has one 32-byte seed. Its SHA-256 is published when the game starts (`seed_hash`) and
  the seed itself when the game is over, on the replay page.
- The wall for hand `n` (counting every hand dealt, from 0) is a Fisher-Yates shuffle of tile ids
  0 to 135 driven by SHA-256 blocks of the text `<seed as 64 hex characters>|n|counter`, four bytes per draw,
  rejecting values that would bias the result (`mahjong/wall.js`). Anyone can run it again.
- Tiles are dealt from the front. The last 14 are the dead wall: four replacement tiles, then five
  dora indicators, then the five ura indicators under them. There are no dice; the seed already
  decides everything dice would.
- Tile id `t` is tile kind `t >> 2` (0 to 8 man, 9 to 17 pin, 18 to 26 sou, 27 to 30 East South West
  North, 31 white, 32 green, 33 red). Ids 16, 52 and 88 are the red fives.

### Calls

- **Chi** from the player on your left only; **pon** and **open kan** from anyone. **Closed kan** and
  **added kan** on your own turn. Priority on one discard: ron, then pon or kan, then chi.
- **No swap-calling:** after a chi or pon you can't discard the same kind of tile you just took, or
  the tile at the other end of a run you just completed (taking 4 for 2-3 and throwing the 1).
- **Kan dora:** a closed kan turns its indicator at once. An open or added kan turns it after the
  discard that follows (or before the next kan, or before scoring if the replacement tile wins).
- **Four kans:** a fifth kan is never allowed. If the four belong to more than one player the hand is
  an abortive draw once the fourth kan's discard goes by.
- **Robbing a kan:** an added kan can be won on (chankan). A closed kan can't, not even for thirteen
  orphans.
- **Kan in riichi:** only a closed kan of the tile just drawn, and only when it doesn't change what
  the hand waits on or how it reads.
- No kan when the wall is empty, and nothing but ron on the last discard.

### Riichi

- Closed hand, tenpai, at least 1,000 points, and at least four tiles left to draw. It costs a
  1,000-point stick, which the next winner takes.
- The stick is paid only if the riichi discard isn't won on.
- **Double riichi** on your first discard, if nobody has called. **Ippatsu** for winning before your
  next discard, unless anyone calls in between.
- After riichi every draw you don't win or kan on is discarded.

### Winning and furiten

- You need at least one yaku. Dora are not yaku.
- **Furiten.** You can't win on a discard (you can still self-draw) when:
  - any tile you're waiting on is among your own discards, including ones other players took;
  - a tile you were waiting on was discarded this go-around and you didn't win on it, until your next
    discard;
  - in riichi, a tile you were waiting on went by: for the rest of the hand.
- **Several winners.** If two or three players win on the same discard, every one of them is paid
  (no head bump, and no draw for three). Each gets the honba bonus; the riichi sticks on the table go
  to the winner next in turn after the discarder.
- **Responsibility (pao).** If you feed the pon or open kan that completes a visible big three
  dragons or big four winds, you pay the whole of a self-drawn win and half of a win on someone
  else's discard.

### Draws

- **Exhaustive draw** (the wall runs out): players who are tenpai receive, and those who aren't pay,
  3,000 in total (1,000/1,500/3,000 by how many are tenpai). Waiting only on tiles you hold all four
  of is not tenpai. Tenpai hands are shown.
- **Nagashi mangan:** at an exhaustive draw, a player whose discards were all terminals and honors,
  and none of them called, is paid a mangan as if self-drawn, in place of the tenpai payments. It
  counts as a draw for the deal and the counters.
- **Abortive draws:** nine different terminals and honors in your first draw with no calls before it
  (your choice); the same wind discarded by all four on the first go-around; all four in riichi; four
  kans by more than one player. No points move; the dealer stays and a counter is added.

### Yaku

Open hands lose one han where marked (−1), and can't use the ones marked closed.

| Han | Yaku |
|-----|------|
| 1 | Riichi (closed), Ippatsu (closed), Fully concealed hand: self-draw (closed), Pinfu (closed), Pure double sequence: iipeikou (closed), All simples: tanyao (open allowed), Value tiles: yakuhai (seat wind, round wind, each dragon), After a kan: rinshan kaihou, Robbing a kan: chankan, Under the sea: haitei (last draw), Under the river: houtei (last discard) |
| 2 | Double riichi (closed), Seven pairs: chiitoitsu (closed, 25 fu), Mixed triple sequence: sanshoku doujun (−1), Pure straight: ittsu (−1), Half outside hand: chanta (−1), All triplets: toitoi, Three concealed triplets: sanankou, Triple triplets: sanshoku doukou, Three kans: sankantsu, All terminals and honors: honroutou, Little three dragons: shousangen |
| 3 | Half flush: honitsu (−1), Fully outside hand: junchan (−1), Twice pure double sequence: ryanpeikou (closed) |
| 6 | Full flush: chinitsu (−1) |
| Yakuman | Thirteen orphans (kokushi musou), Four concealed triplets (suuankou), Big three dragons (daisangen), Little four winds (shousuushii), Big four winds (daisuushii), All honors (tsuuiisou), All terminals (chinroutou), All green (ryuuiisou), Nine gates (chuuren poutou), Four kans (suukantsu), Blessing of heaven (tenhou), Blessing of earth (chiihou) |

- Every yakuman is worth one limit; different yakuman in one hand add up. There are no double
  yakuman for special waits.
- 13 han or more from ordinary yaku and dora counts as a yakuman (kazoe).
- Not used: renhou, open riichi, local yaku, rounding 4 han 30 fu up to mangan.

### Scoring

- **Fu:** 20 to start. +10 for a closed win on a discard. +2 for a self-draw (not with pinfu). Pair of
  dragons, seat wind or round wind +2 (+4 when it is both winds). Edge, middle and single waits +2.
  Triplets: open 2, closed 4, doubled for terminals and honors; kans are four times a triplet. A
  triplet finished by ron counts as open. An open hand worth only 20 counts as 30. Seven pairs is 25.
  Round up to the next 10.
- **Points:** base = fu × 2^(han + 2), capped: mangan 2,000 (5 han, or 4 han 40 fu, or 3 han 70 fu),
  haneman 3,000 (6-7), baiman 4,000 (8-10), sanbaiman 6,000 (11-12), yakuman 8,000 each. A
  non-dealer's ron pays base × 4, a dealer's base × 6; on a self-draw the dealer pays base × 2 and the
  others base × 1 (everyone base × 2 to a dealer). Each payment rounds up to the next 100.
- **Honba:** 300 per counter on a ron, 100 from each player on a self-draw.
- The hand is read the way that scores most.

## 2. The table

- **Authority.** The server holds the wall and every hand. A client sends what it wants to do
  (discard this tile, call, pass); the engine checks it against the legal moves and applies it. No
  result ever comes from a client.
- **What each viewer gets.** A player gets their own hand, their own legal moves and the public
  table: discards, calls, dora indicators, scores, riichi, how many tiles are left. Everyone else's
  hand is a count. Spectators get the public table only. Hands are shown when the rules show them (a
  win, tenpai at a draw). The full record, every hand and the seed, is published when the game is
  over.
- **Channels** on `/api/games/ws`: `mahjong:{id}` (public table), `mj-seat:{token}` (one seat's
  private view; the token is handed to that player over HTTP and is the only thing that opens it),
  `lobby:mahjong`, `reactions:mahjong:{id}`, `mahjong-tournament:{id}`. Moves go over HTTP.
- **Clock.** Each move has a few seconds plus a time bank that refills every hand (standard: 7 s and
  20 s; relaxed: 20 s and 40 s). When it runs out the drawn tile is discarded and calls are passed.
- **Away seats.** Two timeouts in a row, or leaving, puts the seat on autopilot until the player
  acts again. On free tables autopilot is a bot. On paid tables it only discards what it draws, so
  walking away can never beat playing.
- **Reconnecting** is just loading the page: the seat view is the whole state.
- **Bots** (`mahjong/bot.js`) fill empty seats on free tables: three levels, all playing from what a
  player in that seat can see. A table that started with a bot seat never pays anyone anything.
- **Restarts.** Tables live in the memory of the process that owns game tables. Games unfinished at
  startup are cancelled and their entry fees refunded.

## 3. Ways to play

| Kind | Seats | Rated | Money |
|------|-------|-------|-------|
| Tutorial, practice | you and three bots | no | none |
| Quick match | open seats; bots fill after a wait | yes | none |
| Friend room | by link; the host starts, bots optional | no | none |
| Stakes table | four players, no bots | yes | entry fee into a fixed prize table |
| Tournament table | set by the bracket | yes | the tournament's |

- **Rating.** Everyone starts each season on 1,500. After a rated game each player's rating moves by
  how they placed against each of the other three (`K` = 32, less after 30 games). Bots have fixed
  ratings (1,300, 1,450, 1,550) and theirs never move, so beating bots stops paying once a player is
  rated above them, and losing to them costs more the higher they are.
- **Ranks** are names for rating bands. **Seasons** are calendar months (New York time); a new season
  starts each player halfway back to 1,500.
- **Tournaments.** Staff create them: a name, seats (4, 8 or 16), a start time, a game length, an
  entry fee (or none) and optionally weekly repeat. Sign-up is open until the start. Knockout: four
  to a table, top two go through, down to one final table. Seats nobody took are filled by bots, and
  a tournament with a bot in it is free: every fee is refunded and no prize is paid.

## 4. Watching

- Anyone, signed in or not, can open a live table. Spectators see the public table with no delay.
  They are never sent a hidden tile, so there is nothing a spectator could pass to a player.
- Signed-in, verified viewers can send reactions and talent stamps from a fixed list, cheer a seat,
  and pick who wins the game (free, before the second hand starts). Picks are counted on a leaderboard
  and never pay.
- Replays open to everyone once a game is over: every hand, every move, all four hands face up, and
  the seed.

## 5. Money

The rules every side mode follows (`docs/market/credit.md`, `services/sideModeFloor.js`) apply as
they are: Credit only, never Cash; no spending under the net worth floor; no spending in the red.
Mahjong adds a table of four, where two players can agree to lose to each other, so:

- **Only entry fees and fixed prizes.** Points are never worth money. A stakes table pays by placing:
  2.0×, 1.1×, 0.5× and 0 of the fee, which is the pot less a 10% cut that leaves circulation.
- **A weekly cap, up or down.** A player's net result from mahjong for the week (Saturday 00:00 New
  York, like blackjack's) stays within what their Credit converts to Cash at a review: 5% of it or
  $10,000, whichever is more. Sitting down needs room for the fee on the way down and for first
  prize on the way up, counting fees already out. It is its own budget, separate from blackjack's.
- **Paid games a day:** 6.
- **Who may pay:** a verified email and an account as old as staking Credit on a duel needs
  (`games/accountRules.js`).
- **Same network:** a player can't sit at a paid table, or enter a paid tournament, with an account
  that has shared a network address with theirs (`services/ipHash.js`).
- **Bots never pay.** Paid tables need four players. A tournament that needs a bot turns free.
- **Tournament prizes** are a fixed split of the fees less the same 10%. First prize, less the fee,
  can't be more than the weekly minimum cap, or the tournament can't be created.
- **Staff view:** paid games by pair of players, with how often they sat together and what moved
  between them, for spotting collusion.

Everything else a player earns is not money: rating and rank, titles, a record on their profile,
their name on a leaderboard, a headline on the Wire.

The numbers are in `mahjong/settings.js`, each with an environment variable.
