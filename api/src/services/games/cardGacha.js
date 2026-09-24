// Talent card gacha: banners, pity, the featured 50/50, duplicates → stars → shards,
// crafting, unit set rewards, the starter pack and the profile showcase.
// Numbers live in cards.js and docs/games/GAMES_DESIGN.md §1.

const crypto = require("node:crypto");
const cards = require("./cards");
const gamesCatalog = require("./catalog");
const gamesInventory = require("./inventory");
const gamesWallet = require("./wallet");

const GAME_KEY = "talent-cards";
const HIGH_EVERY = 10; // every 10th pull is SR+
const SOFT_PITY_FROM = 60; // SSR+ chance climbs from here
const SOFT_PITY_STEP_BPS = 600;
const HARD_PITY = 80; // guaranteed SSR+
const TOP_RATE_BPS = cards.RARITY_INFO.SSR.rateBps + cards.RARITY_INFO.UR.rateBps; // 400
const UR_SHARE_OF_TOP = cards.RARITY_INFO.UR.rateBps / TOP_RATE_BPS; // 1/8
const STARTER_PACK_SIZE = 5;
const SHOWCASE_SLOTS = 5;
const SET_REWARDS = {
  roster: { shards: 300, cosmeticType: "profile_badge", label: "Roster" },
  spotlight: { shards: 1500, cosmeticType: "profile_frame", label: "Spotlight" },
};

function gachaError(code, extra = {}) {
  const error = new Error(code);
  error.code = code;
  Object.assign(error, extra);
  return error;
}

function randomUnit() {
  return Number(crypto.randomBytes(6).readUIntBE(0, 6)) / 2 ** 48;
}

function randomInt(max) {
  return crypto.randomInt(0, max);
}

function slug(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/^hololive\s+/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function unitLabel(unit) {
  return String(unit || "").replace(/^hololive\s+/i, "").trim() || "Unaffiliated";
}

// ── Banners ────────────────────────────────────────────────────────────────
function weekStartUtc(now = new Date()) {
  const day = now.getUTCDay(); // 0 = Sunday
  const diff = (day + 6) % 7; // days since Monday
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - diff));
  return start;
}

async function getBanners(db, talents, now = new Date()) {
  const bySymbolId = new Map(talents.map((talent) => [talent.asset_id, talent]));
  const standard = {
    key: "standard",
    pool_key: "standard",
    kind: "standard",
    name: "Standard",
    featured: null,
    starts_at: null,
    ends_at: null,
  };

  const { rows } = await db.query(
    `
    SELECT key, name, featured_asset_id, starts_at, ends_at
    FROM games.card_banners
    WHERE is_active AND starts_at <= $1 AND ends_at > $1
    ORDER BY starts_at DESC
    LIMIT 1
  `,
    [now]
  );
  let featured = null;
  if (rows[0] && bySymbolId.has(Number(rows[0].featured_asset_id))) {
    const talent = bySymbolId.get(Number(rows[0].featured_asset_id));
    featured = { key: rows[0].key, name: rows[0].name, talent, starts_at: rows[0].starts_at, ends_at: rows[0].ends_at };
  } else if (talents.length) {
    // No scheduled banner: rotate a featured talent every week, deterministically.
    const start = weekStartUtc(now);
    const end = new Date(start.getTime() + 7 * 86_400_000);
    const weekKey = start.toISOString().slice(0, 10);
    const index = parseInt(crypto.createHash("sha256").update(`featured:${weekKey}`).digest("hex").slice(0, 8), 16) % talents.length;
    const talent = [...talents].sort((a, b) => a.symbol.localeCompare(b.symbol))[index];
    featured = { key: `featured-${weekKey}`, name: `${talent.name} week`, talent, starts_at: start.toISOString(), ends_at: end.toISOString() };
  }

  const out = [standard];
  if (featured) {
    out.push({
      key: featured.key,
      pool_key: "featured",
      kind: "featured",
      name: featured.name,
      featured: {
        symbol: featured.talent.symbol,
        name: featured.talent.name,
        icon: featured.talent.icon,
        color: featured.talent.color,
        unit: featured.talent.unit,
      },
      starts_at: featured.starts_at,
      ends_at: featured.ends_at,
    });
  }
  return out;
}

