// Two-player staked tables (Oshi Card Duel, High-Low). Owns the table lifecycle, escrow,
// timers and settlement. Game rules live in the engines. See docs/games/GAMES_DESIGN.md §3, §5, §7.
//
// Money rules:
//   - Stakes are debited when a player takes a seat (create or join) and held on the match row.
//   - The winner is credited 95% of the pot (rake_bps from the catalog); a draw refunds both.
//   - An open table that expires or is cancelled refunds its host.
//   - Anything still open or playing when the API starts is refunded (tables live in memory).

const cards = require("../cards");
const gamesCatalog = require("../catalog");
const gamesWallet = require("../wallet");
const duelEngine = require("./duelEngine");
const highLowEngine = require("./highLowEngine");
const hub = require("./hub");

const ENGINES = { "oshi-duel": duelEngine, "high-low": highLowEngine };
const DONE_LINGER_MS = 5 * 60_000;
const MAX_STAKE_DEFAULT = 5000;

const tables = new Map(); // id → table
const locks = new Map(); // id → promise chain
let pool = null;

function tableError(code, extra = {}) {
  const error = new Error(code);
  error.code = code;
  Object.assign(error, extra);
  return error;
}

const round2 = (value) => Math.round(Number(value) * 100) / 100;

function withLock(key, fn) {
  const previous = locks.get(key) || Promise.resolve();
  const run = previous.then(fn, fn);
  const settled = run.catch(() => {});
  locks.set(key, settled);
  settled.then(() => {
    if (locks.get(key) === settled) locks.delete(key);
  });
  return run;
}

async function loadUser(db, userId) {
  const { rows } = await db.query(`SELECT id, username, profile_color, profile_picture_url FROM market.users WHERE id = $1`, [userId]);
  if (!rows[0]) throw tableError("unauthenticated");
  return { user_id: Number(rows[0].id), username: rows[0].username, profile_color: rows[0].profile_color, profile_picture_url: rows[0].profile_picture_url };
}

async function getPvpGame(gameKey) {
  if (!ENGINES[gameKey]) throw tableError("game_not_found");
  const game = await gamesCatalog.getGameByKey(pool, gameKey);
  if (!game || game.game_type !== "pvp" || game.status !== "active") throw tableError("game_not_found");
  return game;
}

function parseStake(value, game) {
  const stake = round2(value ?? 0);
  const max = Number(game.max_stake_cash ?? MAX_STAKE_DEFAULT);
  const min = Number(game.min_stake_cash ?? 0);
  if (!Number.isFinite(stake) || stake < min || stake > max) throw tableError("invalid_stake");
  return stake;
}

function userBusy(userId, gameKey) {
  for (const table of tables.values()) {
    if (table.gameKey !== gameKey || table.status === "done" || table.status === "cancelled") continue;
    if (table.players.some((player) => player.user_id === userId)) return table.id;
  }
  return null;
}

// ── Decks (duel only) ──────────────────────────────────────────────────────
async function validateDeck(db, userId, gameKey, deck) {
  if (gameKey !== "oshi-duel") return [];
  const keys = Array.isArray(deck) ? deck.map(String) : [];
  if (keys.length !== duelEngine.DECK_SIZE || new Set(keys).size !== keys.length) throw tableError("invalid_deck");
  const parsed = keys.map((key) => cards.parseCardKey(key));
  if (parsed.some((entry) => !entry) || new Set(parsed.map((entry) => entry.symbol)).size !== keys.length) throw tableError("invalid_deck");
  const { rows } = await db.query(`SELECT card_key FROM games.user_cards WHERE user_id = $1 AND card_key = ANY($2::text[])`, [userId, keys]);
  if (rows.length !== keys.length) throw tableError("card_not_owned");
  return keys;
}

async function snapshotDecks(db, players) {
  const talents = cards.talentMap(await cards.listTalents(db));
  const out = [];
  for (const player of players) {
    const { rows } = await db.query(`SELECT card_key, stars FROM games.user_cards WHERE user_id = $1 AND card_key = ANY($2::text[])`, [player.user_id, player.deck_keys]);
    const stars = new Map(rows.map((row) => [row.card_key, Number(row.stars)]));
    out.push(
      player.deck_keys.map((key) => {
        const { symbol, rarity } = cards.parseCardKey(key);
        const talent = talents.get(symbol);
        const cardStars = stars.get(key) ?? 1;
        return {
          key,
          symbol,
          name: talent?.name ?? symbol,
          unit: talent?.unit ?? null,
          icon: talent?.icon ?? null,
          color: talent?.color ?? null,
          rarity,
          stars: cardStars,
          base: cards.basePower(rarity, cardStars),
          momentum: cards.momentumOf(talent?.move_pct),
          move_pct: talent?.move_pct ?? null,
          price: talent?.price ?? null,
        };
      })
    );
  }
  return out;
}

