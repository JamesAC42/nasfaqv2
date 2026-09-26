// Copies production's public data (YouTube stats, streams, superchats, the market's prices and
// history, news) into a LOCAL database, so development has a full, real dataset. No user data is
// read or copied: accounts, sessions, portfolios, trades, chat, comments and games stay local.
//
//   PROD_DATABASE_URL=postgres://nasfaq_diagnostics:…@host:port/tsdb?sslmode=require \
//     node scripts/pull-prod.js                 into a fresh local database (see below)
//     node scripts/pull-prod.js --refresh       top up YouTube/stream/superchat/news data only
//     node scripts/pull-prod.js --days=60       how far back the heavy time series go (default 180; 14 on --refresh)
//     node scripts/pull-prod.js --dry-run       show what would be copied
//
// Fresh load: create an empty local database, point DATABASE_URL at it, run `node scripts/migrate.js`,
// then this script. It refuses to mix production rows into a database that already has seed talents
// (their ids would collide); use a new database instead.
//
// Production is only ever read: one READ ONLY, REPEATABLE READ transaction (a consistent snapshot),
// streamed through a cursor. The local target must be localhost.

const { Client } = require("pg");
const { loadEnv } = require("../src/config");

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const option = (name, fallback) => {
  const hit = argv.find((arg) => arg.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const REFRESH = flag("refresh");
// Heavy time series go back this far on a fresh load; a refresh only re-reads the last two weeks.
const DAYS = Math.max(1, Number(option("days", REFRESH ? 14 : 180)) || 180);
const DRY = flag("dry-run");
const BATCH = 2000;

// Tables copied, and how. `time`: column bounding heavy time series to the last --days.
// `where`: extra filter. `upsert`: rows that may already exist locally get updated (by primary key).
// `refresh`: included in --refresh runs (source data only; the local market evolves on its own).
const TABLES = [
  { name: "yt.youtube_channels", refresh: true, upsert: true },
  { name: "market.fundamental_formula_versions", upsert: true },
  { name: "yt.youtube_channel_daily_stats", refreshTime: "time", refresh: true },
  { name: "yt.youtube_channel_livestream_stats", refresh: true, upsert: true },
  { name: "yt.livestream_sessions", time: "actual_start_at", refresh: true, upsert: true },
  { name: "yt.livestream_viewer_buckets_5m", time: "bucket_start", refresh: true, upsert: true },
  { name: "yt.youtube_superchats", time: "date", refresh: true, upsert: true },
  { name: "yt.youtube_superchat_currency_breakdowns", refresh: true, upsert: true },
  { name: "market.channel_daily_snapshots" },
  { name: "market.market_assets" },
  { name: "market.asset_daily_market_state" },
  { name: "market.asset_price_events", time: "ts" },
  { name: "market.adjustment_sessions" },
  { name: "market.asset_adjustment_intervals" },
  { name: "market.fundamental_calculation_runs" },
  { name: "market.market_settlement_runs" },
  { name: "market.daily_market_reports" },
  { name: "market.market_runtime_state", upsert: true },
  { name: "market.emojis" },
  { name: "market.profile_pictures" },
  { name: "info.member_news", refresh: true, upsert: true },
  { name: "info.member_news_channels", refresh: true },
  // HoloNews articles only (no author): player-written articles belong to users.
  { name: "content.articles", where: "author_id IS NULL", refresh: true },
  { name: "content.article_assets", refresh: true },
  { name: "games.gacha_prize_items" },
];

function assertLocal(url) {
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    throw new Error("DATABASE_URL is missing or invalid");
  }
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(host)) throw new Error(`refusing to write to ${host}: the target must be a local database`);
}

const q = (name) => name.split(".").map((part) => `"${part.replace(/"/g, '""')}"`).join(".");

async function columns(db, table) {
  const [schema, name] = table.split(".");
  const { rows } = await db.query(
    `SELECT a.attname AS name
     FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = $1 AND c.relname = $2 AND a.attnum > 0 AND NOT a.attisdropped AND a.attgenerated = ''
     ORDER BY a.attnum`,
    [schema, name]
  );
  return rows.map((row) => row.name);
}