function publicRates() {
  return cards.RARITIES.map((rarity) => ({
    rarity,
    name: cards.RARITY_INFO[rarity].name,
    rate_bps: cards.RARITY_INFO[rarity].rateBps,
    power: cards.RARITY_INFO[rarity].power,
    duplicate_shards: cards.RARITY_INFO[rarity].dupShards,
    craft_shards: cards.RARITY_INFO[rarity].craftShards,
  }));
}

// ── Shards ─────────────────────────────────────────────────────────────────
async function lockShardsWithClient(client, userId) {
  await client.query(
    `INSERT INTO games.user_currencies (user_id, shards) VALUES ($1, 0) ON CONFLICT (user_id) DO NOTHING`,
    [userId]
  );
  const { rows } = await client.query(`SELECT shards FROM games.user_currencies WHERE user_id = $1 FOR UPDATE`, [userId]);
  return Number(rows[0].shards);
}

async function changeShardsWithClient(client, userId, delta, reason, referenceType, referenceId) {
  if (!delta) return lockShardsWithClient(client, userId);
  const current = await lockShardsWithClient(client, userId);
  const next = current + delta;
  if (next < 0) throw gachaError("insufficient_shards", { shards: current, required_shards: -delta });
  await client.query(`UPDATE games.user_currencies SET shards = $2, updated_at = now() WHERE user_id = $1`, [userId, next]);
  await client.query(
    `INSERT INTO games.shard_ledger (user_id, delta, reason, reference_type, reference_id) VALUES ($1,$2,$3,$4,$5)`,
    [userId, delta, reason, referenceType, String(referenceId)]
  );
  return next;
}

// ── Granting cards ─────────────────────────────────────────────────────────
/**
 * Adds a copy of a card. The first copy is ★1; each duplicate adds a star up to ★5 and pays
 * duplicate shards (double once the card is maxed). Crafted copies don't pay shards.
 */
async function grantCardWithClient(client, { userId, talent, rarity, source, awardShards = true }) {
  const key = cards.cardKey(talent.symbol, rarity);
  const { rows } = await client.query(
    `SELECT id, stars, copies FROM games.user_cards WHERE user_id = $1 AND card_key = $2 FOR UPDATE`,
    [userId, key]
  );
  const info = cards.RARITY_INFO[rarity];
  if (!rows[0]) {
    await client.query(
      `
      INSERT INTO games.user_cards (user_id, card_key, asset_id, rarity, stars, copies, first_source)
      VALUES ($1,$2,$3,$4,1,1,$5)
    `,
      [userId, key, talent.asset_id, rarity, source]
    );
    return { key, was_new: true, stars: 1, copies: 1, shards: 0 };
  }
  const maxed = Number(rows[0].stars) >= cards.MAX_STARS;
  const stars = maxed ? cards.MAX_STARS : Number(rows[0].stars) + 1;
  const copies = Number(rows[0].copies) + 1;
  await client.query(
    `UPDATE games.user_cards SET stars = $2, copies = $3, last_obtained_at = now() WHERE id = $1`,
    [rows[0].id, stars, copies]
  );
  const shards = awardShards ? (maxed ? info.dupShards * 2 : info.dupShards) : 0;
  return { key, was_new: false, stars, copies, shards };
}

// ── Pity and rolling ───────────────────────────────────────────────────────
async function lockPityWithClient(client, userId, poolKey) {
  await client.query(
    `INSERT INTO games.gacha_pity (user_id, pool_key) VALUES ($1, $2) ON CONFLICT (user_id, pool_key) DO NOTHING`,
    [userId, poolKey]
  );
  const { rows } = await client.query(
    `SELECT pulls_since_high, pulls_since_top, featured_guaranteed, total_pulls FROM games.gacha_pity WHERE user_id = $1 AND pool_key = $2 FOR UPDATE`,
    [userId, poolKey]
  );
  return {
    sinceHigh: Number(rows[0].pulls_since_high),
    sinceTop: Number(rows[0].pulls_since_top),
    featuredGuaranteed: Boolean(rows[0].featured_guaranteed),
    total: Number(rows[0].total_pulls),
  };
}

async function savePityWithClient(client, userId, poolKey, pity) {
  await client.query(
    `
    UPDATE games.gacha_pity
    SET pulls_since_high = $3, pulls_since_top = $4, featured_guaranteed = $5, total_pulls = $6, updated_at = now()
    WHERE user_id = $1 AND pool_key = $2
  `,
    [userId, poolKey, pity.sinceHigh, pity.sinceTop, pity.featuredGuaranteed, pity.total]
  );
}

