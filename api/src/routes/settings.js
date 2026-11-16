// A player's settings (the /settings page): Notifications (services/notificationSettings.js) and
// Display (services/displaySettings.js).
// GET    /api/settings/notifications                 → { preferences, push: { available, public_key }, devices }
// PUT    /api/settings/notifications                 { preferences: { checkin_reminder_push: true, push_market: true } } → the same
//        (push_market, push_bets, push_social and push_exchange turn on pushes for those groups of the
//        bell's notifications: services/pushNotifications.js)
// POST   /api/settings/notifications/devices         { subscription } (a PushSubscription's toJSON()) → the same, plus device_id
// DELETE /api/settings/notifications/devices/:id     → the same
// POST   /api/settings/notifications/devices/remove  { endpoint }: this browser's own, when it turns push off
// GET    /api/settings/display                       → { display: { time_zone: "market" | "local" | null } }
// PUT    /api/settings/display                       { display: { time_zone: "local" } } → the same
// Signed in only. Notifications is behind the checkin-reminders flag and Display behind
// timezone-setting: 404 for anyone the section's flag is off for.

const express = require("express");
const { requireFeature } = require("../features");
const settings = require("../services/notificationSettings");
const display = require("../services/displaySettings");

const router = express.Router();

router.use("/notifications", requireFeature("checkin-reminders"));
router.use("/display", requireFeature("timezone-setting"));

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

router.get("/display", handle(async (req, userId) => ({ display: await display.getDisplaySettings(req.ctx.pool, userId) })));

router.put("/display", handle(async (req, userId) => ({ display: await display.updateDisplaySettings(req.ctx.pool, userId, req.body?.display) })));

module.exports = router;
