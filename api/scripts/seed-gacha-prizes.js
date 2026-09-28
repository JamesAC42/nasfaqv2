// The capsule prize pool, carried over from the original NASFAQ: api/seed/gacha-prizes/prizes.json
// (names, descriptions, type, rarity, pull weight) plus the images beside it.
//
//   node scripts/seed-gacha-prizes.js upload [--dry-run]    images to the CDN (needs the AWS key in api/.env)
//   node scripts/seed-gacha-prizes.js db [--dry-run] [--retire-others]
//
// Run `upload` first, then `db` against each database (local, then prod with DATABASE_URL set to
// it). Both are safe to re-run.
//
// upload: each image becomes a WebP (at most 512px, alpha kept) at gachaprizes/<name>.<hash>.webp,
// where the hash is of the source file, so `db` knows the key without touching S3 and a changed
// image gets a new URL. Files already on the bucket are skipped; nothing is deleted.
//
// db: creates or updates one row per prize in games.gacha_prize_items, matched by cosmetic_key (or
// an existing row with the same image). prizes.json wins, so edits made in the admin page to these
// prizes are overwritten on the next run; change prizes.json instead. --retire-others takes every
// other capsule prize out of the pool (is_active = false). Players keep what they already own.

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Pool } = require("pg");
const { loadEnv } = require("../src/config");

const GAME_KEY = "capsule-gacha";
const PREFIX = "gachaprizes";
const SOURCE_DIR = path.join(__dirname, "..", "seed", "gacha-prizes");
const TYPES = new Set(["hat", "item", "profile_badge", "profile_frame", "chat_flair", "portfolio_theme"]);
const RARITIES = new Set(["common", "rare", "epic", "legendary"]);
const MAX_SIDE = 512;

function loadPrizes() {
  const file = path.join(SOURCE_DIR, "prizes.json");
  const { prizes } = JSON.parse(fs.readFileSync(file, "utf8"));
  const seen = new Set();
  return prizes.map((prize, index) => {
    const where = `prizes.json #${index + 1} (${prize.key || prize.cosmetic_key || "?"})`;
    if (!/^gacha-[a-z0-9-]+$/.test(prize.cosmetic_key || "")) throw new Error(`${where}: cosmetic_key must look like gacha-some-name`);
    if (seen.has(prize.cosmetic_key)) throw new Error(`${where}: duplicate cosmetic_key`);
    seen.add(prize.cosmetic_key);
    if (!TYPES.has(prize.type)) throw new Error(`${where}: unknown type ${prize.type}`);
    if (!RARITIES.has(prize.rarity)) throw new Error(`${where}: unknown rarity ${prize.rarity}`);
    if (!(Number(prize.weight) >= 0)) throw new Error(`${where}: weight must be a number`);
    const source = path.join(SOURCE_DIR, prize.image || "");
    if (!prize.image || !fs.existsSync(source)) throw new Error(`${where}: image ${prize.image} isn't in seed/gacha-prizes`);
    const bytes = fs.readFileSync(source);
    const hash = crypto.createHash("sha1").update(bytes).digest("hex").slice(0, 8);
    const filename = `${prize.cosmetic_key.replace(/^gacha-/, "")}.${hash}.webp`;
    return {
      ...prize,
      name: String(prize.name || "").trim(),
      description: String(prize.description || "").trim(),
      weight: Number(prize.weight),
      active: prize.active !== false,
      source,
      bytes,
      filename,
      imageKey: `${PREFIX}/${filename}`,
      sortOrder: index,
    };
  });
}

async function toWebp(bytes) {
  const sharp = require("sharp");
  return sharp(bytes).rotate().resize({ width: MAX_SIDE, height: MAX_SIDE, fit: "inside", withoutEnlargement: true }).webp({ quality: 88, alphaQuality: 100, effort: 5 }).toBuffer();
}

async function upload(prizes, { dryRun }) {
  const { IMMUTABLE, uploadTarget, listKeys, putObject, mapLimit } = require("./lib/s3-upload");
  const { client, bucket, region } = uploadTarget();
  const existing = await listKeys(client, bucket, PREFIX);
  const todo = prizes.filter((prize) => !existing.has(prize.imageKey));
  console.log(`bucket ${bucket} (${region}), prefix ${PREFIX}/`);
  console.log(`${prizes.length} prizes, ${prizes.length - todo.length} images already there, ${todo.length} to upload`);
  if (dryRun) {
    for (const prize of todo.slice(0, 10)) console.log(`  ${prize.imageKey}  ← ${prize.image}`);
    if (todo.length > 10) console.log(`  … and ${todo.length - 10} more`);
    return;
  }
  let done = 0;
  let bytesOut = 0;
  await mapLimit(todo, 6, async (prize) => {
    const webp = await toWebp(prize.bytes);
    bytesOut += webp.length;
    await putObject(client, bucket, prize.imageKey, webp, "image/webp", IMMUTABLE);
    done += 1;
    if (done % 20 === 0 || done === todo.length) process.stdout.write(`\r${done}/${todo.length} uploaded   `);
  });
  if (todo.length) process.stdout.write(`\n${(bytesOut / 1e6).toFixed(1)} MB of WebP\n`);
}

