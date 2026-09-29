// Multiplayer game tables: two-player staked tables (duel, high-low) and blackjack.
// Money and seat changes go through these routes; live state is pushed on /api/games/ws.

const express = require("express");
const pvp = require("../services/games/tables/pvp");
const blackjack = require("../services/games/tables/blackjack");
const { requireUserId, requireVerifiedUserId } = require("../userContext");
const { sendGameError } = require("./games");

const router = express.Router();

const tableId = (req) => {
  const id = Number.parseInt(String(req.params.id), 10);
  if (!Number.isInteger(id) || id <= 0) {
    const error = new Error("table_not_found");
    error.code = "table_not_found";
    throw error;
  }
  return id;
};

// ── Two-player tables ──────────────────────────────────────────────────────
router.get("/tables", async (req, res, next) => {
  try {
    res.json(await pvp.listTables(String(req.query.game || "oshi-duel")));
  } catch (error) {
    sendGameError(res, next, error);
  }
});

router.get("/tables/mine", async (req, res, next) => {
  try {
    const userId = Number(requireUserId(req));
    res.json({ tables: pvp.tablesForUser(userId) });
  } catch (error) {
    sendGameError(res, next, error);
  }
});

router.get("/tables/:id", async (req, res, next) => {
  try {
    res.json({ table: await pvp.getTable(tableId(req)) });
  } catch (error) {
    sendGameError(res, next, error);
  }
});

router.post("/tables", async (req, res, next) => {
  try {
    const userId = Number(requireVerifiedUserId(req));
    const table = await pvp.createTable({ userId, gameKey: String(req.body?.game || ""), stake: req.body?.stake, deck: req.body?.deck });
    res.status(201).json({ table });
  } catch (error) {
    sendGameError(res, next, error);
  }
});

router.post("/tables/:id/join", async (req, res, next) => {
  try {
    const userId = Number(requireVerifiedUserId(req));
    res.json({ table: await pvp.joinTable({ userId, tableId: tableId(req), deck: req.body?.deck }) });
  } catch (error) {
    sendGameError(res, next, error);
  }
});

router.post("/tables/:id/cancel", async (req, res, next) => {
  try {
    const userId = Number(requireUserId(req));
    res.json(await pvp.cancelTable({ userId, tableId: tableId(req) }));
  } catch (error) {
    sendGameError(res, next, error);
  }
});

router.post("/tables/:id/action", async (req, res, next) => {
  try {
    const userId = Number(requireUserId(req));
    res.json({ table: await pvp.actOnTable({ userId, tableId: tableId(req), action: req.body || {} }) });
  } catch (error) {
    sendGameError(res, next, error);
  }
});

// ── Blackjack ──────────────────────────────────────────────────────────────
router.get("/blackjack", (req, res) => {
  res.json({ tables: blackjack.lobby() });
});

router.get("/blackjack/:key", (req, res, next) => {
  try {
    res.json({ table: blackjack.getTable(req.params.key) });
  } catch (error) {
    sendGameError(res, next, error);
  }
});

router.post("/blackjack/:key/sit", async (req, res, next) => {
  try {
    const userId = Number(requireVerifiedUserId(req));
    res.json({ table: await blackjack.sit({ userId, tableKey: req.params.key, seat: req.body?.seat }) });
  } catch (error) {
    sendGameError(res, next, error);
  }
});

router.post("/blackjack/:key/leave", async (req, res, next) => {
  try {
    const userId = Number(requireUserId(req));
    res.json({ table: await blackjack.leave({ userId, tableKey: req.params.key }) });
  } catch (error) {
    sendGameError(res, next, error);
  }
});

router.post("/blackjack/:key/bet", async (req, res, next) => {
  try {
    const userId = Number(requireVerifiedUserId(req));
    res.json({ table: await blackjack.bet({ userId, tableKey: req.params.key, amount: req.body?.amount }) });
  } catch (error) {
    sendGameError(res, next, error);
  }
});

router.post("/blackjack/:key/action", async (req, res, next) => {
  try {
    const userId = Number(requireUserId(req));
    res.json({ table: await blackjack.act({ userId, tableKey: req.params.key, action: String(req.body?.action || "") }) });
  } catch (error) {
    sendGameError(res, next, error);
  }
});

module.exports = router;
