// Runs the Wire once and prints what it found (the API also runs it every 10 minutes).
//   node scripts/run-wire.js
//   node scripts/run-wire.js --classify "【3D LIVE】ぺこらの3Dライブ！"   judge one title (keywords + Jev)
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
