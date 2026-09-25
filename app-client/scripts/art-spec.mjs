// Builds the art spec from the site's slot registries (npm run art:doc):
//   app/lib/art/talent-slots.json  per-talent slots (key art, reactions, cards, banner)
//   app/lib/art/slots/*.json       shared scene slots (backdrops, illustrations, objects, …)
// Writes:
//   docs/art/ART_ASSETS.md                 human-readable list (same text as ART_SPEC.md)
//   art-pipeline/spec/slots.json           machine-readable spec the art pipeline reads
//   art-pipeline/spec/ART_SPEC.md
// The art-pipeline files are only written when that folder exists next to app-client.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const app = join(here, "..", "app", "lib", "art");
const repo = join(here, "..", "..");
const TALENT_COUNT = 73;
const AREA_ORDER = ["site", "home", "market", "games", "gallery", "predictions", "howto", "admin", "legal"];
const PRIORITY = { high: "P0", medium: "P1", low: "P2" };
const RANK = { P0: 0, P1: 1, P2: 2 };

const talent = JSON.parse(readFileSync(join(app, "talent-slots.json"), "utf8")).slots;
const areas = readdirSync(join(app, "slots"))
  .filter((file) => file.endsWith(".json"))
  .map((file) => JSON.parse(readFileSync(join(app, "slots", file), "utf8")))
  .sort((a, b) => AREA_ORDER.indexOf(a.area) - AREA_ORDER.indexOf(b.area));

const STYLE_BY_KIND = { backdrop: "scene", illustration: "scene", spot: "object", object: "object", icon: "object", texture: "texture", social: "social" };
const LIGHT_BY_KIND = {
  backdrop: "night / dark ink ambience with hololive-blue key light; falls off to dark where UI text sits",
  illustration: "soft, even; dark ink surroundings with blue accents",
  spot: "neutral, soft",
  object: "neutral studio light, soft top-left key, no cast shadow (the UI adds one)",
  icon: "neutral",
  texture: "flat, even, no directional light",
  social: "bright and punchy: it has to read as a small thumbnail",
};

function sharedToPipeline(slot, area) {
  const priority = PRIORITY[slot.priority] ?? "P1";
  return {
    id: slot.id,
    title: slot.title,
    area,
    per: "shared",
    used_in: slot.where,
    kind: slot.kind,
    display: { css_px: slot.css ?? `up to ${Math.round(slot.w / 2)}×${Math.round(slot.h / 2)}`, aspect: aspect(slot.w, slot.h) },
    export: { w: slot.w, h: slot.h, srcset: srcsetFor(slot.w), format: slot.transparent ? "webp (alpha)" : "webp" },
    crop: slot.crop ?? (slot.kind === "backdrop" ? "Full bleed. Keep the areas named in the brief clear for UI text; the UI may crop the sides on phones." : slot.kind === "texture" ? "Cover-fitted; low contrast everywhere UI sits on it." : "Subject centered with a small margin on every side."),
    background: slot.transparent ? "transparent cutout" : "full scene",
    subject: slot.brief,
    lighting: slot.lighting ?? LIGHT_BY_KIND[slot.kind] ?? "neutral",
    style: slot.style ?? STYLE_BY_KIND[slot.kind] ?? "scene",
    variants: slot.variants ?? [{ name: "default" }],
    animation: slot.animation ?? "none",
    priority,
    fallback: slot.fallback ?? "Blue halftone placeholder at the same aspect ratio (SceneArt); the page is complete without it",
    notes: slot.notes ?? "",
  };
}

function talentToPipeline(slot) {
  const { title, used_in, display, export: exp, crop, background, subject, lighting, style, variants, animation, priority, fallback, notes } = slot;
  return { id: slot.id, title, area: "talent", per: "talent", used_in, kind: "character", display, export: exp, crop, background, subject, lighting, style, variants, animation, priority, fallback, notes };
}

function aspect(w, h) {
  const gcd = (a, b) => (b ? gcd(b, a % b) : a);
  const g = gcd(w, h);
  const [a, b] = [w / g, h / g];
  return a > 40 || b > 40 ? (w / h).toFixed(2) + ":1" : `${a}:${b}`;
}

function srcsetFor(w) {
  return [600, 1200, 2400].filter((size) => size < w).concat(w).filter((v, i, list) => list.indexOf(v) === i);
}

const shared = areas.flatMap((file) => file.slots.map((slot) => sharedToPipeline(slot, file.area)));
const perTalent = talent.map(talentToPipeline);
const slots = [...perTalent, ...shared];

const imagesFor = (slot, withP2 = false) => slot.variants.filter((variant) => withP2 || (variant.priority ?? slot.priority) !== "P2").length * (slot.per === "talent" ? TALENT_COUNT : 1);
const totals = {
  talent_slots: perTalent.length,
  shared_slots: shared.length,
  images: slots.reduce((sum, slot) => sum + imagesFor(slot), 0),
  images_with_p2_variants: slots.reduce((sum, slot) => sum + imagesFor(slot, true), 0),
  by_priority: Object.fromEntries(["P0", "P1", "P2"].map((p) => [p, slots.reduce((sum, slot) => sum + slot.variants.filter((v) => (v.priority ?? slot.priority) === p).length * (slot.per === "talent" ? TALENT_COUNT : 1), 0)])),
};