/** SSR+ chance for the next pull, in basis points, given pulls since the last SSR+. */
function topRateBps(sinceTop) {
  const pullNumber = sinceTop + 1;
  if (pullNumber >= HARD_PITY) return 10_000;
  if (pullNumber >= SOFT_PITY_FROM) return Math.min(10_000, TOP_RATE_BPS + (pullNumber - SOFT_PITY_FROM + 1) * SOFT_PITY_STEP_BPS);
  return TOP_RATE_BPS;
}

function rollRarity(pity) {
  const top = topRateBps(pity.sinceTop);
  const roll = randomUnit() * 10_000;
  if (roll < top) return randomUnit() < UR_SHARE_OF_TOP ? "UR" : "SSR";
  if (pity.sinceHigh + 1 >= HIGH_EVERY) return "SR";
  const rest = roll - top; // position within the non-top range
  const scale = (10_000 - top) / (10_000 - TOP_RATE_BPS); // non-top rates keep their proportions
  if (rest < cards.RARITY_INFO.SR.rateBps * scale) return "SR";
  if (rest < (cards.RARITY_INFO.SR.rateBps + cards.RARITY_INFO.R.rateBps) * scale) return "R";
  return "C";
}

function advancePity(pity, rarity) {
  const next = { ...pity, total: pity.total + 1 };
  if (rarity === "SSR" || rarity === "UR") {
    next.sinceTop = 0;
    next.sinceHigh = 0;
  } else if (rarity === "SR") {
    next.sinceTop += 1;
    next.sinceHigh = 0;
  } else {
    next.sinceTop += 1;
    next.sinceHigh += 1;
  }
  return next;
}

function pityStatus(pity) {
  return {
    pulls_since_sr: pity.sinceHigh,
    pulls_since_ssr: pity.sinceTop,
    next_sr_guaranteed_in: Math.max(1, HIGH_EVERY - pity.sinceHigh),
    ssr_guaranteed_in: Math.max(1, HARD_PITY - pity.sinceTop),
    soft_pity_active: pity.sinceTop + 1 >= SOFT_PITY_FROM,
    next_ssr_rate_bps: topRateBps(pity.sinceTop),
    featured_guaranteed: pity.featuredGuaranteed,
    total_pulls: pity.total,
  };
}

