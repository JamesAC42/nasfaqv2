// The weekly evaluation by hand (it normally runs itself, Saturday 00:00 ET).
//
//   node scripts/weekly-evaluation.js preview [YYYY-MM-DD]   what the next one would do; writes nothing
//   node scripts/weekly-evaluation.js run [YYYY-MM-DD]       run it now (each Saturday runs only once)
//
// The date is the evaluation's Saturday (preview default: the next one that hasn't run; run default:
// the latest Saturday). Uses DATABASE_URL from api/.env. `preview` is safe against production: it
// takes no row locks and everything runs in a transaction that is rolled back.

const { loadEnv } = require("../src/config");
const { createPool } = require("../src/db");
const weeklyEvaluation = require("../src/services/weeklyEvaluation");

const pad = (value, width) => String(value).padStart(width);
const pct = (value) => (value === null || value === undefined ? "—" : `${value >= 0 ? "+" : ""}${(value * 100).toFixed(2)}%`);

async function main() {
  loadEnv();
  const [command = "preview", maybeDate] = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
  if (!["preview", "run"].includes(command)) {
    console.log("usage: node scripts/weekly-evaluation.js preview|run [YYYY-MM-DD]");
    process.exitCode = 1;
    return;
  }
  const pool = createPool(process.env.DATABASE_URL);
  try {
    const evalDate = /^\d{4}-\d{2}-\d{2}$/.test(maybeDate || "")
      ? maybeDate
      : command === "preview"
        ? await weeklyEvaluation.pendingEvaluationDate(pool)
        : weeklyEvaluation.evaluationDateFor();
    const result = await weeklyEvaluation.runWeeklyEvaluation(pool, { evalDate, dryRun: command === "preview" });
    if (result.skipped) {
      console.log(`${evalDate}: skipped (${result.skipped})`);
      return;
    }
    const report = result.report;
    console.log(`${command === "preview" ? "[preview, nothing written] " : ""}weekly evaluation ${report.eval_date}${report.first_evaluation ? " (first: no max below what players hold)" : ""}`);
    console.log(`dividends ${report.dividends_total} to ${report.holders_paid} players · fees ${report.fees_total} from ${report.holders_charged} · ${report.paying_count} paying, ${report.charging_count} charging, ${report.flat_count} flat`);
    console.log("");
    console.log(`${"stock".padEnd(6)} ${pad("rate", 8)} ${pad("per share", 10)} ${pad("held", 9)} ${pad("max before", 10)} ${pad("max after", 9)}  buyback`);
    for (const row of report.assets) {
      console.log(`${row.symbol.padEnd(6)} ${pad(pct(row.rate), 8)} ${pad(row.per_share?.toFixed(4) ?? "—", 10)} ${pad(Math.round(row.held), 9)} ${pad(row.max_supply_before, 10)} ${pad(row.max_supply_after, 9)}  ${row.buyback || ""}`);
    }
    if (report.buybacks_started.length) console.log(`\nbuybacks starting: ${report.buybacks_started.map((row) => `${row.symbol} (${Math.round(row.over)} over)`).join(", ")}`);
    if (report.buybacks_closed.length) console.log(`buybacks closing: ${report.buybacks_closed.map((row) => `${row.symbol} ${row.status}`).join(", ")}`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
