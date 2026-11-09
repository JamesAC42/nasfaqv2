// No games, capsules or bets while a player's net worth is under a floor (the owner and BBB,
// 2026-11-09). Credit is the buffer between losing money and having nothing left to trade with, so a
// player this low is steered back to the market, which is the one way back up.
//
// It guards spending that can be lost to chance: card and capsule pulls, entry fees, duel stakes,
// predictions and pools. Free pulls and free games never reach it, and neither does anything that
// pays out: selling a position, a payout, a refund. The card exchange is left out: a card is bought for
// its price rather than gambled on, and a player this low needs to be able to sell theirs. Blackjack
// checks the same floor through its own limits (games/tables/blackjackLimits.js).
//
// economy.SETTINGS.sideModeMinNetWorth sets it (ECONOMY_SIDE_MODE_MIN_NET_WORTH); 0 turns it off.

const economy = require("./economy");
const { getCurrentNetWorth } = require("./netWorth");

/** Throws net_worth_floor when this player is under the floor. `db` can be a transaction's client. */
async function assertAboveFloor(db, userId, floor = economy.SETTINGS.sideModeMinNetWorth) {
  if (!(floor > 0)) return;
  const { total_equity: netWorth } = await getCurrentNetWorth(db, userId);
  if (netWorth < floor) {
    throw Object.assign(new Error("net_worth_floor"), { code: "net_worth_floor", limit: floor });
  }
}

module.exports = { assertAboveFloor };
