const test = require("node:test");
const assert = require("node:assert/strict");

const cards = require("../src/services/games/cards");
const cardGacha = require("../src/services/games/cardGacha");
const { ALIASES } = require("../src/services/talents");

// No scheduled banner in games.card_banners, so getBanners falls back to the weekly rotation.
const noBanners = { query: async () => ({ rows: [] }) };
const NEW = ["KYO", "MEL", "SOP", "TSU"];
const talent = (symbol, index, listedOn = null) => ({ asset_id: index + 1, symbol, name: symbol, unit: null, icon: null, color: null, listed_on: listedOn });
const established = Object.keys(ALIASES).filter((symbol) => !NEW.includes(symbol)).map((symbol, index) => talent(symbol, index));

async function featuredOn(talents, at) {
  const banners = await cardGacha.getBanners(noBanners, talents, new Date(at));
  return banners.find((banner) => banner.kind === "featured");
}

test("cards: listTalents carries the IPO listing date", async () => {
  let sql = "";
  const db = {
    query: async (text) => {
      sql = text;
      return { rows: [
        { id: 1, symbol: "PEK", display_name: "Pekora", current_mid_price: "10", mid_open: "8", unit: "hololive 3rd Generation", icon: "pekora", color: "#fff", listed_on: null },
        { id: 2, symbol: "KYO", display_name: "Kyoko", current_mid_price: "5", mid_open: null, unit: "ASOBI★MAWARI-TAI!", icon: "kyoko", color: "#fb610e", listed_on: "2026-11-19" },
      ] };
    },
  };
  const talents = await cards.listTalents(db);
  assert.match(sql, /market\.ipo_listings/);
  assert.match(sql, /status = 'listed'/);
  assert.deepEqual(talents.map((row) => [row.symbol, row.listed_on]), [["PEK", null], ["KYO", "2026-11-19"]]);
});

test("featured rotation: a talent listing mid-week doesn't change that week's pick", async () => {
  // Week of Monday 2026-11-16; four talents list on Thursday the 19th.
  const listed = [...established, ...NEW.map((symbol, index) => talent(symbol, established.length + index, "2026-11-19"))];
  const before = await featuredOn(established, "2026-11-17T12:00:00Z");
  const after = await featuredOn(listed, "2026-11-20T12:00:00Z");
  assert.equal(before.key, "featured-2026-11-16");
  assert.equal(after.key, before.key);
  assert.equal(after.featured.symbol, before.featured.symbol);
  assert.ok(!NEW.includes(after.featured.symbol));

  // From the next week on, they're in the draw.
  const picks = new Set();
  for (let week = 1; week <= 200; week += 1) {
    const at = new Date(Date.parse("2026-11-16T12:00:00Z") + week * 7 * 86_400_000);
    picks.add((await featuredOn(listed, at)).featured.symbol);
  }
  assert.ok(NEW.some((symbol) => picks.has(symbol)), "a new talent is featured in some later week");
});

test("featured rotation: if every talent is new that week, all of them are drawn from", async () => {
  const fresh = NEW.map((symbol, index) => talent(symbol, index, "2026-11-19"));
  const banner = await featuredOn(fresh, "2026-11-20T12:00:00Z");
  assert.ok(NEW.includes(banner.featured.symbol));
  // The caller's list isn't reordered.
  assert.deepEqual(fresh.map((row) => row.symbol), NEW);
});
