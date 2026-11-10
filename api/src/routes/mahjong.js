// Mahjong (docs/games/MAHJONG_DESIGN.md), under /api/games/mahjong and behind the `mahjong` flag.
//
// Two routers. `site` reads and writes the database only (the ladder, records and replays,
// tournaments and their sign-ups, a player's limits), so any API process can serve it. `live` talks
// to the tables in memory, so only the process that owns game tables serves it (server.js). Seat and
// money changes are HTTP; the table itself arrives on /api/games/ws.
//
// A signed-out visitor's practice table is theirs through its seat token alone, sent back in the
// X-Mahjong-Seat header.

const express = require("express");
const features = require("../features");
const tables = require("../services/games/mahjong/tables");
const tournaments = require("../services/games/mahjong/tournaments");
const records = require("../services/games/mahjong/records");
const limits = require("../services/games/mahjong/limits");
const ratings = require("../services/games/mahjong/ratings");
const { publicRules } = require("../services/games/mahjong/settings");
const ipHash = require("../services/ipHash");
const { requireAdmin, requireUserId, requireVerifiedUserId } = require("../userContext");
const { sendGameError } = require("./games");
const { rateLimit, byIp, byUser, clientIp } = require("../rateLimit");

const FLAG = "mahjong";
const gate = features.requireFeature(FLAG);

// Moves come one every few seconds at the fastest table; sitting down and opening tables far less.
const moveLimit = rateLimit(byUser("mahjong-move", 150, 60), byIp("mahjong-move", 300, 60));
const seatLimit = rateLimit(byUser("mahjong-seat", 20, 60));
const guestLimit = rateLimit(byIp("mahjong-guest", 12, 600));
const pickLimit = rateLimit(byUser("mahjong-pick", 20, 60));

const idOf = (value, code = "table_not_found") => {
  const id = Number.parseInt(String(value), 10);
  if (!Number.isInteger(id) || id <= 0 || String(id) !== String(value)) throw Object.assign(new Error(code), { code });
  return id;
};
const viewerId = (req) => (req.ctx?.user?.id ? Number(req.ctx.user.id) : null);
const seatToken = (req) => {
  const token = String(req.get("x-mahjong-seat") || req.body?.seat_token || "");
  return /^[0-9a-f]{32}$/.test(token) ? token : null;
};
/** Who is acting on a table: the signed-in player, or the holder of a seat token. One of them is required. */
const actor = (req) => {
  const userId = viewerId(req);
  const token = seatToken(req);
  if (!userId && !token) throw Object.assign(new Error("unauthenticated"), { code: "unauthenticated" });
  return { userId, token };
};
const wrap = (handler) => async (req, res, next) => {
  try {
    await handler(req, res);
  } catch (error) {
    sendGameError(res, next, error);
  }
};
const noStore = (res) => res.set("Cache-Control", "private, no-store");

// ── site: database only ────────────────────────────────────────────────────
const site = express.Router();
site.use(gate);

site.get(
  "/rules",
  wrap(async (req, res) => {
    res.json({ rules: publicRules(), season: ratings.seasonOf() });
  })
);

// Where the signed-in player stands: this season's rating, and the paid-game limits.
site.get(
  "/me",
  wrap(async (req, res) => {
    const userId = requireUserId(req);
    noStore(res);
    const [rating, plan] = await Promise.all([ratings.readRating(req.ctx.pool, userId), limits.readPlan(req.ctx.pool, userId)]);
    res.json({ rating: { season: rating.season, rating: rating.rating, games: rating.games, rank: rating.rank.key }, limits: plan });
  })
);

site.get(
  "/leaderboard",
  wrap(async (req, res) => {
    const season = ratings.isSeason(req.query.season) ? String(req.query.season) : ratings.seasonOf();
    const [ladder, oshi, highlights, picks] = await Promise.all([
      records.ladder(req.ctx.pool, { season }),
      records.oshiStandings(req.ctx.pool, { season }),
      records.highlights(req.ctx.pool, { season }),
      records.pickLeaders(req.ctx.pool),
    ]);
    res.json({ season, current_season: ratings.seasonOf(), ladder, oshi, picks, ...highlights });
  })
);