const STYLE_GROUPS = {
  character: "Talent portraits (key art, reactions). Clean modern anime illustration, crisp line art, cel shading with soft gradients, faithful to the talent's official design. Transparent background. Key art and reactions must look like the same artist drew them.",
  card: "Talent card illustrations and banners. Full painted anime scenes, gacha-card quality, same character rendering as `character` but with backgrounds and lighting that escalate by rarity (C simple → UR epic). All five cards of a talent read as one set.",
  scene: "Non-character backdrops and illustrations. The site's 'terminal floor' look: dark ink (#0a0c11), hololive blue (#3fb8f5) as the key color, flat graphic shapes, halftone dots, glowing ticker-board light. Generic fans or silhouettes only, never real talents. No text.",
  object: "Props, spots and small icons (card back, card frames, capsules, chips, medals, envelopes, empty-state spots). Clean semi-flat rendering with halftone shading, bold readable silhouettes with a clean dark outline, hololive blue and gold accents, transparent background unless the slot says otherwise. Sets (medals, capsules, frames, verify spots, result moments) share one geometry and lighting.",
  texture: "Table surfaces (blackjack felt, play-mat markings). Subtle and low-contrast; cover-fitted by the UI rather than tiled unless the slot says it must tile.",
  social: "Open Graph images, 1200×630. Bold, simple, readable as a thumbnail; the brief says where the site name goes (added by the site, not drawn).",
};

const spec = {
  version: 1,
  generated_at: new Date().toISOString(),
  generated_from: ["app-client/app/lib/art/talent-slots.json", "app-client/app/lib/art/slots/*.json"],
  global: {
    themes: "Dark is the default; a light mode exists and shows the same images (no per-theme variants). Dark ink #0a0c11 (panels #0f1219), light paper #f4f6fa (panels #ffffff). Some surfaces are always dark whatever the theme: talent cards and card backs, the card gacha hero, the gacha reveal, the blackjack felt, the locker trophy case. Everything else sits on the theme background: pictures there are hard-edged panels (never feathered into #0a0c11), cutouts and spots are transparent with a clean dark outline so they read on ink and on paper, and backdrops under theme-coloured text are either faded by the UI or drawn on alpha (each slot says which).",
    key_colors: { blue: "#3fb8f5", up: "#2ee38e", down: "#ff4460", warn: "#f5b83f", ink: "#0a0c11" },
    max_dpr: 2,
    loading: "The UI loads `${NEXT_PUBLIC_ART_BASE_URL}/manifest.json` (default `/art`), looks every image up by ID, and uses srcset with the listed widths. File names are never hardcoded.",
    id_format: "SYMBOL/slot/variant for per-talent slots (e.g. PEK/card-ssr/default, PEK/reaction/hype); _shared/slot/variant for shared slots (e.g. _shared/howto-hero/default). Twins (FUWAMOCO) are one symbol.",
    data_attribute: "Every rendered image (and every placeholder) carries data-art-id=\"<ID>\"; placeholders also carry data-art-missing.",
    missing_art: "Every slot has a fallback; a missing ID never breaks a page.",
    talents: TALENT_COUNT,
    content_rules: "hololive production derivative-work guidelines: no NSFW, nothing that damages a talent's image, keep cope/shock cute. Visible 'fan-made, not affiliated' line is on the site.",
  },
  manifest_v2_proposal: {
    shape: {
      version: 2,
      generated_at: "ISO timestamp",
      images: {
        "PEK/keyart/default": { src: "PEK/keyart/default.3f2a1c9e.webp", w: 1200, h: 1500, srcset: { 600: "PEK/keyart/default.600.3f2a1c9e.webp", 1200: "PEK/keyart/default.3f2a1c9e.webp" }, anchors: { eye_y: 0.24 } },
      },
    },
    rules: [
      "Paths are relative to manifest.json.",
      "srcset keys are pixel widths; include the full size.",
      "anchors (all optional, fractions 0..1): eye_y, eye_x, feet_y, focus [x, y] (the UI uses focus as object-position when it crops a scene).",
      "anchors.content_box [x0, y0, x1, y1] for cutouts: the bounding box of opaque pixels (alpha > ~8%). The UI uses it to scale figures consistently and to place fades.",
      "anchors.cut: the edges where the figure is cut by the frame, e.g. [\"bottom\"] for a waist-up portrait, [\"bottom\", \"left\"] if a braid is cut on the left. The UI fades those edges into the page. A cut must sit on the canvas edge.",
      "A blink frame is its own ID: PEK/reaction/idle-blink.",
      "Animated variants (e.g. PEK/card-ur/loop) add `video: { webm, mp4 }` next to a still `src` poster.",
      "The UI still reads the v1 shape (talents.keyart, talents.chibi, scenes) until v2 ships.",
    ],
  },
  style_groups: STYLE_GROUPS,
  totals,
  slots,
};

