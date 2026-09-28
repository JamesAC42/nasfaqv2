// Seeds a LOCAL dev database so the site has something to trade and play with.
//
//   node scripts/seed-dev.js                 talents (channels, assets, today's prices) + capsule prizes
//   node scripts/seed-dev.js prizes          capsule prizes only (copied from prod's public catalog)
//   node scripts/seed-dev.js ticks           schedule the next 3 days of price ticks (tick prediction markets need them)
//   node scripts/seed-dev.js verify <user>   mark an account's email verified (games and trading need it)
//   node scripts/seed-dev.js cash <user> <n> set an account's cash (for the high-limit tables)
//   node scripts/seed-dev.js admin <user>    make an account a site admin (create markets, control room, games admin)
//   node scripts/seed-dev.js predictions [you]       prediction markets in every state, with history and trades;
//                                                    pass your username to get bets, an order and settled results
//   node scripts/seed-dev.js predictions-live [min]  sim traders keep trading so the floor moves (default 10 min)
//   node scripts/seed-dev.js unlock-all <user>  every capsule prize (hats, themes, badges…, inactive ones too),
//                                               every talent card at every rarity (so every gallery banner,
//                                               card and reaction is unlocked), 5,000 shards, email verified.
//                                               Run `prizes` (or seed-gacha-prizes.js db) first for the prize list.
//
// Refuses to run unless DATABASE_URL points at localhost, so it can never touch production.
// Channel ids are made up, so YouTube stats and livestreams stay empty; real data needs a prod dump.

const { loadEnv } = require("../src/config");
const { createPool } = require("../src/db");

