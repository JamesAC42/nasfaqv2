const test = require("node:test");
const assert = require("node:assert/strict");
const { _test } = require("../src/services/holonewsThumbnails");

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
