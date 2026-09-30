// Account email (verification links, password resets) through Resend. Without RESEND_API_KEY and
// AUTH_EMAIL_FROM (local dev) nothing is sent: callers log the link instead.

function emailConfig(env = process.env) {
  const apiKey = String(env.RESEND_API_KEY || "").trim();
  const from = String(env.AUTH_EMAIL_FROM || "").trim();
  return apiKey && from ? { apiKey, from } : null;
}

/** The site's public URL for `path` (PUBLIC_APP_BASE_URL + path), or null when it isn't set. */
function appUrl(path, env = process.env) {
  const base = String(env.PUBLIC_APP_BASE_URL || "").trim().replace(/\/+$/, "");
  if (!base) return null;
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

/**
 * Sends one email. Returns "sent", "not_configured" or "failed"; never throws. Failures are
 * logged with Resend's status and error message (which never includes the key).
 */
async function sendEmail({ to, subject, html, text }, { env = process.env, fetchImpl = fetch, logger = console } = {}) {
  const config = emailConfig(env);
  if (!config) return "not_configured";
  try {
    const response = await fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: config.from, to, subject, html, text }),
    });
    if (response.ok) return "sent";
    const body = await response.text().catch(() => "");
    logger.error(`email "${subject}" failed: Resend ${response.status} ${body.slice(0, 300)}`);
  } catch (error) {
    logger.error(`email "${subject}" failed: ${error?.message || error}`);
  }
  return "failed";
}

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);

module.exports = { appUrl, emailConfig, escapeHtml, sendEmail };
