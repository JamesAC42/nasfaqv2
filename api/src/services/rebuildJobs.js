const { randomUUID } = require("node:crypto");
const JOB_LOCK_KEY = 9204091;
const schema = `CREATE TABLE IF NOT EXISTS market.rebuild_jobs (
  id uuid PRIMARY KEY, owner_pid integer NOT NULL, job jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
)`;

async function getJob(pool, id = null) {
  const { rows } = await pool.query(`
    SELECT id, job, EXISTS (SELECT 1 FROM pg_locks WHERE locktype = 'advisory'
      AND classid = 0 AND objid = $2 AND objsubid = 1 AND granted AND pid = r.owner_pid) AS owner_alive
    FROM market.rebuild_jobs r WHERE ($1::uuid IS NULL OR id = $1::uuid)
    ORDER BY created_at DESC LIMIT 1`, [id, JOB_LOCK_KEY]);
  const row = rows[0];
  if (!row) return null;
  if (row.job.status === "running" && !row.owner_alive) {
    const changed = await pool.query(`UPDATE market.rebuild_jobs r
      SET job = job || jsonb_build_object('status','failed','error','rebuild_interrupted (worker disconnected; completed days are preserved)',
        'finished_at',clock_timestamp())
      WHERE id = $1 AND job->>'status' = 'running' AND NOT EXISTS (
        SELECT 1 FROM pg_locks WHERE locktype='advisory' AND classid=0 AND objid=$2
          AND objsubid=1 AND granted AND pid=r.owner_pid)
      RETURNING job`, [row.id, JOB_LOCK_KEY]);
    if (changed.rows[0]) return changed.rows[0].job;
    return (await pool.query("SELECT job FROM market.rebuild_jobs WHERE id=$1", [row.id])).rows[0].job;
  }
  return row.job;
}

async function startJob(pool, work, logger = console) {
  const client = await pool.connect();
  let locked = false;
  let disconnected = false;
  const onError = () => { disconnected = true; };
  client.on("error", onError);
  try {
    const { rows } = await client.query("SELECT pg_backend_pid() AS pid, pg_try_advisory_lock($1) AS locked", [JOB_LOCK_KEY]);
    locked = rows[0].locked;
    if (!locked) throw Object.assign(new Error("rebuild_running"), { code: "rebuild_running", job: await getJob(pool) });
    // We hold the singleton lock, so any earlier running record has lost its owner.
    // Do not rely on its PID here: a pooled connection can reuse that same PID.
    await client.query(`UPDATE market.rebuild_jobs SET job = job || jsonb_build_object(
      'status','failed','error','rebuild_interrupted (worker disconnected; completed days are preserved)',
      'finished_at',clock_timestamp()) WHERE job->>'status'='running'`);
    const job = { id: randomUUID(), status: "running", started_at: new Date().toISOString(), finished_at: null,
      progress: { phase: "starting", done: 0, total: null, market_date: null }, result: null, error: null };
    await client.query("INSERT INTO market.rebuild_jobs(id,owner_pid,job) VALUES($1,$2,$3::jsonb)",
      [job.id, rows[0].pid, JSON.stringify(job)]);
    const save = async () => {
      if (disconnected) throw new Error("rebuild_worker_disconnected");
      await client.query("UPDATE market.rebuild_jobs SET job=$2::jsonb WHERE id=$1 AND job->>'status'='running'",
        [job.id, JSON.stringify(job)]);
    };
    async function execute() {
      try {
        job.result = await work(async progress => { job.progress = progress; await save(); });
        job.status = "completed";
      } catch (error) {
        job.status = "failed";
        job.error = String(error?.code || error?.message || error).slice(0, 500);
        logger.error?.("market rebuild failed", job.error);
      } finally {
        job.finished_at = new Date().toISOString();
        try { await save(); } catch (error) { logger.error?.("rebuild status persistence failed", error?.code || "connection_error"); }
        try { if (!disconnected) await client.query("SELECT pg_advisory_unlock($1)", [JOB_LOCK_KEY]); }
        catch (error) { disconnected = true; throw error; }
        finally { client.removeListener("error", onError); client.release(disconnected); }
      }
    }
    // Returning the initial snapshot keeps the HTTP response bounded; status is shared in PostgreSQL.
    const initial = JSON.parse(JSON.stringify(job));
    void execute().catch(error => logger.error?.("rebuild worker cleanup failed", error?.code || "connection_error"));
    return initial;
  } catch (error) {
    if (locked && !disconnected) await client.query("SELECT pg_advisory_unlock($1)", [JOB_LOCK_KEY]).catch(() => { disconnected = true; });
    client.removeListener("error", onError);
    client.release(disconnected);
    throw error;
  }
}
module.exports = { schema, getJob, startJob, JOB_LOCK_KEY };
