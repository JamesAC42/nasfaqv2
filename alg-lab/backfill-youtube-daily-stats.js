#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const { loadEnv, getConfig } = require("../api/src/config");
const { Pool } = require("../api/node_modules/pg");

const JSON_PATH = path.join(__dirname, "getStats.json");
const TARGET_START = "2026-01-02";
const TARGET_END = "2026-03-16";
const BASELINE_DATE = "2026-03-17";
const SCRAPED_AT = new Date().toISOString();
const DEFAULT_COUNTRY = "JP";

const LEGACY_SLUG_ALIASES = {
  aki: ["akirosenthal", "akirosenthalch", "akirosenthal"],
  iofi: ["iofi", "iofifteen", "airaniiofifteen"],
  moona: ["moona", "moonahoshinova"],
  roboco: ["roboco", "robocosan"],
  mel: ["mel", "yozoramel"],
  laplus: ["laplus", "laplusdarknesss", "ladarknesss"],
  koseki: ["koseki", "kosekibijou"],
  fuwamoco: ["fuwamoco", "fuwamocoabyssgard", "mococoabyssgard", "fuwawaabyssgard"],
};

function normalizeKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function parseArgs(argv) {
  const out = {
    dryRun: false,
    from: TARGET_START,
    to: TARGET_END,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") {
      out.dryRun = true;
      continue;
    }
    if (arg === "--from") {
      out.from = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg.startsWith("--from=")) {
      out.from = arg.slice("--from=".length);
      continue;
    }
    if (arg === "--to") {
      out.to = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg.startsWith("--to=")) {
      out.to = arg.slice("--to=".length);
    }
  }

  return out;
}

