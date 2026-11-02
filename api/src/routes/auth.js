const express = require("express");
const auth = require("../services/auth");
const { requestIpHash } = require("../services/ipHash");
const { verifyTurnstile } = require("../services/turnstile");

const { rateLimit, byIp, byUser, hit, peek, clear, tooMany } = require("../rateLimit");

const router = express.Router();

// Answers for a failed Turnstile check: the player's to fix (400), or Cloudflare's / ours (503).
function turnstileStatus(code) {
  if (code === "turnstile_required" || code === "turnstile_failed") return 400;
  if (code === "turnstile_unavailable") return 503;
  return null;
}

router.get("/me", async (req, res) => {
  if (!req.ctx.user) {
    return res.status(401).json({ error: "unauthenticated" });
  }

  res.json({
    user: {
      // A BIGINT, which pg returns as a string. The client's ids are all numbers (see publicUser).
      id: Number(req.ctx.user.id),
      username: req.ctx.user.username,
      email: req.ctx.user.email || null,
      email_verified: Boolean(req.ctx.user.email_verified),
      profile_picture_url: req.ctx.user.profile_picture_url || null,
      profile_color: req.ctx.user.profile_color || null,
      is_admin: Boolean(req.ctx.user.is_admin),
      can_manage_assets: Boolean(req.ctx.user.can_manage_assets),
      can_create_prediction_markets: Boolean(req.ctx.user.can_create_prediction_markets),
      can_approve_prediction_markets: Boolean(req.ctx.user.can_approve_prediction_markets),
      can_resolve_prediction_markets: Boolean(req.ctx.user.can_resolve_prediction_markets),
      can_void_prediction_markets: Boolean(req.ctx.user.can_void_prediction_markets),
      created_at: req.ctx.user.created_at,
      suspension: req.ctx.user.suspension || null,
    },
  });
});

router.post("/register", rateLimit(byIp("register", 10, 3600)), async (req, res, next) => {
  try {
    await verifyTurnstile(req, { required: true });
    if (String(req.body?.ogey || "").trim() !== "rrat") {
      return res.status(400).json({ error: "invalid_ogey" });
    }
    const ipHash = requestIpHash(req);
    const user = await auth.createUser(req.ctx.pool, {
      username: req.body?.username,
      email: req.body?.email,
      password: req.body?.password,
      ipHash,
    });
    const session = await auth.createSession(req.ctx.pool, user.id, { ipHash });
    res.setHeader("Set-Cookie", session.cookie);
    res.status(201).json({ user });
  } catch (e) {
    if (e?.code === "invalid_username") return res.status(400).json({ error: "invalid_username" });
    if (e?.code === "invalid_email") return res.status(400).json({ error: "invalid_email" });
    if (e?.code === "invalid_password") return res.status(400).json({ error: "invalid_password" });
    // nameRules.js and emailRules.js
    if (["username_not_allowed", "username_reserved", "username_talent", "disposable_email"].includes(e?.code)) return res.status(400).json({ error: e.code });
    if (e?.code === "username_taken") return res.status(409).json({ error: "username_taken" });
    if (e?.code === "email_taken") return res.status(409).json({ error: "email_taken" });
    if (turnstileStatus(e?.code)) return res.status(turnstileStatus(e.code)).json({ error: e.code });
    next(e);
  }
});

// Sign-in limits. Per address, every attempt counts (30 per 5 minutes). Per account name, only wrong
// passwords count, and past 10 in 15 minutes a sign-in gets through only if it passed Turnstile: a
// stranger spamming someone's name can't lock them out, but a script without the check can't keep
// guessing. (With Turnstile on, as in production, every sign-in has passed it.)
const LOGIN_FAILURES = { name: "login-fail:name", limit: 10, windowSeconds: 900 };

