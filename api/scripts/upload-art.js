// Uploads the site's art (app-client/public/art: content-hashed WebP files + manifest.json) to the
// images bucket behind images.nasfaq.biz, so the site can load it from the CDN.
//
//   node scripts/upload-art.js --dry-run     what would go up
//   node scripts/upload-art.js               upload new files, then the manifest
//   node scripts/upload-art.js --from ../art-pipeline/dist/art
//
// Credentials (api/.env): ART_UPLOAD_AWS_ACCESS_KEY_ID / ART_UPLOAD_AWS_SECRET_ACCESS_KEY for a
// key that can only write the art prefix (preferred), else the API's AWS_ACCESS_KEY_ID /
// AWS_SECRET_ACCESS_KEY. Bucket: ART_S3_BUCKET or AWS_SW_BUCKET. Region: ART_S3_REGION or AWS_REGION.
// Prefix: ART_S3_PREFIX (default "art"), so files land at https://images.nasfaq.biz/art/...
//
// Image files never change once uploaded (the hash is in the name), so they're cached for a year and
// skipped if already there. The manifest goes last, with a one-minute cache, so the site only
// switches to new art once every file it names is up. Nothing on the bucket is ever deleted.

const fs = require("node:fs");
const path = require("node:path");
const { loadEnv } = require("../src/config");
const { IMMUTABLE, uploadTarget, listKeys, putObject, mapLimit } = require("./lib/s3-upload");

const CONTENT_TYPES = { ".webp": "image/webp", ".png": "image/png", ".jpg": "image/jpeg", ".json": "application/json" };
const MANIFEST_CACHE = "public, max-age=60, must-revalidate";

function arg(name) {
  const index = process.argv.indexOf(name);
  return index > -1 ? process.argv[index + 1] : null;
}

function walk(dir, base = dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, base, out);
    else out.push(path.relative(base, full).split(path.sep).join("/"));
  }
  return out;
}

async function main() {
  loadEnv();
  const dryRun = process.argv.includes("--dry-run");
  const from = path.resolve(arg("--from") || path.join(__dirname, "..", "..", "app-client", "public", "art"));
  const prefix = (process.env.ART_S3_PREFIX || "art").replace(/^\/+|\/+$/g, "");
  if (!fs.existsSync(path.join(from, "manifest.json"))) throw new Error(`No manifest.json in ${from}`);

  const manifest = JSON.parse(fs.readFileSync(path.join(from, "manifest.json"), "utf8"));
  // Only what the manifest names (the folder can hold stale exports from older builds).
  const named = new Set();
  for (const image of Object.values(manifest.images ?? {})) {
    if (image.src) named.add(image.src);
    for (const file of Object.values(image.srcset ?? {})) if (file) named.add(file);
  }
  const onDisk = new Set(walk(from));
  const missingLocally = [...named].filter((file) => !onDisk.has(file));
  if (missingLocally.length) throw new Error(`${missingLocally.length} files the manifest names aren't in ${from} (first: ${missingLocally[0]}). Rebuild the art first.`);
  // The older talents/scenes blocks name a few extra sizes the site copy leaves out; send those only if present.
  for (const match of JSON.stringify({ talents: manifest.talents, scenes: manifest.scenes }).matchAll(/"([^"]+\.(?:webp|png|jpg))"/g)) {
    if (onDisk.has(match[1])) named.add(match[1]);
  }

  const { client, bucket, region } = uploadTarget();
  const existing = await listKeys(client, bucket, prefix);
  const todo = [...named].filter((file) => !existing.has(`${prefix}/${file}`)).sort();
  const bytes = todo.reduce((sum, file) => sum + fs.statSync(path.join(from, file)).size, 0);
  console.log(`bucket ${bucket} (${region}), prefix ${prefix}/`);
  console.log(`${named.size} files in the manifest, ${existing.size} already on the bucket, ${todo.length} to upload (${(bytes / 1e6).toFixed(1)} MB)`);
  if (dryRun) {
    for (const file of todo.slice(0, 10)) console.log(`  ${prefix}/${file}`);
    if (todo.length > 10) console.log(`  … and ${todo.length - 10} more`);
    console.log(`  ${prefix}/manifest.json (always)`);
    return;
  }

  let done = 0;
  await mapLimit(todo, 8, async (file) => {
    await putObject(client, bucket, `${prefix}/${file}`, fs.readFileSync(path.join(from, file)), CONTENT_TYPES[path.extname(file)] ?? "application/octet-stream", IMMUTABLE);
    done += 1;
    if (done % 50 === 0 || done === todo.length) process.stdout.write(`\r${done}/${todo.length} uploaded   `);
  });
  if (todo.length) process.stdout.write("\n");

  await putObject(client, bucket, `${prefix}/manifest.json`, fs.readFileSync(path.join(from, "manifest.json")), "application/json", MANIFEST_CACHE);
  console.log(`manifest uploaded: ${prefix}/manifest.json (${manifest.generated_at ?? "no date"})`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