function parseDateArg(value, flagName) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) {
    throw new Error(`Invalid ${flagName} value "${value}", expected YYYY-MM-DD`);
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid ${flagName} value "${value}"`);
  }
  return value;
}

function loadStatsJson(filePath) {
  const payload = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (!payload || typeof payload !== "object" || !payload.stats || typeof payload.stats !== "object") {
    throw new Error(`Unexpected getStats payload shape in ${filePath}`);
  }
  return payload.stats;
}

function buildCandidateKeys(row) {
  const values = [
    row.youtube_channel_id,
    row.name_short,
    row.name_english,
    row.twitter_id,
    row.profile_id,
  ];

  const out = new Set();

  for (const raw of values) {
    const value = String(raw || "").trim().toLowerCase();
    if (!value) continue;

    out.add(normalizeKey(value));

    const tokenGroups = [
      value.split(/[^a-z0-9]+/).filter(Boolean),
      value.split("-").filter(Boolean),
    ];

    for (const tokens of tokenGroups) {
      if (tokens.length === 0) continue;
      out.add(tokens[0]);
      out.add(tokens[tokens.length - 1]);
      out.add(tokens.slice(0, 2).join(""));
      out.add(tokens.slice(-2).join(""));
      out.add(tokens.join(""));

      if (row.name_english) {
        const englishTokens = String(row.name_english)
          .toLowerCase()
          .split(/[^a-z0-9]+/)
          .filter(Boolean);
        if (englishTokens.length > 0) {
          out.add(englishTokens[0]);
          out.add(englishTokens[englishTokens.length - 1]);
        }
      }
    }
  }

  return out;
}

function buildComparisonDebug(row) {
  return {
    youtube_channel_id: row.youtube_channel_id,
    name_short: row.name_short,
    name_english: row.name_english,
    twitter_id: row.twitter_id,
    profile_id: row.profile_id,
    candidate_keys: Array.from(buildCandidateKeys(row)).sort(),
  };
}

function scoreCandidateMatch(slug, row) {
  const normalizedSlug = normalizeKey(slug);
  const english = String(row.name_english || "").toLowerCase();
  const englishTokens = english.split(/[^a-z0-9]+/).filter(Boolean);
  const candidateKeys = buildCandidateKeys(row);
  let score = 0;

  if (candidateKeys.has(normalizedSlug)) score += 100;
  if (englishTokens.includes(normalizedSlug)) score += 60;
  if (normalizeKey(row.name_short) === normalizedSlug) score += 40;
  if (normalizeKey(row.profile_id) === normalizedSlug) score += 30;
  if (normalizeKey(row.twitter_id) === normalizedSlug) score += 30;

  for (const token of englishTokens) {
    if (token.startsWith(normalizedSlug) || normalizedSlug.startsWith(token)) {
      score += 10;
    }
    if (token.includes(normalizedSlug) || normalizedSlug.includes(token)) {
      score += 5;
    }
  }

  return score;
}

function selectDebugRows(slug, rows, limit = 8) {
  return rows
    .map((row) => ({
      row,
      score: scoreCandidateMatch(slug, row),
    }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return String(a.row.name_english || a.row.name_short).localeCompare(
        String(b.row.name_english || b.row.name_short)
      );
    })
    .slice(0, limit)
    .map(({ row, score }) => ({
      score,
      ...buildComparisonDebug(row),
    }));
}

function findChannelMatch(slug, rows) {
  const normalizedSlug = normalizeKey(slug);
  const aliases = (LEGACY_SLUG_ALIASES[slug] || []).map(normalizeKey);

  const matches = rows.filter((row) => {
    const candidates = buildCandidateKeys(row);
    if (candidates.has(normalizedSlug)) return true;
    return aliases.some((alias) => candidates.has(alias));
  });

  if (matches.length === 1) {
    return { row: matches[0], error: null };
  }

  if (matches.length > 1) {
    return {
      row: null,
      error: `ambiguous_channel_mapping:${matches
        .map((row) => `${row.name_english || row.name_short} (${row.youtube_channel_id})`)
        .join(", ")}`,
      debugMatches: matches.map(buildComparisonDebug),
    };
  }

  const debugRows = selectDebugRows(slug, rows);

  return {
    row: null,
    error: "no_channel_mapping",
    debugMatches: debugRows,
  };
}

function parseMetricValue(value) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).replace(/,/g, "").trim();
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function mmddyyyy(dateKey) {
  const [year, month, day] = dateKey.split("-");
  return `${month}/${day}/${year}`;
}

function buildMetricMap(metric) {
  if (!metric || !Array.isArray(metric.labels) || !Array.isArray(metric.data)) {
    return new Map();
  }

  const out = new Map();
  const size = Math.min(metric.labels.length, metric.data.length);
  for (let i = 0; i < size; i += 1) {
    out.set(String(metric.labels[i]), parseMetricValue(metric.data[i]));
  }
  return out;
}

function* dateRange(startDateKey, endDateKey) {
  let current = new Date(`${startDateKey}T00:00:00.000Z`);
  const end = new Date(`${endDateKey}T00:00:00.000Z`);

  while (current <= end) {
    yield current.toISOString().slice(0, 10);
    current.setUTCDate(current.getUTCDate() + 1);
  }
}

function dayDiff(fromDateKey, toDateKey) {
  const from = new Date(`${fromDateKey}T00:00:00.000Z`);
  const to = new Date(`${toDateKey}T00:00:00.000Z`);
  return Math.round((to.getTime() - from.getTime()) / 86400000);
}

function resolveMetricOnDate(metricMap, dateKey) {
  const exact = metricMap.get(mmddyyyy(dateKey));
  if (exact !== null && exact !== undefined) {
    return {
      value: exact,
      sourceDate: dateKey,
      filled: false,
    };
  }

  let best = null;

  for (const [label, value] of metricMap.entries()) {
    if (value === null || value === undefined) continue;
    const [month, day, year] = String(label).split("/");
    const sourceDate = `${year.padStart(4, "0")}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
    const distance = Math.abs(dayDiff(sourceDate, dateKey));

    if (
      !best ||
      distance < best.distance ||
      (distance === best.distance && sourceDate < best.sourceDate)
    ) {
      best = {
        value,
        sourceDate,
        filled: true,
        distance,
      };
    }
  }

  if (!best) {
    return {
      value: null,
      sourceDate: null,
      filled: false,
    };
  }

  return best;
}

