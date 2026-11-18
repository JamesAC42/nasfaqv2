import assert from "node:assert/strict";
import { test } from "node:test";
import { hasHalfEntries, manifestPortrait, pickTexturePath, PORTRAIT_MOODS, PORTRAIT_PENDING, resolvePortrait } from "./mahjong-portrait-art.mjs";

const entry = (symbol, mood, anchors = { eye_y: 0.45, ipd: 0.16 }) => ({
  src: `${symbol}/half/${mood}.0123abcd.webp`,
  w: 768,
  h: 1024,
  srcset: { 600: `${symbol}/half/${mood}.600.0123abcd.webp`, 768: `${symbol}/half/${mood}.768.0123abcd.webp` },
  anchors,
});
const fullSet = (symbol, anchors) => Object.fromEntries(PORTRAIT_MOODS.map((mood) => [`${symbol}/half/${mood}`, entry(symbol, mood, anchors)]));
const overlay = {
  base: "/art/_overlay/mahjong-pilot/half/",
  explicit: false,
  table: { PEK: { eyeY: 462 / 1024, ipd: 123 / 768 } },
};

test("a talent has portrait art when all four moods are listed with both anchors", () => {
  const art = manifestPortrait(fullSet("MIK"), "MIK");
  assert.equal(art.from, "manifest");
  assert.deepEqual(art.face, { eyeY: 0.45, ipd: 0.16 });
  assert.deepEqual(Object.keys(art.files).sort(), [...PORTRAIT_MOODS].sort());
  assert.equal(art.files.win, "MIK/half/win.768.0123abcd.webp");
});

test("a missing mood means no portrait art at all", () => {
  for (const mood of PORTRAIT_MOODS) {
    const images = fullSet("MIK");
    delete images[`MIK/half/${mood}`];
    assert.equal(manifestPortrait(images, "MIK"), null, mood);
  }
  assert.equal(manifestPortrait({}, "MIK"), null);
  assert.equal(manifestPortrait(null, "MIK"), null);
  assert.equal(manifestPortrait(fullSet("PEK"), "MIK"), null, "someone else's set");
});

test("both anchors must be finite numbers in range, on every mood", () => {
  const bad = [
    {},
    { eye_y: 0.45 },
    { ipd: 0.16 },
    { eye_y: Number.NaN, ipd: 0.16 },
    { eye_y: 0.45, ipd: Number.POSITIVE_INFINITY },
    { eye_y: "0.45", ipd: 0.16 },
    { eye_y: 0.45, ipd: null },
    { eye_y: 0.05, ipd: 0.16 },
    { eye_y: 0.85, ipd: 0.16 },
    { eye_y: 0.45, ipd: 0.04 },
    { eye_y: 0.45, ipd: 0.41 },
    { eye_y: 462, ipd: 123 }, // pixels, not fractions
  ];
  for (const anchors of bad) {
    assert.equal(manifestPortrait(fullSet("MIK", anchors), "MIK"), null, JSON.stringify(anchors));
    // One bad mood spoils the set.
    const images = fullSet("MIK");
    images["MIK/half/riichi"] = entry("MIK", "riichi", anchors);
    assert.equal(manifestPortrait(images, "MIK"), null, `riichi ${JSON.stringify(anchors)}`);
  }
  const noAnchors = fullSet("MIK");
  delete noAnchors["MIK/half/think"].anchors;
  assert.equal(manifestPortrait(noAnchors, "MIK"), null, "no anchors");
  // The range ends count.
  for (const anchors of [
    { eye_y: 0.1, ipd: 0.05 },
    { eye_y: 0.8, ipd: 0.4 },
  ])
    assert.ok(manifestPortrait(fullSet("MIK", anchors), "MIK"), JSON.stringify(anchors));
});

test("the face comes from the idle image", () => {
  const images = fullSet("MIK");
  images["MIK/half/idle"] = entry("MIK", "idle", { eye_y: 0.4, ipd: 0.2 });
  assert.deepEqual(manifestPortrait(images, "MIK").face, { eyeY: 0.4, ipd: 0.2 });
});