// ── Public views ───────────────────────────────────────────────────────────
function potOf(table) {
  return round2(table.stake * table.players.length);
}

function publicTable(table) {
  const engine = ENGINES[table.gameKey];
  return {
    id: table.id,
    game: table.gameKey,
    status: table.status,
    stake: table.stake,
    pot: potOf(table),
    rake_bps: table.rakeBps,
    payout_if_win: round2(table.stake * 2 * (1 - table.rakeBps / 10_000)),
    created_at: table.createdAt,
    expires_at: table.status === "open" ? table.expiresAt : null,
    host_user_id: table.hostUserId,
    players: table.players.map(({ deck_keys, ...player }) => ({ ...player, deck_size: deck_keys.length })),
    spectators: hub.count(`table:${table.id}`),
    state: table.state ? engine.publicState(table.state) : null,
    result: table.result,
    server_time: Date.now(),
  };
}

function lobbySnapshot(gameKey) {
  const list = [...tables.values()]
    .filter((table) => table.gameKey === gameKey && (table.status === "open" || table.status === "playing"))
    .sort((a, b) => b.id - a.id)
    .map((table) => {
      const view = publicTable(table);
      return { ...view, state: view.state ? { phase: view.state.phase, round: view.state.round, wins: view.state.wins, scores: view.state.scores } : null };
    });
  return { type: "lobby", game: gameKey, tables: list };
}

function publishTable(table) {
  hub.publish(`table:${table.id}`, { type: "table", table: publicTable(table) });
  hub.publish(`lobby:${table.gameKey}`, lobbySnapshot(table.gameKey));
}

// ── Persistence ────────────────────────────────────────────────────────────
async function persistState(table) {
  await pool.query(`UPDATE games.pvp_matches SET state_json = $2, updated_at = now() WHERE id = $1`, [table.id, JSON.stringify(table.state || {})]);
}

async function refundMatchWithClient(client, matchId, reason) {
  const players = await client.query(`SELECT user_id, stake_cash FROM games.pvp_match_players WHERE match_id = $1`, [matchId]);
  for (const player of players.rows) {
    const stake = Number(player.stake_cash);
    if (stake > 0) {
      await gamesWallet.refundCashForGameWithClient(client, { userId: Number(player.user_id), amount: stake, referenceType: "pvp_match", referenceId: matchId });
    }
  }
  await client.query(`UPDATE games.pvp_match_players SET status = 'removed', outcome = NULL WHERE match_id = $1`, [matchId]);
  await client.query(
    `UPDATE games.pvp_matches SET status = 'cancelled', completed_at = now(), updated_at = now(), result_json = result_json || $2::jsonb WHERE id = $1`,
    [matchId, JSON.stringify({ cancelled: reason })]
  );
}

async function inTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

// ── Lifecycle ──────────────────────────────────────────────────────────────
function createTable(args) {
  return withLock(`user:${args.userId}`, () => createTableLocked(args));
}

