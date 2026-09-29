// How each tagged talent "reacts" to a HoloNews headline: one of the six reaction faces the art
// pipeline draws (idle, hype, moon, cope, smug, shock). Jev reads the headline and answers one
// question per talent (a headline can be great news for one and sad news for another). Without Jev,
// or when it's unsure, a keyword read decides; nothing here writes text about anyone.
//
// Runs from the Wire scheduler every 10 minutes over recent headlines that have talents but no
// mood yet. Stored in content.news_moods (news_id, symbol) → mood; the feed and the article page
// read it and show the faces.

const jev = require("./jev");
const talents = require("./talents");

const MOODS = {
  hype: "Big exciting news for her fans: a 3D live, a debut, a new outfit or song, a concert, a big collab or announcement.",
  moon: "A celebration: a subscriber milestone, an anniversary, a birthday, a record, a chart placing.",
  smug: "She won or showed off: a tournament or bet won, beat a rival, a flex, proved someone wrong.",
  shock: "A surprise or something sudden and unexpected, good or bad: a leak, a sudden change, a plot twist.",
  cope: "Sad or bad news for her fans: a graduation, a hiatus, illness, a cancellation, a loss or a scandal.",
  idle: "Routine or neutral news: a schedule, merch, a regular stream, a mention with nothing to react to.",
};
const MOOD_KEYS = Object.keys(MOODS);
const MIN_CONFIDENCE = 0.45;
const MAX_TALENTS = 6;

// Keyword read, in order of precedence (sad news beats "announces").
const KEYWORDS = [
  ["cope", /\b(graduat\w*|hiatus|terminat\w*|illness|sick|hospital\w*|cancel\w*|postpon\w*|farewell|retir\w*|last stream|break from|lost|loses|condolence|passed away)\b/i],
  ["shock", /\b(surpris\w*|sudden\w*|shock\w*|leak\w*|unexpected\w*|reveal\w*|twist)\b/i],
  ["smug", /\b(wins?|won|victor\w*|champion\w*|beat[s]?|defeat\w*|first place|#1|number one|tops?)\b/i],
  ["moon", /\b(milestone|subscribers?|subs|anniversar\w*|birthday|record|million|chart\w*|oricon|billboard|celebrat\w*)\b/i],
  ["hype", /\b(3d|debut\w*|new outfit|outfit reveal|concert|live|announc\w*|collab\w*|original song|single|album|mv|release\w*|launch\w*|event)\b/i],
];

function keywordMood(headline) {
  for (const [mood, re] of KEYWORDS) if (re.test(headline)) return mood;
  return "idle";
}

/** Moods for each talent in a headline: Jev per talent, keywords when Jev is off, unsure or failing. */
async function judgeHeadline({ headline, summary = null }, cast) {
  const fallback = keywordMood(`${headline} ${summary ?? ""}`);
  if (!cast.length) return [];
  if (!jev.isConfigured()) return cast.map((talent) => ({ symbol: talent.symbol, mood: fallback, confidence: null, classifier: "keywords" }));
  const questions = {};
  for (const [index, talent] of cast.entries()) {
    questions[`t${index}`] = jev.choice(
      `This hololive news headline mentions ${talent.name} (a hololive VTuber). Which face would ${talent.name} make reading it, or how does it land for her fans?`,
      MOODS
    );
  }
  try {
    const { answers } = await jev.ask({ news: { headline, summary: summary || undefined } }, questions);
    return cast.map((talent, index) => {
      const answer = answers[`t${index}`];
      const confident = Number(answer?.confidence ?? 0) >= MIN_CONFIDENCE && MOOD_KEYS.includes(answer?.choice);
      return {
        symbol: talent.symbol,
        mood: confident ? answer.choice : fallback,
        confidence: answer?.confidence ?? null,
        classifier: confident ? "jev" : "keywords",
      };
    });
  } catch {
    return cast.map((talent) => ({ symbol: talent.symbol, mood: fallback, confidence: null, classifier: "keywords" }));
  }
}

/** Judges recent tagged headlines that don't have moods yet (and re-reads keyword guesses once Jev is on). */
async function runNewsMoods(pool, { limit = 30, days = 30 } = {}) {
  const retryKeywords = jev.isConfigured();
  const { rows } = await pool.query(
    `
    SELECT n.id, n.headline, array_agg(DISTINCT ma.symbol) AS symbols
    FROM info.member_news n
    JOIN info.member_news_channels c ON c.news_id = n.id
    JOIN market.market_assets ma ON ma.youtube_channel_id = c.youtube_channel_id
    WHERE n.date > (now() - ($2 || ' days')::interval)::date
      AND (
        NOT EXISTS (SELECT 1 FROM content.news_moods m WHERE m.news_id = n.id)
        OR ($3 AND EXISTS (SELECT 1 FROM content.news_moods m WHERE m.news_id = n.id AND m.classifier = 'keywords' AND m.attempts < 2))
      )
    GROUP BY n.id
    ORDER BY n.date DESC, n.id DESC
    LIMIT $1
  `,
    [limit, String(days), retryKeywords]
  );
  if (!rows.length) return { news_moods: 0 };
  const roster = await talents.loadTalents(pool);
  const names = new Map(roster.map((talent) => [talent.symbol, talent.name]));
  let judged = 0;
  for (const row of rows) {
    const cast = row.symbols.slice(0, MAX_TALENTS).map((symbol) => ({ symbol, name: names.get(symbol) ?? symbol }));
    const moods = await judgeHeadline({ headline: row.headline }, cast);
    for (const entry of moods) {
      await pool.query(
        `
        INSERT INTO content.news_moods (news_id, symbol, mood, confidence, classifier, attempts, judged_at)
        VALUES ($1, $2, $3, $4, $5, 1, now())
        ON CONFLICT (news_id, symbol) DO UPDATE
          SET mood = EXCLUDED.mood, confidence = EXCLUDED.confidence, classifier = EXCLUDED.classifier,
              attempts = content.news_moods.attempts + 1, judged_at = now()
      `,
        [row.id, entry.symbol, entry.mood, entry.confidence, entry.classifier]
      );
    }
    judged += 1;
  }
  return { news_moods: judged };
}

module.exports = { MOODS, MOOD_KEYS, keywordMood, judgeHeadline, runNewsMoods };
