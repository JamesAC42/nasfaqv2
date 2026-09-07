function registerHealthRoutes(app, pool) {
  app.get("/api/live", (_req, res) => {
    res.set("Cache-Control", "no-store").json({ ok: true });
  });

  app.get("/api/health", async (_req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      const result = await pool.query("SELECT 1 AS ok");
      const ready = result.rows[0]?.ok === 1;
      res.status(ready ? 200 : 503).json({ ok: ready, db: ready });
    } catch {
      // Readiness is public: do not expose database errors or connection details.
      res.status(503).json({ ok: false, db: false });
    }
  });
}

module.exports = { registerHealthRoutes };
