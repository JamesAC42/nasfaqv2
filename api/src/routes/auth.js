const express = require("express");
const auth = require("../services/auth");

const router = express.Router();

async function verifyTurnstile(req) {
  const secret = String(process.env.TURNSTILE_SECRET_KEY || "").trim();
  if (!secret) return;

  const token = req.body?.turnstile_token || req.body?.cf_turnstile_response;
  if (!token) {
    const error = new Error("turnstile_required");
    error.code = "turnstile_required";
    throw error;
  }

  const params = new URLSearchParams();
  params.set("secret", secret);
  params.set("response", String(token));
  if (req.ip) params.set("remoteip", req.ip);

  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body: params,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.success) {
    const error = new Error("turnstile_failed");
    error.code = "turnstile_failed";
    throw error;
  }
}

router.get("/me", async (req, res) => {
  if (!req.ctx.user) {
    return res.status(401).json({ error: "unauthenticated" });
  }

  res.json({
    user: {
      id: req.ctx.user.id,
      username: req.ctx.user.username,
      email: req.ctx.user.email || null,
      email_verified: Boolean(req.ctx.user.email_verified),
      profile_picture_url: req.ctx.user.profile_picture_url || null,
      profile_color: req.ctx.user.profile_color || null,
      is_admin: Boolean(req.ctx.user.is_admin),
      can_create_prediction_markets: Boolean(req.ctx.user.can_create_prediction_markets),
      can_approve_prediction_markets: Boolean(req.ctx.user.can_approve_prediction_markets),
      can_resolve_prediction_markets: Boolean(req.ctx.user.can_resolve_prediction_markets),
      can_void_prediction_markets: Boolean(req.ctx.user.can_void_prediction_markets),
      created_at: req.ctx.user.created_at,
    },
  });
});

router.post("/register", async (req, res, next) => {
  try {
    await verifyTurnstile(req);
    const user = await auth.createUser(req.ctx.pool, {
      username: req.body?.username,
      email: req.body?.email,
      password: req.body?.password,
    });
    const session = await auth.createSession(req.ctx.pool, user.id);
    res.setHeader("Set-Cookie", session.cookie);
    res.status(201).json({ user });
  } catch (e) {
    if (e?.code === "invalid_username") return res.status(400).json({ error: "invalid_username" });
    if (e?.code === "invalid_email") return res.status(400).json({ error: "invalid_email" });
    if (e?.code === "invalid_password") return res.status(400).json({ error: "invalid_password" });
    if (e?.code === "username_taken") return res.status(409).json({ error: "username_taken" });
    if (e?.code === "email_taken") return res.status(409).json({ error: "email_taken" });
    if (e?.code === "turnstile_required" || e?.code === "turnstile_failed") return res.status(400).json({ error: e.code });
    next(e);
  }
});

router.post("/login", async (req, res, next) => {
  try {
    await verifyTurnstile(req);
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
    if (e?.code === "turnstile_required" || e?.code === "turnstile_failed") return res.status(400).json({ error: e.code });
    next(e);
  }
});

router.post("/google", async (req, res, next) => {
  try {
    await verifyTurnstile(req);
    const result = await auth.createOrLoginWithGoogle(req.ctx.pool, {
      idToken: req.body?.credential,
    });
    res.setHeader("Set-Cookie", result.session.cookie);
    res.json({ user: result.user });
  } catch (e) {
    if (
      e?.code === "google_auth_not_configured"
      || e?.code === "invalid_google_token"
      || e?.code === "google_login_failed"
      || e?.code === "turnstile_required"
      || e?.code === "turnstile_failed"
    ) return res.status(400).json({ error: e.code });
    if (e?.code === "invalid_email") return res.status(400).json({ error: "invalid_email" });
    next(e);
  }
});

router.post("/verify-email", async (req, res, next) => {
  try {
    await auth.verifyEmailToken(req.ctx.pool, req.body?.token);
    res.json({ ok: true });
  } catch (e) {
    if (e?.code === "invalid_verification_token") return res.status(400).json({ error: "invalid_verification_token" });
    next(e);
  }
});

router.post("/resend-verification", async (req, res, next) => {
  try {
    if (!req.ctx.user) return res.status(401).json({ error: "unauthenticated" });
    if (req.ctx.user.email_verified) return res.json({ ok: true });
    await auth.sendVerificationEmail(req.ctx.pool, req.ctx.user);
    res.json({ ok: true });
  } catch (e) {
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