async function createTableLocked({ userId, gameKey, stake, deck }) {
  const game = await getPvpGame(gameKey);
  const safeStake = parseStake(stake, game);
  if (userBusy(userId, gameKey)) throw tableError("already_seated");
  const deckKeys = await validateDeck(pool, userId, gameKey, deck);
  const user = await loadUser(pool, userId);
  const rakeBps = Number(game.config_json?.rake_bps ?? 500);
  const openMinutes = Number(game.config_json?.open_table_minutes ?? 10);

  const matchId = await inTransaction(async (client) => {
    const { rows } = await client.query(
      `
      INSERT INTO games.pvp_matches (game_id, status, stake_cash, prize_pool_cash, host_user_id, settings_json)
      VALUES ($1, 'queued', $2, $2, $3, $4)
      RETURNING id
    `,
      [game.id, safeStake, userId, JSON.stringify({ rake_bps: rakeBps, config: game.config_json })]
    );
    const id = Number(rows[0].id);
    await client.query(
      `INSERT INTO games.pvp_match_players (match_id, user_id, seat, stake_cash, deck_json) VALUES ($1,$2,0,$3,$4)`,
      [id, userId, safeStake, JSON.stringify(deckKeys)]
    );
    if (safeStake > 0) {
      await gamesWallet.debitCashForGameWithClient(client, { userId, amount: safeStake, entryType: "pvp_stake_debit", referenceType: "pvp_match", referenceId: id });
    }
    return id;
  });

  const now = Date.now();
  const table = {
    id: matchId,
    gameKey,
    game,
    stake: safeStake,
    rakeBps,
    hostUserId: userId,
    status: "open",
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + openMinutes * 60_000).toISOString(),
    players: [{ seat: 0, ...user, deck_keys: deckKeys }],
    state: null,
    result: null,
    timer: null,
  };
  tables.set(matchId, table);
  table.timer = setTimeout(() => withLock(matchId, () => expireTable(matchId)).catch(logError), openMinutes * 60_000);
  publishTable(table);
  return publicTable(table);
}

async function expireTable(matchId) {
  const table = tables.get(matchId);
  if (!table || table.status !== "open") return;
  await inTransaction((client) => refundMatchWithClient(client, matchId, "expired"));
  table.status = "cancelled";
  table.result = { cancelled: "expired" };
  publishTable(table);
  tables.delete(matchId);
}

async function cancelTable({ userId, tableId }) {
  return withLock(tableId, async () => {
    const table = tables.get(tableId);
    if (!table) throw tableError("table_not_found");
    if (table.hostUserId !== userId) throw tableError("forbidden");
    if (table.status !== "open") throw tableError("table_not_open");
    clearTimeout(table.timer);
    await inTransaction((client) => refundMatchWithClient(client, tableId, "host_cancelled"));
    table.status = "cancelled";
    table.result = { cancelled: "host_cancelled" };
    publishTable(table);
    tables.delete(tableId);
    return { ok: true };
  });
}

function joinTable(args) {
  return withLock(`user:${args.userId}`, () => joinTableLocked(args));
}

async function joinTableLocked({ userId, tableId, deck }) {
  return withLock(tableId, async () => {
    const table = tables.get(tableId);
    if (!table) throw tableError("table_not_found");
    if (table.status !== "open") throw tableError("table_full");
    if (table.players.some((player) => player.user_id === userId)) throw tableError("already_seated");
    if (userBusy(userId, table.gameKey)) throw tableError("already_seated");
    const deckKeys = await validateDeck(pool, userId, table.gameKey, deck);
    const user = await loadUser(pool, userId);

    await inTransaction(async (client) => {
      const { rows } = await client.query(`SELECT status FROM games.pvp_matches WHERE id = $1 FOR UPDATE`, [tableId]);
      if (rows[0]?.status !== "queued") throw tableError("table_full");
      await client.query(
        `INSERT INTO games.pvp_match_players (match_id, user_id, seat, stake_cash, deck_json) VALUES ($1,$2,1,$3,$4)`,
        [tableId, userId, table.stake, JSON.stringify(deckKeys)]
      );
      if (table.stake > 0) {
        await gamesWallet.debitCashForGameWithClient(client, { userId, amount: table.stake, entryType: "pvp_stake_debit", referenceType: "pvp_match", referenceId: tableId });
      }
      await client.query(
        `UPDATE games.pvp_matches SET status = 'active', prize_pool_cash = $2, started_at = now(), updated_at = now() WHERE id = $1`,
        [tableId, round2(table.stake * 2)]
      );
    });

    clearTimeout(table.timer);
    table.players.push({ seat: 1, ...user, deck_keys: deckKeys });
    table.status = "playing";
    const now = Date.now();
    if (table.gameKey === "oshi-duel") {
      const decks = await snapshotDecks(pool, table.players);
      table.state = duelEngine.setup({ decks, now, pickSeconds: Number(table.game.config_json?.pick_seconds ?? 20) });
    } else {
      table.state = highLowEngine.setup({ now, callSeconds: Number(table.game.config_json?.call_seconds ?? 10) });
    }
    await persistState(table);
    schedule(table);
    publishTable(table);
    return publicTable(table);
  });
}

