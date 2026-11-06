// Parimutuel math for prediction pools (docs/design/predictions-pools.md §1), with no rake. Pure:
// everything is worked in whole cents with BigInt, so a split is exact and never pays out more
// than the pool holds.
//
// A pool holds P in total and S_k on option k. If option w wins, a stake s on it pays
// floor(s × P / S_w) cents; losing stakes pay nothing. The cents left over from rounding down (under
// a cent per winner) are the pool's dust. If nobody backed the winner, everyone gets their stake back.

const toCents = (value) => BigInt(Math.round(Number(value || 0) * 100));
const fromCents = (cents) => Number(cents) / 100;

/**
 * Settles a pool. `stakes` are { key, outcomeId, stake }; returns { mode, total, winnerTotal, dust,
 * payouts } where payouts maps each key to what it gets back. mode is "paid" (winners split the
 * pool) or "no_winner" (nobody backed the winner, so every stake comes back).
 */
function settle(stakes, winnerOutcomeId) {
  const winner = String(winnerOutcomeId);
  let total = 0n;
  let winnerTotal = 0n;
  for (const entry of stakes) {
    const cents = toCents(entry.stake);
    total += cents;
    if (String(entry.outcomeId) === winner) winnerTotal += cents;
  }
  const payouts = new Map();
  if (winnerTotal === 0n) {
    for (const entry of stakes) payouts.set(entry.key, fromCents(toCents(entry.stake)));
    return { mode: "no_winner", total: fromCents(total), winnerTotal: 0, dust: 0, payouts };
  }
  let paid = 0n;
  for (const entry of stakes) {
    if (String(entry.outcomeId) !== winner) {
      payouts.set(entry.key, 0);
      continue;
    }
    const cents = (toCents(entry.stake) * total) / winnerTotal;
    paid += cents;
    payouts.set(entry.key, fromCents(cents));
  }
  return { mode: "paid", total: fromCents(total), winnerTotal: fromCents(winnerTotal), dust: fromCents(total - paid), payouts };
}

/** Each option's share of the pool and what it pays per $1 if it wins (null while nobody's on it). */
function odds(optionTotals) {
  const totals = optionTotals.map((value) => toCents(value));
  const total = totals.reduce((sum, value) => sum + value, 0n);
  return totals.map((cents) => ({
    share: total > 0n ? Number(cents) / Number(total) : 0,
    multiplier: cents > 0n ? Number(total) / Number(cents) : null,
  }));
}

/**
 * The bet slip's preview: what the player's whole stake on an option would pay if the pool closed
 * right after they add `amount` to it. `mine` is what they already have on that option.
 */
function preview({ total, optionTotal, mine = 0, amount }) {
  const add = toCents(amount);
  const nextTotal = toCents(total) + add;
  const nextOption = toCents(optionTotal) + add;
  const stake = toCents(mine) + add;
  if (nextOption === 0n) return { stake: 0, payout: 0, profit: 0, multiplier: null };
  const payout = (stake * nextTotal) / nextOption;
  return {
    stake: fromCents(stake),
    payout: fromCents(payout),
    profit: fromCents(payout - stake),
    multiplier: Number(nextTotal) / Number(nextOption),
  };
}

module.exports = { fromCents, odds, preview, settle, toCents };
