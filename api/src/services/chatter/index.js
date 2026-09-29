// The /vt/ chatter index: who hololive's corner of /vt/ is talking about right now.
//
// Every few minutes: read the board catalog, pick the hololive threads, fetch the ones that
// changed, and find which talents each new post mentions (talents.js). Jev, when set up, then
// reads each mention and says what it's about (her streams, music, hype, the market...) or that it
// isn't about her at all. Only the verdicts are kept (post number, talent, topic, time), never the
// post text, and rumours about private lives never count toward anyone's heat.

const jev = require("../jev");
const talents = require("../talents");
const fourchan = require("./fourchan");

const BOARD = process.env.CHATTER_BOARD || "vt";
const LOCK_KEY = 9_204_102;
const FIRST_SCAN_HOURS = 24;
const MAX_POST_AGE_HOURS = 48;
const MAX_THREADS_PER_TICK = 40;
const MAX_JEV_PER_TICK = Number(process.env.CHATTER_JEV_PER_TICK || 400);
const MAX_TALENTS_PER_POST = 4;
const KEEP_DAYS = 15;

/** What a mention is about. Heat leaves out `off_topic` (not her) and `rumour` (not our business). */
const TOPICS = {
  stream: "Her streams or content: what she played, did or said on stream, a stream schedule.",
  music: "Her music: songs, covers, karaoke, concerts, albums.",
  collab: "Her collabs or interactions with other talents.",
  hype: "Praise, excitement, fan love or cute moments.",
  market: "Her NASFAQ stock: price, trading, buying or selling her.",
  negative: "Criticism or complaints about her or her content.",
  rumour: "Rumours or speculation about her private life, real identity, or drama.",
  passing: "Only a passing mention, a list of names, or a greeting with no real point about her.",
  off_topic: "The name here doesn't mean this hololive talent (a common word, another person, a game character).",
};
const UNCOUNTED = new Set(["off_topic", "rumour"]);
/** Topics worth naming as the reason someone is hot. */
const SHOWN_TOPICS = new Set(["stream", "music", "collab", "hype", "market"]);

const HOLO_THREAD = /hololive|ホロライブ|\bholo(?:en|id|jp|x)?\b|\/hl[a-z]{0,3}\/|\bhlgg?\b|\bhlj\b/i;
const OTHER_AGENCY = /nijisanji|\bniji\b|vshojo|phase[\s-]*connect|\bindie\b|vspo|idol corp/i;

// ── Pure helpers (tested) ────────────────────────────────────────────────────

/** Is this catalog thread part of hololive's corner of /vt/, and is it one talent's own thread? */
function classifyThread(thread, matcher) {
  const subject = fourchan.postText(thread.sub);
  const teaser = fourchan.postText(thread.com).slice(0, 400);
  let symbol = null;
  for (const slug of talents.threadSlugs(subject)) {
    const hits = [...matcher.match(slug)].filter(([, hit]) => hit.strong);
    if (hits.length === 1) {
      symbol = hits[0][0];
      break;
    }
  }
  const text = `${subject} ${teaser}`;
  const holo = Boolean(symbol) || HOLO_THREAD.test(text) || (!OTHER_AGENCY.test(subject) && [...matcher.match(subject).values()].some((hit) => hit.strong));
  return { holo, symbol, subject: subject.slice(0, 200) };
}

/** The talents one post mentions: by name, or the thread's own talent when it names nobody. */
function mentionsForPost(text, matcher, threadSymbol) {
  const found = matcher.match(text);
  if (!found.size) return threadSymbol ? [{ symbol: threadSymbol, via: "thread", strong: true }] : [];
  // A roll call of five names isn't talk about any of them.
  if (found.size > MAX_TALENTS_PER_POST) return [];
  return [...found].map(([symbol, hit]) => ({ symbol, via: "name", strong: hit.strong }));
}

/**
 * Heat per talent from mention rows `{ symbol, posted_at, topic }` (already filtered to counted
 * topics), relative to that talent's own usual pace over the covered window.
 */
