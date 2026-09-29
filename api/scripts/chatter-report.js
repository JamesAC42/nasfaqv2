// Checks the /vt/ chatter numbers against the raw rows, so the Wire page can be trusted.
//
//   node scripts/chatter-report.js [days]
//
// Prints when collection started, posts per day (distinct posts, and mentions), how each talent's
// count splits between posts that name her and posts in her own threads, which threads count as
// hers, what Jev said the posts were about, and how much went unread. Read only.

const { loadEnv } = require("../src/config");
const { createPool } = require("../src/db");

async function main() {
  loadEnv();
  const days = Math.min(15, Math.max(1, Number(process.argv[2]) || 7));
  const pool = createPool(process.env.DATABASE_URL);
  const q = (sql, params = []) => pool.query(sql, params).then((result) => result.rows);
  try {
    const [range] = await q(`SELECT MIN(posted_at) AS first, MAX(posted_at) AS last, COUNT(*)::int AS mentions, COUNT(DISTINCT post_no)::int AS posts FROM content.vt_mentions`);
    console.log(`collected: ${range.first?.toISOString() ?? "nothing"} → ${range.last?.toISOString() ?? ""}  (${range.posts} posts, ${range.mentions} mentions kept)\n`);

    const perDay = await q(
      `SELECT to_char(posted_at AT TIME ZONE 'America/New_York', 'Dy MM-DD') AS day, COUNT(DISTINCT post_no)::int AS posts, COUNT(*)::int AS mentions,
              COUNT(*) FILTER (WHERE topic IN ('off_topic', 'rumour'))::int AS not_counted
       FROM content.vt_mentions WHERE posted_at > now() - ($1 || ' days')::interval
       GROUP BY 1, date_trunc('day', posted_at AT TIME ZONE 'America/New_York') ORDER BY date_trunc('day', posted_at AT TIME ZONE 'America/New_York')`,
      [String(days)]
    );
    console.log("per day (ET)            posts  mentions  not counted (off-topic/rumour)");
    for (const row of perDay) console.log(`  ${row.day.padEnd(20)} ${String(row.posts).padStart(6)} ${String(row.mentions).padStart(9)} ${String(row.not_counted).padStart(8)}`);

    const talents = await q(
      `SELECT symbol, COUNT(*)::int AS total, COUNT(*) FILTER (WHERE via = 'name')::int AS by_name, COUNT(*) FILTER (WHERE via = 'thread')::int AS in_thread,
              COUNT(*) FILTER (WHERE topic IS NULL)::int AS unread
       FROM content.vt_mentions WHERE posted_at > now() - ($1 || ' days')::interval AND (topic IS NULL OR topic NOT IN ('off_topic', 'rumour'))
       GROUP BY 1 ORDER BY 2 DESC LIMIT 15`,
      [String(days)]
    );
    console.log(`\ntop talents, last ${days} days   total  names her  in her thread  unread by Jev`);
    for (const row of talents) console.log(`  ${row.symbol.padEnd(28)} ${String(row.total).padStart(5)} ${String(row.by_name).padStart(10)} ${String(row.in_thread).padStart(14)} ${String(row.unread).padStart(14)}`);

    const threads = await q(`SELECT symbol, COUNT(*)::int AS threads, MAX(subject) AS example FROM content.vt_threads WHERE symbol IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 10`);
    console.log("\nthreads counted as one talent's own (every post in them is about her):");
    for (const row of threads) console.log(`  ${row.symbol.padEnd(6)} ${String(row.threads).padStart(3)} thread(s), e.g. "${String(row.example || "").slice(0, 70)}"`);

    const topics = await q(
      `SELECT COALESCE(topic, '(not read by Jev)') AS topic, COUNT(*)::int AS mentions FROM content.vt_mentions WHERE posted_at > now() - ($1 || ' days')::interval GROUP BY 1 ORDER BY 2 DESC`,
      [String(days)]
    );
    console.log("\nwhat the mentions were about:");
    for (const row of topics) console.log(`  ${row.topic.padEnd(22)} ${row.mentions}`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