// [symbol, name, unit, icon, colour, price, open, (old circulating supply: unused, players' holdings are the circulating supply now)]
const TALENTS = [
  ["AKI", "Aki Rosenthal", "hololive 1st Generation", "aki", "#feefbc", 10.96, 10.94, 7628],
  ["AME", "Watson Amelia", "hololive English -Myth-", "amelia", "#ffd642", 10.28, 10.24, 6957],
  ["AQU", "Minato Aqua", "hololive 2nd Generation", "aqua", "#3b42ab", 13.9, 13.9, 10000],
  ["AYA", "Nakiri Ayame", "hololive 2nd Generation", "ayame", "#fe3434", 12.44, 12.44, 7133],
  ["AZK", "AZKi", "hololive Generation 0", "azki", "#ff4d4d", 12.65, 12.5, 7700],
  ["BIJ", "Koseki Bijou", "hololive English -Advent-", "koseki", "#b19abc", 10.42, 10.42, 7219],
  ["BLD", "Elizabeth Rose Bloodflame", "hololive English -Justice-", "bloodflame", "#bd0f0f", 8.86, 9.29, 7129],
  ["BLZ", "Hakos Baelz", "hololive English -Promise-", "baelz", "#fee020", 11.82, 11.82, 7725],
  ["BOT", "Shishiro Botan", "hololive 5th Generation", "botan", "#dedede", 14.36, 14.32, 8537],
  ["BYS", "FuwaMoco Abyssgard", "hololive English -Advent-", "fuwamoco", "#f0e5cc", 12.26, 12.37, 8116],
  ["CHC", "Yuzuki Choco", "hololive 2nd Generation", "choco", "#ffdbdb", 11.32, 11.25, 9577],
  ["CHH", "Rindo Chihaya", "hololive FLOW GLOW", "chihaya", "#3e9389", 8.91, 8.9, 7654],
  ["CHL", "Sakamata Chloe", "hololive holoX", "chloe", "#7d0d0d", 10.73, 10.69, 7076],
  ["CLI", "Mori Calliope", "hololive English -Myth-", "calliope", "#ffa3c8", 17.7, 17.71, 8946],
  ["COC", "Kiryu Coco", "hololive 4th Generation", "coco", "#fe892a", 8.94, 8.93, 6871],
  ["DRK", "La+ Darknesss", "hololive holoX", "laplus", "#3a256a", 12.83, 12.71, 7204],
  ["FAU", "Ceres Fauna", "hololive English -Promise-", "fauna", "#9effbb", 9.16, 9.16, 7084],
  ["FBK", "Shirakami Fubuki", "hololive 1st Generation", "fubuki", "#7cd2fe", 18.18, 18.14, 7590],
  ["FFT", "Airani Iofifteen", "hololive Indonesia", "iofi", "#f52eac", 9.44, 9.48, 7850],
  ["FLR", "Shiranui Flare", "hololive 3rd Generation", "flare", "#ffb36b", 11.26, 11.11, 8507],
  ["GUR", "Gawr Gura", "hololive English -Myth-", "gura", "#3678a1", 18.58, 18.44, 7193],
  ["HAT", "Akai Haato", "hololive 1st Generation", "haato", "#ff2929", 13.77, 13.71, 8798],
  ["HIO", "Hiodoshi Ao", "hololive ReGLOSS", "ao", "#484960", 7.75, 7.75, 6874],
  ["HJM", "Todoroki Hajime", "hololive ReGLOSS", "hajime", "#f7dbff", 13.24, 13.07, 8244],
  ["HSH", "Moona Hoshinova", "hololive Indonesia", "moona", "#b468f3", 12.9, 13.04, 10000],
  ["INA", "Ninomae Ina’nis", "hololive English -Myth-", "inanis", "#463b4e", 14.34, 14.32, 8439],
  ["IRO", "Kazama Iroha", "hololive holoX", "iroha", "#74d2c8", 12.28, 12.35, 7969],
  ["KAN", "Amane Kanata", "hololive 4th Generation", "kanata", "#dadce8", 11.97, 12.66, 9401],
  ["KND", "Otonose Kanade", "hololive ReGLOSS", "kanade", "#ffeebf", 11.57, 11.52, 8531],
  ["KNR", "Kobo Kanaeru", "hololive Indonesia", "kanaeru", "#addafb", 16.95, 16.76, 7376],
  ["KRA", "Takanashi Kiara", "hololive English -Myth-", "kiara", "#ff8365", 14.18, 14.18, 8410],
  ["KRE", "Inugami Korone", "hololive GAMERS", "korone", "#fff59c", 16.24, 16.16, 7877],
  ["KRN", "Ouro Kronii", "hololive English -Promise-", "kronii", "#253bb3", 11.04, 11.04, 7555],
  ["KVL", "Kaela Kovalskia", "hololive Indonesia", "kovalskia", "#f34552", 11.17, 11.17, 9060],
  ["KYR", "Hakui Koyori", "hololive holoX", "koyori", "#f7d1d5", 13.89, 13.97, 8249],
  ["LAM", "Yukihana Lamy", "hololive 5th Generation", "lamy", "#abdbff", 12.98, 12.98, 7795],
  ["LUI", "Takane Lui", "hololive holoX", "lui", "#f2abac", 12.74, 13.38, 8020],
  ["LUN", "Himemori Luna", "hololive 4th Generation", "luna", "#ffaadc", 12.16, 12.15, 8410],
  ["MAR", "Houshou Marine", "hololive 3rd Generation", "marine", "#bf4848", 22.49, 22.59, 7824],
  ["MIK", "Sakura Miko", "hololive Generation 0", "miko", "#ff5286", 18.23, 19.33, 8572],
  ["MIO", "Ookami Mio", "hololive GAMERS", "mio", "#35323d", 13.56, 13.56, 7748],
  ["MIZ", "Mizumiya Su", "hololive FLOW GLOW", "su", "#85effa", 10.85, 10.84, 8736],
  ["MLF", "Anya Melfissa", "hololive Indonesia", "melfissa", "#9f7c80", 10.03, 9.96, 7631],
  ["MMR", "Cecilia Immergreen", "hololive English -Justice-", "immergreen", "#10da7c", 8.22, 7.92, 7476],
  ["MRN", "Gigi Murin", "hololive English -Justice-", "murin", "#fba92c", 8.43, 8.4, 7233],
  ["MTS", "Natsuiro Matsuri", "hololive 1st Generation", "matsuri", "#fcd267", 14.48, 14.49, 8251],
  ["MUM", "Nanashi Mumei", "hololive English -Promise-", "mumei", "#be9a8a", 9.79, 9.76, 7053],
  ["NEN", "Momosuzu Nene", "hololive 5th Generation", "nene", "#fff2c0", 11.63, 11.66, 7422],
  ["NIK", "Koganei Niko", "hololive FLOW GLOW", "niko", "#ea902b", 10.2, 9.82, 7818],
  ["NOE", "Shirogane Noel", "hololive 3rd Generation", "noel", "#465f6b", 15.62, 15.08, 7679],
  ["NVL", "Shiori Novella", "hololive English -Advent-", "shiori", "#705f8b", 9.26, 9.24, 7146],
  ["OKY", "Nekomata Okayu", "hololive GAMERS", "okayu", "#dc76f4", 16.32, 16.33, 8635],
  ["OLL", "Kureiji Ollie", "hololive Indonesia", "ollie", "#ee014c", 10.8, 10.8, 8086],
  ["PEK", "Usada Pekora", "hololive 3rd Generation", "pekora", "#cedcf5", 18.94, 18.92, 8374],
  ["PLK", "Omaru Polka", "hololive 5th Generation", "polka", "#3599ea", 13.09, 13.08, 7818],
  ["PNT", "Raora Panthera", "hololive English -Justice-", "panthera", "#ff85c0", 9.6, 9.35, 8590],
  ["RBC", "Robocosan", "hololive Generation 0", "roboco", "#ef4989", 12.6, 12.37, 7869],
  ["RDN", "Juufuutei Raden", "hololive ReGLOSS", "raden", "#444153", 11.85, 11.86, 7312],
  ["REI", "Pavolia Reine", "hololive Indonesia", "reine", "#73e2c8", 9.63, 9.63, 7458],
  ["RIO", "Isaki Riona", "hololive FLOW GLOW", "riona", "#cdc5c3", 8.49, 8.47, 8203],
  ["RIS", "Ayunda Risu", "hololive Indonesia", "risu", "#fdccc8", 9.93, 9.93, 7311],
  ["RRK", "Ichijou Ririka", "hololive ReGLOSS", "ririka", "#fff0f8", 9.74, 9.75, 7474],
  ["RVN", "Nerissa Ravencroft", "hololive English -Advent-", "nerissa", "#5167d9", 11.17, 11.11, 7264],
  ["RYS", "IRyS", "hololive English -Promise-", "irys", "#c51072", 10.69, 10.69, 7657],
  ["SAN", "Tsukumo Sana", "hololive English -Council-", "sana", "#2a24ca", 4.98, 4.96, 6891],
  ["SBR", "Oozora Subaru", "hololive 2nd Generation", "subaru", "#e8f56a", 17.01, 16.96, 8920],
  ["SHI", "Murasaki Shion", "hololive 2nd Generation", "shion", "#5c366e", 10.53, 10.51, 7097],
  ["SRA", "Tokino Sora", "hololive Generation 0", "sora", "#8485f6", 13.48, 13.43, 8697],
  ["SUI", "Hoshimachi Suisei", "hololive Generation 0", "suisei", "#9dc9f4", 19.09, 19.1, 7934],
  ["TOW", "Tokoyami Towa", "hololive 4th Generation", "towa", "#c29edc", 15.04, 15.42, 8124],
  ["VIV", "Kikirara Vivi", "hololive FLOW GLOW", "vivi", "#ae88fa", 10.77, 10.39, 8399],
  ["WAT", "Tsunomaki Watame", "hololive 4th Generation", "watame", "#feffe6", 15.83, 15.86, 8682],
  ["ZET", "Vestia Zeta", "hololive Indonesia", "zeta", "#bdbdc3", 11.03, 11.32, 7876]
];