/** The leading topic when there's enough to say (3+ posts, 30%+ of them), else null. Passing mentions only lead when nothing else does. */
function moodOf(topics) {
  const entries = Object.entries(topics ?? {});
  const total = entries.reduce((sum, [, count]) => sum + count, 0);
  const ranked = entries.filter(([topic]) => topic !== "passing").sort((a, b) => b[1] - a[1]);
  const [topic, count] = ranked[0] ?? entries.sort((a, b) => b[1] - a[1])[0] ?? [null, 0];
  return topic && count >= 3 && count / Math.max(1, total) >= 0.3 ? topic : null;
}

function summarize(rows, { now = Date.now(), coveredHours, recentHours = 6 } = {}) {
  const recentCutoff = now - recentHours * 3600_000;
  const dayCutoff = now - 24 * 3600_000;
  const bySymbol = new Map();
  for (const row of rows) {
    const at = new Date(row.posted_at).getTime();
    const entry = bySymbol.get(row.symbol) ?? { symbol: row.symbol, recent: 0, day: 0, prior: 0, hourly: new Array(24).fill(0), topics: {} };
    if (at > recentCutoff) entry.recent += 1;
    else entry.prior += 1;
    if (at > dayCutoff) {
      entry.day += 1;
      const hour = Math.min(23, Math.floor((now - at) / 3600_000));
      entry.hourly[23 - hour] += 1;
      if (row.topic) entry.topics[row.topic] = (entry.topics[row.topic] ?? 0) + 1;
    }
    bySymbol.set(row.symbol, entry);
  }
  const priorHours = Math.max(1, (coveredHours ?? 0) - recentHours);
  const ready = (coveredHours ?? 0) >= 30;
  const talentsOut = [...bySymbol.values()].map((entry) => {
    const usual = (entry.prior / priorHours) * recentHours;
    const heat = ready ? (entry.recent + 3) / (usual + 3) : null;
    const counted = Object.entries(entry.topics).filter(([topic]) => SHOWN_TOPICS.has(topic));
    const topicTotal = Object.values(entry.topics).reduce((sum, count) => sum + count, 0);
    const [topTopic, topCount] = counted.sort((a, b) => b[1] - a[1])[0] ?? [null, 0];
    return {
      symbol: entry.symbol,
      posts_recent: entry.recent,
      posts_24h: entry.day,
      usual_recent: ready ? Number(usual.toFixed(1)) : null,
      heat: heat === null ? null : Number(heat.toFixed(2)),
      hourly: entry.hourly,
      topic: topCount >= 3 && topCount / Math.max(1, topicTotal) >= 0.35 ? topTopic : null,
      // What the last day's posts about her were about (Jev's reads, counted topics only), and the
      // leading one when it's clear: the Wire page shows it as her mood.
      topics: entry.topics,
      mood: moodOf(entry.topics),
    };
  });
  // Hot: well above their own usual. Busiest: simply the most posts (what shows until there's history).
  const hot = ready
    ? talentsOut
        .filter((entry) => entry.posts_recent >= 5 && entry.heat >= 1.5)
        .sort((a, b) => b.heat - a.heat || b.posts_recent - a.posts_recent)
        .slice(0, 8)
        .map((entry) => entry.symbol)
    : [];
  const busiest = talentsOut
    .filter((entry) => entry.posts_recent >= 3)
    .sort((a, b) => b.posts_recent - a.posts_recent)
    .slice(0, 8)
    .map((entry) => entry.symbol);
  return { ready, recent_hours: recentHours, covered_hours: Math.round(coveredHours ?? 0), talents: talentsOut.sort((a, b) => b.posts_24h - a.posts_24h), hot, busiest };
}

// ── Judging ─────────────────────────────────────────────────────────────────

async function judgePost({ text, subject, mentions }, names) {
  const questions = {};
  for (const mention of mentions) {
    questions[mention.symbol] = jev.choice(
      `This is an anonymous post from a hololive thread on 4chan's /vt/ board. What is the post saying about ${names.get(mention.symbol) ?? mention.symbol} (the hololive VTuber)? Judge only the post's own words.`,
      TOPICS
    );
  }
  const { answers } = await jev.ask({ thread: subject, post: text.slice(0, 900) }, questions, { timeoutMs: 12_000, attempts: 2 });
  return mentions.map((mention) => {
    const answer = answers[mention.symbol];
    const topic = answer.choice in TOPICS ? answer.choice : "passing";
    return { ...mention, topic, confidence: Number(answer.confidence ?? 0), classifier: "jev" };
  });
}

