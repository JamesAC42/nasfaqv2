// A player's settings (the /settings page). So far only Notifications (services/notificationSettings.js):
// GET    /api/settings/notifications                 → { preferences, push: { available, public_key }, devices }
// PUT    /api/settings/notifications                 { preferences: { checkin_reminder_push: true, push_market: true } } → the same
//        (push_market, push_bets, push_social and push_exchange turn on pushes for those groups of the
//        bell's notifications: services/pushNotifications.js)
// POST   /api/settings/notifications/devices         { subscription } (a PushSubscription's toJSON()) → the same, plus device_id
// DELETE /api/settings/notifications/devices/:id     → the same
// POST   /api/settings/notifications/devices/remove  { endpoint }: this browser's own, when it turns push off
// Signed in only. Behind the checkin-reminders flag: 404 for anyone it's off for.

const express = require("express");
const { requireFeature } = require("../features");
const settings = require("../services/notificationSettings");

const router = express.Router();

router.use("/notifications", requireFeature("checkin-reminders"));

const handle = (work) => async (req, res, next) => {
  try {
    if (!req.ctx?.user?.id) return res.status(401).json({ error: "unauthenticated" });
    res.set("Cache-Control", "no-store");
    res.json(await work(req, Number(req.ctx.user.id)));
  } catch (error) {
    if (error?.status) return res.status(error.status).json({ error: error.code });
    next(error);
  }
};

router.get("/notifications", handle((req, userId) => settings.getSettings(req.ctx.pool, userId)));

router.put("/notifications", handle((req, userId) => settings.updatePreferences(req.ctx.pool, userId, req.body?.preferences)));

router.post(
  "/notifications/devices",
  handle((req, userId) => settings.addDevice(req.ctx.pool, userId, req.body?.subscription, { userAgent: req.headers["user-agent"] }))
);

router.post("/notifications/devices/remove", handle((req, userId) => settings.removeDeviceByEndpoint(req.ctx.pool, userId, req.body?.endpoint)));

router.delete("/notifications/devices/:id", handle((req, userId) => settings.removeDevice(req.ctx.pool, userId, req.params.id)));

module.exports = router;