site.get(
  "/highlights",
  wrap(async (req, res) => {
    res.json({ season: ratings.seasonOf(), ...(await records.highlights(req.ctx.pool)), recent: await records.recentGames(req.ctx.pool, { limit: 8 }) });
  })
);

site.get(
  "/players/:username",
  wrap(async (req, res) => {
    const record = await records.playerRecord(req.ctx.pool, req.params.username);
    if (!record) return res.status(404).json({ error: "profile_not_found" });
    return res.json(record);
  })
);

// A game's record: while it's in play, the hands' results; once it's over, the whole replay and the seed.
site.get(
  "/games/:id",
  wrap(async (req, res) => {
    const record = await records.getGame(req.ctx.pool, idOf(req.params.id));
    if (!record) return res.status(404).json({ error: "table_not_found" });
    return res.json(record);
  })
);

site.get(
  "/tournaments",
  wrap(async (req, res) => {
    res.json({ tournaments: await tournaments.list(req.ctx.pool), server_time: Date.now() });
  })
);

site.get(
  "/tournaments/:id",
  wrap(async (req, res) => {
    noStore(res);
    const payload = await tournaments.get(req.ctx.pool, idOf(req.params.id, "tournament_not_found"), viewerId(req));
    if (!payload) return res.status(404).json({ error: "tournament_not_found" });
    return res.json(payload);
  })
);

site.post(
  "/tournaments",
  seatLimit,
  wrap(async (req, res) => {
    const admin = requireAdmin(req);
    const body = req.body || {};
    const tournament = await tournaments.create(req.ctx.pool, {
      name: body.name,
      seats: body.seats,
      length: body.length,
      finalLength: body.final_length,
      speed: body.speed,
      entryFee: body.entry_fee,
      startsAt: body.starts_at,
      repeatWeekly: body.repeat_weekly === true,
      createdBy: Number(admin.id),
    });
    res.status(201).json({ tournament });
  })
);

site.post(
  "/tournaments/:id/register",
  seatLimit,
  wrap(async (req, res) => {
    const userId = Number(requireVerifiedUserId(req));
    await tournaments.register(req.ctx.pool, { tournamentId: idOf(req.params.id, "tournament_not_found"), userId });
    res.status(201).json(await tournaments.get(req.ctx.pool, Number(req.params.id), userId));
  })
);

site.post(
  "/tournaments/:id/withdraw",
  seatLimit,
  wrap(async (req, res) => {
    const userId = Number(requireUserId(req));
    await tournaments.withdraw(req.ctx.pool, { tournamentId: idOf(req.params.id, "tournament_not_found"), userId });
    res.json(await tournaments.get(req.ctx.pool, Number(req.params.id), userId));
  })
);

site.post(
  "/tournaments/:id/pick",
  pickLimit,
  wrap(async (req, res) => {
    const userId = Number(requireVerifiedUserId(req));
    res.json(await tournaments.pick(req.ctx.pool, { tournamentId: idOf(req.params.id, "tournament_not_found"), userId, pickedUserId: Number(req.body?.user_id) }));
  })
);

site.post(
  "/tournaments/:id/cancel",
  wrap(async (req, res) => {
    requireAdmin(req);
    await tournaments.cancel(req.ctx.pool, { tournamentId: idOf(req.params.id, "tournament_not_found") });
    res.json({ ok: true });
  })
);

// Staff: who keeps sitting at paid tables together, and who comes out ahead.
site.get(
  "/admin/pairs",
  wrap(async (req, res) => {
    requireAdmin(req);
    noStore(res);
    res.json({ pairs: await records.pairReport(req.ctx.pool, { days: req.query.days }), linking: ipHash.ipHashingEnabled() });
  })
);