// ── Scanning ────────────────────────────────────────────────────────────────

async function loadThreadState(pool) {
  const { rows } = await pool.query(`SELECT thread_no, last_modified, last_post_no, fetched_http_date FROM content.vt_threads`);
  return new Map(rows.map((row) => [Number(row.thread_no), row]));
}

/** One pass over the board. Returns counts for the log. */
async function scanOnce(pool, { logger = console, getJson = fourchan.getJson, now = Date.now() } = {}) {
  const roster = await talents.loadTalents(pool);
  const matcher = talents.createMatcher(roster);
  const catalog = await getJson(`/${BOARD}/catalog.json`);
  if (catalog.status !== 200) return { skipped: `catalog ${catalog.status}` };

  const state = await loadThreadState(pool);
  const threads = catalog.body.flatMap((page) => page.threads ?? []);
  const changed = [];
  for (const thread of threads) {
    const kind = classifyThread(thread, matcher);
    if (!kind.holo) continue;
    const known = state.get(Number(thread.no));
    if (known && Number(known.last_modified) >= Number(thread.last_modified)) continue;
    changed.push({ thread, kind, known });
  }
  changed.sort((a, b) => Number(b.thread.last_modified) - Number(a.thread.last_modified));

  const minTime = Math.floor(now / 1000) - MAX_POST_AGE_HOURS * 3600;
  const firstTime = Math.floor(now / 1000) - FIRST_SCAN_HOURS * 3600;
  const pending = [];
  let fetched = 0;
  for (const { thread, kind, known } of changed.slice(0, MAX_THREADS_PER_TICK)) {
    const result = await getJson(`/${BOARD}/thread/${thread.no}.json`, { since: known?.fetched_http_date ?? null });
    fetched += 1;
    if (result.status !== 200) {
      await pool.query(`UPDATE content.vt_threads SET last_modified = $2, checked_at = now() WHERE thread_no = $1`, [thread.no, thread.last_modified]);
      continue;
    }
    const posts = result.body.posts ?? [];
    const lastSeen = Number(known?.last_post_no ?? 0);
    let newest = lastSeen;
    for (const post of posts) {
      newest = Math.max(newest, Number(post.no));
      if (Number(post.no) <= lastSeen) continue;
      if (Number(post.time) < (known ? minTime : firstTime)) continue;
      const text = fourchan.postText(post.com);
      if (!text) continue;
      const mentions = mentionsForPost(text, matcher, kind.symbol);
      if (mentions.length) pending.push({ post_no: Number(post.no), thread_no: Number(thread.no), time: Number(post.time), text, subject: kind.subject, mentions });
    }
    await pool.query(
      `
      INSERT INTO content.vt_threads (thread_no, subject, symbol, last_modified, last_post_no, fetched_http_date, checked_at)
      VALUES ($1,$2,$3,$4,$5,$6,now())
      ON CONFLICT (thread_no) DO UPDATE SET subject = EXCLUDED.subject, symbol = EXCLUDED.symbol, last_modified = EXCLUDED.last_modified,
        last_post_no = GREATEST(content.vt_threads.last_post_no, EXCLUDED.last_post_no), fetched_http_date = EXCLUDED.fetched_http_date, checked_at = now()
    `,
      [thread.no, kind.subject, kind.symbol, thread.last_modified, newest, result.lastModified]
    );
  }

  // Judge: Jev for as many as the tick's budget allows, the name match alone for the rest.
  const names = new Map(roster.map((talent) => [talent.symbol, talent.name]));
  const useJev = jev.isConfigured();
  let jevCalls = 0;
  const judged = await jev.mapLimit(pending, 4, async (item) => {
    if (useJev && jevCalls < MAX_JEV_PER_TICK) {
      jevCalls += 1;
      try {
        return { item, verdicts: await judgePost(item, names) };
      } catch {
        // fall through: not checked
      }
    }
    return { item, verdicts: item.mentions.map((mention) => ({ ...mention, topic: null, confidence: null, classifier: "keywords" })) };
  });

  let stored = 0;
  for (const { item, verdicts } of judged) {
    for (const verdict of verdicts) {
      const { rowCount } = await pool.query(
        `
        INSERT INTO content.vt_mentions (post_no, symbol, thread_no, posted_at, via, topic, confidence, classifier)
        VALUES ($1,$2,$3,to_timestamp($4),$5,$6,$7,$8)
        ON CONFLICT (post_no, symbol) DO NOTHING
      `,
        [item.post_no, verdict.symbol, item.thread_no, item.time, verdict.via, verdict.topic, verdict.confidence, verdict.classifier]
      );
      stored += rowCount;
    }
  }

  await pool.query(`DELETE FROM content.vt_mentions WHERE posted_at < now() - ($1 || ' days')::interval`, [String(KEEP_DAYS)]);
  await pool.query(`DELETE FROM content.vt_threads WHERE checked_at < now() - interval '4 days'`);
  summaryCache = null;
  const out = { holo_threads: changed.length, fetched, posts: pending.length, mentions: stored, jev_calls: jevCalls };
  if (stored) logger.info?.("chatter scanned", out);
  return out;
}