// Capsule prizes are copied from prod's public catalog, so names, odds and images (served from the
// CDN) match the real machine. If prod can't be reached, this small set stands in (no images).
const PROD_CATALOG_URL = process.env.SEED_PRIZES_FROM || "https://holo.nasfaq.biz/api/games/capsule-gacha/catalog";
const FALLBACK_PRIZES = [
  // [cosmetic_key, display name, type, rarity, weight]
  ["dev-hat-common-cap", "Cap", "hat", "common", 32],
  ["dev-hat-common-beanie", "Beanie", "hat", "common", 32],
  ["dev-frame-rare-gold", "Gold frame", "profile_frame", "rare", 12],
  ["dev-flair-rare-star", "Star flair", "chat_flair", "rare", 12],
  ["dev-badge-rare-ribbon", "Ribbon badge", "profile_badge", "rare", 12],
  ["dev-hat-epic-crown", "Crown", "hat", "epic", 4],
  ["dev-frame-epic-neon", "Neon frame", "profile_frame", "epic", 4],
  ["dev-hat-legendary-halo", "Halo", "hat", "legendary", 1],
];

function assertLocal(url) {
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    throw new Error("DATABASE_URL is missing or invalid");
  }
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(host)) {
    throw new Error(`refusing to seed ${host}: seed-dev.js only runs against a local database`);
  }
}

