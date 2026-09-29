// Auto-tagging: which talents an article or news headline is about, so its stock chips (and the
// News section on each stock page) fill themselves in.
//
// The name matcher finds candidates; Jev, when set up, reads the text and says whether each one is
// really a subject or just a passing mention. Tags are only ever added, never removed: an author's
// own picks stand, and each article is judged once (an author who later removes a tag keeps it
// removed).

const jev = require("./jev");
const talents = require("./talents");

const MAX_CANDIDATES = 10;
const MAX_TAGS = 8;
const MIN_CONFIDENCE = 0.5;

const VERDICTS = {
  main: "Yes: she is one of the main subjects.",
  involved: "She takes part in, or is directly affected by, what it describes.",
  passing: "Only mentioned in passing: a list of names, a comparison, a shout-out.",
  not_her: "The name here means something or someone else.",
};

/** Markdown/HTML to plain text, trimmed to what's worth reading. */
function plain(text, limit = 6000) {
  return String(text ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[#*_>`~|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

/** Candidates with the keyword verdict: named in the title, or named strongly twice in the body. */
function candidatesFor({ title, body }, matcher) {
  const inTitle = matcher.match(title);
  const inBody = matcher.match(body);
  const symbols = new Set([...inTitle.keys(), ...inBody.keys()]);
  return [...symbols]
    .map((symbol) => {
      const t = inTitle.get(symbol);
      const b = inBody.get(symbol);
      const count = (t?.count ?? 0) * 3 + (b?.count ?? 0);
      const keyword = Boolean(t?.strong) || ((b?.strong ?? false) && (b?.count ?? 0) >= 2);
      return { symbol, count, keyword };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, MAX_CANDIDATES);
}

/** Decide which candidates to tag. Returns { symbols, classifier }. */
async function judge({ title, body, kind }, candidates, names) {
  if (!candidates.length) return { symbols: [], classifier: "keywords" };
  const byKeyword = candidates.filter((candidate) => candidate.keyword).map((candidate) => candidate.symbol);
  if (!jev.isConfigured()) return { symbols: byKeyword.slice(0, MAX_TAGS), classifier: "keywords" };
  const questions = {};
  for (const candidate of candidates) {
    questions[candidate.symbol] = jev.choice(`Is this ${kind} about ${names.get(candidate.symbol) ?? candidate.symbol} (the hololive VTuber)?`, VERDICTS);
  }
  try {
    const { answers } = await jev.ask({ [kind]: { title, text: body || undefined } }, questions);
    const symbols = candidates
      .filter((candidate) => {
        const answer = answers[candidate.symbol];
        const yes = answer.choice === "main" || answer.choice === "involved";
        // Unsure either way: fall back to what the names alone say.
        return Number(answer.confidence ?? 0) >= MIN_CONFIDENCE ? yes : candidate.keyword;
      })
      .map((candidate) => candidate.symbol);
    return { symbols: symbols.slice(0, MAX_TAGS), classifier: "jev" };
  } catch {
    return { symbols: byKeyword.slice(0, MAX_TAGS), classifier: "keywords" };
  }
}

async function logJudged(pool, kind, refId, symbols, classifier) {
  await pool.query(
    `
    INSERT INTO content.autotag_log (kind, ref_id, symbols, classifier, judged_at) VALUES ($1,$2,$3,$4,now())
    ON CONFLICT (kind, ref_id) DO UPDATE SET symbols = EXCLUDED.symbols, classifier = EXCLUDED.classifier, judged_at = now()
  `,
    [kind, refId, symbols, classifier]
  );
}

/** Player-written articles published in the last month that haven't been judged yet. */
async function tagArticles(pool, matcher, names, { limit = 25 } = {}) {
  const { rows } = await pool.query(
    `
    SELECT a.id, a.title, a.subtitle, a.content,
           COALESCE(ARRAY(SELECT ma.symbol FROM content.article_assets aa JOIN market.market_assets ma ON ma.id = aa.asset_id WHERE aa.article_id = a.id), '{}') AS tagged
    FROM content.articles a
    WHERE a.is_news = FALSE AND a.status = 'published' AND a.published_at > now() - interval '30 days'
      AND NOT EXISTS (SELECT 1 FROM content.autotag_log l WHERE l.kind = 'article' AND l.ref_id = a.id)
    ORDER BY a.published_at DESC
    LIMIT $1
  `,
    [limit]
  );
  let added = 0;
  for (const row of rows) {
    const text = { title: [row.title, row.subtitle].filter(Boolean).join(" — "), body: plain(row.content), kind: "article" };
    const tagged = new Set(row.tagged.map((symbol) => String(symbol).toUpperCase()));
    const candidates = candidatesFor(text, matcher).filter((candidate) => !tagged.has(candidate.symbol));
    const { symbols, classifier } = await judge(text, candidates, names);
    const room = Math.max(0, MAX_TAGS - tagged.size);
    const toAdd = symbols.slice(0, room);
    if (toAdd.length) {
      const result = await pool.query(
        `
        INSERT INTO content.article_assets (article_id, asset_id, source)
        SELECT $1, ma.id, 'auto' FROM market.market_assets ma WHERE ma.symbol = ANY($2::text[])
        ON CONFLICT DO NOTHING
      `,
        [row.id, toAdd]
      );
      added += result.rowCount;
    }
    await logJudged(pool, "article", row.id, toAdd, classifier);
  }
  return { articles: rows.length, article_tags: added };
}

/** HoloNews headlines from the last two weeks that came out of the rollup with no talent at all. */
async function tagNews(pool, matcher, names, { limit = 40 } = {}) {
  const { rows } = await pool.query(
    `
    SELECT n.id, n.headline
    FROM info.member_news n
    WHERE n.date > (now() - interval '14 days')::date
      AND NOT EXISTS (SELECT 1 FROM info.member_news_channels c WHERE c.news_id = n.id)
      AND NOT EXISTS (SELECT 1 FROM content.autotag_log l WHERE l.kind = 'news' AND l.ref_id = n.id)
    ORDER BY n.date DESC, n.id DESC
    LIMIT $1
  `,
    [limit]
  );
  let added = 0;
  for (const row of rows) {
    const text = { title: row.headline, body: "", kind: "news headline" };
    const { symbols, classifier } = await judge(text, candidatesFor(text, matcher), names);
    if (symbols.length) {
      const result = await pool.query(
        `
        INSERT INTO info.member_news_channels (news_id, youtube_channel_id)
        SELECT $1, ma.youtube_channel_id FROM market.market_assets ma
        WHERE ma.symbol = ANY($2::text[]) AND ma.youtube_channel_id IS NOT NULL
        ON CONFLICT DO NOTHING
      `,
        [row.id, symbols]
      );
      added += result.rowCount;
      // The article page for this headline, if someone's opened it already.
      await pool.query(
        `
        INSERT INTO content.article_assets (article_id, asset_id, source)
        SELECT a.id, ma.id, 'auto' FROM content.articles a JOIN market.market_assets ma ON ma.symbol = ANY($2::text[])
        WHERE a.news_id = $1
        ON CONFLICT DO NOTHING
      `,
        [row.id, symbols]
      );
    }
    await logJudged(pool, "news", row.id, symbols, classifier);
  }
  return { news: rows.length, news_tags: added };
}

async function runAutotag(pool) {
  const roster = await talents.loadTalents(pool);
  const matcher = talents.createMatcher(roster);
  const names = new Map(roster.map((talent) => [talent.symbol, talent.name]));
  const articles = await tagArticles(pool, matcher, names);
  const news = await tagNews(pool, matcher, names).catch((error) => ({ news_error: String(error?.message || error) }));
  return { ...articles, ...news };
}

module.exports = { VERDICTS, candidatesFor, judge, plain, runAutotag };
