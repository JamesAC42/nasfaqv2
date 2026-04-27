const PREDICTION_MARKET_EVENTS_REDIS_CHANNEL = "nasfaq_prediction_markets:events";

async function publishPredictionMarketEvent(redis, payload) {
  if (!redis || !payload) return;
  try {
    await redis.publish(
      PREDICTION_MARKET_EVENTS_REDIS_CHANNEL,
      JSON.stringify({
        type: payload.type || "prediction.market.updated",
        at: new Date().toISOString(),
        ...payload,
      })
    );
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("prediction market publish failed:", String(error?.message || error));
  }
}

module.exports = {
  PREDICTION_MARKET_EVENTS_REDIS_CHANNEL,
  publishPredictionMarketEvent,
};
