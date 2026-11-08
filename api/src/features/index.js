// Feature flags: new things stay with staff until they're ready, then a one-line PR turns them on.
// Each flag is one JSON file in this folder (README.md has the how-to). The API decides who sees
// what; the client only hides what the API already withholds.
//
// - A flag is "off" (nobody), "staff" (admins, so the owner can preview in production) or "on"
//   (everyone).
// - forViewer(user): every flag as that viewer resolves it (GET /api/features).
// - isEnabled(flag, user), and requireFeature(flag): Express middleware that 404s anyone without it.
// - A flag's "fields" are payload keys only its viewers get: forAudience(payload, audience) drops
//   them anywhere in a payload for everyone else. Shared caches build one copy per audience
//   (responseCache's `features` option, cacheKey); the market socket sends staff their own copy.
//
// Only being an admin changes how a flag resolves, so a viewer's audience ("staff" or "everyone")
// is all a cached copy depends on. Anonymous visitors and players always see the same thing.

const fs = require("node:fs");
const path = require("node:path");

const STATES = ["off", "staff", "on"];
const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const STAFF_SUFFIX = "|staff";

function readFlags(dir = __dirname) {
  const flags = new Map();
  for (const file of fs.readdirSync(dir).filter((name) => name.endsWith(".json")).sort()) {
    const key = file.slice(0, -".json".length);
    if (!NAME.test(key)) throw new Error(`feature flag ${file}: name it in lowercase words joined by hyphens`);
    let spec;
    try {
      spec = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
    } catch (error) {
      throw new Error(`feature flag ${key}: ${error.message}`);
    }
    if (!STATES.includes(spec?.state)) throw new Error(`feature flag ${key}: "state" must be one of ${STATES.join(", ")}`);
    if (typeof spec.description !== "string" || !spec.description.trim()) throw new Error(`feature flag ${key}: needs a "description"`);
    const fields = spec.fields ?? [];
    if (!Array.isArray(fields) || fields.some((field) => typeof field !== "string" || !field)) {
      throw new Error(`feature flag ${key}: "fields" must be a list of payload keys`);
    }
    flags.set(key, { key, state: spec.state, description: spec.description.trim(), fields: [...fields] });
  }
  return flags;
}

let flags = readFlags();
const warned = new Set();

function flagOf(key) {
  const flag = flags.get(key);
  if (!flag && !warned.has(key)) {
    warned.add(key);
    // eslint-disable-next-line no-console
    console.error(`unknown feature flag "${key}": treated as off (is there a file for it in api/src/features?)`);
  }
  return flag ?? null;
}

const isStaff = (user) => Boolean(user?.is_admin);
const audienceOf = (user) => (isStaff(user) ? "staff" : "everyone");
const allows = (state, audience) => state === "on" || (state === "staff" && audience === "staff");

/** Whether `flag` is on for this audience ("staff" or "everyone"). Unknown flags are off. */
function enabledFor(key, audience) {
  const flag = flagOf(key);
  return Boolean(flag) && allows(flag.state, audience);
}

/** Whether `flag` is on for this user (null when signed out). */
const isEnabled = (key, user) => enabledFor(key, audienceOf(user));

/** Whether `flag` is at "staff": its answer then depends on who's asking. */
const staffOnly = (key) => flagOf(key)?.state === "staff";

/** Every flag as this viewer resolves it: { "tick-reasons": true, ... }. */
function forViewer(user) {
  const audience = audienceOf(user);
  return Object.fromEntries([...flags.values()].map((flag) => [flag.key, allows(flag.state, audience)]));
}

/** Whether staff get anything in a payload that everyone else doesn't (a flag with fields at "staff"). */
const staffSeesMore = () => [...flags.values()].some((flag) => flag.state === "staff" && flag.fields.length > 0);

/** The payload keys this audience doesn't get. */
function hiddenFields(audience) {
  const hidden = new Set();
  for (const flag of flags.values()) if (!allows(flag.state, audience)) for (const field of flag.fields) hidden.add(field);
  return hidden;
}

function omit(value, hidden) {
  if (Array.isArray(value)) return value.map((item) => omit(item, hidden));
  if (!value || typeof value !== "object" || value instanceof Date) return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !hidden.has(key)).map(([key, item]) => [key, omit(item, hidden)]));
}

/** The payload as this audience may see it: every gated field it doesn't get is dropped, at any depth. */
function forAudience(payload, audience) {
  const hidden = hiddenFields(audience);
  return hidden.size ? omit(payload, hidden) : payload;
}

/** One event as each audience gets it: { everyone, staff } JSON texts (the same text when nothing differs). */
function audienceTexts(payload) {
  const everyone = JSON.stringify(forAudience(payload, "everyone"));
  return { everyone, staff: staffSeesMore() ? JSON.stringify(forAudience(payload, "staff")) : everyone };
}

/**
 * The shared-cache key for this viewer's copy of `key`: staff get their own while they see more than
 * everyone else, so a staff copy is never served to anyone else.
 */
const cacheKey = (key, user) => (isStaff(user) && staffSeesMore() ? `${key}${STAFF_SUFFIX}` : key);

/** Every copy of these keys, for clearing a cache whatever the flags say. */
const cacheKeyVariants = (keys) => keys.flatMap((key) => [key, `${key}${STAFF_SUFFIX}`]);

/** The response differs by viewer: no shared cache (a proxy, a CDN) may keep it. */
function markPrivate(res) {
  res.locals.privateCache = true;
  res.setHeader("Cache-Control", "private, no-cache");
}

/** For a response that went through forAudience: private while staff see more than everyone else. */
function viewerVaries(res) {
  if (staffSeesMore()) markPrivate(res);
}

/** Express middleware: 404 for anyone `flag` isn't on for (and private while it's staff-only). */
function requireFeature(key) {
  return (req, res, next) => {
    if (staffOnly(key)) markPrivate(res);
    if (isEnabled(key, req.ctx?.user ?? null)) return next();
    return res.status(404).json({ error: "not_found" });
  };
}

/** Every flag with its state and description (tests, and anything listing them). */
const list = () => [...flags.values()].map((flag) => ({ ...flag, fields: [...flag.fields] }));

/**
 * For tests only: sets flags ({ "tick-reasons": "on" }, or { "x": { state: "staff", fields: ["y"] } })
 * until the returned function is called. A key without a file becomes a flag for the duration.
 */
function override(changes) {
  const before = flags;
  flags = new Map(before);
  for (const [key, change] of Object.entries(changes)) {
    const { state, fields } = typeof change === "string" ? { state: change } : change;
    if (!STATES.includes(state)) throw new Error(`feature flag ${key}: unknown state ${state}`);
    const current = flags.get(key) ?? { key, description: "test flag", fields: [] };
    flags.set(key, { ...current, state, fields: fields ? [...fields] : current.fields });
  }
  return () => {
    flags = before;
  };
}

module.exports = {
  STATES,
  audienceOf,
  audienceTexts,
  cacheKey,
  cacheKeyVariants,
  enabledFor,
  forAudience,
  forViewer,
  isEnabled,
  list,
  markPrivate,
  override,
  readFlags,
  requireFeature,
  staffOnly,
  staffSeesMore,
  viewerVaries,
};