async function primaryKey(db, table) {
  const { rows } = await db.query(
    `SELECT a.attname AS name FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
     WHERE i.indrelid = $1::regclass AND i.indisprimary ORDER BY array_position(i.indkey, a.attnum)`,
    [table]
  );
  return rows.map((row) => row.name);
}

/** Foreign keys from `table` to other tables in the copy set: [{ parent, cols, parentCols }]. */
async function foreignKeys(db, table, names) {
  const { rows } = await db.query(
    `SELECT confrelid::regclass::text AS parent,
            (SELECT array_agg(attname::text ORDER BY k.ord) FROM unnest(con.conkey) WITH ORDINALITY k(num, ord) JOIN pg_attribute ON attrelid = con.conrelid AND attnum = k.num) AS cols,
            (SELECT array_agg(attname::text ORDER BY k.ord) FROM unnest(con.confkey) WITH ORDINALITY k(num, ord) JOIN pg_attribute ON attrelid = con.confrelid AND attnum = k.num) AS parent_cols
     FROM pg_constraint con WHERE con.contype = 'f' AND con.conrelid = $1::regclass`,
    [table]
  );
  return rows.filter((row) => names.has(row.parent) && row.parent !== table).map((row) => ({ parent: row.parent, cols: row.cols, parentCols: row.parent_cols }));
}

/** Parents before children. */
function topoSort(tables, deps) {
  const done = new Set();
  const out = [];
  const visit = (table, trail = new Set()) => {
    if (done.has(table.name)) return;
    if (trail.has(table.name)) return; // a cycle: keep the listed order
    trail.add(table.name);
    for (const dep of deps.get(table.name) || []) {
      const parent = tables.find((entry) => entry.name === dep.parent);
      if (parent) visit(parent, trail);
    }
    done.add(table.name);
    out.push(table);
  };
  for (const table of tables) visit(table);
  return out;
}

