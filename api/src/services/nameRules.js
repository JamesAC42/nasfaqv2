// Name and word rules: what a username can't be, and the words bios, chat messages, comments and
// article titles can't contain. Every list lives here; test/name-rules.test.js covers them.
//
// Usernames (sign-up and renames) get the strict check. The name is reduced to a skeleton (lower
// case, accents and leetspeak undone: 4dm1n is admin, separators and runs of single letters joined:
// a_d_m_i_n is admin, trailing digits dropped: admin123 is admin) and refused when it
//  - contains a slur or a hate term (SLURS, HATE_TERMS) -> username_not_allowed;
//  - is or claims to be staff (RESERVED_WORDS: "nasfaq_admin", "ModBob", "official") -> username_reserved;
//  - is a talent's ticker or name (market.market_assets, yt.youtube_channels) -> username_talent.
//    Only the whole name: "Pekora" and "Usada_Pekora" are refused, "PekoraFan" is fine.
//
// Everything else people write gets the lighter check (findBlockedWord): the slurs and the hate
// phrases, as whole words, with leetspeak undone but no joining across spaces, so ordinary words
// that happen to contain one ("spicy", "raccoon", "Montenegro") get through. Swearing is allowed.
//
// Terms are written plainly so they can be reviewed. Each letter may repeat ("niiice" style) and
// still match. ANYWHERE terms match inside a longer word; WORD terms are short enough to hide in
// ordinary words, so they only match a whole word (plus a plural "s"); EDGE terms also match at the
// start or end of a username ("adminbob", "bobadmin") but not inside one ("badminton").

const ANYWHERE = "anywhere";
const EDGE = "edge";
const WORD = "word";

/** Racial, ethnic, homophobic and transphobic slurs: refused in usernames and in everything people write. */
const SLURS = [
  ["nigger", ANYWHERE],
  ["nigga", ANYWHERE],
  ["faggot", ANYWHERE],
  ["tranny", ANYWHERE],
  ["shemale", ANYWHERE],
  ["wetback", ANYWHERE],
  ["raghead", ANYWHERE],
  ["towelhead", ANYWHERE],
  ["porchmonkey", ANYWHERE],
  ["junglebunny", ANYWHERE],
  ["zipperhead", ANYWHERE],
  ["chingchong", ANYWHERE],
  ["jigaboo", ANYWHERE],
  ["spearchucker", ANYWHERE],
  ["beaner", ANYWHERE],
  ["kike", WORD],
  ["chink", WORD],
  ["gook", WORD],
  ["spic", WORD],
  ["coon", WORD],
  ["dyke", WORD],
  ["fag", WORD],
  ["paki", WORD],
  ["negro", WORD],
  ["darkie", WORD],
  ["squaw", WORD],
];

/** Hate symbols and slogans, and the worst insults: refused in usernames. */
const HATE_TERMS = [
  ["hitler", ANYWHERE],
  ["siegheil", ANYWHERE],
  ["whitepower", ANYWHERE],
  ["holohoax", ANYWHERE],
  ["gasthejews", ANYWHERE],
  ["killalljews", ANYWHERE],
  ["nazi", WORD],
  ["kkk", WORD],
  ["retard", EDGE],
];

/** Hate phrases refused in everything people write (as whole words, in this order). */
const HATE_PHRASES = ["heil hitler", "sieg heil", "gas the jews", "kill all jews", "white power", "holohoax"];

/**
 * Numbers that are hate symbols, refused in usernames (14_88 too). Not in what people write: this
 * is a stock market, and $1488 is a price.
 */
const HATE_NUMBERS = ["1488"];

/** Ordinary words that contain an ANYWHERE term. They're taken out before matching. */
const EXCEPTIONS = ["snigger", "beanery"];

/** Words that make a name look like staff or the site itself. */
const RESERVED_WORDS = [
  ["nasfaq", ANYWHERE],
  ["admin", EDGE],
  ["administrator", EDGE],
  ["moderator", EDGE],
  ["mod", WORD],
  ["staff", WORD],
  ["official", WORD],
  ["support", WORD],
  ["system", WORD],
];

// Leetspeak and look-alike symbols. 2 and 6 read as nothing in particular, so they're dropped.
const LEET = { 0: "o", 1: "i", 3: "e", 4: "a", 5: "s", 7: "t", 8: "b", 9: "g", "@": "a", $: "s", "!": "i", "|": "l", "€": "e", "£": "l" };