router.post("/login", rateLimit(byIp("login", 30, 300)), async (req, res, next) => {
  const loginName = String(req.body?.username || "").trim();
  try {
    const passedTurnstile = await verifyTurnstile(req);
    if (!passedTurnstile && loginName) {
      const failures = await peek(req.ctx.redis, LOGIN_FAILURES.name, loginName, LOGIN_FAILURES);
      if (failures.count >= LOGIN_FAILURES.limit) return tooMany(res, failures.retryAfter);
    }
    const result = await auth.loginWithPassword(req.ctx.pool, {
      username: req.body?.username,
      password: req.body?.password,
      ipHash: requestIpHash(req),
    });
    if (loginName) await clear(req.ctx.redis, LOGIN_FAILURES.name, loginName, LOGIN_FAILURES);
    res.setHeader("Set-Cookie", result.session.cookie);
    res.json({ user: result.user });
  } catch (e) {
    if (e?.code === "invalid_username") return res.status(400).json({ error: "invalid_username" });
    if (e?.code === "invalid_password") return res.status(400).json({ error: "invalid_password" });
    if (e?.code === "invalid_credentials") {
      if (loginName) await hit(req.ctx.redis, LOGIN_FAILURES.name, loginName, LOGIN_FAILURES);
      return res.status(401).json({ error: "invalid_credentials" });
    }
    if (turnstileStatus(e?.code)) return res.status(turnstileStatus(e.code)).json({ error: e.code });
    next(e);
  }
});

// Forgot password: emails a reset link to the account named by `login` (username or email). The
// answer is the same whether or not there is one, and the email goes out after it.
const forgotLimit = rateLimit(byIp("forgot", 10, 3600), { name: "forgot:login", limit: 3, windowSeconds: 3600, key: (req) => String(req.body?.login || "").trim() || null });

router.post("/forgot-password", forgotLimit, async (req, res, next) => {
  try {
    await verifyTurnstile(req);
    const login = String(req.body?.login || "").trim();
    if (!login || login.length > 254) return res.status(400).json({ error: "invalid_login" });
    auth.requestPasswordReset(req.ctx.pool, login).catch((error) => {
      // eslint-disable-next-line no-console
      console.error("password reset request failed:", error?.message || error);
    });
    res.json({ ok: true });
  } catch (e) {
    if (turnstileStatus(e?.code)) return res.status(turnstileStatus(e.code)).json({ error: e.code });
    next(e);
  }
});

router.post("/reset-password", rateLimit(byIp("reset", 20, 3600)), async (req, res, next) => {
  try {
    const result = await auth.resetPassword(req.ctx.pool, { token: req.body?.token, password: req.body?.password, ipHash: requestIpHash(req) });
    res.setHeader("Set-Cookie", result.session.cookie);
    res.json({ user: result.user });
  } catch (e) {
    if (e?.code === "invalid_password") return res.status(400).json({ error: "invalid_password" });
    if (e?.code === "invalid_reset_token") return res.status(400).json({ error: "invalid_reset_token" });
    next(e);
  }
});

router.post("/verify-email", rateLimit(byIp("verify-email", 30, 3600)), async (req, res, next) => {
  try {
    await auth.verifyEmailToken(req.ctx.pool, req.body?.token);
    res.json({ ok: true });
  } catch (e) {
    if (e?.code === "invalid_verification_token") return res.status(400).json({ error: "invalid_verification_token" });
    next(e);
  }
});

router.post("/resend-verification", rateLimit(byUser("resend", 1, 60), byUser("resend-day", 5, 86400), byIp("resend", 10, 3600)), async (req, res, next) => {
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

// Profile settings → Account security. Both end every session the player has and hand this browser
// a fresh one, so it stays signed in while every other device is signed out.
router.post("/sign-out-everywhere", rateLimit(byUser("sign-out-everywhere", 5, 900)), async (req, res, next) => {
  try {
    if (!req.ctx.user) return res.status(401).json({ error: "unauthenticated" });
    const session = await auth.signOutEverywhere(req.ctx.pool, req.ctx.user.id, { ipHash: requestIpHash(req) });
    await auth.announceSessionsRevoked(req.ctx.redis, req.ctx.user.id);
    res.setHeader("Set-Cookie", session.cookie);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// Each try runs a full password check, so few of them; a wrong current password counts like any other.
router.post("/change-password", rateLimit(byUser("change-password", 5, 900)), async (req, res, next) => {
  try {
    if (!req.ctx.user) return res.status(401).json({ error: "unauthenticated" });
    const session = await auth.changePassword(req.ctx.pool, req.ctx.user.id, {
      currentPassword: req.body?.current_password,
      newPassword: req.body?.new_password,
      ipHash: requestIpHash(req),
    });
    await auth.announceSessionsRevoked(req.ctx.redis, req.ctx.user.id);
    res.setHeader("Set-Cookie", session.cookie);
    res.json({ ok: true });
  } catch (e) {
    if (e?.code === "invalid_password") return res.status(400).json({ error: "invalid_password" });
    if (e?.code === "wrong_password") return res.status(400).json({ error: "wrong_password" });
    next(e);
  }
});

module.exports = router;
