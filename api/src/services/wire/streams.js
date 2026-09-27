// What a stream is, from its title: a 3D live, a new outfit, a birthday, a song release... Stream
// titles come from the talents' own channels, so an event found here is real news.
//
// Two judges: keyword rules (always available, JP + EN), and Jev when JEV_API_KEY is set. Jev
// handles the titles keywords miss; keywords keep it honest on the sensitive ones. Each title is
// judged once and stored in content.wire_stream_labels.

const jev = require("../jev");

// Order matters: the first rule that matches wins (a birthday 3D live is a 3D live).
const RULES = [
  ["members_only", /メン限|メンバー限定|members?[\s-]*only|member'?s[\s-]*only/i],
  ["three_d", /3d\s*(live|ライブ|配信|お披露目|showcase|stream|concert|debut)|3D(?=\s*[】\]])|【\s*3D/i],
  ["new_outfit", /new\s*outfit|新衣装|衣装お披露目|outfit\s*reveal|new\s*model|新モデル|\b[23]\.0\b/i],
  ["original_song", /original\s*song|オリジナル曲|オリ曲|\bMV\b|music\s*video|新曲/i],
  ["anniversary", /anniversary|周年/i],
  ["birthday", /birthday|誕生日|生誕/i],
  ["milestone", /万人|記念配信|milestone|\d+(\.\d+)?\s*m(il+ion)?\s*(subs|subscribers)/i],
  ["announcement", /重大告知|告知|announcement|お知らせ/i],
  ["cover_song", /歌ってみた|\bcover\b/i],
  ["endurance", /耐久|endurance|until\s+i\s+(win|clear|beat|finish)|24\s*(時間|hours?)|クリアするまで/i],
  ["karaoke", /歌枠|karaoke|singing\s*stream/i],
  ["collab", /コラボ|collab/i],
];

// What Jev chooses between. Descriptions are the criteria: concrete, with the words titles use.
const EVENTS = {
  three_d: "A 3D stream or 3D live concert, where the talent appears in a full 3D model (3D LIVE, 3D配信, 3Dライブ, 3D showcase).",
  new_outfit: "A reveal of a new outfit, hairstyle or model (new outfit, 新衣装お披露目, new model, 2.0).",
  original_song: "The premiere or release of the talent's own original song or music video (original song, オリジナル曲, MV premiere).",
  cover_song: "The premiere or release of a song cover (歌ってみた, cover).",
  birthday: "The talent's own birthday stream or birthday live (birthday, 誕生日).",
  anniversary: "A celebration of the talent's debut anniversary (anniversary, 周年記念).",
  milestone: "A celebration of reaching a subscriber milestone (e.g. 100万人記念, 1M subscribers).",
  announcement: "A stream that exists to make an announcement (重大告知, お知らせ, announcement).",
  endurance: "An endurance or marathon stream (耐久, endurance, until I win, 24 hours).",
  karaoke: "A karaoke or singing stream (歌枠, karaoke).",
  collab: "A collaboration stream with other streamers (コラボ, collab).",
  members_only: "A members-only stream (メン限, members only).",
  other: "Anything else: regular gaming, chatting, reactions, watchalongs, or a title that doesn't say.",
};

/** Which events make a headline. Karaoke and collabs happen daily; members-only is private. */
const NEWSWORTHY = new Set(["three_d", "new_outfit", "original_song", "cover_song", "birthday", "anniversary", "milestone", "announcement", "endurance"]);
/** Events where a wrong headline would be embarrassing: Jev alone isn't enough, the title must say so too. */
const NEEDS_KEYWORD = new Set(["announcement", "milestone"]);
const JEV_MIN_CONFIDENCE = 0.55;

function keywordEvent(title) {
  for (const [event, pattern] of RULES) if (pattern.test(title)) return event;
  return "other";
}

async function jevEvent(title, channelName) {
  const { answers } = await jev.ask(
    { stream_title: title, channel: channelName },
    { event: jev.choice("Using only the stream title, what kind of stream is this? Judge the title's own words, not guesses about the channel.", EVENTS) }
  );
  const answer = answers.event;
  return { event: answer.choice, confidence: Number(answer.confidence ?? 0), probabilities: answer.probabilities ?? null };
}

/** Decide one title. Returns { event, confidence, classifier, probabilities }. */
async function judgeTitle(title, channelName) {
  const keyword = keywordEvent(title);
  if (!jev.isConfigured()) return { event: keyword, confidence: null, classifier: "keywords", probabilities: null };
  let verdict;
  try {
    verdict = await jevEvent(title, channelName);
  } catch {
    return { event: keyword, confidence: null, classifier: "keywords", probabilities: null }; // not checked: keep the rule's answer
  }
  let event = verdict.event;
  if (!(event in EVENTS)) event = "other";
  if (verdict.confidence < JEV_MIN_CONFIDENCE) {
    // Unsure: take the keyword answer only if Jev also ranked it among its top two.
    const ranked = Object.entries(verdict.probabilities ?? {}).sort((a, b) => b[1] - a[1]).map(([key]) => key);
    event = keyword !== "other" && ranked.slice(0, 2).includes(keyword) ? keyword : "other";
  }
  if (NEEDS_KEYWORD.has(event) && keyword !== event) event = "other";
  if (keyword === "members_only") event = "members_only";
  return { event, confidence: verdict.confidence, classifier: "jev", probabilities: verdict.probabilities };
}

/** Labels any recent titles not judged yet (or whose title changed). */
async function labelRecentStreams(pool, { hours = 72, limit = 200 } = {}) {
  const { rows } = await pool.query(
    `
    SELECT s.video_id, s.video_title, COALESCE(c.name_english, c.name_short) AS channel_name
    FROM yt.livestream_sessions s
    JOIN yt.youtube_channels c ON c.youtube_channel_id = s.youtube_channel_id
    LEFT JOIN content.wire_stream_labels l ON l.video_id = s.video_id
    WHERE s.video_title IS NOT NULL AND s.video_title <> ''
      AND COALESCE(s.actual_start_at, s.scheduled_start_at, s.first_seen_at) > now() - ($1 || ' hours')::interval
      AND (l.video_id IS NULL OR l.title <> s.video_title)
    ORDER BY COALESCE(s.actual_start_at, s.scheduled_start_at, s.first_seen_at) DESC
    LIMIT $2
  `,
    [String(hours), limit]
  );
  const results = await jev.mapLimit(rows, 4, async (row) => {
    const verdict = await judgeTitle(row.video_title, row.channel_name);
    await pool.query(
      `
      INSERT INTO content.wire_stream_labels (video_id, title, event, confidence, classifier, probabilities, labeled_at)
      VALUES ($1,$2,$3,$4,$5,$6,now())
      ON CONFLICT (video_id) DO UPDATE SET title = EXCLUDED.title, event = EXCLUDED.event, confidence = EXCLUDED.confidence,
        classifier = EXCLUDED.classifier, probabilities = EXCLUDED.probabilities, labeled_at = now()
    `,
      [row.video_id, row.video_title, verdict.event, verdict.confidence, verdict.classifier, verdict.probabilities ? JSON.stringify(verdict.probabilities) : null]
    );
    return verdict;
  });
  return { labeled: results.length, by_jev: results.filter((result) => result.classifier === "jev").length };
}

module.exports = { EVENTS, NEWSWORTHY, RULES, judgeTitle, keywordEvent, labelRecentStreams };
