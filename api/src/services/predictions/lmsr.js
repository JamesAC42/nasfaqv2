// LMSR market maker (docs/predictions/PREDICTIONS_DESIGN.md §2). Pure math, no I/O.
//
// State: liquidity b and q[i] = net shares of outcome i the market maker has sold.
// price_i = e^(q_i/b) / S,  S = Σ e^(q_j/b),  cost C(q) = b·ln S.
// Everything is computed with a max-shift so large q/b never overflows.

const PRICE_CEIL = 0.99;
const PRICE_FLOOR = 0.01;

function expTerms(q, b) {
  const scaled = q.map((value) => value / b);
  const max = Math.max(...scaled);
  return { max, terms: scaled.map((value) => Math.exp(value - max)) };
}

/** C(q) = b · ln Σ e^(q_j/b) */
function cost(q, b) {
  const { max, terms } = expTerms(q, b);
  return b * (max + Math.log(terms.reduce((sum, term) => sum + term, 0)));
}

function prices(q, b) {
  const { terms } = expTerms(q, b);
  const total = terms.reduce((sum, term) => sum + term, 0);
  return terms.map((term) => term / total);
}

/** q vector that opens the market at the given probabilities (normalized). */
function seedShares(probabilities, b) {
  const total = probabilities.reduce((sum, p) => sum + p, 0);
  return probabilities.map((p) => b * Math.log(Math.max(1e-9, p / total)));
}

function withDelta(q, index, delta) {
  return q.map((value, i) => (i === index ? value + delta : value));
}

/** Curve cash for buying `shares` of outcome `index`. */
function buyCost(q, b, index, shares) {
  return cost(withDelta(q, index, shares), b) - cost(q, b);
}

/** Curve cash paid out for selling `shares` of outcome `index`. */
function sellProceeds(q, b, index, shares) {
  return cost(q, b) - cost(withDelta(q, index, -shares), b);
}

/**
 * Shares of `index` that `cash` of curve spend buys:
 * Δ = b·ln(1 + S·(e^(c/b) − 1) / e^(q_i/b)), computed relative to the max term.
 */
function sharesForCash(q, b, index, cash) {
  if (!(cash > 0)) return 0;
  const { terms } = expTerms(q, b);
  const total = terms.reduce((sum, term) => sum + term, 0);
  return b * Math.log(1 + (total * Math.expm1(cash / b)) / terms[index]);
}

/**
 * Shares of `index` to trade so its price lands exactly on `target`.
 * Positive = buy that many, negative = sell. Other outcomes' shares stay fixed.
 * p_i = s_i / (s_i + R) with R the rest → s_i = R·t/(1−t).
 */
function sharesToPrice(q, b, index, target) {
  const { max, terms } = expTerms(q, b);
  const rest = terms.reduce((sum, term, i) => (i === index ? sum : sum + term), 0);
  const wanted = rest * (target / (1 - target)); // e^(q_i'/b − max)
  const nextQ = b * (Math.log(wanted) + max);
  return nextQ - q[index];
}

/** Largest buy of `index` that keeps its price at or under the ceiling. */
function maxBuyShares(q, b, index, ceiling = PRICE_CEIL) {
  return Math.max(0, sharesToPrice(q, b, index, ceiling));
}

/** Largest sell of `index` that keeps its price at or over the floor. */
function maxSellShares(q, b, index, floor = PRICE_FLOOR) {
  return Math.max(0, -sharesToPrice(q, b, index, floor));
}

/** Worst-case market-maker loss for N outcomes. */
const maxLoss = (b, outcomes) => b * Math.log(outcomes);

module.exports = {
  PRICE_CEIL,
  PRICE_FLOOR,
  buyCost,
  cost,
  maxBuyShares,
  maxLoss,
  maxSellShares,
  prices,
  seedShares,
  sellProceeds,
  sharesForCash,
  sharesToPrice,
};