// ── Reading ─────────────────────────────────────────────────────────────────

let summaryCache = null;

/** Heat for every talent with recent chatter, plus the hottest few. Cached for a minute. */
async function getSummary(pool, { now = Date.now() } = {}) {
  if (summaryCache && now - summaryCache.at < 60_000) return summaryCache.value;
  const [{ rows }, coverage] = await Promise.all([
    pool.query(`
      SELECT symbol, posted_at, topic
      FROM content.vt_mentions
      WHERE posted_at > now() - interval '7 days'
        AND (topic IS NULL OR topic <> ALL($1::text[]))
    `, [[...UNCOUNTED]]),
    pool.query(`SELECT EXTRACT(EPOCH FROM (now() - MIN(posted_at))) / 3600 AS hours FROM content.vt_mentions WHERE posted_at > now() - interval '7 days'`),
  ]);
  const value = { generated_at: new Date(now).toISOString(), board: `/${BOARD}/`, ...summarize(rows, { now, coveredHours: Number(coverage.rows[0]?.hours ?? 0) }) };
  summaryCache = { at: now, value };
  return value;
}

/**
 * Posts per hour over the last `days` (board-wide, or one talent), oldest hour first and ending at
 * the current hour, plus what they were about and (board-wide) who was talked about most. Leaves
 * out off-topic and rumour mentions, like heat does.
 */
