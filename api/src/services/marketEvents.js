const MARKET_EVENTS_REDIS_CHANNEL = "nasfaq_market:events";

async function publishMarketEvent(redis, payload) {
  if (!redis) return;
  try {
    await redis.publish(MARKET_EVENTS_REDIS_CHANNEL, JSON.stringify(payload));
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("market event publish failed:", String(error?.message || error));
  }
}

function buildStatusEvent(status) {
  return {
    type: "market.status_update",
    status: status || null,
    at: new Date().toISOString(),
  };
}

async function publishMarketStatusEvent(redis, status) {
  await publishMarketEvent(redis, buildStatusEvent(status));
}

module.exports = {
  MARKET_EVENTS_REDIS_CHANNEL,
  publishMarketEvent,
  publishMarketStatusEvent,
};