async function main() {
  loadEnv();
  const localUrl = process.env.DATABASE_URL;
  const prodUrl = process.env.PROD_DATABASE_URL;
  assertLocal(localUrl);
  if (!prodUrl) throw new Error("set PROD_DATABASE_URL to production's read-only connection (the nasfaq_diagnostics role)");
  if (new URL(prodUrl).hostname === new URL(localUrl).hostname && new URL(prodUrl).pathname === new URL(localUrl).pathname) throw new Error("PROD_DATABASE_URL and DATABASE_URL point at the same database");

  const local = new Client({ connectionString: localUrl });
  const prod = new Client({ connectionString: prodUrl, application_name: "nasfaq-pull-prod" });
  await local.connect();
  await prod.connect();

  try {
    const wanted = TABLES.filter((table) => !REFRESH || table.refresh);
    const names = new Set(wanted.map((table) => table.name));

    // What exists on each side (tables can be missing locally or unreadable on prod).
    const plan = [];
    const deps = new Map();
    for (const table of wanted) {
      const localCols = await columns(local, table.name);
      if (!localCols.length) {
        console.log(`skip ${table.name}: not in the local schema (run node scripts/migrate.js)`);
        continue;
      }
      const prodCols = await columns(prod, table.name).catch(() => []);
      if (!prodCols.length) {
        console.log(`skip ${table.name}: not on production`);
        continue;
      }
      const cols = localCols.filter((col) => prodCols.includes(col));
      deps.set(table.name, await foreignKeys(local, table.name, names));
      plan.push({ ...table, cols, pk: await primaryKey(local, table.name) });
    }
    const ordered = topoSort(plan, deps);

    if (!REFRESH) {
      const { rows } = await local.query(`SELECT (SELECT count(*) FROM yt.youtube_channels)::int AS channels, (SELECT count(*) FROM market.market_assets)::int AS assets`);
      if (rows[0].channels || rows[0].assets) {
        throw new Error(
          `the local database already has ${rows[0].channels} channels / ${rows[0].assets} assets (seed data?). ` +
            "Production ids would collide with them: load into a fresh database (createdb, set DATABASE_URL, node scripts/migrate.js), or use --refresh to top up an earlier pull."
        );
      }
    }

    await prod.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await prod.query("SET LOCAL lock_timeout = '2s'");
    const bounded = new Map(); // table -> SQL condition, so children follow their parent's window

    for (const table of ordered) {
      const conditions = [];
      const timeCol = table.time ?? (REFRESH ? table.refreshTime : undefined);
      if (timeCol && table.cols.includes(timeCol)) {
        conditions.push(`${q(timeCol)} >= now() - interval '${DAYS} days'`);
      }
      if (table.where) conditions.push(table.where);
      for (const dep of deps.get(table.name) || []) {
        const parentCondition = bounded.get(dep.parent);
        if (!parentCondition) continue;
        const cols = dep.cols.map(q).join(", ");
        const parentCols = dep.parentCols.map(q).join(", ");
        conditions.push(`(${cols}) IN (SELECT ${parentCols} FROM ${q(dep.parent)} WHERE ${parentCondition})`);
      }
      if (conditions.length) bounded.set(table.name, conditions.join(" AND "));
      const where = conditions.length ? ` WHERE ${conditions.join(" AND ")}` : "";

      const colList = table.cols.map(q).join(", ");
      if (DRY) {
        const { rows } = await prod.query(`SELECT count(*)::bigint AS n FROM ${q(table.name)}${where}`).catch((error) => ({ rows: [{ n: `error: ${error.message}` }] }));
        console.log(`${table.name}: ${rows[0].n} rows${where ? ` (${where.slice(7)})` : ""}`);
        continue;
      }

      const conflict =
        table.upsert && table.pk.length
          ? ` ON CONFLICT (${table.pk.map(q).join(", ")}) DO UPDATE SET ${table.cols.filter((col) => !table.pk.includes(col)).map((col) => `${q(col)} = EXCLUDED.${q(col)}`).join(", ") || `${q(table.pk[0])} = EXCLUDED.${q(table.pk[0])}`}`
          : " ON CONFLICT DO NOTHING";
      const insert = `INSERT INTO ${q(table.name)} (${colList}) SELECT ${colList} FROM jsonb_populate_recordset(NULL::${q(table.name)}, $1::jsonb)${conflict}`;

      const cursor = `c_${table.name.replace(/\W/g, "_")}`;
      try {
        await prod.query("SAVEPOINT table_read");
        // Rows as JSON: dates and timestamps travel as text, so nothing shifts through JS Dates.
        await prod.query(`DECLARE ${cursor} NO SCROLL CURSOR FOR SELECT to_jsonb(x) AS row FROM (SELECT ${colList} FROM ${q(table.name)}${where}) x`);
      } catch (error) {
        await prod.query("ROLLBACK TO SAVEPOINT table_read");
        console.log(`skip ${table.name}: ${error.message}`);
        continue;
      }
      let copied = 0;
      const started = Date.now();
      await local.query("BEGIN");
      try {
        for (;;) {
          const { rows } = await prod.query(`FETCH ${BATCH} FROM ${cursor}`);
          if (!rows.length) break;
          const result = await local.query(insert, [JSON.stringify(rows.map((row) => row.row))]);
          copied += result.rowCount;
          process.stdout.write(`\r${table.name}: ${copied.toLocaleString("en-US")} rows`);
        }
        await local.query("COMMIT");
      } catch (error) {
        await local.query("ROLLBACK");
        throw new Error(`${table.name}: ${error.message}`);
      } finally {
        await prod.query(`CLOSE ${cursor}`).catch(() => {});
      }
      process.stdout.write(`\r${table.name}: ${copied.toLocaleString("en-US")} rows (${((Date.now() - started) / 1000).toFixed(1)}s)\n`);
    }
    await prod.query("ROLLBACK");

    if (!DRY) {
      // Keep local id sequences ahead of the copied ids.
      for (const table of ordered) {
        for (const col of table.cols) {
          const { rows } = await local.query(`SELECT pg_get_serial_sequence($1, $2) AS seq`, [table.name, col]);
          if (!rows[0]?.seq) continue;
          await local.query(`SELECT setval($1, GREATEST((SELECT COALESCE(MAX(${q(col)}), 0) FROM ${q(table.name)}), 1))`, [rows[0].seq]);
        }
      }
      console.log(REFRESH ? "Refreshed. The local market settles from this data at 09:00 ET." : "Done. Start the API, then sign up / seed your test accounts (node scripts/seed-dev.js admin <you>, predictions <you>).");
    }
  } finally {
    await prod.end().catch(() => {});
    await local.end().catch(() => {});
  }
}

main().catch((error) => {
  console.error("\npull-prod failed:", error.message);
  process.exit(1);
});