async function seedTalents(pool) {
  const today = new Date().toISOString().slice(0, 10);
  for (const [index, [symbol, name, unit, icon, color, price, open]] of TALENTS.entries()) {
    const channelId = `UCdev${symbol}${String(index).padStart(3, "0")}`.padEnd(24, "0");
    await pool.query(
      `INSERT INTO yt.youtube_channels (youtube_channel_id, name_short, name_english, symbol, icon, color, unit)
       VALUES ($1, $2, $2, $3, $4, $5, $6)
       ON CONFLICT (youtube_channel_id) DO UPDATE SET name_short = EXCLUDED.name_short, name_english = EXCLUDED.name_english,
         symbol = EXCLUDED.symbol, icon = EXCLUDED.icon, color = EXCLUDED.color, unit = EXCLUDED.unit`,
      [channelId, name, symbol, icon, color, unit]
    );
    const asset = await pool.query(
      `INSERT INTO market.market_assets (youtube_channel_id, symbol, display_name, status, max_supply, circulating_supply, treasury_supply,
         liquidity_depth, spread_bps, current_mid_price, current_bid_price, current_ask_price)
       VALUES ($1, $2, $3, 'active', 10000, $4, $5, 1000, 400, $6, $6 * 0.98, $6 * 1.02)
       ON CONFLICT (symbol) DO UPDATE SET display_name = EXCLUDED.display_name
       RETURNING id, current_mid_price`,
      [channelId, symbol, name, 0, 10000, price]
    );
    const snapshot = await pool.query(
      `INSERT INTO market.channel_daily_snapshots (youtube_channel_id, snapshot_date, subscriber_count, view_count)
       VALUES ($1, $2, 1000000, 100000000)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [channelId, today]
    );
    const snapshotId =
      snapshot.rows[0]?.id ??
      (await pool.query(`SELECT id FROM market.channel_daily_snapshots WHERE youtube_channel_id = $1 ORDER BY id DESC LIMIT 1`, [channelId])).rows[0].id;
    await pool.query(
      `INSERT INTO market.asset_daily_market_state (asset_id, market_date, snapshot_id, fair_value, mid_open, daily_emission,
         treasury_supply_start, circulating_supply_start)
       VALUES ($1, $2, $3, $4, $4, 0, $5, $6)
       ON CONFLICT (asset_id, market_date) DO NOTHING`,
      [asset.rows[0].id, today, snapshotId, open, 10000, 0]
    );
  }
  console.log(`seeded ${TALENTS.length} talents`);
}

async function fetchProdPrizes() {
  try {
    const response = await fetch(PROD_CATALOG_URL, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = await response.json();
    const rewards = Array.isArray(body?.rewards) ? body.rewards : [];
    if (!rewards.length) throw new Error("no rewards in the catalog");
    return rewards.map((reward, index) => ({
      cosmeticKey: reward.cosmetic_key || reward.key,
      displayName: reward.display_name || reward.cosmetic_key,
      description: reward.description || "",
      type: reward.cosmetic_type || reward.type || "profile_badge",
      rarity: reward.rarity || "common",
      slotKey: reward.slot_key || null,
      weight: Number(reward.pull_weight ?? reward.weight ?? 1),
      imageKey: reward.image_key,
      filename: reward.filename || String(reward.image_key || "").split("/").pop(),
      metadata: reward.metadata || {},
      sortOrder: Number(reward.sort_order ?? index),
    }));
  } catch (error) {
    console.warn(`couldn't copy prizes from ${PROD_CATALOG_URL} (${error.message}); using the built-in set without images`);
    return null;
  }
}

async function seedPrizes(pool) {
  const copied = await fetchProdPrizes();
  const prizes =
    copied ??
    FALLBACK_PRIZES.map(([cosmeticKey, displayName, type, rarity, weight], index) => ({
      cosmeticKey,
      displayName,
      description: "",
      type,
      rarity,
      slotKey: type,
      weight,
      imageKey: `gachaprizes/${cosmeticKey}.png`,
      filename: `${cosmeticKey}.png`,
      metadata: {},
      sortOrder: index,
    }));
  for (const prize of prizes) {
    if (!prize.cosmeticKey || !prize.imageKey) continue;
    await pool.query(
      `INSERT INTO games.gacha_prize_items (game_key, cosmetic_key, display_name, description, cosmetic_type, rarity, slot_key,
         pull_weight, image_key, filename, metadata_json, is_active, is_deleted, sort_order, updated_at)
       VALUES ('capsule-gacha', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true, false, $11, now())
       ON CONFLICT (game_key, cosmetic_key) DO UPDATE SET display_name = EXCLUDED.display_name, description = EXCLUDED.description,
         cosmetic_type = EXCLUDED.cosmetic_type, rarity = EXCLUDED.rarity, slot_key = EXCLUDED.slot_key, pull_weight = EXCLUDED.pull_weight,
         image_key = EXCLUDED.image_key, filename = EXCLUDED.filename, metadata_json = EXCLUDED.metadata_json, is_active = true,
         is_deleted = false, sort_order = EXCLUDED.sort_order, updated_at = now()`,
      [prize.cosmeticKey, prize.displayName, prize.description, prize.type, prize.rarity, prize.slotKey, prize.weight, prize.imageKey, prize.filename,
        JSON.stringify(prize.metadata), prize.sortOrder]
    );
  }
  if (copied) {
    // The real pool replaces any stand-ins from an earlier offline run.
    await pool.query(`UPDATE games.gacha_prize_items SET is_deleted = true, updated_at = now() WHERE game_key = 'capsule-gacha' AND NOT (cosmetic_key = ANY($1::text[]))`, [
      prizes.map((prize) => prize.cosmeticKey),
    ]);
  }
  const counts = prizes.reduce((acc, prize) => ({ ...acc, [prize.rarity]: (acc[prize.rarity] || 0) + 1 }), {});
  console.log(`seeded ${prizes.length} capsule prizes (${Object.entries(counts).map(([rarity, n]) => `${n} ${rarity}`).join(", ")})`);
}

/**
 * Price ticks locally: production schedules them after each daily settlement, which needs real
 * YouTube data. Here we give every talent a fair value near its price and schedule the next few
 * days, so ticks move prices and the tick prediction markets open.
 */
async function seedTicks(pool) {
  const adjustments = require("../src/services/marketAdjustments");
  await pool.query(
    `UPDATE market.market_assets a SET current_fair_value = v.fv, current_fair_value_raw = v.fv, adjustment_enabled = true
     FROM (SELECT id, current_mid_price * (0.85 + random() * 0.3) AS fv FROM market.market_assets) v
     WHERE v.id = a.id AND (a.current_fair_value IS NULL OR a.current_fair_value <= 0) AND a.current_mid_price > 0`
  );
  const day = (offset) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(Date.now() + offset * 86_400_000));
  let intervals = 0;
  for (const offset of [0, 1, 2]) intervals += (await adjustments.ensureAdjustmentSession(pool, { marketDate: day(offset) })).interval_count || 0;
  console.log(`scheduled ticks for ${day(0)} to ${day(2)} (${intervals} talent-ticks)`);
}