async function fetchExistingChannelRows(pool) {
  const { rows } = await pool.query(`
    SELECT youtube_channel_id, name_short, name_english, twitter_id, profile_id
    FROM yt.youtube_channels
    ORDER BY name_short ASC
  `);
  return rows;
}

async function fetchBaselineVideoCounts(pool, channelIds) {
  if (channelIds.length === 0) {
    return new Map();
  }

  const { rows } = await pool.query(
    `
      SELECT DISTINCT ON (youtube_channel_id)
        youtube_channel_id,
        time::date::text AS snapshot_date,
        video_count
      FROM yt.youtube_channel_daily_stats
      WHERE youtube_channel_id = ANY($1::text[])
        AND time::date = $2::date
      ORDER BY youtube_channel_id, time DESC
    `,
    [channelIds, BASELINE_DATE]
  );

  return new Map(rows.map((row) => [row.youtube_channel_id, row]));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const targetStart = parseDateArg(args.from, "--from");
  const targetEnd = parseDateArg(args.to, "--to");
  if (targetStart > targetEnd) {
    throw new Error(`Invalid date range: ${targetStart} is after ${targetEnd}`);
  }
  loadEnv();

  const { databaseUrl } = getConfig();
  if (!databaseUrl) {
    throw new Error("Missing DATABASE_URL");
  }

  const statsBySlug = loadStatsJson(JSON_PATH);

  const pool = new Pool({
    connectionString: databaseUrl,
    max: 4,
  });

  try {
    const dbChannels = await fetchExistingChannelRows(pool);
    const dbBySlug = new Map();
    const preflightSkips = [];

    for (const slug of Object.keys(statsBySlug)) {
      const match = findChannelMatch(slug, dbChannels);
      if (match.row) {
        dbBySlug.set(slug, match.row);
        continue;
      }
      preflightSkips.push({
        slug,
        reason: match.error,
        compared_db_rows: match.debugMatches || [],
      });
    }

    const resolved = [];
    const skipped = [...preflightSkips];

    for (const slug of Object.keys(statsBySlug)) {
      const dbRow = dbBySlug.get(slug);
      if (!dbRow) {
        continue;
      }
      resolved.push({
        slug,
        youtube_channel_id: dbRow.youtube_channel_id,
        name_english: dbRow.name_english,
      });
    }

    const baselineByChannelId = await fetchBaselineVideoCounts(
      pool,
      resolved.map((row) => row.youtube_channel_id)
    );

    const reportRows = [];
    let estimatedRows = 0;

    for (const { slug, youtube_channel_id, name_english } of resolved) {
      const baseline = baselineByChannelId.get(youtube_channel_id);
      if (!baseline || baseline.video_count === null) {
        skipped.push({ slug, youtube_channel_id, reason: "missing_baseline_video_count" });
        continue;
      }

      const channelStats = statsBySlug[slug];
      const subscriberMap = buildMetricMap(channelStats.subscriberCount);
      const viewMap = buildMetricMap(channelStats.viewCount);
      let availableDays = 0;
      const filledSubscriberDates = [];
      const filledViewDates = [];
      const unresolvedDates = [];

      for (const dateKey of dateRange(targetStart, targetEnd)) {
        const subscriber = resolveMetricOnDate(subscriberMap, dateKey);
        const view = resolveMetricOnDate(viewMap, dateKey);

        if (subscriber.value === null || view.value === null) {
          unresolvedDates.push({
            date: dateKey,
            subscriber_source_date: subscriber.sourceDate,
            view_source_date: view.sourceDate,
          });
          continue;
        }

        availableDays += 1;
        if (subscriber.filled) {
          filledSubscriberDates.push({
            date: dateKey,
            source_date: subscriber.sourceDate,
          });
        }
        if (view.filled) {
          filledViewDates.push({
            date: dateKey,
            source_date: view.sourceDate,
          });
        }
      }

      estimatedRows += availableDays;
      reportRows.push({
        slug,
        youtube_channel_id,
        name_english,
        baseline_video_count: Number(baseline.video_count),
        available_days: availableDays,
        filled_subscriber_dates: filledSubscriberDates,
        filled_view_dates: filledViewDates,
        unresolved_dates: unresolvedDates,
      });
    }

    reportRows.sort((a, b) => a.slug.localeCompare(b.slug));

    if (args.dryRun) {
      console.log(`Dry run report for ${targetStart} through ${targetEnd}`);
      console.log(`Resolved channels with baseline: ${reportRows.length}`);
      console.log(`Estimated rows to insert or update: ${estimatedRows}`);
      for (const row of reportRows) {
        console.log(JSON.stringify(row));
      }
      if (skipped.length > 0) {
        console.log(`Skipped items: ${skipped.length}`);
        for (const item of skipped) {
          console.log(JSON.stringify(item));
        }
      }
      return;
    }

    const insertSql = `
      INSERT INTO yt.youtube_channel_daily_stats (
        time,
        youtube_channel_id,
        subscriber_count,
        view_count,
        video_count,
        hidden_subscriber_count,
        last_upload_at,
        last_upload_video_id,
        last_live_at,
        last_live_video_id,
        country,
        scraped_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12
      )
      ON CONFLICT (youtube_channel_id, time)
      DO UPDATE SET
        subscriber_count = EXCLUDED.subscriber_count,
        view_count = EXCLUDED.view_count,
        video_count = EXCLUDED.video_count,
        hidden_subscriber_count = EXCLUDED.hidden_subscriber_count,
        last_upload_at = EXCLUDED.last_upload_at,
        last_upload_video_id = EXCLUDED.last_upload_video_id,
        last_live_at = EXCLUDED.last_live_at,
        last_live_video_id = EXCLUDED.last_live_video_id,
        country = EXCLUDED.country,
        scraped_at = EXCLUDED.scraped_at
    `;

    const client = await pool.connect();
    let insertedRows = 0;

    try {
      await client.query("BEGIN");

      for (const row of reportRows) {
        const { slug, youtube_channel_id, baseline_video_count: baselineVideoCount } = row;

        const channelStats = statsBySlug[slug];
        const subscriberMap = buildMetricMap(channelStats.subscriberCount);
        const viewMap = buildMetricMap(channelStats.viewCount);

        for (const dateKey of dateRange(targetStart, targetEnd)) {
          const subscriber = resolveMetricOnDate(subscriberMap, dateKey);
          const view = resolveMetricOnDate(viewMap, dateKey);

          if (subscriber.value === null || view.value === null) {
            skipped.push({
              slug,
              youtube_channel_id,
              date: dateKey,
              reason: "missing_metric_after_fill",
              subscriber_source_date: subscriber.sourceDate,
              view_source_date: view.sourceDate,
            });
            continue;
          }

          const daysBeforeBaseline = dayDiff(dateKey, BASELINE_DATE);
          const videoCount = Math.max(baselineVideoCount - daysBeforeBaseline, 0);

          await client.query(insertSql, [
            `${dateKey}T00:00:00.000Z`,
            youtube_channel_id,
            subscriber.value,
            view.value,
            videoCount,
            null,
            null,
            null,
            null,
            null,
            DEFAULT_COUNTRY,
            SCRAPED_AT,
          ]);

          insertedRows += 1;
        }
      }

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    console.log(`Prepared backfill for ${targetStart} through ${targetEnd}`);
    console.log(`Inserted or updated rows: ${insertedRows}`);

    if (skipped.length > 0) {
      console.log(`Skipped items: ${skipped.length}`);
      for (const item of skipped.slice(0, 100)) {
        console.log(JSON.stringify(item));
      }
      if (skipped.length > 100) {
        console.log(`... ${skipped.length - 100} more skipped items`);
      }
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
