// The hat fitter: a local page for setting where each hat and item sits on a player's picture.
//
//   cd app-client && npm run hats      then open http://localhost:4319
//
// It lists every hat and item in the live capsule catalog (a public GET) on a sample picture, lets you nudge
// each one with the keyboard, and Save writes app/lib/hat-fit.json, which the site reads
// (app/lib/hat-fit.ts). Commit that file and deploy to ship the fits. Runs on 127.0.0.1 only.
// HAT_API=http://localhost:5067 reads the catalog from a local API instead; PORT changes the port.

import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
// HAT_FIT_FILE points it at another file (a scratch copy, to try the page without touching the real fits).
const FIT_FILE = process.env.HAT_FIT_FILE ? path.resolve(process.env.HAT_FIT_FILE) : path.resolve(here, "../../app/lib/hat-fit.json");
const PAGE = path.join(here, "index.html");
const PORT = Number(process.env.PORT || 4319);
const API = (process.env.HAT_API || "https://holo.nasfaq.biz").replace(/\/+$/, "");

const KEY = /^[a-z0-9][a-z0-9_.-]*$/i;
const LIMITS = { x: [-2, 2], y: [-2, 2], scale: [0.1, 5], rotate: [-180, 180] };
const DEFAULTS = { x: 0, y: 0, scale: 1, rotate: 0 };

const round = (value, places) => Math.round(value * 10 ** places) / 10 ** places;

/** Keeps only real hats and in-range numbers, drops anything at its default, sorts by key. */
function cleanFits(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("expected an object of hat fits");
  const out = {};
  for (const key of Object.keys(input).sort()) {
    if (!KEY.test(key)) throw new Error(`bad hat key: ${key}`);
    const fit = {};
    for (const [field, [min, max]] of Object.entries(LIMITS)) {
      const raw = input[key]?.[field];
      if (raw === undefined || raw === null) continue;
      const value = Number(raw);
      if (!Number.isFinite(value) || value < min || value > max) throw new Error(`${key}.${field} out of range: ${raw}`);
      const rounded = round(value, field === "rotate" ? 1 : 4);
      if (rounded !== DEFAULTS[field]) fit[field] = rounded;
    }
    if (Object.keys(fit).length) out[key] = fit;
  }
  return out;
}

async function readFits() {
  try {
    return JSON.parse(await readFile(FIT_FILE, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  }
}

/** Every hat and item in the capsule catalog, as the page wants them: hats first, then items. */
async function loadHats() {
  const response = await fetch(`${API}/api/games/capsule-gacha/catalog`, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`catalog request failed: HTTP ${response.status}`);
  const { rewards = [] } = await response.json();
  return rewards
    .filter((item) => ["hat", "item"].includes(item.cosmetic_type || item.type) && item.image_url)
    .map((item) => ({
      key: item.cosmetic_key || item.key,
      kind: item.cosmetic_type || item.type,
      name: item.display_name || item.cosmetic_key,
      rarity: item.rarity || "common",
      image: item.image_url,
    }))
    .sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "hat" ? -1 : 1));
}

function send(res, status, body, type = "application/json; charset=utf-8") {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1_000_000) throw new Error("body too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    if (req.method === "GET" && url.pathname === "/") return send(res, 200, await readFile(PAGE, "utf8"), "text/html; charset=utf-8");
    if (req.method === "GET" && url.pathname === "/hats") return send(res, 200, { api: API, hats: await loadHats() });
    if (req.method === "GET" && url.pathname === "/fits") return send(res, 200, await readFits());
    if (req.method === "PUT" && url.pathname === "/fits") {
      const fits = cleanFits(JSON.parse(await readBody(req)));
      await writeFile(FIT_FILE, `${JSON.stringify(fits, null, 2)}\n`);
      return send(res, 200, { saved: Object.keys(fits).length, file: path.relative(process.cwd(), FIT_FILE) });
    }
    send(res, 404, { error: "not_found" });
  } catch (error) {
    send(res, 400, { error: String(error.message || error) });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Hat fitter: http://localhost:${PORT}`);
  console.log(`  hats from ${API}`);
  console.log(`  saves to  ${path.relative(process.cwd(), FIT_FILE)}`);
});
