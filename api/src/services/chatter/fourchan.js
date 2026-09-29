// A polite 4chan JSON API client: one request a second at most, If-Modified-Since on every call,
// and a 304 costs nothing. https://github.com/4chan/4chan-API

const API_BASE = process.env.FOURCHAN_API_BASE || "https://a.4cdn.org";
const USER_AGENT = "nasfaq-chatter/1.0 (+https://nasfaq.biz)";
const MIN_GAP_MS = 1100;

let lastRequestAt = 0;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * GET a board JSON file. Returns { status: 200, body, lastModified } or { status: 304 } or
 * { status: 404 } (thread pruned). Throws on anything else.
 */
async function getJson(path, { since = null, timeoutMs = 15_000 } = {}) {
  const wait = lastRequestAt + MIN_GAP_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = { "user-agent": USER_AGENT, accept: "application/json" };
    if (since) headers["if-modified-since"] = since;
    const response = await fetch(`${API_BASE}${path}`, { headers, signal: controller.signal });
    if (response.status === 304 || response.status === 404) return { status: response.status };
    if (!response.ok) throw new Error(`4chan ${response.status} for ${path}`);
    return { status: 200, body: await response.json(), lastModified: response.headers.get("last-modified") };
  } finally {
    clearTimeout(timer);
  }
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** A post's HTML comment as plain text: quotes (>>123) and markup removed, entities decoded. */
function postText(html) {
  return String(html || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<a [^>]*class="quotelink"[^>]*>[^<]*<\/a>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (entity, name) => ENTITIES[name.toLowerCase()] ?? entity)
    .replace(/[ \t]+/g, " ")
    .trim();
}

module.exports = { getJson, postText };
