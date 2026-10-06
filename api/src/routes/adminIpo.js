// IPO control room, mounted at /api/admin/ipo (site admins only; docs/market/ipo.md, services/ipo.js).
//
//   GET    /                       every IPO with its data funnel, prelaunch talents not in one, defaults
//   POST   /detect                 talents on hololive's site we don't track yet (services/talentDetect.js)
//   POST   /events                 create an IPO from detected talents and/or tracked prelaunch stocks
//   PATCH  /events/:id             change an announced IPO (title, listing date, window, percentages)
//   DELETE /events/:id/listings/:listingId   take a talent out of an announced IPO
//   POST   /events/:id/open        open the window now (it also opens on its own when due)
//   POST   /events/:id/list        list now: fill subscriptions and make the stocks tradable
//   POST   /events/:id/cancel      call it off; subscriptions are refunded

const express = require("express");
const ipo = require("../services/ipo");
const talentDetect = require("../services/talentDetect");
const { requireAdmin } = require("../userContext");

const router = express.Router();

const ERROR_STATUS = {
  unauthenticated: 401,
  forbidden: 403,
  ipo_not_found: 404,
  invalid_title: 400,
  invalid_listing_date: 400,
  invalid_setting: 400,
  invalid_color: 400,
  invalid_symbol: 400,
  invalid_name: 400,
  invalid_youtube_channel_id: 400,
  listing_date_past: 400,
  no_talents: 400,
  too_many_talents: 400,
  talent_not_found: 404,
  symbol_taken: 409,
  already_listed: 409,
  already_in_ipo: 409,
  ipo_not_editable: 409,
  ipo_not_announced: 409,
  ipo_not_open: 409,
  ipo_not_cancellable: 409,
  ipo_window_passed: 409,
  no_fair_value: 409,
  waiting_for_stats: 409,
};

const handle = (fn) => async (req, res, next) => {
  try {
    requireAdmin(req);
    await fn(req, res);
  } catch (error) {
    const status = ERROR_STATUS[error?.code];
    if (!status) return next(error);
    const body = { error: error.code };
    if (error.field !== undefined) body.field = error.field;
    res.status(status).json(body);
  }
};

const eventId = (req) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    const error = new Error("ipo_not_found");
    error.code = "ipo_not_found";
    throw error;
  }
  return id;
};

router.get(
  "/",
  handle(async (req, res) => {
    res.json(await ipo.getAdminOverview(req.ctx.pool));
  })
);

router.post(
  "/detect",
  handle(async (req, res) => {
    try {
      res.json(await talentDetect.detectNewTalents(req.ctx.pool));
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("talent detect failed:", error?.message || error);
      res.status(502).json({ error: "detect_failed", detail: String(error?.message || error) });
    }
  })
);

router.post(
  "/events",
  handle(async (req, res) => {
    const result = await ipo.createEvent(req.ctx.pool, req.body || {}, { adminUserId: req.ctx.user.id });
    res.status(201).json(result);
  })
);

router.patch(
  "/events/:id",
  handle(async (req, res) => {
    await ipo.updateEvent(req.ctx.pool, eventId(req), req.body || {});
    res.json({ ok: true });
  })
);

router.delete(
  "/events/:id/listings/:listingId",
  handle(async (req, res) => {
    await ipo.removeListing(req.ctx.pool, eventId(req), Number(req.params.listingId));
    res.json({ ok: true });
  })
);

router.post(
  "/events/:id/open",
  handle(async (req, res) => {
    res.json(await ipo.openWindow(req.ctx.pool, eventId(req), { force: true, redis: req.ctx.redis }));
  })
);

router.post(
  "/events/:id/list",
  handle(async (req, res) => {
    res.json(await ipo.listEvent(req.ctx.pool, eventId(req), { force: true, redis: req.ctx.redis }));
  })
);

router.post(
  "/events/:id/cancel",
  handle(async (req, res) => {
    res.json(await ipo.cancelEvent(req.ctx.pool, eventId(req), { redis: req.ctx.redis }));
  })
);

module.exports = router;
