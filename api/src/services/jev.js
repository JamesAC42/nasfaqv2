// Client for Jev, TypeSafe's System One model (https://docs.typesafe.ai). Jev doesn't write text:
// it answers typed questions about a piece of state (choice / score / noul) with probabilities and
// a confidence, fast and cheap. Code keeps the facts, arithmetic and actions; Jev only judges.
//
//   const jev = require("./jev");
//   if (jev.isConfigured()) {
//     const { answers } = await jev.ask({ title: "【3D LIVE】…" }, {
//       event: jev.choice("What kind of stream is this?", { three_d: "A 3D stream…", other: "Anything else" }),
//     });
//     answers.event.choice, answers.event.confidence
//   }
//
// Failures never look like answers: a timeout, a rate limit or a malformed reply throws, and the
// caller falls back to its non-Jev path ("not checked").

const ENDPOINT = process.env.JEV_API_URL || "https://api.typesafe.ai/v1/systemone";
const MODEL = process.env.JEV_MODEL || "jev-latest";

class JevError extends Error {
  constructor(message, { status = null, code = "jev_failed" } = {}) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const apiKey = () => String(process.env.JEV_API_KEY || process.env.TYPESAFE_API_KEY || "").trim();
const isConfigured = () => Boolean(apiKey());

const choice = (instructions, criteria) => ({ type: "choice", instructions, criteria });
const score = (instructions, criteria) => ({ type: "score", instructions, criteria });
const noul = (instructions, criteria = undefined) => ({ type: "noul", instructions, ...(criteria ? { criteria } : {}) });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let usage = { requests: 0, input_tokens: 0, failures: 0 };

/**
 * One request: the same state, several independent questions. Retries 429/529 with backoff.
 * Returns { answers, usage }; throws JevError otherwise.
 */
async function ask(state, questions, { timeoutMs = 15_000, attempts = 3 } = {}) {
  const key = apiKey();
  if (!key) throw new JevError("JEV_API_KEY is not set", { code: "jev_not_configured" });
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(ENDPOINT, {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify({ model: MODEL, state, questions }),
        signal: controller.signal,
      });
      if (response.status === 429 || response.status === 529) {
        lastError = new JevError(`jev ${response.status}`, { status: response.status, code: "jev_busy" });
        await sleep(500 * 2 ** (attempt - 1) + Math.random() * 250);
        continue;
      }
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new JevError(`jev ${response.status}: ${JSON.stringify(body)?.slice(0, 300)}`, { status: response.status });
      if (!body || typeof body.answers !== "object") throw new JevError("jev returned no answers", { code: "jev_malformed" });
      for (const id of Object.keys(questions)) {
        if (!body.answers[id]) throw new JevError(`jev answer missing for ${id}`, { code: "jev_malformed" });
      }
      usage.requests += 1;
      usage.input_tokens += Number(body.usage?.input_tokens ?? 0);
      return { answers: body.answers, usage: body.usage ?? null };
    } catch (error) {
      if (error instanceof JevError && error.code !== "jev_busy") {
        usage.failures += 1;
        throw error;
      }
      lastError = error.name === "AbortError" ? new JevError("jev timed out", { code: "jev_timeout" }) : error instanceof JevError ? error : new JevError(String(error?.message || error));
      if (attempt < attempts) await sleep(400 * attempt);
    } finally {
      clearTimeout(timer);
    }
  }
  usage.failures += 1;
  throw lastError ?? new JevError("jev failed");
}

/** Runs `fn` over `items` with at most `limit` in flight. */
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      out[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return out;
}

module.exports = {
  JevError,
  ask,
  choice,
  isConfigured,
  mapLimit,
  noul,
  score,
  stats: () => ({ ...usage }),
};
