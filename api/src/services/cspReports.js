// Content-Security-Policy violation reports (the policy is in app-client/next.config.ts). Browsers
// post them to /api/site/csp-report in one of two shapes: the old report-uri one
// ({ "csp-report": { ... } }, application/csp-report) or the Reporting API's
// ([{ type: "csp-violation", body: { ... } }], application/reports+json).
//
// Each one is boiled down to the directive and what it blocked (an origin, or inline / eval / data
// / blob), counted per day in Redis (csp:violations:YYYY-MM-DD, kept two weeks), and each new pair
// logged once per process. Before the policy is enforced, `HGETALL csp:violations:<day>` says what
// real pages load that it would block. Nothing about who sent it is kept.

const KEY_PREFIX = "csp:violations:";
const KEEP_SECONDS = 14 * 86_400;
const MAX_PER_REQUEST = 20;
const logged = new Set();

/** What a blocked-uri / blockedURL names: an origin, or a keyword for what isn't one. */
function blockedSource(value) {
  const text = String(value ?? "").trim().toLowerCase();
  if (!text) return "unknown";
  if (["inline", "eval", "wasm-eval", "self", "trusted-types-policy", "trusted-types-sink"].includes(text)) return text;
  if (/^(data|blob|about|chrome-extension|moz-extension|safari-extension|safari-web-extension):/.test(text)) return text.split(":")[0];
  try {
    return new URL(text).origin.slice(0, 120);
  } catch {
    return text.slice(0, 60);
  }
}

/** The violations in a report body, as [{ directive, blocked, disposition }]. */
function parseReports(body) {
  const items = Array.isArray(body) ? body : [body];
  const out = [];
  for (const item of items.slice(0, MAX_PER_REQUEST)) {
    if (!item || typeof item !== "object") continue;
    const report = item["csp-report"] || (item.type === "csp-violation" ? item.body : null);
    if (!report || typeof report !== "object") continue;
    const directive = String(report["effective-directive"] || report.effectiveDirective || report["violated-directive"] || report.violatedDirective || "")
      .trim()
      .split(/\s+/)[0]
      .toLowerCase()
      .slice(0, 40);
    if (!directive) continue;
    out.push({
      directive,
      blocked: blockedSource(report["blocked-uri"] ?? report.blockedURL),
      disposition: String(report.disposition || "").toLowerCase() === "enforce" ? "enforce" : "report",
    });
  }
  return out;
}

function dayKey(now = new Date()) {
  return `${KEY_PREFIX}${now.toISOString().slice(0, 10)}`;
}

/** Counts the violations in `body`; returns how many it found. */
async function recordReports(redis, body, { logger = console } = {}) {
  const violations = parseReports(body);
  if (!violations.length) return 0;
  const key = dayKey();
  if (redis) {
    const multi = redis.multi();
    for (const { directive, blocked, disposition } of violations) multi.hIncrBy(key, `${disposition} ${directive} ${blocked}`, 1);
    multi.expire(key, KEEP_SECONDS);
    await multi.exec().catch(() => {});
  }
  for (const { directive, blocked, disposition } of violations) {
    const pair = `${disposition} ${directive} ${blocked}`;
    if (logged.has(pair)) continue;
    if (logged.size < 1000) logged.add(pair);
    logger.warn?.(`csp ${disposition === "enforce" ? "blocked" : "would block"}: ${directive} ${blocked}`);
  }
  return violations.length;
}

module.exports = { KEY_PREFIX, blockedSource, dayKey, parseReports, recordReports };