function foldAccents(text) {
  return String(text ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "");
}

/** Lower case, leetspeak undone, then letters only. */
function skeleton(text) {
  return [...foldAccents(text).toLowerCase()]
    .map((ch) => LEET[ch] ?? ch)
    .join("")
    .replace(/[^a-z]/g, "");
}

/** Lower case with digits dropped (so "Admin1" is admin, not admini), then letters only. */
function plainSkeleton(text) {
  return foldAccents(text).toLowerCase().replace(/[^a-z]/g, "");
}

/** "faggot" -> "f+a+g{2,}o+t+": each letter may repeat. */
function termPattern(term) {
  return term.replace(/(.)\1*/g, (run) => `${run[0]}${run.length > 1 ? `{${run.length},}` : "+"}`);
}

function compile([term, mode]) {
  const pattern = termPattern(term);
  return {
    term,
    mode,
    anywhere: new RegExp(pattern),
    word: new RegExp(`^(?:${pattern})(?:e?s)?$`),
    edge: new RegExp(`^(?:${pattern})|(?:${pattern})s?$`),
  };
}

const COMPILED_SLURS = SLURS.map(compile);
const COMPILED_HATE = HATE_TERMS.map(compile);
const COMPILED_RESERVED = RESERVED_WORDS.map(compile);
const COMPILED_PHRASES = HATE_PHRASES.map((phrase) => new RegExp(`(?:^| )${phrase.split(" ").map(termPattern).join(" +")}(?: |$)`));
const COMPILED_EXCEPTIONS = new RegExp(EXCEPTIONS.map(termPattern).join("|"), "g");

/** Whether `form` (a skeleton) has the term in it, as `entry.mode` says. */
function hasTerm(entry, form) {
  if (entry.mode === ANYWHERE) return entry.anywhere.test(form.replace(COMPILED_EXCEPTIONS, " "));
  return entry.word.test(form);
}

/**
 * A username's words, before leetspeak is undone: split at spaces, underscores and camelCase
 * ("NasfaqAdmin" -> nasfaq, admin), with runs of one-letter words joined back ("a_d_m_i_n" -> admin).
 */
