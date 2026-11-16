// Shares and buybacks (docs/market/core-market.md, BBB's "Volume" section).
//
// max_supply          weekly, from subscribers (weeklyEvaluation.js)
// circulating_supply  shares players hold (kept in step by every fill, buyback and forced buyback)
// treasury_supply     max_supply − held, floored at 0: the broker's shares
// broker buffer       broker_buffer_pct × max_supply of the broker's shares that are never sold
// for sale            treasury_supply − buffer: what buys can take. Zero means sold out.
//
// A stock in a buyback (trading_state = 'buyback') is frozen: no buys, no ticks, the price stays put,
// and sells fill at the broker's buyback price (120% of the frozen price, 10 points less per day,
// floored at 50%) for the shares still over the max, and only on shares the seller held before the
// last tick ahead of the buyback (offerCutoffBefore). Everything else sells at the frozen price.

function envNumber(name, fallback) {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Base rates are priced against this many shares, whatever a stock's max shares are this week. */
const REFERENCE_SUPPLY = Math.max(1, envNumber("MARKET_PRICE_REFERENCE_SUPPLY", 10_000));
const BUYBACK_START = envNumber("MARKET_BUYBACK_START", 1.2);
const BUYBACK_DAILY_STEP = envNumber("MARKET_BUYBACK_DAILY_STEP", 0.1);
const BUYBACK_FLOOR = envNumber("MARKET_BUYBACK_FLOOR", 0.5);
const DAY_MS = 86_400_000;

function toNumber(value, fallback = 0) {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function bufferShares(asset) {
  return Math.max(0, toNumber(asset.broker_buffer_pct, 0.02)) * Math.max(0, toNumber(asset.max_supply, 0));
}

/** Shares a buy can take right now (0 = sold out). */
function sharesForSale(asset) {
  if (asset.trading_state === "buyback") return 0;
  return Math.max(0, toNumber(asset.treasury_supply, 0) - bufferShares(asset));
}

/** The broker's buyback price as a multiple of the frozen price, at `now`. */
function buybackMultiplier(startedAt, now = new Date()) {
  const started = new Date(startedAt).getTime();
  const days = Number.isFinite(started) ? Math.max(0, Math.floor((now.getTime() - started) / DAY_MS)) : 0;
  return Math.max(BUYBACK_FLOOR, BUYBACK_START - BUYBACK_DAILY_STEP * days);
}

function buybackPrice(buyback, now = new Date()) {
  return toNumber(buyback.frozen_price, 0) * buybackMultiplier(buyback.started_at, now);
}

/**
 * A sell into a buyback: how many of its shares get the broker's offer and the price per share. The
 * offer goes to the shares still over the max (first come, first served) and only to the seller's
 * `eligible` shares (offerSharesFor); the rest fill at the frozen price, so selling out and buying
 * back at the Open isn't free money and nor is buying on Friday to sell into Saturday's offer.
 */
function buybackFill(asset, buyback, quantity, now = new Date(), eligible = Infinity) {
  const over = Math.max(0, toNumber(asset.circulating_supply, 0) - toNumber(asset.max_supply, 0));
  const frozen = toNumber(buyback.frozen_price, 0);
  if (!(quantity > 0)) return { price: frozen, atOffer: 0 };
  const atOffer = Math.max(0, Math.min(quantity, over, eligible));
  return { price: (atOffer * buybackPrice(buyback, now) + (quantity - atOffer) * frozen) / quantity, atOffer };
}

function buybackFillPrice(asset, buyback, quantity, now = new Date(), eligible = Infinity) {
  return buybackFill(asset, buyback, quantity, now, eligible).price;
}

/**
 * The seller's shares that can still get the offer: what they hold less what they added after the
 * cutoff (`late`, market.asset_buyback_late_shares). Buys are refused while frozen, so a holding only
 * shrinks and the late shares are the last to go.
 */
function offerSharesFor(held, late = 0) {
  return Math.max(0, toNumber(held, 0) - toNumber(late, 0));
}

/** The tick hours in New York (Open, Lunch, Late, Overnight: marketAdjustments.INTERVALS). */
const TICK_HOURS_ET = [3, 9, 15, 21];

function etHour(at) {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", hourCycle: "h23" }).format(at)) % 24;
}

/**
 * The last tick strictly before `at`: shares held then are the ones the offer pays on. Friday's
 * Late tick (21:00 ET) for the Saturday 00:00 evaluation, in EDT and EST alike (New York's offset is
 * whole hours, so the ticks fall on the UTC hour).
 */
function offerCutoffBefore(at) {
  const time = new Date(at).getTime();
  let hour = Math.floor(time / 3_600_000) * 3_600_000;
  if (hour === time) hour -= 3_600_000;
  for (let step = 0; step < 12; step++, hour -= 3_600_000) {
    if (TICK_HOURS_ET.includes(etHour(new Date(hour)))) return new Date(hour);
  }
  return new Date(hour);
}

/** Each seller's late shares in a buyback, Map user id → number. */
async function lateSharesFor(client, buybackId, userIds) {
  const late = new Map();
  if (!buybackId || !userIds.length) return late;
  const { rows } = await client.query(
    `SELECT user_id, late_shares FROM market.asset_buyback_late_shares WHERE buyback_id = $1 AND user_id = ANY($2::bigint[])`,
    [buybackId, userIds]
  );
  for (const row of rows) late.set(Number(row.user_id), toNumber(row.late_shares, 0));
  return late;
}

/** When the buyback price next drops, or null at the floor. */
function nextBuybackStepAt(buyback, now = new Date()) {
  if (buybackMultiplier(buyback.started_at, now) <= BUYBACK_FLOOR) return null;
  const started = new Date(buyback.started_at).getTime();
  const days = Math.floor((now.getTime() - started) / DAY_MS) + 1;
  return new Date(started + days * DAY_MS);
}

async function getActiveBuyback(client, assetId, { lock = false } = {}) {
  const { rows } = await client.query(
    `SELECT * FROM market.asset_buybacks WHERE asset_id = $1 AND status = 'active' ${lock ? "FOR UPDATE" : ""} LIMIT 1`,
    [assetId]
  );
  return rows[0] || null;
}

/** Shares players hold, from the holdings themselves. */
async function heldShares(client, assetId) {
  const { rows } = await client.query(`SELECT COALESCE(SUM(quantity), 0) AS held FROM market.portfolio_holdings WHERE asset_id = $1`, [assetId]);
  return toNumber(rows[0]?.held, 0);
}

/** Writes circulating/treasury for a new held count (treasury = max − held, floored at 0). */
async function setHeld(client, assetId, held) {
  await client.query(
    `
    UPDATE market.market_assets
    SET circulating_supply = GREATEST($2::numeric, 0),
        treasury_supply = GREATEST(max_supply - GREATEST($2::numeric, 0), 0),
        updated_at = now()
    WHERE id = $1
  `,
    [assetId, held]
  );
}

/** Moves `delta` shares between the broker and players (+ = players bought). */
async function moveShares(client, assetId, delta) {
  await client.query(
    `
    UPDATE market.market_assets
    SET circulating_supply = GREATEST(circulating_supply + $2::numeric, 0),
        treasury_supply = GREATEST(max_supply - GREATEST(circulating_supply + $2::numeric, 0), 0),
        updated_at = now()
    WHERE id = $1
  `,
    [assetId, delta]
  );
}

/** Public view of a stock's supply (added to asset payloads). */
function supplyView(asset, buyback = null, now = new Date()) {
  const max = toNumber(asset.max_supply, 0);
  const held = toNumber(asset.circulating_supply, 0);
  const forSale = sharesForSale(asset);
  const view = {
    trading_state: asset.trading_state || "open",
    shares_for_sale: forSale,
    broker_buffer: bufferShares(asset),
    sold_out: (asset.trading_state || "open") === "open" && forSale <= 0,
    held_pct_of_max: max > 0 ? held / max : null,
    buyback: null,
  };
  if (buyback) {
    view.buyback = {
      started_at: buyback.started_at,
      frozen_price: toNumber(buyback.frozen_price, 0),
      target_max_supply: toNumber(buyback.target_max_supply, 0),
      price: buybackPrice(buyback, now),
      multiplier: buybackMultiplier(buyback.started_at, now),
      next_step_at: nextBuybackStepAt(buyback, now),
      // The schedule, so a page can draw every day's offer (start − step × days, never under the floor).
      start: BUYBACK_START,
      daily_step: BUYBACK_DAILY_STEP,
      floor: BUYBACK_FLOOR,
      shares_bought: toNumber(buyback.shares_bought, 0),
      shares_over: Math.max(0, held - toNumber(asset.max_supply, 0)),
    };
  }
  return view;
}

module.exports = {
  REFERENCE_SUPPLY,
  BUYBACK_START,
  BUYBACK_DAILY_STEP,
  BUYBACK_FLOOR,
  bufferShares,
  sharesForSale,
  buybackMultiplier,
  buybackPrice,
  buybackFill,
  buybackFillPrice,
  offerSharesFor,
  offerCutoffBefore,
  lateSharesFor,
  nextBuybackStepAt,
  getActiveBuyback,
  heldShares,
  setHeld,
  moveShares,
  supplyView,
};
