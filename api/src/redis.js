const { createClient } = require("redis");

async function createRedis(redisUrl) {
  if (!redisUrl) {
    throw new Error("Missing REDIS_URL");
  }
  const client = createClient({ url: redisUrl });
  client.on("error", (err) => {
    // eslint-disable-next-line no-console
    console.error("redis error:", err);
  });
  await client.connect();
  await client.ping();
  return client;
}

module.exports = { createRedis };


