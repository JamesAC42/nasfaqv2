const MARKET_ASSETS_CACHE_KEY = "market:assets:list";
const MARKET_ASSETS_CACHE_TTL_SECONDS = 5;
const MARKET_ASSET_SUPERCHAT_RANK_CACHE_TTL_SECONDS = 60 * 60 * 6;

function buildAssetSuperchatRankCacheKey(symbol, range = "7d") {
  return `market:asset:${String(symbol || "").trim().toUpperCase()}:superchat-rank:${String(range || "7d").trim().toLowerCase()}`;
}

async function getCachedJson(redis, key) {
  if (!redis || !key) return null;
  const raw = await redis.get(key);
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch {
    await redis.del(key);
    return null;
  }
}

async function setCachedJson(redis, key, value, ttlSeconds) {
  if (!redis || !key) return;
  await redis.set(key, JSON.stringify(value), {
    EX: ttlSeconds,
  });
}

async function getCachedAssets(redis) {
  return getCachedJson(redis, MARKET_ASSETS_CACHE_KEY);
}

async function setCachedAssets(redis, assets) {
  await setCachedJson(redis, MARKET_ASSETS_CACHE_KEY, assets, MARKET_ASSETS_CACHE_TTL_SECONDS);
}

async function invalidateMarketAssetsCache(redis) {
  if (!redis) return;
  await redis.del(MARKET_ASSETS_CACHE_KEY);
}

module.exports = {
  getCachedAssets,
  setCachedAssets,
  invalidateMarketAssetsCache,
  getCachedJson,
  setCachedJson,
  buildAssetSuperchatRankCacheKey,
  MARKET_ASSETS_CACHE_KEY,
  MARKET_ASSETS_CACHE_TTL_SECONDS,
  MARKET_ASSET_SUPERCHAT_RANK_CACHE_TTL_SECONDS,
};
