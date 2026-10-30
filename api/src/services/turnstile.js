// Cloudflare Turnstile on sign-up, sign-in and forgot-password. It fails closed: no answer from
// Cloudflare within 5 s, or a token solved on some other site, is a failed check. Without
// TURNSTILE_SECRET_KEY the check is skipped (local development), except that production sign-up
// refuses outright, so a lost secret doesn't open sign-up to bots.

const { clientIp } = require("../rateLimit");

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const SITEVERIFY_TIMEOUT_MS = 5_000;

function turnstileError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

/**
 * Hostnames a token may have been solved on: TURNSTILE_HOSTNAMES (comma-separated), else in
 * production PUBLIC_APP_BASE_URL's host. Empty means any (development, where the test keys report
 * their own hostname).
 */
function expectedHostnames(env = process.env) {
  const listed = String(env.TURNSTILE_HOSTNAMES || "")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
  if (listed.length || env.NODE_ENV !== "production") return listed;
  try {
    return [new URL(env.PUBLIC_APP_BASE_URL).hostname.toLowerCase()];
  } catch {
    return [];
  }
}

let warnedMissingSecret = false;

/**
 * Throws { code: "turnstile_required" | "turnstile_failed" | "turnstile_unavailable" } unless the
 * request carries a token Cloudflare accepts. `required` (sign-up) refuses in production when no
 * secret is configured instead of skipping the check. Resolves true when Cloudflare accepted a
 * token, false when the check was skipped (no secret).
 */
async function verifyTurnstile(req, { required = false, env = process.env, fetchImpl = fetch, timeoutMs = SITEVERIFY_TIMEOUT_MS } = {}) {
  const secret = String(env.TURNSTILE_SECRET_KEY || "").trim();
  if (!secret) {
    if (required && env.NODE_ENV === "production") {
      if (!warnedMissingSecret) {
        warnedMissingSecret = true;
        // eslint-disable-next-line no-console
        console.error("TURNSTILE_SECRET_KEY is not set: sign-up is refused until it is");
      }
      throw turnstileError("turnstile_unavailable");
    }
    return false;
  }

  const token = req.body?.turnstile_token || req.body?.cf_turnstile_response;
  if (!token) throw turnstileError("turnstile_required");

  const params = new URLSearchParams();
  params.set("secret", secret);
  params.set("response", String(token));
  const ip = clientIp(req);
  if (ip && ip !== "unknown") params.set("remoteip", ip);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  let body;
  try {
    response = await fetchImpl(SITEVERIFY_URL, { method: "POST", body: params, signal: controller.signal });
    body = await response.json().catch(() => ({}));
  } catch {
    throw turnstileError("turnstile_unavailable");
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok || !body?.success) throw turnstileError("turnstile_failed");

  const hostnames = expectedHostnames(env);
  if (hostnames.length && !hostnames.includes(String(body.hostname || "").toLowerCase())) {
    throw turnstileError("turnstile_failed");
  }
  return true;
}

module.exports = { SITEVERIFY_TIMEOUT_MS, expectedHostnames, verifyTurnstile };