async function actOnTable({ userId, tableId, action }) {
  return withLock(tableId, async () => {
    const table = tables.get(tableId);
    if (!table) throw tableError("table_not_found");
    if (table.status !== "playing") throw tableError("invalid_action");
    const seat = table.players.findIndex((player) => player.user_id === userId);
    if (seat < 0) throw tableError("forbidden");
    const engine = ENGINES[table.gameKey];
    table.state = engine.act(table.state, seat, action, Date.now());
    await afterChange(table);
    const view = publicTable(table);
    // Only you see your own locked-in pick before the reveal.
    if (table.gameKey === "oshi-duel" && table.state.phase === "picking") view.my_pick = table.state.picks[seat];
    if (table.gameKey === "high-low" && table.state.phase === "calling") view.my_call = table.state.calls[seat];
    return view;
  });
}

async function afterChange(table) {
  await persistState(table);
  if (table.state.phase === "done") await settle(table);
  else schedule(table);
  publishTable(table);
}

function schedule(table) {
  clearTimeout(table.timer);
  const deadline = table.state?.deadline;
  if (!deadline) return;
  table.timer = setTimeout(
    () => withLock(table.id, () => tickTable(table.id)).catch(logError),
    Math.max(0, deadline - Date.now()) + 25
  );
}

async function tickTable(tableId) {
  const table = tables.get(tableId);
  if (!table || table.status !== "playing") return;
  const engine = ENGINES[table.gameKey];
  const next = engine.tick(table.state, Date.now());
  if (next === table.state) {
    schedule(table);
    return;
  }
  table.state = next;
  await afterChange(table);
}

async function settle(table) {
  clearTimeout(table.timer);
  const winnerSeat = table.state.winner;
  const pot = round2(table.stake * 2);
  const payout = winnerSeat === null ? 0 : round2(pot * (1 - table.rakeBps / 10_000));
  const rake = winnerSeat === null ? 0 : round2(pot - payout);
  const winner = winnerSeat === null ? null : table.players[winnerSeat];

  await inTransaction(async (client) => {
    const { rows } = await client.query(`SELECT status FROM games.pvp_matches WHERE id = $1 FOR UPDATE`, [table.id]);
    if (rows[0]?.status !== "active") return;
    if (winner === null) {
      for (const player of table.players) {
        if (table.stake > 0) {
          await gamesWallet.refundCashForGameWithClient(client, { userId: player.user_id, amount: table.stake, referenceType: "pvp_match", referenceId: table.id });
        }
        await client.query(`UPDATE games.pvp_match_players SET status = 'submitted', outcome = 'draw', payout_cash = $3 WHERE match_id = $1 AND user_id = $2`, [table.id, player.user_id, table.stake]);
      }
    } else {
      if (payout > 0) {
        await gamesWallet.creditCashForGameWithClient(client, { userId: winner.user_id, amount: payout, entryType: "pvp_prize_payout", referenceType: "pvp_match", referenceId: table.id });
      }
      for (const player of table.players) {
        const won = player.user_id === winner.user_id;
        const outcome = won ? "win" : table.state.done_reason === "forfeit" ? "forfeit" : "loss";
        await client.query(`UPDATE games.pvp_match_players SET status = 'submitted', outcome = $3, payout_cash = $4 WHERE match_id = $1 AND user_id = $2`, [table.id, player.user_id, outcome, won ? payout : 0]);
      }
    }
    await client.query(
      `
      UPDATE games.pvp_matches
      SET status = 'completed', completed_at = now(), updated_at = now(), winner_user_id = $2, rake_cash = $3,
          state_json = $4, result_json = $5
      WHERE id = $1
    `,
      [table.id, winner?.user_id ?? null, rake, JSON.stringify(table.state), JSON.stringify({ winner_seat: winnerSeat, payout, rake, reason: table.state.done_reason })]
    );
  });

  table.status = "done";
  table.result = { winner_seat: winnerSeat, winner_username: winner?.username ?? null, payout, rake, reason: table.state.done_reason };
  setTimeout(() => {
    if (tables.get(table.id)?.status === "done") tables.delete(table.id);
  }, DONE_LINGER_MS).unref?.();
}

