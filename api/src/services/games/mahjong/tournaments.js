// Mahjong tournaments (docs/games/MAHJONG_DESIGN.md §3 and §5).
//
// Staff create one with a number of seats (4, 8 or 16), a start time and an entry fee (or none).
// Players sign up until it starts. It is a knockout: four to a table, the top two go through, down
// to one final table. Seats nobody took go to bots, and a tournament with a bot in it is free:
// every fee is refunded and no prize is paid, so a bot can never stand between anyone and money.
//
// The bracket is kept in games.mahjong_tournaments.bracket_json and every step is written before
// the next begins. Tables themselves live in memory (tables.js): after a restart, a round's
// unfinished tables are dealt again from the start.

const crypto = require("node:crypto");
const economy = require("../../economy");
const gamesWallet = require("../wallet");
const notifications = require("../../notifications");
const hub = require("../tables/hub");
const limits = require("./limits");
const records = require("./records");
const { LENGTHS } = require("./game");
const { SETTINGS, SPEEDS, tournamentPrizeTable } = require("./settings");

const SEAT_COUNTS = [4, 8, 16];
const ROUND_NAMES = { 1: "Final table", 2: "Semifinals", 4: "First round" };
const TICK_MS = 5000;

let pool = null;
let tables = null; // the table manager, handed in by init() (it calls back here when a table finishes)
let timer = null;
let ticking = false;

function tournamentError(code, extra = {}) {
  return Object.assign(new Error(code), { code, ...extra });
}

const round2 = (value) => Math.round(Number(value) * 100) / 100;

// ── Reading ────────────────────────────────────────────────────────────────
const rowView = (row) => {
  const fee = Number(row.entry_fee);
  return {
    id: Number(row.id),
    name: row.name,
    status: row.status,
    seats: Number(row.seats),
    length: row.length,
    final_length: row.final_length,
    speed: row.speed,
    entry_fee: fee,
    paid: row.paid,
    prizes: fee > 0 ? tournamentPrizeTable(fee, Number(row.seats)) : null,
    starts_at: row.starts_at,
    repeat_weekly: row.repeat_weekly,
    started_at: row.started_at,
    completed_at: row.completed_at,
    entrants: row.entrants === undefined ? undefined : Number(row.entrants),
    result: row.result_json && Object.keys(row.result_json).length ? row.result_json : null,
  };
};

const ENTRANTS_SQL = `(SELECT COUNT(*) FROM games.mahjong_tournament_players p WHERE p.tournament_id = t.id AND p.status <> 'withdrawn')`;

/** Tournaments open for sign-up or running, then the latest finished ones. */
async function list(db) {
  const { rows } = await db.query(
    `(SELECT t.*, ${ENTRANTS_SQL} AS entrants FROM games.mahjong_tournaments t WHERE t.status IN ('signup', 'running') ORDER BY t.starts_at LIMIT 20)
     UNION ALL
     (SELECT t.*, ${ENTRANTS_SQL} AS entrants FROM games.mahjong_tournaments t WHERE t.status = 'completed' ORDER BY t.completed_at DESC LIMIT 8)`
  );
  return rows.map(rowView);
}

async function entrantsOf(db, tournamentId) {
  const { rows } = await db.query(
    `SELECT p.user_id, p.status, p.place, p.payout, u.username, u.profile_color, oa.symbol AS oshi,
            (SELECT COUNT(*) FROM games.mahjong_picks k WHERE k.tournament_id = p.tournament_id AND k.picked_user_id = p.user_id)::int AS picks
     FROM games.mahjong_tournament_players p
     JOIN market.users u ON u.id = p.user_id
     LEFT JOIN market.market_assets oa ON oa.id = u.oshi_coin_asset_id
     WHERE p.tournament_id = $1 AND p.status <> 'withdrawn'
     ORDER BY p.place NULLS LAST, p.registered_at`,
    [tournamentId]
  );
  return rows.map((row) => ({ user_id: Number(row.user_id), username: row.username, profile_color: row.profile_color, oshi: row.oshi, status: row.status, place: row.place, payout: Number(row.payout), picks: row.picks }));
}