// ── Markdown ───────────────────────────────────────────────────────────────
const cell = (text) => String(text ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
let md = `# NASFAQ art spec

Every image the site can show, for the art pipeline. Generated by \`npm run art:doc\` (in app-client)
from \`app-client/app/lib/art/talent-slots.json\` and \`app-client/app/lib/art/slots/*.json\`; edit those,
not this file. Machine-readable copy: \`art-pipeline/spec/slots.json\`. Live placeholders: \`/dev/art\`.

**${totals.images.toLocaleString("en-US")} images** (${totals.images_with_p2_variants.toLocaleString("en-US")} with the P2 extras):
${perTalent.length} per-talent slots × ${TALENT_COUNT} talents, plus ${shared.length} shared slots.
By priority: P0 ${totals.by_priority.P0.toLocaleString("en-US")}, P1 ${totals.by_priority.P1.toLocaleString("en-US")}, P2 ${totals.by_priority.P2.toLocaleString("en-US")}.

## 1. Global facts

- **Themes:** ${spec.global.themes}
- **Key colors:** blue ${spec.global.key_colors.blue}, up ${spec.global.key_colors.up}, down ${spec.global.key_colors.down}, ink ${spec.global.key_colors.ink}.
- **Pixel ratio:** exports are sized for ${spec.global.max_dpr}x.
- **Loading:** ${spec.global.loading}
- **IDs:** ${spec.global.id_format}
- **Inspecting:** ${spec.global.data_attribute}
- **Missing art:** ${spec.global.missing_art}
- **Content:** ${spec.global.content_rules}

## 2. Style groups

${Object.entries(STYLE_GROUPS).map(([key, text]) => `- **${key}**: ${text}`).join("\n")}

## 3. Per-talent slots (× ${TALENT_COUNT})

`;
function slotBlock(slot, level) {
  let out = `${level} \`${slot.id}\` · ${slot.title} · ${slot.priority}\n\n`;
  out += `| | |\n|---|---|\n`;
  out += `| Export | ${slot.export.w}×${slot.export.h} (${slot.display.aspect}), srcset ${slot.export.srcset.join(", ")}, ${slot.export.format} |\n`;
  out += `| Display | ${cell(slot.display.css_px)} css px |\n`;
  out += `| Crop | ${cell(slot.crop)} |\n| Background | ${cell(slot.background)} |\n| Subject | ${cell(slot.subject)} |\n| Lighting | ${cell(slot.lighting)} |\n| Style | ${slot.style} |\n`;
  out += `| Variants | ${slot.variants.map((v) => `**${v.name}**${v.priority ? ` (${v.priority})` : ""}${v.subject ? `: ${cell(v.subject)}` : ""}`).join("<br>")} |\n`;
  out += `| Animation | ${cell(slot.animation)} |\n| Fallback | ${cell(slot.fallback)} |\n`;
  out += `| Used in | ${slot.used_in.map(cell).join("<br>")} |\n`;
  if (slot.notes) out += `| Notes | ${cell(slot.notes)} |\n`;
  return out + "\n";
}

for (const slot of perTalent) md += slotBlock(slot, "###");

md += `## 4. Shared slots (${shared.length})\n`;
for (const file of areas) {
  const list = shared.filter((slot) => slot.area === file.area).sort((a, b) => RANK[a.priority] - RANK[b.priority] || a.id.localeCompare(b.id));
  if (!list.length) continue;
  md += `\n### ${file.area} (${list.length})\n\n| ID | Export | Kind · style | Priority | Display (css px) |\n|---|---|---|---|---|\n`;
  for (const slot of list) {
    md += `| \`${slot.id}\` | ${slot.export.w}×${slot.export.h}${slot.background.startsWith("transparent") ? " · alpha" : ""} | ${slot.kind} · ${slot.style} | ${slot.priority} | ${cell(slot.display.css_px)} |\n`;
  }
  md += "\n";
  for (const slot of list) md += slotBlock(slot, "####");
}
md += `
## 5. Manifest v2 (proposal)

The UI already looks images up by ID and reads this shape (and still reads v1):

\`\`\`json
${JSON.stringify(spec.manifest_v2_proposal.shape, null, 2)}
\`\`\`

${spec.manifest_v2_proposal.rules.map((rule) => `- ${rule}`).join("\n")}
`;

const outputs = [[join(repo, "docs", "art", "ART_ASSETS.md"), md]];
const pipeline = join(repo, "art-pipeline");
if (existsSync(pipeline)) {
  outputs.push([join(pipeline, "spec", "slots.json"), JSON.stringify(spec, null, 2) + "\n"], [join(pipeline, "spec", "ART_SPEC.md"), md]);
}
for (const [path, text] of outputs) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
  console.log(`wrote ${path}`);
}
console.log(`${totals.images} images: ${perTalent.length} talent slots × ${TALENT_COUNT} + ${shared.length} shared`);