test("the texture is the widest export no wider than 768, else the src", () => {
  assert.equal(pickTexturePath({ src: "a.webp", srcset: { 300: "a.300.webp", 600: "a.600.webp", 768: "a.768.webp", 1536: "a.1536.webp" } }), "a.768.webp");
  assert.equal(pickTexturePath({ src: "a.webp", srcset: { 600: "a.600.webp" } }), "a.600.webp");
  assert.equal(pickTexturePath({ src: "a.webp", srcset: { 1536: "a.1536.webp" } }), "a.webp");
  assert.equal(pickTexturePath({ src: "a.webp" }), "a.webp");
  assert.equal(pickTexturePath({ src: "a.webp", srcset: { 768: "" } }), "a.webp");
  assert.equal(pickTexturePath({}), null);
  const images = fullSet("MIK");
  delete images["MIK/half/idle"].src;
  images["MIK/half/idle"].srcset = {};
  assert.equal(manifestPortrait(images, "MIK"), null, "an entry with no file");
});

test("production: only the manifest counts, and nothing is decided before it settles", () => {
  assert.equal(resolvePortrait({ images: undefined, settled: false, symbol: "MIK" }), PORTRAIT_PENDING);
  assert.equal(resolvePortrait({ images: fullSet("MIK"), settled: false, symbol: "MIK" }), PORTRAIT_PENDING);
  assert.equal(resolvePortrait({ images: fullSet("MIK"), settled: true, symbol: "MIK" }).from, "manifest");
  assert.equal(resolvePortrait({ images: undefined, settled: true, symbol: "MIK" }), null, "manifest missing");
  assert.equal(resolvePortrait({ images: {}, settled: true, symbol: "PEK" }), null, "the old table is dev only");
  assert.equal(resolvePortrait({ images: fullSet("MIK"), settled: true, symbol: null }), null);
});

test("development: the overlay stands in for its talents when the manifest has none of their half-body art", () => {
  const art = resolvePortrait({ images: {}, settled: true, symbol: "PEK", overlay });
  assert.equal(art.from, "overlay");
  assert.equal(art.files.riichi, "/art/_overlay/mahjong-pilot/half/PEK_riichi.png");
  assert.deepEqual(art.face, overlay.table.PEK);
  assert.equal(resolvePortrait({ images: undefined, settled: true, symbol: "PEK", overlay }).from, "overlay", "manifest missing");
  assert.equal(resolvePortrait({ images: {}, settled: false, symbol: "PEK", overlay }), PORTRAIT_PENDING, "waits for the manifest");
  assert.equal(resolvePortrait({ images: {}, settled: true, symbol: "MIK", overlay }), null, "not in the old table");
  // A complete manifest set wins; a partial one shows as a card rather than being masked.
  assert.equal(resolvePortrait({ images: fullSet("PEK"), settled: true, symbol: "PEK", overlay }).from, "manifest");
  const partial = fullSet("PEK");
  delete partial["PEK/half/win"];
  assert.equal(hasHalfEntries(partial, "PEK"), true);
  assert.equal(resolvePortrait({ images: partial, settled: true, symbol: "PEK", overlay }), null);
});

test("development: an explicit overlay base wins for its talents, before the manifest loads", () => {
  const explicit = { ...overlay, base: "https://cdn.example/half", explicit: true };
  assert.equal(resolvePortrait({ images: undefined, settled: false, symbol: "PEK", overlay: explicit }).files.idle, "https://cdn.example/half/PEK_idle.png");
  assert.equal(resolvePortrait({ images: fullSet("PEK"), settled: true, symbol: "PEK", overlay: explicit }).from, "overlay");
  assert.equal(resolvePortrait({ images: fullSet("MIK"), settled: true, symbol: "MIK", overlay: explicit }).from, "manifest");
});
