// Chat older than the visible window (CHAT_HISTORY_VISIBLE_DAYS, keeping each room's newest
// CHAT_HISTORY_MIN_MESSAGES) moves to chat.archived_messages every 10 minutes, on the scheduler pod
// under an advisory lock. Every chat history read used to run the archive transaction itself, a write
// on each GET; history reads both tables with the same visibility rules, so readers see nothing
// different. CHAT_ARCHIVE_ENABLED=false stops it.

const chatDb = require("../chatDb");
const schedulerHealth = require("./schedulerHealth");

const LOCK_KEY = 9_204_120;
const INTERVAL_MS = 10 * 60_000;
// Batches (CHAT_ARCHIVE_BATCH_SIZE messages, each its own transaction) per tick: enough to catch up a
// backlog over a few ticks without holding the lock for long.
const MAX_BATCHES_PER_TICK = 20;

/** Archives until a batch comes back short (or MAX_BATCHES_PER_TICK); returns how many moved. */
async function archiveOldMessages(pool) {
  let moved = 0;
  for (let batch = 0; batch < MAX_BATCHES_PER_TICK; batch += 1) {
    const count = await chatDb.archiveMessagesOlderThan(pool);
    moved += count;
    if (count < chatDb.CHAT_ARCHIVE_BATCH_SIZE) break;
  }
  return moved;
}

function startChatArchiveScheduler(pool, logger = console, redis = null, { intervalMs = INTERVAL_MS, firstTickMs = 60_000 } = {}) {
  const enabled = (process.env.CHAT_ARCHIVE_ENABLED || "true").toLowerCase() !== "false";
  const heartbeat = schedulerHealth.startSchedulerHeartbeat(redis, "chat-archive", { enabled, intervalMs }, logger);
  if (!enabled) return () => heartbeat.stop();
  let running = false;
  async function tick() {
    if (running) return;
    running = true;
    heartbeat.update("running");
    let client;
    try {
      client = await pool.connect();
      const { rows } = await client.query("SELECT pg_try_advisory_lock($1) AS locked", [LOCK_KEY]);
      if (!rows[0]?.locked) {
        heartbeat.skip();
        return;
      }
      try {
        const moved = await archiveOldMessages(pool);
        if (moved > 0) logger.log?.(`chat archive: moved ${moved} old messages`);
      } finally {
        await client.query("SELECT pg_advisory_unlock($1)", [LOCK_KEY]).catch(() => {});
      }
      heartbeat.update("idle");
    } catch (error) {
      heartbeat.update("error", error);
      logger.error?.("chat archive failed", error);
    } finally {
      client?.release();
      running = false;
    }
  }
  const timer = setInterval(() => void tick(), intervalMs);
  timer.unref?.();
  const first = setTimeout(() => void tick(), firstTickMs);
  first.unref?.();
  return () => {
    clearTimeout(first);
    clearInterval(timer);
    heartbeat.stop();
  };
}

module.exports = { LOCK_KEY, archiveOldMessages, startChatArchiveScheduler };