// ── Pulling ────────────────────────────────────────────────────────────────
async function pullCards(pool, { userId, bannerKey, count }) {
  const pulls = Number(count) === 10 ? 10 : Number(count) === 1 ? 1 : null;
  if (!pulls) throw gachaError("invalid_pull_count");

  const game = await gamesCatalog.getGameByKey(pool, GAME_KEY);
  if (!game) throw gachaError("game_not_found");
  const cost = Number(pulls === 10 ? game.config_json?.ten_pull_cost_cash ?? 900 : game.config_json?.pull_cost_cash ?? 100);

  const talents = await cards.listTalents(pool);
  if (!talents.length) throw gachaError("card_pool_empty");
  const banners = await getBanners(pool, talents);
  const banner = banners.find((entry) => entry.key === (bannerKey || "standard"));
  if (!banner) throw gachaError("banner_not_found");
  const featured = banner.featured ? talents.find((talent) => talent.symbol === banner.featured.symbol) : null;
  const others = featured ? talents.filter((talent) => talent.symbol !== featured.symbol) : talents;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const session = await client.query(
      `
      INSERT INTO games.game_sessions (game_id, user_id, status, entry_fee_cash, payout_cash, started_at, created_at)
      VALUES ($1,$2,'active',$3,0,now(),now())
      RETURNING id
    `,
      [game.id, userId, cost]
    );
    const sessionId = Number(session.rows[0].id);
    const debit = await gamesWallet.debitCashForGameWithClient(client, {
      userId,
      amount: cost,
      entryType: "gacha_pull_fee",
      referenceType: "game_session",
      referenceId: sessionId,
    });

    let pity = await lockPityWithClient(client, userId, banner.pool_key);
    const batchId = crypto.randomUUID();
    const results = [];
    let shardsTotal = 0;
    for (let index = 0; index < pulls; index += 1) {
      const pityBefore = pity.sinceTop;
      const rarity = rollRarity(pity);
      let talent;
      let wasFeatured = false;
      if (featured && (rarity === "SSR" || rarity === "UR")) {
        const winsFiftyFifty = pity.featuredGuaranteed || randomUnit() < 0.5;
        talent = winsFiftyFifty ? featured : others[randomInt(others.length)];
        wasFeatured = winsFiftyFifty;
        pity = { ...pity, featuredGuaranteed: !winsFiftyFifty };
      } else {
        talent = talents[randomInt(talents.length)];
      }
      pity = advancePity(pity, rarity);
      const grant = await grantCardWithClient(client, { userId, talent, rarity, source: "gacha" });
      shardsTotal += grant.shards;
      await client.query(
        `
        INSERT INTO games.card_pulls (
          user_id, batch_id, banner_key, pool_key, cost_cash, card_key, asset_id, rarity,
          was_featured, was_new, stars_after, shards_awarded, pity_before
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      `,
        [userId, batchId, banner.key, banner.pool_key, cost / pulls, grant.key, talent.asset_id, rarity, wasFeatured, grant.was_new, grant.stars, grant.shards, pityBefore]
      );
      results.push({
        ...cards.publicCard(talent, rarity, { stars: grant.stars }),
        was_new: grant.was_new,
        was_featured: wasFeatured,
        stars: grant.stars,
        copies: grant.copies,
        shards: grant.shards,
      });
    }
    await savePityWithClient(client, userId, banner.pool_key, pity);
    const shards = await changeShardsWithClient(client, userId, shardsTotal, "duplicate", "card_pull_batch", batchId);
    const best = results.reduce((top, card) => (cards.rarityRank(card.rarity) > cards.rarityRank(top.rarity) ? card : top), results[0]);
    await client.query(
      `
      UPDATE games.game_sessions
      SET status = 'completed', result_json = $2, completed_at = now()
      WHERE id = $1
    `,
      [sessionId, JSON.stringify({ type: "card_pull", batch_id: batchId, banner: banner.key, count: pulls, best: best.key, shards: shardsTotal })]
    );
    await client.query("COMMIT");
    return {
      batch_id: batchId,
      banner: { key: banner.key, kind: banner.kind, name: banner.name },
      cost_cash: cost,
      cash_balance: debit.cash_balance,
      shards,
      shards_awarded: shardsTotal,
      cards: results,
      pity: pityStatus(pity),
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

// ── Crafting ───────────────────────────────────────────────────────────────
async function craftCard(pool, { userId, cardKey }) {
  const parsed = cards.parseCardKey(cardKey);
  if (!parsed) throw gachaError("invalid_card");
  const talents = await cards.listTalents(pool);
  const talent = talents.find((entry) => entry.symbol === parsed.symbol);
  if (!talent) throw gachaError("invalid_card");
  const cost = cards.RARITY_INFO[parsed.rarity].craftShards;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const shards = await changeShardsWithClient(client, userId, -cost, "craft", "card", cardKey);
    const grant = await grantCardWithClient(client, { userId, talent, rarity: parsed.rarity, source: "craft", awardShards: false });
    await client.query("COMMIT");
    return { card: { ...cards.publicCard(talent, parsed.rarity, { stars: grant.stars }), stars: grant.stars, copies: grant.copies, was_new: grant.was_new }, shards, cost_shards: cost };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

// ── Collection, sets, rewards ──────────────────────────────────────────────
async function loadOwnedCards(db, userId) {
  const { rows } = await db.query(
    `SELECT card_key, rarity, stars, copies, first_obtained_at FROM games.user_cards WHERE user_id = $1`,
    [userId]
  );
  return new Map(rows.map((row) => [row.card_key, { rarity: row.rarity, stars: Number(row.stars), copies: Number(row.copies), first_obtained_at: row.first_obtained_at }]));
}

function computeSets(talents, owned, claimed) {
  const units = new Map();
  for (const talent of talents) {
    const key = slug(talent.unit || "unaffiliated");
    if (!units.has(key)) units.set(key, { key, label: unitLabel(talent.unit), members: [] });
    units.get(key).members.push(talent);
  }
  return [...units.values()].map((unit) => {
    const best = unit.members.map((talent) => {
      let top = null;
      for (const rarity of cards.RARITIES) if (owned.has(cards.cardKey(talent.symbol, rarity))) top = rarity;
      return { symbol: talent.symbol, best: top };
    });
    const roster = best.filter((member) => member.best).length;
    const spotlight = best.filter((member) => member.best && cards.rarityRank(member.best) >= cards.rarityRank("SR")).length;
    const total = unit.members.length;
    return {
      key: unit.key,
      label: unit.label,
      total,
      members: best,
      roster: { have: roster, complete: roster === total, claimed: claimed.has(`set:${unit.key}:roster`), reward_shards: SET_REWARDS.roster.shards },
      spotlight: { have: spotlight, complete: spotlight === total, claimed: claimed.has(`set:${unit.key}:spotlight`), reward_shards: SET_REWARDS.spotlight.shards },
    };
  });
}

async function loadClaims(db, userId) {
  const { rows } = await db.query(`SELECT reward_key FROM games.user_reward_claims WHERE user_id = $1`, [userId]);
  return new Set(rows.map((row) => row.reward_key));
}

async function loadShowcase(db, userId) {
  const { rows } = await db.query(`SELECT slot, card_key FROM games.user_card_showcase WHERE user_id = $1 ORDER BY slot`, [userId]);
  return rows.map((row) => ({ slot: Number(row.slot), card_key: row.card_key }));
}

async function getCollection(pool, userId) {
  const talents = await cards.listTalents(pool);
  const [owned, claims, showcase, shardRow, pityRows, banners] = await Promise.all([
    loadOwnedCards(pool, userId),
    loadClaims(pool, userId),
    loadShowcase(pool, userId),
    pool.query(`SELECT shards FROM games.user_currencies WHERE user_id = $1`, [userId]),
    pool.query(`SELECT pool_key, pulls_since_high, pulls_since_top, featured_guaranteed, total_pulls FROM games.gacha_pity WHERE user_id = $1`, [userId]),
    getBanners(pool, talents),
  ]);
  const byKey = new Map();
  for (const talent of talents) for (const rarity of cards.RARITIES) byKey.set(cards.cardKey(talent.symbol, rarity), { talent, rarity });

  const ownedCards = [];
  for (const [key, row] of owned) {
    const entry = byKey.get(key);
    if (!entry) continue;
    ownedCards.push({ ...cards.publicCard(entry.talent, entry.rarity, { stars: row.stars }), stars: row.stars, copies: row.copies, obtained_at: row.first_obtained_at });
  }
  const pity = {};
  for (const row of pityRows.rows) {
    pity[row.pool_key] = pityStatus({ sinceHigh: Number(row.pulls_since_high), sinceTop: Number(row.pulls_since_top), featuredGuaranteed: Boolean(row.featured_guaranteed), total: Number(row.total_pulls) });
  }
  for (const key of ["standard", "featured"]) if (!pity[key]) pity[key] = pityStatus({ sinceHigh: 0, sinceTop: 0, featuredGuaranteed: false, total: 0 });

  return {
    shards: Number(shardRow.rows[0]?.shards ?? 0),
    talents: talents.map((talent) => ({ symbol: talent.symbol, name: talent.name, unit: talent.unit, icon: talent.icon, color: talent.color, move_pct: talent.move_pct, price: talent.price })),
    cards: ownedCards,
    total_cards: talents.length * cards.RARITIES.length,
    showcase,
    sets: computeSets(talents, owned, claims),
    starter_claimed: claims.has("starter"),
    banners,
    rates: publicRates(),
    pity,
  };
}

async function claimReward(pool, { userId, rewardKey }) {
  const talents = await cards.listTalents(pool);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const inserted = await client.query(
      `INSERT INTO games.user_reward_claims (user_id, reward_key) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING claimed_at`,
      [userId, rewardKey]
    );
    if (!inserted.rowCount) throw gachaError("reward_already_claimed");

    let reward;
    if (rewardKey === "starter") {
      const picks = [...talents].sort(() => randomUnit() - 0.5).slice(0, STARTER_PACK_SIZE);
      const granted = [];
      for (const talent of picks) {
        const grant = await grantCardWithClient(client, { userId, talent, rarity: "C", source: "starter", awardShards: false });
        granted.push({ ...cards.publicCard(talent, "C", { stars: grant.stars }), stars: grant.stars, was_new: grant.was_new });
      }
      reward = { cards: granted, shards: 0 };
    } else {
      const match = /^set:([a-z0-9-]+):(roster|spotlight)$/.exec(rewardKey);
      if (!match) throw gachaError("invalid_reward");
      const owned = await loadOwnedCards(client, userId);
      const set = computeSets(talents, owned, new Set()).find((entry) => entry.key === match[1]);
      if (!set) throw gachaError("invalid_reward");
      if (!set[match[2]].complete) throw gachaError("set_incomplete");
      const spec = SET_REWARDS[match[2]];
      await changeShardsWithClient(client, userId, spec.shards, "set_reward", "reward", rewardKey);
      const cosmetic = await gamesInventory.grantCosmeticWithClient(client, {
        userId,
        cosmeticKey: `set:${set.key}:${match[2]}`,
        cosmeticType: spec.cosmeticType,
        rarity: match[2] === "spotlight" ? "legendary" : "epic",
        sourceType: "set_reward",
        sourceReferenceId: null,
        metadata: { display_name: `${set.label} ${spec.label}`, description: `Completed the ${set.label} ${spec.label.toLowerCase()} set.`, slot_key: spec.cosmeticType, unit: set.label },
      });
      reward = { shards: spec.shards, cosmetic };
    }
    await client.query(`UPDATE games.user_reward_claims SET reward_json = $3 WHERE user_id = $1 AND reward_key = $2`, [userId, rewardKey, JSON.stringify(reward)]);
    const shards = await lockShardsWithClient(client, userId);
    await client.query("COMMIT");
    return { reward_key: rewardKey, reward, shards };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function setShowcase(pool, { userId, cardKeys }) {
  const keys = Array.isArray(cardKeys) ? [...new Set(cardKeys.map(String))].slice(0, SHOWCASE_SLOTS) : [];
  const owned = await loadOwnedCards(pool, userId);
  if (keys.some((key) => !owned.has(key))) throw gachaError("card_not_owned");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`DELETE FROM games.user_card_showcase WHERE user_id = $1`, [userId]);
    for (const [index, key] of keys.entries()) {
      await client.query(`INSERT INTO games.user_card_showcase (user_id, slot, card_key) VALUES ($1,$2,$3)`, [userId, index + 1, key]);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  return { showcase: keys.map((key, index) => ({ slot: index + 1, card_key: key })) };
}

/** What another player's profile shows: their showcase and collection totals. */
async function getPublicCollection(pool, username) {
  const user = await pool.query(`SELECT id, username FROM market.users WHERE username_normalized = lower($1)`, [String(username || "")]);
  if (!user.rows[0]) return null;
  const userId = Number(user.rows[0].id);
  const talents = await cards.listTalents(pool);
  const bySymbol = cards.talentMap(talents);
  const [owned, showcase] = await Promise.all([loadOwnedCards(pool, userId), loadShowcase(pool, userId)]);
  const counts = Object.fromEntries(cards.RARITIES.map((rarity) => [rarity, 0]));
  for (const row of owned.values()) counts[row.rarity] += 1;
  return {
    username: user.rows[0].username,
    unique_cards: owned.size,
    total_cards: talents.length * cards.RARITIES.length,
    by_rarity: counts,
    showcase: showcase
      .map((slot) => {
        const parsed = cards.parseCardKey(slot.card_key);
        const talent = parsed && bySymbol.get(parsed.symbol);
        const row = owned.get(slot.card_key);
        if (!talent || !row) return null;
        return { slot: slot.slot, ...cards.publicCard(talent, parsed.rarity, { stars: row.stars }), stars: row.stars };
      })
      .filter(Boolean),
  };
}

/** Site-wide feed of SSR and UR pulls for the games hub. */
async function listRecentTopPulls(pool, { limit = 12 } = {}) {
  const { rows } = await pool.query(
    `
    SELECT p.id, p.card_key, p.rarity, p.was_featured, p.created_at, u.username, u.profile_color, a.symbol, a.display_name
    FROM games.card_pulls p
    JOIN market.users u ON u.id = p.user_id
    JOIN market.market_assets a ON a.id = p.asset_id
    WHERE p.rarity IN ('SSR', 'UR')
    ORDER BY p.created_at DESC, p.id DESC
    LIMIT $1
  `,
    [Math.max(1, Math.min(50, Number(limit) || 12))]
  );
  return rows.map((row) => ({
    id: Number(row.id),
    card_key: row.card_key,
    rarity: row.rarity,
    was_featured: row.was_featured,
    created_at: row.created_at,
    username: row.username,
    profile_color: row.profile_color,
    symbol: row.symbol,
    name: row.display_name,
  }));
}

module.exports = {
  GAME_KEY,
  HARD_PITY,
  HIGH_EVERY,
  SOFT_PITY_FROM,
  advancePity,
  changeShardsWithClient,
  claimReward,
  craftCard,
  getBanners,
  getCollection,
  getPublicCollection,
  grantCardWithClient,
  listRecentTopPulls,
  loadOwnedCards,
  pullCards,
  rollRarity,
  setShowcase,
  topRateBps,
};
