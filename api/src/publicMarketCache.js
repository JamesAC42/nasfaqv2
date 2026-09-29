// The public market payloads every open tab reads: the asset board and the latest daily report
// (plus the /market hub). Cached through responseCache; invalidateMarketAssetsCache clears them
// whenever prices, supply or the report change (fills, ticks, settlement, evaluations, rebuilds).

const marketDb = require("./marketDb");
const { scrubPublicMarketPayload, publicDailyReport, revealedTargets } = require("./services/marketSecrecy");
const { sendCachedJson } = require("./responseCache");

const ASSETS_KEY = "market:assets";
const REPORT_KEY = "market:report:latest";
const hubKey = (tradeLimit) => `market:hub:${tradeLimit}`;
const HUB_TRADE_LIMITS = [20, 50, 100];

const assetsOptions = (pool) => ({
  ttlSeconds: 5,
  memoMs: 1000,
  load: async () => scrubPublicMarketPayload(await marketDb.listAssets(pool)),
});

const reportOptions = (pool) => ({
  ttlSeconds: 30,
  memoMs: 2000,
  notFound: "report_not_found",
  load: async () => {
    const report = await marketDb.getLatestDailyReport(pool);
    if (!report) return null;
    const [publicReport, revealed] = await Promise.all([publicDailyReport(pool, report), revealedTargets(pool)]);
    return { ...publicReport, revealed_targets: revealed };
  },
});

/** Sends the public asset board. */
const sendPublicAssets = (req, res) => sendCachedJson(req, res, ASSETS_KEY, assetsOptions(req.ctx.pool));

/** Sends the latest daily report with the revealed targets. */
const sendLatestReport = (req, res) => sendCachedJson(req, res, REPORT_KEY, reportOptions(req.ctx.pool));

/** Sends the /market hub (5s; the page patches fills in from the socket between refetches). */
function sendHub(req, res, tradeLimit, build) {
  const limit = HUB_TRADE_LIMITS.find((value) => value >= tradeLimit) ?? 100;
  return sendCachedJson(req, res, hubKey(limit), { ttlSeconds: 5, memoMs: 1000, load: () => build(limit) });
}

// /api/market/adjustments/summary is cached per recent_limit bucket (routes/market.js).
const ADJUSTMENT_SUMMARY_LIMITS = [20, 50, 100];

const PUBLIC_MARKET_KEYS = [ASSETS_KEY, REPORT_KEY, "market:status", ...HUB_TRADE_LIMITS.map(hubKey), ...ADJUSTMENT_SUMMARY_LIMITS.map((limit) => `market:adjustments:${limit}`)];

module.exports = { sendPublicAssets, sendLatestReport, sendHub, PUBLIC_MARKET_KEYS, ADJUSTMENT_SUMMARY_LIMITS };
