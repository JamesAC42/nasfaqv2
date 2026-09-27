// Runs the Wire once and prints what it found (the API also runs it every 10 minutes).
//   node scripts/run-wire.js
//   node scripts/run-wire.js --classify "【3D LIVE】ぺこらの3Dライブ！"   judge one title (keywords + Jev)
//   node scripts/run-wire.js --chatter     scan /vt/ once and print who's hot
//   node scripts/run-wire.js --autotag     tag untagged articles and headlines once
const { Pool } = require("pg");
const { loadEnv } = require("../src/config");

async function main() {
  loadEnv();
  const jev = require("../src/services/jev");
  const classify = process.argv.indexOf("--classify");
  if (classify > -1) {
    const title = process.argv[classify + 1] || "";
    const streams = require("../src/services/wire/streams");
    console.log({ keywords: streams.keywordEvent(title), jev_configured: jev.isConfigured(), verdict: await streams.judgeTitle(title, "") });
    return;
  }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    if (process.argv.includes("--chatter")) {
      const chatter = require("../src/services/chatter");
      console.log(`Jev: ${jev.isConfigured() ? "on" : "off (name matching only)"}`);
      console.log(await chatter.scanOnce(pool, { logger: { info: () => {} } }));
      const summary = await chatter.getSummary(pool);
      console.log(`history: ${summary.covered_hours}h${summary.ready ? "" : " (heat starts after 30h)"} · hot: ${summary.hot.join(", ") || "—"} · busiest: ${summary.busiest.join(", ") || "—"}`);
      for (const talent of summary.talents.slice(0, 15)) {
        console.log(`${talent.symbol.padEnd(4)} ${String(talent.posts_recent).padStart(4)} posts/${summary.recent_hours}h  heat ${talent.heat ?? "—"}  ${talent.topic ?? ""}`);
      }
      console.log("jev usage:", jev.stats());
      return;
    }
    if (process.argv.includes("--autotag")) {
      console.log(await require("../src/services/autotag").runAutotag(pool));
      const { rows } = await pool.query(`SELECT kind, ref_id, symbols, classifier FROM content.autotag_log ORDER BY judged_at DESC LIMIT 20`);
      for (const row of rows) console.log(`${row.kind.padEnd(8)} #${row.ref_id} ${row.classifier.padEnd(8)} ${row.symbols.join(", ") || "—"}`);
      return;
    }
    const wire = require("../src/services/wire");
    console.log(`Jev: ${jev.isConfigured() ? "on" : "off (keyword rules only; set JEV_API_KEY)"}`);
    console.log(JSON.stringify(await wire.runWire(pool), null, 2));
    for (const item of await wire.listWire(pool, { limit: 15 })) console.log(`${String(item.importance).padStart(2)} ${item.kind.padEnd(22)} ${item.headline}`);
    console.log("jev usage:", jev.stats());
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
