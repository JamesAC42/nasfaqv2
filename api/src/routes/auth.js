const express = require("express");
const auth = require("../services/auth");

const router = express.Router();

router.get("/me", async (req, res) => {
  if (!req.ctx.user) {
    return res.status(401).json({ error: "unauthenticated" });
  }

  res.json({
    user: {
      id: req.ctx.user.id,
      username: req.ctx.user.username,
      created_at: req.ctx.user.created_at,
    },
  });
});

router.post("/register", async (req, res, next) => {
  try {
    const user = await auth.createUser(req.ctx.pool, {
      username: req.body?.username,
      password: req.body?.password,
    });
    const session = await auth.createSession(req.ctx.pool, user.id);
    res.setHeader("Set-Cookie", session.cookie);
    res.status(201).json({ user });
  } catch (e) {
    if (e?.code === "invalid_username") return res.status(400).json({ error: "invalid_username" });
    if (e?.code === "invalid_password") return res.status(400).json({ error: "invalid_password" });
    if (e?.code === "username_taken") return res.status(409).json({ error: "username_taken" });
    next(e);
  }
});

router.post("/login", async (req, res, next) => {
  try {
    const result = await auth.loginWithPassword(req.ctx.pool, {
      username: req.body?.username,
      password: req.body?.password,
    });
    res.setHeader("Set-Cookie", result.session.cookie);
    res.json({ user: result.user });
  } catch (e) {
    if (e?.code === "invalid_username") return res.status(400).json({ error: "invalid_username" });
    if (e?.code === "invalid_password") return res.status(400).json({ error: "invalid_password" });
    if (e?.code === "invalid_credentials") return res.status(401).json({ error: "invalid_credentials" });
    next(e);
  }
});

router.post("/logout", async (req, res, next) => {
  try {
    const token = auth.getSessionTokenFromRequest(req);
    await auth.revokeSession(req.ctx.pool, token);
    res.setHeader("Set-Cookie", auth.buildExpiredSessionCookie());
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
