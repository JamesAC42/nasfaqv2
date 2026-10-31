// Writes the talent alias table (services/talents.js) to holonews/internal/talents/aliases.json, where
// the HoloNews scraper's name matcher reads it. Run after changing ALIASES:
//
//   node api/scripts/export-talent-aliases.js
//
// api/test/holonews-thumbnails.test.js fails while the two differ.

const fs = require("node:fs");
const path = require("node:path");
const { ALIASES } = require("../src/services/talents");

const OUTPUT = path.join(__dirname, "..", "..", "holonews", "internal", "talents", "aliases.json");

function aliasesJson() {
  return `${JSON.stringify(ALIASES, null, 2)}\n`;
}

if (require.main === module) {
  fs.writeFileSync(OUTPUT, aliasesJson());
  console.log(`wrote ${Object.keys(ALIASES).length} talents to ${path.relative(process.cwd(), OUTPUT)}`);
}

module.exports = { OUTPUT, aliasesJson };