function nameTokens(name) {
  const parts = String(name ?? "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .split(/[\s_]+/)
    .filter(Boolean);
  const tokens = [];
  let run = "";
  for (const part of parts) {
    if (part.length === 1) {
      run += part;
      continue;
    }
    if (run) tokens.push(run);
    run = "";
    tokens.push(part);
  }
  if (run) tokens.push(run);
  return tokens;
}

/** The forms a name is checked in: the whole name and each word, each with digits read as leetspeak and with them dropped. */
function nameForms(name) {
  const tokens = nameTokens(name);
  const variants = (text) => [...new Set([skeleton(text), plainSkeleton(text)])].filter(Boolean);
  return {
    whole: variants(tokens.join("")),
    words: tokens.flatMap(variants),
  };
}

function matchesName(entry, forms) {
  if (entry.mode === ANYWHERE) return forms.whole.some((form) => hasTerm(entry, form));
  if ([...forms.words, ...forms.whole].some((form) => entry.word.test(form))) return true;
  return entry.mode === EDGE && forms.whole.some((form) => entry.edge.test(form));
}

function hasHateNumber(text) {
  const digits = String(text ?? "").replace(/[^0-9]/g, " ").replace(/(\d)\s+(?=\d)/g, "$1");
  return HATE_NUMBERS.some((number) => digits.includes(number));
}

/** The key a talent name is compared by: lower case, letters only (accents folded, no leetspeak). */
function talentKey(text) {
  return plainSkeleton(text);
}

/**
 * Keys for one talent: the ticker, the full name in either order, and each part of the name four
 * letters or longer ("Usada Pekora" -> usadapekora, pekorausada, usada, pekora).
 */
function talentKeys({ symbol, names = [] }) {
  const keys = new Set();
  if (symbol) keys.add(talentKey(symbol));
  for (const name of names) {
    if (!name) continue;
    const parts = String(name).split(/\s+/).map(talentKey).filter(Boolean);
    keys.add(parts.join(""));
    keys.add([...parts].reverse().join(""));
    for (const part of parts) if (part.length >= 4) keys.add(part);
  }
  keys.delete("");
  return keys;
}

/**
 * Checks a username against the lists. Returns null when it's fine, else the error code:
 * username_not_allowed, username_reserved or username_talent. `talentNames` is a Set of talentKey()s.
 */
function usernameProblem(name, { talentNames = new Set() } = {}) {
  const forms = nameForms(name);
  if (hasHateNumber(name)) return "username_not_allowed";
  if ([...COMPILED_SLURS, ...COMPILED_HATE].some((entry) => matchesName(entry, forms))) return "username_not_allowed";
  if (COMPILED_RESERVED.some((entry) => matchesName(entry, forms))) return "username_reserved";
  if (forms.whole.some((form) => talentNames.has(form))) return "username_talent";
  return null;
}

/**
 * The lighter check for things people write. Returns the first blocked term found (for logs and
 * tests; the player is only told a word isn't allowed), or null.
 */
function findBlockedWord(text) {
  const raw = String(text ?? "");
  if (!raw.trim()) return null;
  // Symbols count as letters inside a word (n!gger), not around it (an @mention, "wow!").
  const words = foldAccents(raw)
    .toLowerCase()
    .split(/[^\p{L}\p{N}@$!|€£]+/u)
    .map((word) => skeleton(word.replace(/^[@!|]+|[!|]+$/g, "")))
    .filter(Boolean);
  for (const word of words) {
    const entry = COMPILED_SLURS.find((candidate) => hasTerm(candidate, word));
    if (entry) return entry.term;
  }
  const line = words.join(" ");
  const phrase = COMPILED_PHRASES.findIndex((pattern) => pattern.test(line));
  return phrase >= 0 ? HATE_PHRASES[phrase] : null;
}

function wordError(field) {
  const error = new Error("blocked_words");
  error.code = "blocked_words";
  if (field) error.field = field;
  return error;
}

/** Throws blocked_words (with `field`) when `text` has a blocked word; returns the text otherwise. */
function assertCleanText(text, field = null) {
  if (findBlockedWord(text)) throw wordError(field);
  return text;
}

// ── Talent names, from the database ────────────────────────────────────────
// Cached for a few minutes: a new IPO talent's name is reserved soon after she lists.
const TALENT_CACHE_MS = 10 * 60_000;
let talentCache = { at: 0, names: null, loading: null };

async function loadTalentNames(db) {
  const { rows } = await db.query(`
    SELECT a.symbol, ARRAY[a.display_name, c.name_short, c.name_english] AS names
    FROM market.market_assets a
    LEFT JOIN yt.youtube_channels c ON c.youtube_channel_id = a.youtube_channel_id
    UNION ALL
    SELECT c.symbol, ARRAY[c.name_short, c.name_english]
    FROM yt.youtube_channels c
    WHERE NOT EXISTS (SELECT 1 FROM market.market_assets a WHERE a.youtube_channel_id = c.youtube_channel_id)
  `);
  const names = new Set();
  for (const row of rows) for (const key of talentKeys({ symbol: row.symbol, names: row.names || [] })) names.add(key);
  return names;
}

async function talentNames(db, { now = Date.now() } = {}) {
  if (talentCache.names && now - talentCache.at < TALENT_CACHE_MS) return talentCache.names;
  if (!talentCache.loading) {
    talentCache.loading = loadTalentNames(db)
      .then((names) => {
        talentCache = { at: Date.now(), names, loading: null };
        return names;
      })
      .catch((error) => {
        talentCache.loading = null;
        throw error;
      });
  }
  return talentCache.loading;
}

function clearTalentNameCache() {
  talentCache = { at: 0, names: null, loading: null };
}

/** Throws the usernameProblem() code when `name` breaks a rule (talent names read from `db`). */
async function assertUsernameAllowed(db, name) {
  const problem = usernameProblem(name, { talentNames: await talentNames(db) });
  if (problem) {
    const error = new Error(problem);
    error.code = problem;
    throw error;
  }
  return name;
}

module.exports = {
  HATE_NUMBERS,
  HATE_PHRASES,
  HATE_TERMS,
  RESERVED_WORDS,
  SLURS,
  assertCleanText,
  assertUsernameAllowed,
  clearTalentNameCache,
  findBlockedWord,
  nameTokens,
  talentKey,
  talentKeys,
  talentNames,
  usernameProblem,
};