// ── live: the tables in memory ─────────────────────────────────────────────
const live = express.Router();
live.use(gate);

live.get(
  "/",
  wrap(async (req, res) => {
    const userId = viewerId(req);
    const mine = userId ? tables.tableOfUser(userId) : null;
    noStore(res);
    res.json({ ...tables.lobby(), rules: publicRules(), season: ratings.seasonOf(), my_table: mine ? { id: mine.id, kind: mine.kind, status: mine.status } : null });
  })
);

live.post(
  "/tables",
  seatLimit,
  wrap(async (req, res) => {
    const body = req.body || {};
    const kind = String(body.kind || "");
    // Practice and the tutorial are open to any account; anything with other people needs a verified one.
    const userId = Number(kind === "practice" || kind === "tutorial" ? requireUserId(req) : requireVerifiedUserId(req));
    noStore(res);
    res.status(201).json(await tables.createTable({ userId, kind, length: body.length, speed: body.speed, level: body.level, tier: body.tier, lesson: body.lesson, coach: body.coach === true }));
  })
);

// A signed-out visitor's practice hand or guided lesson.
live.post(
  "/guest",
  guestLimit,
  wrap(async (req, res) => {
    if (viewerId(req)) throw Object.assign(new Error("invalid_table"), { code: "invalid_table" });
    noStore(res);
    res.status(201).json(await tables.createGuestTable({ ipKey: clientIp(req), lesson: req.body?.lesson ?? null, level: req.body?.level === "normal" ? "normal" : "easy" }));
  })
);

live.get(
  "/rooms/:code",
  wrap(async (req, res) => {
    const id = tables.roomByCode(req.params.code);
    if (!id) return res.status(404).json({ error: "table_not_found" });
    return res.json({ table_id: id });
  })
);

live.get(
  "/tables/:id",
  wrap(async (req, res) => {
    noStore(res);
    const payload = await tables.getTable({ tableId: idOf(req.params.id), userId: viewerId(req), token: seatToken(req) });
    if (!payload) return res.status(404).json({ error: "table_not_found" });
    return res.json(payload);
  })
);

live.post(
  "/tables/:id/sit",
  seatLimit,
  wrap(async (req, res) => {
    const userId = Number(requireVerifiedUserId(req));
    noStore(res);
    res.json(await tables.joinTable({ userId, tableId: idOf(req.params.id) }));
  })
);

live.post(
  "/tables/:id/leave",
  wrap(async (req, res) => {
    res.json(await tables.leaveTable({ ...actor(req), tableId: idOf(req.params.id) }));
  })
);

live.post(
  "/tables/:id/start",
  seatLimit,
  wrap(async (req, res) => {
    const userId = Number(requireUserId(req));
    res.json(await tables.startTable({ userId, tableId: idOf(req.params.id) }));
  })
);

live.post(
  "/tables/:id/action",
  moveLimit,
  wrap(async (req, res) => {
    noStore(res);
    res.json(await tables.actOnTable({ ...actor(req), tableId: idOf(req.params.id), action: req.body?.action }));
  })
);

live.post(
  "/tables/:id/back",
  moveLimit,
  wrap(async (req, res) => {
    noStore(res);
    res.json(await tables.returnToSeat({ ...actor(req), tableId: idOf(req.params.id) }));
  })
);

live.post(
  "/tables/:id/ready",
  moveLimit,
  wrap(async (req, res) => {
    noStore(res);
    res.json(await tables.readyUp({ ...actor(req), tableId: idOf(req.params.id) }));
  })
);

live.post(
  "/tables/:id/pick",
  pickLimit,
  wrap(async (req, res) => {
    const userId = Number(requireVerifiedUserId(req));
    res.json(await tables.pickWinner({ userId, tableId: idOf(req.params.id), seat: req.body?.seat }));
  })
);

module.exports = { FLAG, live, site };