// ── Queries ────────────────────────────────────────────────────────────────
async function listTables(gameKey) {
  await getPvpGame(gameKey);
  const { rows } = await pool.query(
    `
    SELECT m.id, m.stake_cash, m.completed_at, m.result_json,
           json_agg(json_build_object('seat', p.seat, 'username', u.username, 'profile_color', u.profile_color, 'outcome', p.outcome, 'payout', p.payout_cash) ORDER BY p.seat) AS players
    FROM games.pvp_matches m
    JOIN games.game_catalog g ON g.id = m.game_id
    JOIN games.pvp_match_players p ON p.match_id = m.id
    JOIN market.users u ON u.id = p.user_id
    WHERE g.key = $1 AND m.status = 'completed'
    GROUP BY m.id
    ORDER BY m.completed_at DESC
    LIMIT 12
  `,
    [gameKey]
  );
  return {
    ...lobbySnapshot(gameKey),
    recent: rows.map((row) => ({ id: Number(row.id), stake: Number(row.stake_cash), completed_at: row.completed_at, result: row.result_json, players: row.players })),
  };
}

async function getTable(tableId) {
  const live = tables.get(tableId);
  if (live) return publicTable(live);
  const { rows } = await pool.query(
    `
    SELECT m.id, g.key AS game_key, m.status, m.stake_cash, m.created_at, m.state_json, m.result_json, m.settings_json, m.host_user_id
    FROM games.pvp_matches m JOIN games.game_catalog g ON g.id = m.game_id
    WHERE m.id = $1
  `,
    [tableId]
  );
  const row = rows[0];
  if (!row || !ENGINES[row.game_key]) throw tableError("table_not_found");
  const players = await pool.query(
    `
    SELECT p.seat, p.user_id, u.username, u.profile_color, u.profile_picture_url
    FROM games.pvp_match_players p JOIN market.users u ON u.id = p.user_id
    WHERE p.match_id = $1 ORDER BY p.seat
  `,
    [tableId]
  );
  const rakeBps = Number(row.settings_json?.rake_bps ?? 500);
  const stake = Number(row.stake_cash);
  const hasState = row.state_json && Object.keys(row.state_json).length;
  return {
    id: Number(row.id),
    game: row.game_key,
    status: row.status === "completed" ? "done" : row.status === "cancelled" ? "cancelled" : row.status,
    stake,
    pot: round2(stake * players.rows.length),
    rake_bps: rakeBps,
    payout_if_win: round2(stake * 2 * (1 - rakeBps / 10_000)),
    created_at: row.created_at,
    expires_at: null,
    host_user_id: row.host_user_id === null ? null : Number(row.host_user_id),
    players: players.rows.map((player) => ({ seat: Number(player.seat), user_id: Number(player.user_id), username: player.username, profile_color: player.profile_color, profile_picture_url: player.profile_picture_url })),
    spectators: 0,
    state: hasState ? ENGINES[row.game_key].publicState(row.state_json) : null,
    result: row.result_json || null,
    server_time: Date.now(),
  };
}

// ── Startup ────────────────────────────────────────────────────────────────
async function recover() {
  const { rows } = await pool.query(`SELECT id FROM games.pvp_matches WHERE status IN ('queued', 'active')`);
  for (const row of rows) {
    await inTransaction((client) => refundMatchWithClient(client, Number(row.id), "server_restart"));
  }
  if (rows.length) console.log(`games: refunded ${rows.length} unfinished table(s) from before restart`);
}

function logError(error) {
  console.error("games table error:", error);
}

async function init(db) {
  pool = db;
  await recover();
  hub.registerSnapshotProvider((channel) => {
    const lobby = /^lobby:([a-z0-9-]+)$/.exec(channel);
    if (lobby && ENGINES[lobby[1]]) return lobbySnapshot(lobby[1]);
    const table = /^table:(\d+)$/.exec(channel);
    if (table && tables.has(Number(table[1]))) return { type: "table", table: publicTable(tables.get(Number(table[1]))) };
    return null;
  });
  hub.onSubscriberCount((channel) => {
    const match = /^table:(\d+)$/.exec(channel);
    const table = match && tables.get(Number(match[1]));
    if (table) hub.publish(channel, { type: "spectators", table_id: table.id, spectators: hub.count(channel) });
  });
}

/** Tables the user is seated at (for "return to your game" links). */
function tablesForUser(userId) {
  return [...tables.values()].filter((table) => table.players.some((player) => player.user_id === userId) && (table.status === "open" || table.status === "playing")).map(publicTable);
}

module.exports = {
  ENGINES,
  actOnTable,
  cancelTable,
  createTable,
  getTable,
  init,
  joinTable,
  listTables,
  tablesForUser,
};
