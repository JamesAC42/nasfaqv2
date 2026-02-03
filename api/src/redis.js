const { createClient } = require("redis");

async function createRedis(redisUrl, redisPassword) {
  if (!redisUrl) {
    throw new Error("Missing REDIS_URL");
  }
  const client = createClient({ url: redisUrl, password: redisPassword || undefined });
  client.on("error", (err) => {
    // eslint-disable-next-line no-console
    console.error("redis error:", err);
  });
  await client.connect();
  await client.ping();
  return client;
}

module.exports = { createRedis };


