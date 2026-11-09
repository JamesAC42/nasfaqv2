// The Saturday review's last safety net (BBB, relayed by the owner, 2026-11-09): a player left with
// no shares and no money to buy any gets a little Cash and Credit, to put a foot back in the door.
// Some will lean on it to gamble, and BBB and the owner accepted that, so there's no anti-abuse here.
// It's limited anyway: the money leaves them far under the side-mode floor (sideModeFloor.js), so the
// market is the only place it can go, and holding it means they don't qualify next week.
//
// Bricked is worked out after the review's fees, forced buybacks, conversion and new max shares. The
// player's shares, Cash and Credit are each worth less than one share of the cheapest stock they could
// buy, fee included (cheapestShareCost):
//   - Shares: only stocks that trade count (a halted or delisted stock can't be sold), so a leftover
//     fraction doesn't block it.
//   - Cash: spendable plus held. Held money is on its way into shares or back: queued buys and IPO
//     subscriptions both sit in held_cash.
//   - Credit: Credit that's left keeps converting each Saturday, so that player gets back on their
//     own, and clearing a big Cash debt for them would be a windfall. It also caps what anyone ends
//     up with at about bailoutCash + bailoutCredit.
// Open prediction positions and cards aren't counted, on purpose. Net worth doesn't count them either,
// they can't buy a share today, and the cost of being wrong is a small payment rather than a stuck player.
//
// Who: a verified email, no suspension and a visit in the last bailoutActiveDays (0 turns the bailout
// off). There's no cooldown.
//
// A bailout puts Cash at bailoutCash, which clears anything share fees took below zero, and adds
// bailoutCredit. Credit below zero (margin, a void) shrinks by that much and isn't forgiven, since only
// Credit pays it back and buying shares doesn't need Credit (economy.js).
//
// One ledger row per player (weekly_bailout, referencing the evaluation), inside the review's
// transaction, so a date's review pays once like the rest of it. An on-demand (playtest) run pays
// nobody. The report's auto_bailout block has totals only: everyone who qualifies (`qualified`) next
// to who's paid (`players`).

const economy = require("./economy");
const notifications = require("./notifications");
const pgNumeric = require("./pgNumeric");
const supply = require("./marketSupply");
const trading = require("./trading");
const { activeSuspensionSql } = require("./moderation");

const ENTRY_TYPE = "weekly_bailout";

const num = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};
const cents = (value) => Math.round(value * 100) / 100;
/** Up to the next cent, without float noise turning $1,012.34 into $1,012.35. */
const centsUp = (value) => Math.ceil(value * 100 - 1e-6) / 100;

/** The ids of the players the review may bail out, whatever their balances. */
async function loadPlayers(db, evalDate, { activeDays = economy.SETTINGS.bailoutActiveDays } = {}) {
  if (!(activeDays > 0)) return new Set();
  const { rows } = await db.query(
    `
    SELECT u.id
    FROM market.users u
    WHERE u.email_verified
      AND NOT ${activeSuspensionSql("u")}
      AND EXISTS (SELECT 1 FROM market.user_active_days a WHERE a.user_id = u.id AND a.day > $1::date - $2::int)
    ORDER BY u.id
  `,
    [evalDate, activeDays]
  );
  return new Set(rows.map((row) => Number(row.id)));
}

/**
 * What one share of the cheapest stock a player could buy costs, fee included, or null if nothing can
 * be bought. `stocks` are market_assets rows as they stand after the review. A frozen or sold-out stock
 * doesn't count, and neither does one with no fair value yet (trading refuses it).
 */
function cheapestShareCost(stocks) {
  let cheapest = null;
  for (const stock of stocks) {
    if (!(num(stock.current_fair_value) > 0) || !(num(stock.current_mid_price) > 0) || supply.sharesForSale(stock) < 1) continue;
    const cost = trading.oneShareCost(stock);
    if (cheapest === null || cost < cheapest) cheapest = cost;
  }
  return cheapest;
}

/** The rule itself, on balances as the review leaves them. */
function isBricked({ sharesValue, cash, held, credit }, shareCost) {
  return sharesValue < shareCost && cash + held < shareCost && credit < shareCost;
}

function noticeFor({ userId, evalDate, cash, credit, cashBefore, creditAfter }) {
  const money = notifications.money;
  const gave = credit > 0 ? `${money(cash)} Cash and ${money(credit)} Credit` : `${money(cash)} Cash`;
  const notes = [];
  if (cashBefore < 0) notes.push(`That clears the ${money(-cashBefore)} your Cash was below zero.`);
  if (credit > 0 && creditAfter < 0) notes.push("The Credit goes toward what you owe.");
  return {
    userId,
    kind: "dividend",
    title: `Back in the game: ${gave}`,
    body: [`You had no shares and not enough to buy one, so Saturday's review gave you ${gave}.`, ...notes, "Pick a stock and get back in."].join(" "),
    href: "/market",
    data: { eval_date: evalDate, cash, credit },
  };
}

/**
 * Who this review bails out, from what the review has left them with. Pure, like planEvaluation.
 * players: loadPlayers' set of ids. wallets: Map player → { cash, credit, held } after the conversion,
 * exact. A player with no wallet isn't bricked: it opens with the starter balances. holdings: Map stock
 * id (text) → Map player → exact quantity. stocks: as for cheapestShareCost. Returns
 * { summary, paid: [{ userId, cash, credit, notice }] }; summary is the report's auto_bailout block.
 */
function planBailouts({ evalDate, players, wallets, holdings, stocks, onDemand = false, settings = economy.SETTINGS }) {
  const summary = { qualified: 0, players: 0, cash: 0, credit: 0, debt_cleared: 0, cheapest_share: null };
  const paid = [];
  const shareCost = cheapestShareCost(stocks);
  if (shareCost === null) return { summary, paid };
  summary.cheapest_share = cents(shareCost);
  // Twice the cheapest share, in case the amount is ever set below it: the price can move before a batch fills.
  const cashTarget = Math.max(settings.bailoutCash, Math.ceil(shareCost * 2));

  const sharesValue = new Map();
  for (const stock of stocks) {
    for (const [userId, quantity] of holdings.get(String(stock.id)) || []) {
      if (players.has(userId)) sharesValue.set(userId, (sharesValue.get(userId) || 0) + pgNumeric.toNumber(quantity) * num(stock.current_mid_price));
    }
  }

  for (const userId of players) {
    const wallet = wallets.get(userId);
    if (!wallet) continue;
    const cashBefore = pgNumeric.toNumber(wallet.cash);
    const creditBefore = pgNumeric.toNumber(wallet.credit);
    const held = wallet.held ? pgNumeric.toNumber(wallet.held) : 0;
    if (!isBricked({ sharesValue: sharesValue.get(userId) || 0, cash: cashBefore, held, credit: creditBefore }, shareCost)) continue;
    summary.qualified += 1;
    if (onDemand) continue;
    const cash = centsUp(cashTarget - cashBefore);
    const credit = settings.bailoutCredit;
    summary.players += 1;
    summary.cash += cash;
    summary.credit += credit;
    summary.debt_cleared += Math.max(0, -cashBefore);
    paid.push({ userId, cash, credit, notice: noticeFor({ userId, evalDate, cash, credit, cashBefore, creditAfter: creditBefore + credit }) });
  }
  summary.cash = cents(summary.cash);
  summary.credit = cents(summary.credit);
  summary.debt_cleared = cents(summary.debt_cleared);
  return { summary, paid };
}

module.exports = { ENTRY_TYPE, cheapestShareCost, isBricked, loadPlayers, planBailouts };
