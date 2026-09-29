const KEY_PREFIX = "nasfaq:ops:scheduler:";
function summarize(row, now = Date.now()) {
  if (!row) return { scheduler_enabled: false, scheduler_status: "unknown", scheduler_interval_ms: null, scheduler_last_seen_at: null };
  const fresh = Number.isFinite(Date.parse(row.last_seen_at)) && now - Date.parse(row.last_seen_at) < 90000;
  const stalled = row.state === "running" && now - Date.parse(row.tick_started_at) > Math.max(120000, row.interval_ms * 3);
  const status = !fresh ? "stale" : !row.enabled ? "off" : row.state === "error" ? "error" : stalled ? "stalled" : "running";
  return { scheduler_enabled: fresh && Boolean(row.enabled), scheduler_status: status,
    scheduler_interval_ms: row.interval_ms, scheduler_last_seen_at: row.last_seen_at,
    scheduler_last_success_at: row.last_success_at || null, scheduler_error_code: row.error_code || null };
}
async function getSchedulerHealth(redis, name) {
  try { return summarize(JSON.parse(await redis?.get(KEY_PREFIX + name) || "null")); }
  catch { return summarize(null); }
}
function startSchedulerHeartbeat(redis, name, { enabled, intervalMs }, logger = console) {
  // Disabled web/game replicas must never overwrite the actual scheduler's heartbeat.
  if (!redis || (!enabled && process.env.SCHEDULER_STATUS_OWNER !== "true")) return { update() {}, stop() {} };
  const row = { enabled, interval_ms: intervalMs, state: "idle", last_success_at: null, error_code: null };
  let publishing = false;
  async function publish() {
    if (publishing) return;
    publishing = true;
    try { await redis.set(KEY_PREFIX + name, JSON.stringify({ ...row, last_seen_at: new Date().toISOString() }), { EX: 86400 }); }
    catch (error) { logger.error?.("scheduler heartbeat failed", name, error?.code || "redis_error"); }
    finally { publishing = false; }
  }
  void publish();
  const timer = setInterval(() => { void publish(); }, 15000);
  timer.unref?.();
  return {
    update(state, error = null) {
      row.state = state;
      if (state === "running") row.tick_started_at = new Date().toISOString();
      if (state === "idle") row.last_success_at = new Date().toISOString();
      row.error_code = error ? String(error.code || "scheduler_error") : null;
    },
    stop() { clearInterval(timer); },
  };
}
module.exports = { getSchedulerHealth, startSchedulerHeartbeat, summarize };
