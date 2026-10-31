const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { _test } = require("../src/services/holonewsThumbnails");
const talents = require("../src/services/talents");
const exportAliases = require("../scripts/export-talent-aliases");

// Reference images are named by the hololive site's talent slugs; these channel names don't map
// to them by lowercasing and dashing alone.
test("reference image slugs for channel names", () => {
  const slugs = (name) => _test.referenceImagesFor(name).slugs;
  assert.deepEqual(slugs("Usada Pekora"), ["usada-pekora"]);
  assert.deepEqual(slugs("La+ Darknesss"), ["la-darknesss"]);
  assert.deepEqual(slugs("Ninomae Ina’nis"), ["ninomae-inanis"]);
  assert.deepEqual(slugs("Ninomae Ina'nis"), ["ninomae-inanis"]);
  assert.deepEqual(slugs("Robocosan"), ["roboco-san"]);
  assert.deepEqual(slugs("FuwaMoco Abyssgard"), ["fuwawa-abyssgard", "mococo-abyssgard"]);
  assert.match(_test.referenceImagesFor("FuwaMoco Abyssgard").note, /Fuwawa and Mococo/);
  assert.deepEqual(slugs("  Hakos   Baelz "), ["hakos-baelz"]);
});

// holonews (Go) matches names with its own copy of the alias table.
test("holonews has the current talent alias table", () => {
  const exported = JSON.parse(fs.readFileSync(exportAliases.OUTPUT, "utf8"));
  assert.deepEqual(exported, JSON.parse(exportAliases.aliasesJson()), "holonews/internal/talents/aliases.json is out of date: run node api/scripts/export-talent-aliases.js");
});

const ROSTER = [
  { symbol: "PEK", name: "Usada Pekora", youtube_channel_id: "UC_PEK" },
  { symbol: "MAR", name: "Houshou Marine", youtube_channel_id: "UC_MAR" },
  { symbol: "NOE", name: "Shirogane Noel", youtube_channel_id: "UC_NOE" },
  { symbol: "CLI", name: "Mori Calliope", youtube_channel_id: "UC_CLI" },
  { symbol: "GUR", name: "Gawr Gura", youtube_channel_id: "UC_GUR" },
  { symbol: "LAM", name: "Yukihana Lamy", youtube_channel_id: "UC_LAM" },
  { symbol: "PLK", name: "Omaru Polka", youtube_channel_id: "UC_PLK" },
  { symbol: "BYS", name: "FuwaMoco Abyssgard", youtube_channel_id: "UC_BYS" },
];
const names = (list) => list.map((talent) => talent.name);
const pick = (headline, confirmed) => names(_test.selectTalents(_test.namedTalents(headline, ROSTER), confirmed));

test("a headline that names no talent gets none, however many it counts", () => {
  const headline = "Shattered Legends is confirmed as a Tabletop RPG project with Matt Mercer serving as GM for 4 Hololive talents.";
  assert.deepEqual(_test.namedTalents(headline, ROSTER), []);
  assert.deepEqual(pick(headline, ["Usada Pekora", "Houshou Marine", "Mori Calliope", "Gawr Gura"]), []);
});

test("named talents, and only those", () => {
  assert.deepEqual(pick("Pekora and Marine announce a joint 3D live", ["Usada Pekora", "Houshou Marine", "Shirogane Noel"]), ["Usada Pekora", "Houshou Marine"]);
  // Nicknames count as naming; the model's answer is matched whatever its case, and so are tags.
  assert.deepEqual(pick("Senchou visits Peko-land", ["houshou marine", "$PEK"]), ["Houshou Marine", "Usada Pekora"]);
  // The model (or a tag) can drop a name that means something else, but never add one.
  assert.deepEqual(pick("Lamy shows off a polka dot dress", ["Yukihana Lamy"]), ["Yukihana Lamy"]);
  assert.deepEqual(pick("Mococo's birthday stream", ["FuwaMoco Abyssgard", "Gawr Gura", "GUR"]), ["FuwaMoco Abyssgard"]);
});

test("the model isn't asked about a headline that names nobody", async () => {
  // No Gemini key: asking would throw gemini_not_configured.
  const config = { geminiApiKey: null };
  assert.deepEqual(await _test.identifyTalents(config, "A new hololive office opens in Tokyo", ROSTER, ["PEK"]), []);
  await assert.rejects(_test.identifyTalents(config, "Pekora opens a new office", ROSTER), { code: "gemini_not_configured" });
});

test("no talent and nothing to picture: no thumbnail", () => {
  const plan = _test.planThumbnail([], { image_prompt: "", skip: true });
  assert.equal(plan.draw, false);
  assert.match(plan.reason, /names no talent/);
  assert.equal(_test.planThumbnail(["Usada Pekora"], { image_prompt: "  ", skip: false }).draw, false);
  // A skip doesn't stop a thumbnail of talents the headline names.
  assert.equal(_test.planThumbnail(["Usada Pekora"], { image_prompt: "Pekora with a carrot", skip: true }).draw, true);
});

test("a clear scene without talents draws nobody; named talents are drawn alone", () => {
  const scene = _test.planThumbnail([], { image_prompt: "a tabletop RPG table with dice", skip: false });
  assert.equal(scene.draw, true);
  assert.match(scene.prompt, /Draw no people and no characters/);
  assert.doesNotMatch(scene.prompt, /reference images/);

  const duo = _test.planThumbnail(["Usada Pekora", "FuwaMoco Abyssgard"], { image_prompt: "a collab", skip: false });
  assert.ok(duo.prompt.includes("Draw exactly 2 characters: Usada Pekora, FuwaMoco Abyssgard (the twins Fuwawa and Mococo Abyssgard, one image each)."));
  assert.match(duo.prompt, /Add no other characters/);

  assert.match(_test.thumbnailCastRules([]), /NO people/);
  assert.match(_test.thumbnailCastRules([]), /"skip":true/);
  assert.ok(_test.thumbnailCastRules(["Usada Pekora"]).includes("Draw exactly these hololive talents and nobody else: Usada Pekora."));
});

test("the name matcher the thumbnails use", () => {
  const matcher = talents.createMatcher(ROSTER);
  assert.deepEqual([...matcher.match("the marine biology stream").keys()], []);
  assert.deepEqual([...matcher.match("Marine and PEKORA").keys()].sort(), ["MAR", "PEK"]);
});