/** One tournament with who's in it and the bracket; `viewerId` adds whether they're in and their pick. */
async function get(db, tournamentId, viewerId = null) {
  const { rows } = await db.query(`SELECT t.*, ${ENTRANTS_SQL} AS entrants FROM games.mahjong_tournaments t WHERE t.id = $1`, [tournamentId]);
  if (!rows[0]) return null;
  const tournament = rowView(rows[0]);
  const entrants = await entrantsOf(db, tournamentId);
  const payload = { tournament, entrants, bracket: rows[0].bracket_json?.rounds ? rows[0].bracket_json : null, server_time: Date.now() };
  if (viewerId) {
    payload.me = { entered: entrants.some((entry) => entry.user_id === Number(viewerId)), pick: await records.readPick(db, { userId: viewerId, tournamentId }) };
  }
  return payload;
}

async function push(tournamentId) {
  const payload = await get(pool, tournamentId).catch(() => null);
  if (payload) hub.publish(`mahjong-tournament:${tournamentId}`, { type: "mahjong-tournament", ...payload });
}

// ── Creating and signing up ────────────────────────────────────────────────
async function create(db, { name, seats, length = "east", finalLength = "south", speed = "standard", entryFee = 0, startsAt, repeatWeekly = false, createdBy = null }) {
  const cleanName = String(name || "").replace(/\s+/g, " ").trim();
  if (cleanName.length < 3 || cleanName.length > 60) throw tournamentError("invalid_tournament", { field: "name" });
  if (!SEAT_COUNTS.includes(Number(seats))) throw tournamentError("invalid_tournament", { field: "seats" });
  if (!Object.hasOwn(LENGTHS, length) || !Object.hasOwn(LENGTHS, finalLength)) throw tournamentError("invalid_tournament", { field: "length" });
  if (!Object.hasOwn(SPEEDS, speed) || speed === "untimed") throw tournamentError("invalid_tournament", { field: "speed" });
  const fee = round2(entryFee);
  if (!Number.isFinite(fee) || fee < 0) throw tournamentError("invalid_tournament", { field: "entry_fee" });
  // Winning it can't take anyone past a week's cap: first prize less the fee stays within the minimum cap.
  if (fee > 0 && tournamentPrizeTable(fee, Number(seats)).top_net > SETTINGS.weeklyMinimum) {
    throw tournamentError("mahjong_prize_over_cap", { limit: SETTINGS.weeklyMinimum });
  }
  const starts = new Date(startsAt);
  if (Number.isNaN(starts.getTime()) || starts.getTime() < Date.now() + 30_000 || starts.getTime() > Date.now() + 90 * 86_400_000) {
    throw tournamentError("invalid_tournament", { field: "starts_at" });
  }
  const { rows } = await db.query(
    `INSERT INTO games.mahjong_tournaments (name, seats, length, final_length, speed, entry_fee, paid, starts_at, repeat_weekly, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [cleanName, Number(seats), length, finalLength, speed, fee, fee > 0, starts.toISOString(), Boolean(repeatWeekly), createdBy]
  );
  return rowView(rows[0]);
}

async function register(db, { tournamentId, userId }) {
  const done = await records.inTransaction(db, async (client) => {
    const { rows } = await client.query(`SELECT * FROM games.mahjong_tournaments WHERE id = $1 FOR UPDATE`, [tournamentId]);
    const row = rows[0];
    if (!row) throw tournamentError("tournament_not_found");
    if (row.status !== "signup") throw tournamentError("tournament_closed");
    const { rows: entered } = await client.query(`SELECT user_id, status FROM games.mahjong_tournament_players WHERE tournament_id = $1`, [tournamentId]);
    const active = entered.filter((entry) => entry.status !== "withdrawn");
    if (active.some((entry) => Number(entry.user_id) === Number(userId))) throw tournamentError("already_seated");
    if (active.length >= Number(row.seats)) throw tournamentError("table_full");
    const fee = Number(row.entry_fee);
    if (fee > 0) {
      const prize = tournamentPrizeTable(fee, Number(row.seats));
      await limits.assertPaidAccount(client, userId);
      await limits.assertNoSharedNetwork(client, userId, active.map((entry) => Number(entry.user_id)));
      await economy.lockWallet(client, userId);
      limits.assertCanEnter(await limits.readPlan(client, userId), { fee, topNet: prize.top_net });
      await records.payEntry(client, { userId, tournamentId, fee, maxNet: prize.top_net });
    }
    await client.query(
      `INSERT INTO games.mahjong_tournament_players (tournament_id, user_id) VALUES ($1, $2)
       ON CONFLICT (tournament_id, user_id) DO UPDATE SET status = 'registered', registered_at = now(), place = NULL, payout = 0`,
      [tournamentId, userId]
    );
    return true;
  });
  void push(tournamentId);
  return done;
}

async function withdraw(db, { tournamentId, userId }) {
  await records.inTransaction(db, async (client) => {
    const { rows } = await client.query(`SELECT status FROM games.mahjong_tournaments WHERE id = $1 FOR UPDATE`, [tournamentId]);
    if (!rows[0]) throw tournamentError("tournament_not_found");
    if (rows[0].status !== "signup") throw tournamentError("tournament_closed");
    const { rowCount } = await client.query(`UPDATE games.mahjong_tournament_players SET status = 'withdrawn' WHERE tournament_id = $1 AND user_id = $2 AND status = 'registered'`, [tournamentId, userId]);
    if (!rowCount) throw tournamentError("forbidden");
    await records.refundOpenEntries(client, { tournamentId, userId });
  });
  void push(tournamentId);
  return { ok: true };
}

/** A spectator's free call on the champion, before the first deal. Entrants don't pick. */
async function pick(db, { tournamentId, userId, pickedUserId }) {
  const { rows } = await db.query(`SELECT status FROM games.mahjong_tournaments WHERE id = $1`, [tournamentId]);
  if (!rows[0]) throw tournamentError("tournament_not_found");
  if (rows[0].status !== "signup") throw tournamentError("mahjong_picks_closed");
  const entrants = await entrantsOf(db, tournamentId);
  if (entrants.some((entry) => entry.user_id === Number(userId))) throw tournamentError("forbidden");
  const target = entrants.find((entry) => entry.user_id === Number(pickedUserId));
  if (!target) throw tournamentError("invalid_action");
  await records.savePick(db, { userId, tournamentId, pickedUserId: target.user_id, pickedName: target.username });
  void push(tournamentId);
  return { pick: { user_id: target.user_id, name: target.username } };
}

// ── Running ────────────────────────────────────────────────────────────────
function shuffle(list, randomInt) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const saveBracket = (db, tournamentId, bracket) => db.query(`UPDATE games.mahjong_tournaments SET bracket_json = $2 WHERE id = $1`, [tournamentId, JSON.stringify(bracket)]);

/** Deals every table of a round that isn't finished (all of them at first; after a restart, the ones cut short). */
async function dealRound(row, bracket) {
  const round = bracket.rounds[bracket.rounds.length - 1];
  const isFinal = round.tables.length === 1;
  for (const entry of round.tables) {
    if (entry.status === "done") continue;
    entry.game_id = await tables.createTournamentTable({
      tournament: { id: Number(row.id), name: row.name, round: round.round, table: entry.table, final: isFinal, round_name: round.name },
      players: entry.players.map((player) => (player.user_id ? { user_id: player.user_id, username: player.name } : { bot: player.bot })),
      length: isFinal ? row.final_length : row.length,
      speed: row.speed,
      paid: row.paid,
    });
    entry.status = "playing";
    for (const player of entry.players) {
      if (!player.user_id) continue;
      notifications
        .notify(pool, player.user_id, {
          kind: "mahjong",
          title: `${row.name}: your table is ready`,
          body: `${round.name}, table ${entry.table}. The first hand deals in a few seconds.`,
          href: `/games/mahjong/table/${entry.game_id}`,
          data: { tournament_id: Number(row.id), game_id: entry.game_id },
        })
        .catch(() => {});
    }
  }
  bracket.next_round_at = null;
  await saveBracket(pool, row.id, bracket);
}

function roundOf(number, tablesList) {
  return { round: number, name: ROUND_NAMES[tablesList.length] ?? `Round ${number}`, tables: tablesList.map((players, index) => ({ table: index + 1, status: "pending", game_id: null, players, result: null })) };
}

async function start(tournamentId) {
  const randomInt = (n) => crypto.randomInt(0, n);
  const prepared = await records.inTransaction(pool, async (client) => {
    const { rows } = await client.query(`SELECT * FROM games.mahjong_tournaments WHERE id = $1 FOR UPDATE`, [tournamentId]);
    const row = rows[0];
    if (!row || row.status !== "signup") return null;
    const { rows: entered } = await client.query(
      `SELECT p.user_id, u.username FROM games.mahjong_tournament_players p JOIN market.users u ON u.id = p.user_id
       WHERE p.tournament_id = $1 AND p.status = 'registered' ORDER BY p.registered_at`,
      [tournamentId]
    );
    if (!entered.length) {
      await client.query(`UPDATE games.mahjong_tournaments SET status = 'cancelled', completed_at = now(), result_json = $2 WHERE id = $1`, [tournamentId, JSON.stringify({ cancelled: "nobody_entered" })]);
      return { row, cancelled: true };
    }
    const seats = Number(row.seats);
    const players = entered.slice(0, seats).map((entry) => ({ user_id: Number(entry.user_id), name: entry.username, bot: null }));
    let paid = row.paid;
    if (players.length < seats && paid) {
      // A bot has to sit in: the tournament is free. Everyone gets their fee back.
      await records.refundOpenEntries(client, { tournamentId });
      paid = false;
    }
    while (players.length < seats) players.push({ user_id: null, name: "Bot", bot: "normal" });
    const drawn = shuffle(players, randomInt);
    const groups = [];
    for (let i = 0; i < seats; i += 4) groups.push(drawn.slice(i, i + 4));
    const bracket = { rounds: [roundOf(1, groups)], next_round_at: null };
    await client.query(`UPDATE games.mahjong_tournaments SET status = 'running', started_at = now(), paid = $2, bracket_json = $3 WHERE id = $1`, [tournamentId, paid, JSON.stringify(bracket)]);
    await client.query(`UPDATE games.mahjong_tournament_players SET status = 'playing' WHERE tournament_id = $1 AND status = 'registered'`, [tournamentId]);
    return { row: { ...row, paid, status: "running" }, bracket };
  });
  if (!prepared) return;
  if (prepared.cancelled) {
    await scheduleRepeat(prepared.row);
    return void push(tournamentId);
  }
  await dealRound(prepared.row, prepared.bracket);
  void push(tournamentId);
}

/** Who goes through from a finished round: the top two of each table, seated so table-mates split up. */
function advancers(round) {
  const top = round.tables.map((entry) => entry.result.filter((line) => line.place <= 2).sort((a, b) => a.place - b.place));
  if (top.length === 2) return [[top[0][0], top[1][1], top[1][0], top[0][1]]];
  const groups = [];
  for (let i = 0; i < top.length; i += 4) {
    const [a, b, c, d] = top.slice(i, i + 4);
    groups.push([a[0], b[1], c[0], d[1]], [b[0], a[1], d[0], c[1]]);
  }
  return groups;
}

const asPlayer = (line) => ({ user_id: line.user_id ?? null, name: line.name, bot: line.bot ?? null });

/** tables.js calls this when a tournament table's game is over. */
async function onTableOver(table, result) {
  const tournamentId = table.tournament?.id;
  if (!tournamentId) return;
  const outcome = await records.inTransaction(pool, async (client) => {
    const { rows } = await client.query(`SELECT * FROM games.mahjong_tournaments WHERE id = $1 FOR UPDATE`, [tournamentId]);
    const row = rows[0];
    if (!row || row.status !== "running") return null;
    const bracket = row.bracket_json;
    const round = bracket.rounds[bracket.rounds.length - 1];
    const entry = round.tables.find((candidate) => candidate.game_id === table.id);
    if (!entry || entry.status === "done") return null;
    entry.status = "done";
    entry.result = result.standings.map((line) => {
      const seat = table.seats[line.seat];
      return { place: line.place, user_id: seat.user_id, name: seat.username, bot: seat.bot, points: line.points, score: line.score };
    });
    const isFinal = round.tables.length === 1;
    // Out in this round: their entry is settled with nothing, which frees their week's room.
    const out = entry.result.filter((line) => line.user_id && (isFinal ? false : line.place > 2));
    for (const line of out) {
      await client.query(`UPDATE games.mahjong_tournament_players SET status = 'out' WHERE tournament_id = $1 AND user_id = $2`, [tournamentId, line.user_id]);
      await client.query(`UPDATE games.mahjong_entries SET status = 'settled', payout = 0, settled_at = now() WHERE tournament_id = $1 AND user_id = $2 AND status = 'open'`, [tournamentId, line.user_id]);
    }
    let finished = null;
    if (round.tables.every((candidate) => candidate.status === "done")) {
      if (isFinal) finished = await complete(client, row, bracket, entry);
      else {
        bracket.rounds.push(roundOf(round.round + 1, advancers(round).map((group) => group.map(asPlayer))));
        bracket.next_round_at = Date.now() + SETTINGS.tournamentBreakSeconds * 1000;
      }
    }
    await client.query(`UPDATE games.mahjong_tournaments SET bracket_json = $2 WHERE id = $1`, [tournamentId, JSON.stringify(bracket)]);
    return { row, finished };
  });
  if (!outcome) return;
  if (outcome.finished) {
    const champion = outcome.finished.champion;
    if (champion.user_id) await records.wireTournament(pool, { tournamentId, name: outcome.row.name, userId: champion.user_id, username: champion.name, seats: Number(outcome.row.seats) }).catch(() => {});
    await scheduleRepeat(outcome.row);
  }
  void push(tournamentId);
}

/** The final table is over: places, prizes for a paid one, and the picks. Runs inside onTableOver's transaction. */
async function complete(client, row, bracket, finalTable) {
  const tournamentId = Number(row.id);
  const fee = Number(row.entry_fee);
  const prizes = row.paid && fee > 0 ? tournamentPrizeTable(fee, Number(row.seats)).prizes : null;
  const places = [];
  for (const line of finalTable.result) {
    const payout = prizes && line.user_id ? round2(prizes[line.place - 1] ?? 0) : 0;
    places.push({ place: line.place, user_id: line.user_id, name: line.name, bot: line.bot, payout });
    if (!line.user_id) continue;
    if (payout > 0) {
      await gamesWallet.creditCashForGameWithClient(client, { userId: line.user_id, amount: payout, entryType: "mahjong_prize_payout", referenceType: "mahjong_tournament", referenceId: tournamentId });
    }
    await client.query(`UPDATE games.mahjong_entries SET status = 'settled', payout = $3, settled_at = now() WHERE tournament_id = $1 AND user_id = $2 AND status = 'open'`, [tournamentId, line.user_id, payout]);
    await client.query(`UPDATE games.mahjong_tournament_players SET status = 'finished', place = $3, payout = $4 WHERE tournament_id = $1 AND user_id = $2`, [tournamentId, line.user_id, line.place, payout]);
  }
  // Anything still open (it shouldn't be) is handed back rather than kept.
  await records.refundOpenEntries(client, { tournamentId });
  const champion = places.find((line) => line.place === 1);
  await client.query(`UPDATE games.mahjong_picks SET correct = (picked_user_id IS NOT DISTINCT FROM $2::bigint AND $2::bigint IS NOT NULL) WHERE tournament_id = $1`, [tournamentId, champion.user_id]);
  await client.query(`UPDATE games.mahjong_tournaments SET status = 'completed', completed_at = now(), result_json = $2 WHERE id = $1`, [tournamentId, JSON.stringify({ places, champion })]);
  return { champion, places };
}

/** Staff: stop a tournament that hasn't finished. Fees go back; its tables play out but count for nothing here. */
async function cancel(db, { tournamentId }) {
  const done = await records.inTransaction(db, async (client) => {
    const { rows } = await client.query(`SELECT * FROM games.mahjong_tournaments WHERE id = $1 FOR UPDATE`, [tournamentId]);
    if (!rows[0]) throw tournamentError("tournament_not_found");
    if (rows[0].status !== "signup" && rows[0].status !== "running") throw tournamentError("tournament_closed");
    await records.refundOpenEntries(client, { tournamentId });
    await client.query(`UPDATE games.mahjong_tournaments SET status = 'cancelled', repeat_weekly = false, completed_at = now(), result_json = $2 WHERE id = $1`, [tournamentId, JSON.stringify({ cancelled: "staff" })]);
    return true;
  });
  void push(tournamentId);
  return done;
}

/** A weekly tournament books its next edition, a week on, when this one ends. */
async function scheduleRepeat(row) {
  if (!row.repeat_weekly) return;
  let next = new Date(row.starts_at).getTime() + 7 * 86_400_000;
  while (next < Date.now() + 3_600_000) next += 7 * 86_400_000;
  await pool
    .query(
      `INSERT INTO games.mahjong_tournaments (name, seats, length, final_length, speed, entry_fee, paid, starts_at, repeat_weekly, created_by)
       SELECT $2, seats, length, final_length, speed, entry_fee, entry_fee > 0, $3, true, created_by FROM games.mahjong_tournaments t WHERE t.id = $1
         AND NOT EXISTS (SELECT 1 FROM games.mahjong_tournaments n WHERE n.name = $2 AND n.status = 'signup')`,
      [row.id, row.name, new Date(next).toISOString()]
    )
    .catch((error) => console.error("mahjong tournament repeat failed:", String(error?.message || error)));
}

async function tick() {
  if (ticking) return;
  ticking = true;
  try {
    const { rows: due } = await pool.query(`SELECT id FROM games.mahjong_tournaments WHERE status = 'signup' AND starts_at <= now() ORDER BY starts_at LIMIT 5`);
    for (const row of due) await start(Number(row.id));
    const { rows: running } = await pool.query(`SELECT * FROM games.mahjong_tournaments WHERE status = 'running'`);
    for (const row of running) {
      const bracket = row.bracket_json;
      const round = bracket?.rounds?.[bracket.rounds.length - 1];
      if (!round) continue;
      const pending = round.tables.some((entry) => entry.status === "pending");
      // A table that was in play when the process stopped is gone from memory: deal it again.
      let lost = false;
      for (const entry of round.tables) {
        if (entry.status === "playing" && !(await tables.getTable({ tableId: entry.game_id }))) {
          entry.status = "pending";
          lost = true;
        }
      }
      if (lost || (pending && (!bracket.next_round_at || Date.now() >= bracket.next_round_at))) {
        await dealRound(row, bracket);
        void push(Number(row.id));
      }
    }
  } catch (error) {
    console.error("mahjong tournaments tick failed:", String(error?.message || error));
  } finally {
    ticking = false;
  }
}

/** Every API process: sign-ups are taken anywhere, and their pushes need the database. */
function setPool(db) {
  pool = db;
}

/** The process that owns the tables: starts tournaments when they're due and moves them along. */
function init(db, tableManager) {
  pool = db;
  tables = tableManager;
  clearInterval(timer);
  timer = setInterval(() => void tick(), TICK_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}

module.exports = { ROUND_NAMES, SEAT_COUNTS, advancers, cancel, create, get, init, list, onTableOver, pick, register, setPool, tick, withdraw };