async function getHistory(pool, { days = 7, symbol = null } = {}) {
  const safeDays = Math.min(KEEP_DAYS, Math.max(1, Number.parseInt(days, 10) || 7));
  const params = [[...UNCOUNTED], String(safeDays)];
  let symbolFilter = "";
  if (symbol) {
    params.push(String(symbol).toUpperCase());
    symbolFilter = "AND symbol = $3";
  }
  const base = `FROM content.vt_mentions WHERE posted_at > date_trunc('hour', now()) - ($2 || ' days')::interval + interval '1 hour' AND (topic IS NULL OR topic <> ALL($1::text[])) ${symbolFilter}`;
  // Board-wide, a post naming two talents is one post (hourly counts are distinct posts); per talent
  // it's one post about her. "In her thread" = posts in a thread dedicated to her that don't name
  // anyone (they count as about her), as opposed to posts that name her.
  const [hours, topics, talentsResult, now, since, own] = await Promise.all([
    pool.query(`SELECT EXTRACT(EPOCH FROM date_trunc('hour', posted_at)) * 1000 AS hour, COUNT(DISTINCT post_no)::int AS posts ${base} GROUP BY 1`, params),
    // Every topic, including the ones heat leaves out (rumours, not her), and the last day's split.
    pool.query(
      `SELECT COALESCE(topic, 'unread') AS topic, COUNT(*)::int AS posts,
              COUNT(*) FILTER (WHERE posted_at > now() - interval '24 hours')::int AS day
       FROM content.vt_mentions
       WHERE posted_at > date_trunc('hour', now()) - ($1 || ' days')::interval + interval '1 hour' ${symbol ? "AND symbol = $2" : ""}
       GROUP BY 1 ORDER BY 2 DESC`,
      symbol ? [String(safeDays), String(symbol).toUpperCase()] : [String(safeDays)]
    ),
    symbol
      ? Promise.resolve({ rows: [] })
      : pool.query(`SELECT symbol, COUNT(*)::int AS posts, COUNT(*) FILTER (WHERE via = 'thread')::int AS in_thread ${base} GROUP BY 1 ORDER BY 2 DESC LIMIT 12`, params),
    pool.query(`SELECT EXTRACT(EPOCH FROM date_trunc('hour', now())) * 1000 AS hour`),
    pool.query(`SELECT MIN(posted_at) AS since FROM content.vt_mentions`),
    symbol ? pool.query(`SELECT COUNT(*) FILTER (WHERE via = 'thread')::int AS in_thread ${base}`, params) : Promise.resolve({ rows: [] }),
  ]);
  const lastHour = Number(now.rows[0].hour);
  const count = safeDays * 24;
  const start = lastHour - (count - 1) * 3600_000;
  const hourly = new Array(count).fill(0);
  for (const row of hours.rows) {
    const index = Math.round((Number(row.hour) - start) / 3600_000);
    if (index >= 0 && index < count) hourly[index] = row.posts;
  }
  const total = hourly.reduce((sum, value) => sum + value, 0);
  const peakIndex = hourly.reduce((best, value, index) => (value > hourly[best] ? index : best), 0);
  return {
    board: `/${BOARD}/`,
    symbol: symbol ? String(symbol).toUpperCase() : null,
    days: safeDays,
    start: new Date(start).toISOString(),
    hourly,
    total,
    peak: total ? { at: new Date(start + peakIndex * 3600_000).toISOString(), posts: hourly[peakIndex] } : null,
    // Every topic Jev read this week (and in the last 24 hours); `counted` false for the ones heat
    // and the totals leave out (rumours, posts that aren't about her).
    topics: topics.rows.map((row) => ({ topic: row.topic, posts: row.posts, day: row.day, counted: !UNCOUNTED.has(row.topic) })),
    talents: talentsResult.rows.map((row) => ({ symbol: row.symbol, posts: row.posts, in_thread: row.in_thread })),
    in_thread: symbol ? Number(own.rows[0]?.in_thread ?? 0) : null,
    // When collection started (the oldest mention kept). Hours before it aren't "quiet", they're
    // just not collected, and the page says so.
    collecting_since: since.rows[0]?.since ? new Date(since.rows[0].since).toISOString() : null,
  };
}

function startChatterScheduler(pool, logger = console, { intervalMs = 5 * 60_000 } = {}) {
  if (String(process.env.CHATTER_ENABLED || "").toLowerCase() === "off") return () => {};
  let running = false;
  async function tick() {
    if (running) return;
    running = true;
    let client;
    try {
      client = await pool.connect();
      const { rows } = await client.query("SELECT pg_try_advisory_lock($1) AS locked", [LOCK_KEY]);
      if (!rows[0]?.locked) return;
      try {
        await scanOnce(pool, { logger });
      } finally {
        await client.query("SELECT pg_advisory_unlock($1)", [LOCK_KEY]).catch(() => {});
      }
    } catch (error) {
      logger.warn?.("chatter scan failed", String(error?.message || error));
    } finally {
      client?.release();
      running = false;
    }
  }
  const first = setTimeout(tick, 30_000);
  const timer = setInterval(tick, intervalMs);
  first.unref?.();
  timer.unref?.();
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}

module.exports = { TOPICS, classifyThread, getHistory, getSummary, mentionsForPost, scanOnce, startChatterScheduler, summarize };
