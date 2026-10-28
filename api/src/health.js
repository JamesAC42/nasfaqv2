// Liveness (/api/live) only says the process answers; it never touches the database, so a database
// outage doesn't get every pod restarted. Readiness (/api/health) checks the database on `db`, which
// server.js gives a connection of its own: borrowing one from the API's pool meant a pool busy with
// real work failed every pod's probe at once, and Kubernetes took them all out of the Service.
function registerHealthRoutes(app, db) {
  app.get("/api/live", (_req, res) => {
    res.set("Cache-Control", "no-store").json({ ok: true });
  });

  // Callers arriving while a check is running share it: the endpoint is public, and a flood of
  // requests must not queue up on the one connection and time out the real probe.
  let inflight = null;
  const checkDatabase = () => {
    if (!inflight) {
      inflight = Promise.resolve()
        .then(() => db.query("SELECT 1 AS ok"))
        .then((result) => result.rows[0]?.ok === 1)
        .catch(() => false)
        .finally(() => {
          inflight = null;
        });
    }
    return inflight;
  };

  app.get("/api/health", async (_req, res) => {
    res.set("Cache-Control", "no-store");
    // Readiness is public: never expose database errors or connection details.
    const ready = await checkDatabase();
    res.status(ready ? 200 : 503).json({ ok: ready, db: ready });
  });
}

module.exports = { registerHealthRoutes };
