// Regenerates docs/art/ART_ASSETS.md from app/lib/art/slots/*.json (npm run art:doc).
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const slotsDir = join(here, "..", "app", "lib", "art", "slots");
const out = join(here, "..", "..", "docs", "art", "ART_ASSETS.md");
const ORDER = ["site", "home", "market", "games", "predictions", "howto", "admin", "legal"];
const RANK = { high: 0, medium: 1, low: 2 };

const areas = readdirSync(slotsDir)
  .filter((file) => file.endsWith(".json"))
  .map((file) => JSON.parse(readFileSync(join(slotsDir, file), "utf8")))
  .sort((a, b) => (ORDER.indexOf(a.area) + 99) % 99 - (ORDER.indexOf(b.area) + 99) % 99);
const all = areas.flatMap((area) => area.slots);
const count = (p) => all.filter((slot) => slot.priority === p).length;
const cell = (text) => String(text ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");

let md = `# Art assets

Everything the site wants drawn, in one list, so the images can be generated in a single pass.
Generated from \`app-client/app/lib/art/slots/*.json\` by \`npm run art:doc\`; edit the JSON, not this file.
Live previews with placeholders: \`/dev/art\` on a local dev server.

**${all.length} scene images** (${count("high")} high, ${count("medium")} medium, ${count("low")} low priority) plus the talent set below.

## How art gets into the site

- **Scene images** (this list) are keyed by slot id. The art pipeline writes each one into the manifest
  (\`/art/manifest.json\`) under \`scenes["<id>"]\` as \`{ src, srcset?: { 600, 1200, 2400 }, w, h }\`.
  Every \`<SceneArt slot="<id>">\` picks it up; nothing in the UI changes.
- **Talent art** is per talent under \`talents["<SYMBOL>"]\` and drawn by \`<ArtSlot>\`.
- Until an image exists its slot shows a placeholder at the final aspect ratio. In development the
  placeholder is labelled with the slot id and size (in production: set localStorage \`nasfaq-art-debug\` to \`1\`).
- Style for everything: the site's "terminal floor" look. Dark ink backgrounds (#0a0c11), hololive blue
  (#3fb8f5) as the key colour, clean anime illustration for characters, flat graphic shapes and halftone
  for everything else. Nothing should carry text unless the brief says so: the UI sets the words.
- Backdrops need a quiet area where the UI puts text (the brief says where) and must still work under
  a dark gradient. Light mode shows the same image, so avoid pure-black edges that look like holes.

## Talent set (per talent, all ${"~"}70 talents)

| Asset | Size | Notes |
|---|---|---|
| Key art | 4:5, 1200×1500 (+600w) | Half-body, facing slightly left, eye line about 30% from the top (\`eye_y\`), transparent or plain background. Used on stock pages, cards, profile banners, the arcade hero. |
| Chibi · idle | 512×512 transparent (+256, 128) | Neutral, standing. Optional eyes-closed \`blink\` frame. |
| Chibi · hype | 512×512 | Stock up big / a win. |
| Chibi · moon | 512×512 | Pointing up, rocket energy. |
| Chibi · cope | 512×512 | Stock down / a loss, sweating smile. |
| Chibi · smug | 512×512 | Called it. |
| Chibi · shock | 512×512 | Something wild happened. |

`;

for (const area of areas) {
  if (!area.slots.length) continue;
  md += `\n## ${area.area} (${area.slots.length})\n\n| Slot | Size | Kind | Priority | Where | Brief |\n|---|---|---|---|---|---|\n`;
  for (const slot of [...area.slots].sort((a, b) => RANK[a.priority] - RANK[b.priority] || a.id.localeCompare(b.id))) {
    const brief = slot.notes ? `${slot.brief} *${slot.notes}*` : slot.brief;
    md += `| \`${slot.id}\`<br>${cell(slot.title)} | ${slot.w}×${slot.h}${slot.transparent ? "<br>transparent" : ""} | ${slot.kind} | ${slot.priority} | ${cell(slot.where.join(", "))} | ${cell(brief)} |\n`;
  }
}

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, md);
console.log(`wrote ${out}: ${all.length} scene slots`);
