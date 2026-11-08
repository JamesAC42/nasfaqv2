// Live updates for predictions v2 over /api/prediction-markets/ws (via Redis):
//   prediction.trade           every fill, with the market's new prices
//   prediction.market.updated  status changes, new markets, resolutions

const { publishPredictionMarketEvent } = require("../predictionMarketEvents");

async function publishTrades(redis, fills, extra = {}) {
  for (const fill of fills || []) {
    if (!fill) continue;
    await publishPredictionMarketEvent(redis, { type: "prediction.trade", slug: fill.slug, market_id: fill.market_id, trade: { ...fill, ...extra } });
  }
}

// A pool's events name the prediction-pools flag: the predictions socket sends them only to viewers the
// flag covers (server.js), so a staff-only pool's slug never reaches everyone.
async function publishMarkets(redis, action, markets) {
  for (const market of markets || []) {
    if (!market) continue;
    const gate = market.pricing === "pool" ? { feature: "prediction-pools" } : {};
    await publishPredictionMarketEvent(redis, { type: "prediction.market.updated", action, slug: market.slug, market_id: market.id, ...gate });
  }
}

module.exports = { publishMarkets, publishTrades };