async function findUser(pool, username) {
  const { rows } = await pool.query(`SELECT id, username FROM market.users WHERE username_normalized = lower($1)`, [String(username || "")]);
  if (!rows[0]) throw new Error(`no user called ${username}. Register on the site first.`);
  return rows[0];
}

async function verify(pool, username) {
  const user = await findUser(pool, username);
  await pool.query(`UPDATE market.users SET email_verified = true, email_verified_at = COALESCE(email_verified_at, now()) WHERE id = $1`, [user.id]);
  console.log(`verified ${user.username}`);
}

async function setCash(pool, username, amount) {
  const user = await findUser(pool, username);
  const target = Number(amount);
  if (!Number.isFinite(target) || target < 0) throw new Error("cash must be a number >= 0");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const current = await client.query(`SELECT cash_balance FROM market.portfolio_cash_balances WHERE user_id = $1 FOR UPDATE`, [user.id]);
    if (!current.rows[0]) throw new Error(`${user.username} has no cash account yet. Sign in on the site once first.`);
    const delta = target - Number(current.rows[0].cash_balance);
    // Through the ledger, so balances still reconcile.
    await client.query(
      `INSERT INTO market.ledger_entries (user_id, asset_id, entry_type, quantity_delta, cash_delta, reference_type, reference_id)
       VALUES ($1, NULL, 'admin_grant', 0, $2, 'dev_seed', $1)`,
      [user.id, delta]
    );
    await client.query(`UPDATE market.portfolio_cash_balances SET cash_balance = $2, updated_at = now() WHERE user_id = $1`, [user.id, target]);
    await client.query("COMMIT");
    console.log(`${user.username} now has $${target}`);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/** Everything unlockable, for looking at art and cosmetics: all prizes, all cards, some shards. */
async function unlockAll(pool, username) {
  const user = await findUser(pool, username);
  const cards = require("../src/services/games/cards");
  const cardGacha = require("../src/services/games/cardGacha");
  const inventory = require("../src/services/games/inventory");
  const catalog = require("../src/services/games/gachaPrizeCatalog");
  const talents = await cards.listTalents(pool);
  const prizes = (await catalog.listAdminPrizeItems(pool)).filter((prize) => !prize.is_deleted);
  const client = await pool.connect();
  let newCosmetics = 0;
  let newCards = 0;
  try {
    await client.query("BEGIN");
    await client.query(`UPDATE market.users SET email_verified = true, email_verified_at = COALESCE(email_verified_at, now()) WHERE id = $1`, [user.id]);
    const { rows: owned } = await client.query(`SELECT cosmetic_key FROM games.user_cosmetics WHERE user_id = $1`, [user.id]);
    const have = new Set(owned.map((row) => row.cosmetic_key));
    for (const prize of prizes) {
      if (have.has(prize.cosmetic_key)) continue;
      // Same metadata a capsule pull records, so it shows (and equips) exactly like a won prize.
      await inventory.grantCosmeticWithClient(client, {
        userId: user.id,
        cosmeticKey: prize.cosmetic_key,
        cosmeticType: prize.cosmetic_type,
        rarity: prize.rarity,
        sourceType: "dev_seed",
        metadata: { display_name: prize.display_name, description: prize.description, slot_key: prize.slot_key, image_key: prize.image_key, image_url: prize.image_url, ...(prize.metadata || {}) },
      });
      newCosmetics += 1;
    }
    const { rows: ownedCards } = await client.query(`SELECT card_key FROM games.user_cards WHERE user_id = $1`, [user.id]);
    const haveCards = new Set(ownedCards.map((row) => row.card_key));
    for (const talent of talents) {
      for (const rarity of cards.RARITIES) {
        if (haveCards.has(cards.cardKey(talent.symbol, rarity))) continue; // re-running doesn't pile up copies
        const grant = await cardGacha.grantCardWithClient(client, { userId: user.id, talent, rarity, source: "dev_seed", awardShards: false });
        if (grant.was_new) newCards += 1;
      }
    }
    await cardGacha.changeShardsWithClient(client, user.id, 5000, "admin_grant", "dev_seed", "unlock-all");
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  console.log(
    `${user.username}: +${newCosmetics} cosmetics (${prizes.length} prizes in the catalog), +${newCards} cards (${talents.length} talents x ${cards.RARITIES.length}), +5,000 shards.\n` +
      "Equip themes, hats and frames from /games/item-locker; set rewards can be claimed from the collection page."
  );
}

async function makeAdmin(pool, username) {
  const user = await findUser(pool, username);
  await pool.query(`UPDATE market.users SET is_admin = true, email_verified = true, email_verified_at = COALESCE(email_verified_at, now()) WHERE id = $1`, [user.id]);
  console.log(`${user.username} is now a site admin. Sign out and back in (or reload) to see the admin links.`);
}

async function main() {
  loadEnv();
  assertLocal(process.env.DATABASE_URL);
  const pool = createPool(process.env.DATABASE_URL);
  const [command, ...args] = process.argv.slice(2);
  try {
    if (!command) {
      await seedTalents(pool);
      await seedPrizes(pool);
      await seedTicks(pool);
    } else if (command === "prizes") await seedPrizes(pool);
    else if (command === "ticks") await seedTicks(pool);
    else if (command === "verify") await verify(pool, args[0]);
    else if (command === "cash") await setCash(pool, args[0], args[1]);
    else if (command === "admin") await makeAdmin(pool, args[0]);
    else if (command === "unlock-all") await unlockAll(pool, args[0]);
    else if (command === "predictions") await require("./seed-predictions").seedPredictions(pool, args[0] || null);
    else if (command === "predictions-live") {
      const { createRedis } = require("../src/redis");
      const redis = await createRedis(process.env.REDIS_URL, process.env.REDIS_PASSWORD);
      try {
        await require("./seed-predictions").runLive(pool, redis, args[0]);
      } finally {
        await redis.quit().catch(() => {});
      }
    }
    else throw new Error(`unknown command ${command}`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error("seed-dev failed:", error.message);
  process.exit(1);
});
