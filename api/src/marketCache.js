const MARKET_ASSETS_CACHE_KEY = "market:assets:list";
const MARKET_ASSETS_CACHE_TTL_SECONDS = 5;

async function getCachedAssets(redis) {
  if (!redis) return null;
  const raw = await redis.get(MARKET_ASSETS_CACHE_KEY);
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch {
    await redis.del(MARKET_ASSETS_CACHE_KEY);
    return null;
  }
}

async function setCachedAssets(redis, assets) {
  if (!redis) return;
  await redis.set(MARKET_ASSETS_CACHE_KEY, JSON.stringify(assets), {
    EX: MARKET_ASSETS_CACHE_TTL_SECONDS,
  });
}

async function invalidateMarketAssetsCache(redis) {
  if (!redis) return;
  await redis.del(MARKET_ASSETS_CACHE_KEY);
}

module.exports = {
  getCachedAssets,
  setCachedAssets,
  invalidateMarketAssetsCache,
  MARKET_ASSETS_CACHE_KEY,
  MARKET_ASSETS_CACHE_TTL_SECONDS,
};