async function seedDb(prizes, { dryRun, retireOthers }) {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  const host = (() => {
    try {
      return new URL(process.env.DATABASE_URL).hostname;
    } catch {
      return "?";
    }
  })();
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  const counts = { created: 0, updated: 0, retired: 0 };
  try {
    await client.query("BEGIN");
    for (const prize of prizes) {
      const values = [
        GAME_KEY,
        prize.cosmetic_key,
        prize.name,
        prize.description,
        prize.type,
        prize.rarity,
        prize.type,
        prize.weight,
        prize.imageKey,
        prize.filename,
        prize.active,
        prize.sortOrder,
      ];
      const { rows } = await client.query(
        `SELECT id FROM games.gacha_prize_items WHERE game_key = $1 AND (cosmetic_key = $2 OR image_key = $3) ORDER BY (cosmetic_key = $2) DESC LIMIT 1`,
        [GAME_KEY, prize.cosmetic_key, prize.imageKey]
      );
      if (rows[0]) {
        await client.query(
          `UPDATE games.gacha_prize_items
           SET cosmetic_key = $2, display_name = $3, description = $4, cosmetic_type = $5, rarity = $6, slot_key = $7,
               pull_weight = $8, image_key = $9, filename = $10, is_active = $11, is_deleted = false, sort_order = $12, updated_at = now()
           WHERE id = $13 AND game_key = $1`,
          [...values, rows[0].id]
        );
        counts.updated += 1;
      } else {
        await client.query(
          `INSERT INTO games.gacha_prize_items (game_key, cosmetic_key, display_name, description, cosmetic_type, rarity, slot_key,
             pull_weight, image_key, filename, is_active, sort_order, metadata_json, is_deleted, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, '{}'::jsonb, false, now())`,
          values
        );
        counts.created += 1;
      }
    }
    if (retireOthers) {
      const { rowCount } = await client.query(
        `UPDATE games.gacha_prize_items SET is_active = false, updated_at = now()
         WHERE game_key = $1 AND is_active AND NOT (cosmetic_key = ANY($2::text[]))`,
        [GAME_KEY, prizes.map((prize) => prize.cosmetic_key)]
      );
      counts.retired = rowCount;
    }
    const { rows: others } = await client.query(
      `SELECT cosmetic_key, display_name FROM games.gacha_prize_items
       WHERE game_key = $1 AND is_active AND NOT is_deleted AND NOT (cosmetic_key = ANY($2::text[])) ORDER BY cosmetic_key`,
      [GAME_KEY, prizes.map((prize) => prize.cosmetic_key)]
    );
    await client.query(dryRun ? "ROLLBACK" : "COMMIT");
    const byRarity = {};
    for (const prize of prizes.filter((entry) => entry.active)) byRarity[prize.rarity] = (byRarity[prize.rarity] || 0) + 1;
    console.log(`${dryRun ? "[dry run, rolled back] " : ""}${host}: ${counts.created} created, ${counts.updated} updated${retireOthers ? `, ${counts.retired} other prizes retired` : ""}`);
    console.log(`in the pool: ${Object.entries(byRarity).map(([rarity, n]) => `${n} ${rarity}`).join(", ")}; ${prizes.filter((entry) => !entry.active).length} inactive`);
    if (others.length) console.log(`still in the pool from elsewhere (--retire-others takes them out): ${others.map((row) => row.display_name).join(", ")}`);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

async function main() {
  loadEnv();
  const command = process.argv[2];
  const dryRun = process.argv.includes("--dry-run");
  const prizes = loadPrizes();
  if (command === "upload") return upload(prizes, { dryRun });
  if (command === "db") return seedDb(prizes, { dryRun, retireOthers: process.argv.includes("--retire-others") });
  console.log("usage: node scripts/seed-gacha-prizes.js upload|db [--dry-run] [--retire-others]");
  process.exitCode = 1;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
}

module.exports = { loadPrizes, toWebp };
