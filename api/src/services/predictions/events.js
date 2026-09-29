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

async function publishMarkets(redis, action, markets) {
  for (const market of markets || []) {
    if (!market) continue;
    await publishPredictionMarketEvent(redis, { type: "prediction.market.updated", action, slug: market.slug, market_id: market.id });
  }
}

module.exports = { publishMarkets, publishTrades };
