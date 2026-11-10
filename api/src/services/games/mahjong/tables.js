// Mahjong tables (docs/games/MAHJONG_DESIGN.md §2-§5): who sits where, the clock, bots and away
// seats, what each viewer is sent, and what a finished game writes down and pays.
//
// A table lives in this process's memory (the one that owns game tables, see server.js). The engine
// (game.js, round.js) decides what a move does; this file decides who may make it and when, and
// pushes the result: the public table on `mahjong:{id}`, each seat's own view on `mj-seat:{token}`.
//
// Kinds:
//   tutorial  one guided hand on an arranged wall (tutorial.js). Free, never recorded.
//   practice  you and three bots. Free, never recorded. Signed-out visitors get one too ("guest").
//   friend    a room by link; the host starts it and bots take the empty seats. Recorded, unrated.
//   ranked    quick match: open seats, bots fill after a wait. Recorded and rated. Free.
//   stakes    four players, an entry fee each, a fixed prize table. No bots. Recorded and rated.
//   tournament  seated by tournaments.js.
//
// Everything that changes a table runs under that table's lock, one step at a time. One timer per
// table fires when the next thing is due (a bot's move, a player's clock, the pause between hands, an
// open table's wait) and tick() does whatever is due then.

const crypto = require("node:crypto");
const economy = require("../../economy");
const siteState = require("../../siteState");
const socketLimits = require("../../../socketLimits");
const hub = require("../tables/hub");
const reactions = require("../tables/reactions");
const bot = require("./bot");
const game = require("./game");
const limits = require("./limits");
const records = require("./records");
const round = require("./round");
const tutorial = require("./tutorial");
const view = require("./view");
const { newSeed } = require("./wall");
const { kindOf } = require("./tiles");
const { SETTINGS, SPEEDS, stakesPrizeTable } = require("./settings");

const SEATS = 4;
// Unrecorded tables take ids far above anything the database hands out (and within the hub's 12 digits).
const MEMORY_ID_BASE = 800_000_000_000;
const KINDS = new Set(["tutorial", "practice", "friend", "ranked", "stakes", "tournament"]);
const RECORDED = new Set(["friend", "ranked", "stakes", "tournament"]);
const RATED = new Set(["ranked", "stakes", "tournament"]);
const LISTED = new Set(["ranked", "stakes", "tournament"]);
const BOT_NAMES = ["Paper Hands", "Diamond Hands", "Limit Order", "Stop Loss", "Dip Buyer", "Bag Check", "Dead Cat", "Short Squeeze", "Margin Call", "Late Bell"];
const AWAY_AFTER_TIMEOUTS = 2;
// How long the table shows a finished hand before dealing the next.
const WIN_PAUSE_MS = 9000;
const DRAW_PAUSE_MS = 6000;
const READY_PAUSE_MS = 1200;
const SOLO_PAUSE_MS = 60_000;
const AUTO_DISCARD_MS = 900;

const tables = new Map(); // id -> table
const roomCodes = new Map(); // friend room code -> table id
const seatTokens = new Map(); // seat token -> { tableId, seat }
const userTables = new Map(); // user id -> table id (one live seat per player)
const guestStarts = new Map(); // ip key -> [timestamps]
const locks = new Map();
let pool = null;
let memorySeq = 0;
let talentSymbols = [];
let overListener = null;

function tableError(code, extra = {}) {
  return Object.assign(new Error(code), { code, ...extra });
}

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

const logError = (error) => console.error("mahjong table error:", error);
const randomInt = (n) => crypto.randomInt(0, n);
const speedOf = (table) => SPEEDS[table.speed] ?? SPEEDS.standard;

// ── Seats ──────────────────────────────────────────────────────────────────
function newToken() {
  return crypto.randomBytes(16).toString("hex");
}

/** A talent for a seat: the player's oshi, else one picked by who they are; never one already at the table. */
function talentFor(table, wanted, salt) {
  const taken = new Set(table.seats.filter(Boolean).map((seat) => seat.talent));
  if (wanted && !taken.has(wanted)) return wanted;
  const free = talentSymbols.filter((symbol) => !taken.has(symbol));
  if (!free.length) return wanted ?? null;
  const index = salt === null ? randomInt(free.length) : Number(salt) % free.length;
  return free[index];
}

function humanSeat(table, player, { guest = false } = {}) {
  return {
    user_id: player.user_id ?? null,
    username: player.username,
    profile_color: player.profile_color ?? null,
    profile_picture_url: player.profile_picture_url ?? null,
    talent: talentFor(table, player.oshi ?? null, player.user_id ?? null),
    rating: player.rating ?? null,
    rank: player.rank ?? null,
    bot: null,
    guest,
    token: newToken(),
    away: false,
    left: false,
    seen: false,
    timeouts: 0,
    bank: 0,
    ready: false,
    fee: 0,
  };
}

function botSeat(table, level) {
  const used = new Set(table.seats.filter(Boolean).map((seat) => seat.username));
  const names = BOT_NAMES.filter((name) => !used.has(name));
  return {
    user_id: null,
    username: names[randomInt(names.length)],
    profile_color: "#8a94a6",
    profile_picture_url: null,
    talent: talentFor(table, null, null),
    rating: SETTINGS.botRatings[level] ?? null,
    rank: null,
    bot: level,
    guest: false,
    token: null,
    away: false,
    left: false,
    seen: false,
    timeouts: 0,
    bank: 0,
    ready: true,
    fee: 0,
  };
}

const humansAt = (table) => table.seats.filter((seat) => seat && !seat.bot);
const presentHumans = (table) => humansAt(table).filter((seat) => !seat.away);
const seatIndexOfUser = (table, userId) => (userId ? table.seats.findIndex((seat) => seat && seat.user_id === Number(userId)) : -1);
const seatIndexOfToken = (table, token) => (token ? table.seats.findIndex((seat) => seat && seat.token === token) : -1);
const seatChannel = (seat) => `mj-seat:${seat.token}`;

function seatOf(table, { userId = null, token = null }) {
  const byToken = seatIndexOfToken(table, token);
  return byToken >= 0 ? byToken : seatIndexOfUser(table, userId);
}

function registerSeat(table, index) {
  const seat = table.seats[index];
  if (seat?.token) seatTokens.set(seat.token, { tableId: table.id, seat: index });
  if (seat?.user_id) userTables.set(seat.user_id, table.id);
}

function releaseSeat(table, seat) {
  if (seat?.token) seatTokens.delete(seat.token);
  if (seat?.user_id && userTables.get(seat.user_id) === table.id) userTables.delete(seat.user_id);
}

/** The live table a player is seated at, if any. */
function tableOfUser(userId) {
  const id = userTables.get(Number(userId));
  const table = id ? tables.get(id) : null;
  if (!table || table.status === "done" || table.status === "cancelled") return null;
  return seatIndexOfUser(table, userId) >= 0 ? table : null;
}

// ── Views ──────────────────────────────────────────────────────────────────
function publicSeat(table, seat, index) {
  if (!seat) return null;
  return {
    seat: index,
    user_id: seat.user_id,
    username: seat.username,
    profile_color: seat.profile_color,
    profile_picture_url: seat.profile_picture_url,
    talent: seat.talent,
    bot: seat.bot,
    guest: seat.guest,
    rating: seat.rating,
    rank: seat.rank,
    away: seat.away,
    connected: seat.bot ? true : !seat.seen || hub.count(seatChannel(seat)) > 0,
    ready: seat.ready,
  };
}

function gameView(table, seatIndex) {
  const match = table.game;
  if (!match) return null;
  const hand = match.hand;
  return {
    wind: match.wind,
    number: match.number,
    label: game.roundLabel(match),
    honba: match.honba,
    sticks: match.sticks,
    scores: hand ? [...hand.scores] : [...match.scores],
    hand_index: match.hand_index,
    length: match.length,
    seed_hash: match.seed_hash,
    hand: hand ? (seatIndex === null ? view.publicHand(hand) : view.seatHand(hand, seatIndex, { coach: table.coach })) : null,
    history: match.hands.map((summary) => ({ index: summary.index, label: summary.label, honba: summary.honba, result: briefResult(summary.result) })),
    over: match.over,
    final: match.final,
  };
}

/** A finished hand in a line: who won what off whom, or how it drew. */
function briefResult(result) {
  if (result.type === "draw") return { type: "draw", reason: result.reason, deltas: result.deltas };
  return { type: "win", deltas: result.deltas, wins: result.wins.map((win) => ({ seat: win.seat, from: win.from, han: win.han, fu: win.fu, yakuman: win.yakuman, limit: win.limit, gain: win.gain })) };
}

function clockView(table) {
  const asks = Object.entries(table.asks);
  if (table.between) return { phase: "between", until: table.between.until, seats: [] };
  if (!asks.length) return null;
  const hand = table.game?.hand;
  // During calls, who is being waited on would say who can use the tile: only the turn is public.
  const shown = hand?.phase === "turn" ? asks.map(([seat, ask]) => ({ seat: Number(seat), deadline: ask.deadline })) : [];
  return { phase: hand?.phase ?? null, until: Math.max(...asks.map(([, ask]) => ask.deadline)), seats: shown };
}

function publicTable(table, seatIndex = null) {
  const prizes = table.fee > 0 ? stakesPrizeTable(table.fee) : null;
  const payload = {
    id: table.id,
    kind: table.kind,
    status: table.status,
    length: table.length,
    speed: table.speed,
    level: table.level,
    coach: table.coach,
    fee: table.fee,
    prizes: prizes ? prizes.prizes : null,
    rated: table.rated,
    recorded: Boolean(table.dbId),
    room_code: table.code,
    host_user_id: table.hostUserId,
    seats: table.seats.map((seat, index) => publicSeat(table, seat, index)),
    game: gameView(table, seatIndex),
    clock: clockView(table),
    starts_at: table.startAt,
    expires_at: table.status === "waiting" ? table.expiresAt : null,
    created_at: table.createdAt,
    tournament: table.tournament,
    lesson: table.lesson ? { key: table.lesson.key, step: table.lesson.step, steps: table.lesson.steps.length } : null,
    picks: table.pickCounts,
    picks_open: picksOpen(table),
    cheers: table.cheers,
    spectators: hub.count(`mahjong:${table.id}`),
    result: table.result,
    server_time: Date.now(),
  };
  if (seatIndex !== null) {
    const seat = table.seats[seatIndex];
    const ask = table.asks[seatIndex];
    payload.me = { seat: seatIndex, away: seat.away, bank: seat.bank, deadline: ask?.deadline ?? null, turn_ms: speedOf(table).turn * 1000, ready: seat.ready, auto: ask?.kind === "auto" };
  }
  return payload;
}

function lobbyEntry(table) {
  const match = table.game;
  return {
    id: table.id,
    kind: table.kind,
    status: table.status,
    length: table.length,
    speed: table.speed,
    fee: table.fee,
    seats: table.seats.map((seat, index) => (seat ? { seat: index, username: seat.username, profile_color: seat.profile_color, talent: seat.talent, bot: seat.bot, rank: seat.rank } : null)),
    label: match ? game.roundLabel(match) : null,
    scores: match ? [...(match.hand?.scores ?? match.scores)] : null,
    starts_at: table.startAt,
    tournament: table.tournament,
    spectators: hub.count(`mahjong:${table.id}`),
  };
}

function lobbySnapshot() {
  const list = [...tables.values()]
    .filter((table) => LISTED.has(table.kind) && (table.status === "waiting" || table.status === "playing"))
    .sort((a, b) => (a.status === b.status ? b.createdAt - a.createdAt : a.status === "playing" ? -1 : 1))
    .map(lobbyEntry);
  return { type: "lobby", game: "mahjong", tables: list, server_time: Date.now() };
}

const lobbyPush = socketLimits.coalesce(() => hub.publish("lobby:mahjong", lobbySnapshot()), 1000);

function publish(table) {
  hub.publish(`mahjong:${table.id}`, { type: "mahjong", table: publicTable(table) });
  table.seats.forEach((seat, index) => {
    if (seat?.token) hub.publish(seatChannel(seat), { type: "mahjong", table: publicTable(table, index) });
  });
  if (LISTED.has(table.kind)) lobbyPush.schedule();
}

// ── The clock ──────────────────────────────────────────────────────────────
/** A bot's pause before it plays: quicker when nobody is at the table to watch. */
function thinkMs(table, phase) {
  if (!presentHumans(table).length && !hub.count(`mahjong:${table.id}`)) return 40;
  if (table.kind === "tutorial") return 550;
  return phase === "turn" ? 650 + randomInt(700) : 450 + randomInt(450);
}

/** What the table is waiting on from each seat, with when it's due. Kept while the question is the same. */
function refreshAsks(table) {
  const hand = table.game?.hand;
  const asks = {};
  if (table.status === "playing" && hand && hand.phase !== "over" && !table.between) {
    const now = Date.now();
    const speed = speedOf(table);
    for (const index of round.waitingSeats(hand)) {
      const key = `${table.game.hand_index}:${hand.seq}:${hand.phase}`;
      const previous = table.asks[index];
      if (previous?.key === key) {
        asks[index] = previous;
        continue;
      }
      const seat = table.seats[index];
      if (seat.bot || seat.away) {
        const due = now + thinkMs(table, hand.phase);
        asks[index] = { key, kind: "bot", since: now, due, deadline: due };
      } else {
        const options = round.optionsFor(hand, index);
        // In riichi with nothing to decide, the drawn tile goes straight back out.
        const forced = options.phase === "turn" && hand.riichi[index] > 0 && !options.tsumo && !options.ankan.length;
        if (forced) asks[index] = { key, kind: "auto", since: now, due: now + AUTO_DISCARD_MS, deadline: now + AUTO_DISCARD_MS };
        else {
          const gone = seat.seen && hub.count(seatChannel(seat)) === 0;
          const allowed = gone ? Math.min(10_000, speed.turn * 1000 + seat.bank) : speed.turn * 1000 + seat.bank;
          asks[index] = { key, kind: "human", since: now, due: now + allowed, deadline: now + allowed };
        }
      }
    }
  }
  table.asks = asks;
}

function nextDue(table) {
  if (table.status === "waiting") return Math.min(table.startAt ?? Infinity, table.expiresAt ?? Infinity);
  if (table.status !== "playing") return Infinity;
  if (table.settling) return table.settling;
  if (table.between) return table.between.until;
  return Math.min(Infinity, ...Object.values(table.asks).map((ask) => ask.due));
}

function schedule(table) {
  clearTimeout(table.timer);
  const due = nextDue(table);
  if (!Number.isFinite(due)) return;
  table.timer = setTimeout(
    () =>
      withLock(table.id, () => tick(table)).catch((error) => {
        // Never leave a table frozen: look again shortly (usually a database blip).
        logError(error);
        if (tables.get(table.id) === table && table.status !== "done" && table.status !== "cancelled") {
          clearTimeout(table.timer);
          table.timer = setTimeout(() => withLock(table.id, () => tick(table)).catch(logError), 2000);
        }
      }),
    Math.max(0, due - Date.now()) + 15
  );
  table.timer.unref?.();
}

/** After anything changes: work out who's being waited on, set the timer, tell everyone. */
function changed(table) {
  refreshAsks(table);
  schedule(table);
  publish(table);
}

/** The move made for a seat whose clock ran out: the drawn tile goes back, calls are passed. */
function timeoutAction(hand, index) {
  const options = round.optionsFor(hand, index);
  if (options.phase !== "turn") return { type: "pass" };
  const tile = hand.drawn !== null && options.discards.includes(hand.drawn) ? hand.drawn : options.discards[options.discards.length - 1];
  return { type: "discard", tile };
}

function autopilotLevel(table, seat) {
  if (seat.bot) return seat.bot;
  // On a paid table an absent seat only throws back what it draws: walking away can't beat playing.
  return table.fee > 0 || table.paidTournament ? "auto" : "normal";
}

async function tick(table) {
  if (tables.get(table.id) !== table) return;
  const now = Date.now();
  if (table.status === "waiting") {
    if (table.startAt && now >= table.startAt) await startWhenDue(table);
    else if (table.expiresAt && now >= table.expiresAt) await cancelTable(table, "expired");
    else schedule(table);
    return;
  }
  if (table.status !== "playing") return;
  if (table.settling) return finishTable(table);
  if (table.between) {
    if (now >= table.between.until) await nextHand(table);
    else schedule(table);
    return;
  }
  const hand = table.game.hand;
  // One move at a time: each can change who's being waited on.
  const due = Object.entries(table.asks).find(([, ask]) => now >= ask.due);
  if (!due) return schedule(table);
  const index = Number(due[0]);
  const ask = due[1];
  const seat = table.seats[index];
  let action;
  if (ask.kind === "bot") action = bot.decide(hand, index, { level: autopilotLevel(table, seat) });
  else {
    action = timeoutAction(hand, index);
    if (ask.kind === "human") {
      seat.timeouts += 1;
      seat.bank = 0;
      if (seat.timeouts >= AWAY_AFTER_TIMEOUTS) seat.away = true;
    }
  }
  if (!action) return changed(table);
  applyMove(table, index, action);
  await afterMove(table);
}

function applyMove(table, index, action) {
  round.act(table.game.hand, index, action);
}

async function afterMove(table) {
  const hand = table.game.hand;
  if (hand.phase === "over") beginPause(table);
  changed(table);
}

function beginPause(table) {
  const result = table.game.hand.result;
  const solo = !RECORDED.has(table.kind);
  const big = result.type === "win" && (result.wins.length > 1 || result.wins.some((win) => win.yakuman || win.han >= 8));
  const pause = !presentHumans(table).length ? 300 : solo ? SOLO_PAUSE_MS : result.type === "win" ? WIN_PAUSE_MS + (big ? 4000 : 0) : DRAW_PAUSE_MS;
  for (const seat of table.seats) seat.ready = Boolean(seat.bot);
  table.between = { until: Date.now() + pause };
  table.asks = {};
}

async function nextHand(table) {
  const match = table.game;
  const summary = game.next(match);
  table.between = null;
  if (table.dbId) {
    const seatUsers = table.seats.map((seat) => seat.user_id);
    records.saveHand(pool, table.dbId, summary, seatUsers).catch(logError);
    if (humansAt(table).length >= 2 && summary.result.type === "win") {
      for (const win of summary.result.wins) {
        const seat = table.seats[win.seat];
        if (win.yakuman && seat.user_id) {
          records.wireYakuman(pool, { gameId: table.dbId, handIndex: summary.index, userId: seat.user_id, username: seat.username, yaku: win.yaku, kind: table.kind }).catch(logError);
        }
      }
    }
  }
  const speed = speedOf(table);
  for (const seat of table.seats) seat.bank = speed.bank * 1000;
  if (match.over || table.lesson) {
    table.settling = Date.now();
    return finishTable(table);
  }
  changed(table);
}

// ── Starting and finishing ─────────────────────────────────────────────────
function shuffleSeats(table) {
  for (let i = SEATS - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [table.seats[i], table.seats[j]] = [table.seats[j], table.seats[i]];
  }
  table.seats.forEach((seat, index) => {
    if (seat.token) seatTokens.set(seat.token, { tableId: table.id, seat: index });
  });
}

async function startGame(table) {
  if (table.seats.some((seat) => !seat)) throw tableError("table_not_full");
  if (!table.lesson) shuffleSeats(table);
  const speed = speedOf(table);
  for (const seat of table.seats) {
    seat.bank = speed.bank * 1000;
    seat.ready = Boolean(seat.bot);
  }
  table.rated = RATED.has(table.kind);
  // A tournament seat whose player isn't at the table when it deals starts on autopilot.
  if (table.kind === "tournament") for (const seat of table.seats) if (!seat.bot && hub.count(seatChannel(seat)) === 0) seat.away = true;
  table.game = game.createGame({ seed: newSeed(), length: table.length, wallFor: table.lesson ? () => table.lesson.wall() : null });
  if (table.dbId) await records.startGameRow(pool, table.dbId, { seedHash: table.game.seed_hash, seats: table.seats });
  table.status = "playing";
  table.startAt = null;
  table.startedAt = Date.now();
  changed(table);
}

/** A waiting table's moment has come: fill the empty seats with bots where that's allowed, and deal. */
async function startWhenDue(table) {
  if (table.kind === "stakes") {
    // Needs four players; if someone stood up during the countdown it goes back to waiting.
    if (humansAt(table).length < SEATS) {
      table.startAt = null;
      return changed(table);
    }
  } else {
    for (let index = 0; index < SEATS; index += 1) if (!table.seats[index]) table.seats[index] = botSeat(table, table.level);
  }
  await startGame(table);
}

async function finishTable(table) {
  const match = table.game;
  const final = match.final ?? { standings: game.standings(match.scores, match.sticks), scores: [...match.scores], sticks: match.sticks };
  let lines = final.standings.map((entry) => ({ seat: entry.seat, user_id: table.seats[entry.seat].user_id, place: entry.place, points: entry.points, score: entry.score, rating_before: null, rating_after: null, payout: 0 }));
  if (table.dbId) {
    const prizes = table.fee > 0 ? stakesPrizeTable(table.fee).prizes : null;
    const closed = await records.finishGame(pool, { gameId: table.dbId, seed: match.seed, rated: table.rated, prizes, standings: final.standings, seats: table.seats, hands: match.hands });
    if (closed) lines = closed.lines;
  }
  table.settling = null;
  table.status = "done";
  table.asks = {};
  table.between = null;
  table.result = { standings: [...lines].sort((a, b) => a.place - b.place), seed: match.seed, seed_hash: match.seed_hash, replay: table.dbId };
  for (const seat of table.seats) releaseUser(table, seat);
  clearTimeout(table.timer);
  publish(table);
  lobbyPush.schedule();
  if (overListener && table.tournament) {
    try {
      await overListener(table, table.result);
    } catch (error) {
      logError(error);
    }
  }
  setTimeout(() => discard(table), SETTINGS.doneLingerMinutes * 60_000).unref?.();
}

function releaseUser(table, seat) {
  if (seat?.user_id && userTables.get(seat.user_id) === table.id) userTables.delete(seat.user_id);
}

function discard(table) {
  if (tables.get(table.id) !== table) return;
  clearTimeout(table.timer);
  for (const seat of table.seats) releaseSeat(table, seat);
  if (table.code) roomCodes.delete(table.code);
  tables.delete(table.id);
  lobbyPush.schedule();
}

async function cancelTable(table, reason) {
  clearTimeout(table.timer);
  if (table.dbId) await records.cancelGame(pool, table.dbId, reason);
  table.status = "cancelled";
  table.result = { cancelled: reason };
  table.asks = {};
  publish(table);
  discard(table);
}

// ── Creating tables ────────────────────────────────────────────────────────
function newTable({ id, kind, length = "east", speed = "standard", level = "normal", coach = false, fee = 0, dbId = null, hostUserId = null, code = null, tournament = null, lesson = null }) {
  const now = Date.now();
  const table = {
    id,
    dbId,
    kind,
    status: "waiting",
    length,
    speed,
    level,
    coach,
    fee,
    rated: RATED.has(kind),
    hostUserId,
    code,
    tournament,
    paidTournament: false,
    lesson,
    seats: [null, null, null, null],
    game: null,
    asks: {},
    between: null,
    settling: null,
    timer: null,
    startAt: null,
    startedAt: null,
    expiresAt: now + SETTINGS.openTableMinutes * 60_000,
    createdAt: now,
    picks: new Map(),
    pickCounts: [0, 0, 0, 0],
    cheers: [0, 0, 0, 0],
    result: null,
  };
  tables.set(id, table);
  if (code) roomCodes.set(code, id);
  return table;
}

function parseOptions({ length, speed, level }) {
  return {
    length: Object.hasOwn(game.LENGTHS, String(length)) ? String(length) : "east",
    speed: speed === "relaxed" ? "relaxed" : "standard",
    level: bot.LEVELS.includes(level) ? level : "normal",
  };
}

function newRoomCode() {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  for (;;) {
    let code = "";
    for (let i = 0; i < 6; i += 1) code += alphabet[randomInt(alphabet.length)];
    if (!roomCodes.has(code)) return code;
  }
}

function assertFree(userId) {
  const current = tableOfUser(userId);
  if (current) throw tableError("already_seated", { table_id: current.id });
}

/** A table against three bots, dealt at once. `guest` seats a signed-out visitor; `lessonKey` makes it a guided hand. */
async function createSoloTable({ player, guest = false, lessonKey = null, level, length, speed }) {
  const lessonSpec = lessonKey ? tutorial.lessonOf(lessonKey) : null;
  if (lessonKey && !lessonSpec) throw tableError("lesson_not_found");
  const options = parseOptions({ length, speed, level });
  memorySeq += 1;
  const table = newTable({
    id: MEMORY_ID_BASE + memorySeq,
    kind: lessonSpec ? "tutorial" : "practice",
    length: "east",
    ...(lessonSpec ? { speed: "untimed", level: "auto" } : { length: options.length, speed: speed === "untimed" ? "untimed" : options.speed, level: options.level }),
    coach: true,
    lesson: lessonSpec ? { key: lessonKey, step: 0, steps: lessonSpec.steps, wall: lessonSpec.wall } : null,
  });
  table.seats[0] = humanSeat(table, player, { guest });
  registerSeat(table, 0);
  for (let index = 1; index < SEATS; index += 1) table.seats[index] = botSeat(table, table.level);
  await startGame(table);
  return table;
}

async function createTable({ userId, kind, length, speed, level, tier, lesson, coach }) {
  return withLock(`user:${userId}`, async () => {
    if (!KINDS.has(kind) || kind === "tournament") throw tableError("invalid_table");
    if (siteState.gamesPaused()) throw tableError("games_paused");
    assertFree(userId);
    const player = await records.loadPlayer(pool, userId);
    if (!player) throw tableError("unauthenticated");
    if (kind === "tutorial" || kind === "practice") {
      const table = await createSoloTable({ player, lessonKey: kind === "tutorial" ? String(lesson || "") : null, level, length, speed });
      return seatedView(table, 0);
    }
    if (kind === "friend") {
      const options = parseOptions({ length, speed, level });
      const code = newRoomCode();
      const dbId = await records.createGameRow(pool, { kind, length: options.length, speed: options.speed, roomCode: code, hostUserId: userId, settings: { level: options.level, coach: Boolean(coach) } });
      const table = newTable({ id: dbId, dbId, kind, ...options, coach: Boolean(coach), hostUserId: Number(userId), code });
      table.seats[0] = humanSeat(table, player);
      registerSeat(table, 0);
      changed(table);
      return seatedView(table, 0);
    }
    // Quick match and stakes: take a seat at a table that's waiting, or open one.
    return withLock("lobby", async () => {
      const options = parseOptions({ length, speed: "standard", level: "normal" });
      const fee = kind === "stakes" ? Number(tier) : 0;
      if (kind === "stakes" && !SETTINGS.stakesTiers.includes(fee)) throw tableError("invalid_stake");
      const open = [...tables.values()].filter((table) => table.kind === kind && table.status === "waiting" && table.length === options.length && table.fee === fee && table.seats.some((seat) => !seat));
      for (const table of open.sort((a, b) => a.createdAt - b.createdAt)) {
        try {
          return await withLock(table.id, () => sitLocked(table, player));
        } catch (error) {
          // Someone on their network is already at that table: try the next, or open a new one.
          if (error?.code !== "mahjong_same_network") throw error;
        }
      }
      const dbId = await records.createGameRow(pool, { kind, length: options.length, speed: options.speed, fee, rated: true });
      const table = newTable({ id: dbId, dbId, kind, ...options, fee });
      try {
        return await withLock(table.id, () => sitLocked(table, player));
      } catch (error) {
        await cancelTable(table, "not_started").catch(logError);
        throw error;
      }
    });
  });
}

/** A practice table for a signed-out visitor: free, unrecorded, and theirs through the token alone. */
async function createGuestTable({ ipKey, lesson = null, level = "easy" }) {
  if (siteState.gamesPaused()) throw tableError("games_paused");
  const now = Date.now();
  const recent = (guestStarts.get(ipKey) || []).filter((at) => now - at < 10 * 60_000);
  if (recent.length >= SETTINGS.guestTablesPerIp) throw tableError("mahjong_guest_limit");
  const open = [...tables.values()].filter((table) => table.seats.some((seat) => seat?.guest) && table.status === "playing").length;
  if (open >= SETTINGS.guestTables) throw tableError("mahjong_guest_busy");
  recent.push(now);
  guestStarts.set(ipKey, recent);
  if (guestStarts.size > 5000) for (const [key, list] of guestStarts) if (!list.some((at) => now - at < 10 * 60_000)) guestStarts.delete(key);
  const table = await createSoloTable({ player: { username: "Guest" }, guest: true, lessonKey: lesson ? String(lesson) : null, level, length: "east", speed: "untimed" });
  return seatedView(table, 0);
}

function seatedView(table, index) {
  return { table: publicTable(table, index), seat: { index, channel: seatChannel(table.seats[index]), token: table.seats[index].guest ? table.seats[index].token : undefined } };
}

// ── Sitting down and leaving ───────────────────────────────────────────────
async function sitLocked(table, player) {
  if (table.status !== "waiting") throw tableError("table_not_open");
  if (seatIndexOfUser(table, player.user_id) >= 0) throw tableError("already_seated", { table_id: table.id });
  const index = table.seats.findIndex((seat) => !seat);
  if (index < 0) throw tableError("table_full");
  const seat = humanSeat(table, player);
  if (table.fee > 0) {
    const prize = stakesPrizeTable(table.fee);
    await limits.assertPaidAccount(pool, player.user_id);
    await limits.assertNoSharedNetwork(pool, player.user_id, humansAt(table).map((other) => other.user_id));
    await records.inTransaction(pool, async (client) => {
      // One paid entry at a time per player: the row lock holds until the fee commits.
      await economy.lockWallet(client, player.user_id);
      limits.assertCanEnter(await limits.readPlan(client, player.user_id), { fee: table.fee, topNet: prize.top_net });
      await records.payEntry(client, { userId: player.user_id, gameId: table.dbId, fee: table.fee, maxNet: prize.top_net });
    });
    seat.fee = table.fee;
  }
  table.seats[index] = seat;
  registerSeat(table, index);
  const full = table.seats.every(Boolean);
  if (table.kind === "ranked") {
    // The wait for players starts with the first one; a full table goes at once.
    if (full) table.startAt = Date.now() + 3000;
    else if (!table.startAt) table.startAt = Date.now() + SETTINGS.botFillSeconds * 1000;
  } else if (table.kind === "stakes" && full) {
    table.startAt = Date.now() + SETTINGS.stakesStartSeconds * 1000;
  }
  changed(table);
  return seatedView(table, index);
}

async function joinTable({ userId, tableId }) {
  return withLock(`user:${userId}`, () =>
    withLock(tableId, async () => {
      if (siteState.gamesPaused()) throw tableError("games_paused");
      const table = getTableOrThrow(tableId);
      if (table.kind !== "friend" && table.kind !== "ranked" && table.kind !== "stakes") throw tableError("table_not_open");
      const current = tableOfUser(userId);
      if (current && current !== table) throw tableError("already_seated", { table_id: current.id });
      const player = await records.loadPlayer(pool, userId);
      if (!player) throw tableError("unauthenticated");
      return sitLocked(table, player);
    })
  );
}

async function leaveTable({ userId = null, token = null, tableId }) {
  return withLock(tableId, async () => {
    const table = getTableOrThrow(tableId);
    const index = seatOf(table, { userId, token });
    if (index < 0) throw tableError("forbidden");
    const seat = table.seats[index];
    if (table.status === "waiting" && table.kind !== "tournament") {
      if (seat.fee > 0) await records.inTransaction(pool, (client) => records.refundOpenEntries(client, { gameId: table.dbId, userId: seat.user_id }));
      releaseSeat(table, seat);
      table.seats[index] = null;
      const left = humansAt(table);
      if (!left.length) {
        await cancelTable(table, "empty");
        return { ok: true };
      }
      if (table.hostUserId === seat.user_id) table.hostUserId = left[0].user_id;
      if (table.kind === "stakes") table.startAt = null;
      changed(table);
      return { ok: true };
    }
    if (table.status === "playing" || table.status === "waiting") {
      if (!RECORDED.has(table.kind)) {
        // Practice and the tutorial: nobody else is playing, so the table just closes.
        table.status = "cancelled";
        table.result = { cancelled: "left" };
        table.asks = {};
        publish(table);
        discard(table);
        return { ok: true };
      }
      seat.away = true;
      seat.left = true;
      changed(table);
    }
    return { ok: true };
  });
}

/** A friend room's host deals: bots take the seats nobody did. */
async function startTable({ userId, tableId }) {
  return withLock(tableId, async () => {
    const table = getTableOrThrow(tableId);
    if (table.kind !== "friend" || table.status !== "waiting") throw tableError("table_not_open");
    if (table.hostUserId !== Number(userId)) throw tableError("forbidden");
    if (siteState.gamesPaused()) throw tableError("games_paused");
    for (let index = 0; index < SEATS; index += 1) if (!table.seats[index]) table.seats[index] = botSeat(table, table.level);
    await startGame(table);
    return { table: publicTable(table, seatIndexOfUser(table, userId)) };
  });
}

// ── Moves ──────────────────────────────────────────────────────────────────
function cleanAction(raw) {
  const type = String(raw?.type || "");
  const int = (value, max) => (Number.isInteger(value) && value >= 0 && value <= max ? value : null);
  if (type === "discard") {
    const tile = int(raw.tile, 135);
    if (tile === null) throw tableError("invalid_action");
    return { type, tile, riichi: raw.riichi === true };
  }
  if (type === "ankan" || type === "kakan") {
    const kind = int(raw.kind, 33);
    if (kind === null) throw tableError("invalid_action");
    return { type, kind };
  }
  if (type === "pon" || type === "chi") {
    if (!Array.isArray(raw.tiles) || raw.tiles.length !== 2 || raw.tiles.some((tile) => int(tile, 135) === null)) throw tableError("invalid_action");
    return { type, tiles: [raw.tiles[0], raw.tiles[1]] };
  }
  if (["tsumo", "ron", "kan", "pass", "kyuushu"].includes(type)) return { type };
  throw tableError("invalid_action");
}

async function actOnTable({ userId = null, token = null, tableId, action }) {
  return withLock(tableId, async () => {
    const table = getTableOrThrow(tableId);
    const index = seatOf(table, { userId, token });
    if (index < 0) throw tableError("forbidden");
    if (table.status !== "playing" || table.between || !table.game.hand) throw tableError("invalid_action");
    const hand = table.game.hand;
    const seat = table.seats[index];
    const raw = { ...(action || {}) };
    // "pon" or "chi" with no tiles named means the only way it could be made.
    if ((raw.type === "pon" || raw.type === "chi") && !Array.isArray(raw.tiles)) {
      const ways = round.optionsFor(hand, index)?.[raw.type] ?? [];
      if (ways.length === 1 || (raw.type === "pon" && ways.length)) raw.tiles = ways[0];
    }
    const move = cleanAction(raw);
    if (table.lesson && table.lesson.step < table.lesson.steps.length && !tutorial.matchesStep(table.lesson.steps[table.lesson.step], move, kindOf)) {
      throw tableError("tutorial_step", { step: table.lesson.step });
    }
    const ask = table.asks[index];
    try {
      applyMove(table, index, move);
    } catch (error) {
      if (error?.code === "illegal_action") throw tableError("invalid_action", { why: error.why });
      throw error;
    }
    if (table.lesson) table.lesson.step += 1;
    if (ask?.kind === "human") {
      const over = Date.now() - ask.since - speedOf(table).turn * 1000;
      if (over > 0) seat.bank = Math.max(0, seat.bank - over);
    }
    seat.timeouts = 0;
    seat.away = false;
    seat.left = false;
    await afterMove(table);
    return { table: publicTable(table, index) };
  });
}

/** "I'm back": takes a seat off autopilot. */
async function returnToSeat({ userId = null, token = null, tableId }) {
  return withLock(tableId, async () => {
    const table = getTableOrThrow(tableId);
    const index = seatOf(table, { userId, token });
    if (index < 0) throw tableError("forbidden");
    const seat = table.seats[index];
    if (seat.away) {
      seat.away = false;
      seat.left = false;
      seat.timeouts = 0;
      // The autopilot's pending move becomes the player's, on a fresh clock.
      delete table.asks[index];
      changed(table);
    }
    return { table: publicTable(table, index) };
  });
}

/** "Next hand": when everyone at the table has seen the result, there's no need to wait out the pause. */
async function readyUp({ userId = null, token = null, tableId }) {
  return withLock(tableId, async () => {
    const table = getTableOrThrow(tableId);
    const index = seatOf(table, { userId, token });
    if (index < 0) throw tableError("forbidden");
    if (table.status === "playing" && table.between) {
      table.seats[index].ready = true;
      if (presentHumans(table).every((seat) => seat.ready)) table.between.until = Math.min(table.between.until, Date.now() + READY_PAUSE_MS);
      schedule(table);
      publish(table);
    }
    return { table: publicTable(table, index) };
  });
}

// ── Spectators ─────────────────────────────────────────────────────────────
/** Picks are open on listed tables with at least two players, until the first hand is over. */
function picksOpen(table) {
  return LISTED.has(table.kind) && table.status === "playing" && table.game.hands.length === 0 && humansAt(table).length >= 2;
}

async function pickWinner({ userId, tableId, seat }) {
  return withLock(tableId, async () => {
    const table = getTableOrThrow(tableId);
    const index = Number(seat);
    if (!Number.isInteger(index) || index < 0 || index >= SEATS) throw tableError("invalid_action");
    if (!picksOpen(table)) throw tableError("mahjong_picks_closed");
    if (seatIndexOfUser(table, userId) >= 0) throw tableError("forbidden");
    const target = table.seats[index];
    await records.savePick(pool, { userId, gameId: table.dbId, seat: index, pickedUserId: target.user_id, pickedName: target.username });
    const previous = table.picks.get(Number(userId));
    if (previous !== undefined) table.pickCounts[previous] -= 1;
    table.picks.set(Number(userId), index);
    table.pickCounts[index] += 1;
    publish(table);
    return { pick: { seat: index, name: target.username } };
  });
}

/** For reactions.js: the player's seat, -1 if they're watching, null if there's no such live table. */
function reactionSeat(tableId, userId) {
  const table = tables.get(Number(tableId));
  if (!table || (table.status !== "playing" && table.status !== "waiting" && table.status !== "done")) return null;
  return seatIndexOfUser(table, userId);
}

/** Cheers counted for the table's tally (reactions.js calls this as they go out); the next table push carries it. */
function countCheers(tableId, items) {
  const table = tables.get(Number(tableId));
  if (!table) return;
  for (const [id, , count] of items) {
    const match = /^cheer-([0-3])$/.exec(String(id));
    if (match) table.cheers[Number(match[1])] += count;
  }
}

// ── Reads ──────────────────────────────────────────────────────────────────
function getTableOrThrow(tableId) {
  const table = tables.get(Number(tableId));
  if (!table) throw tableError("table_not_found");
  return table;
}

/** A live table as this viewer sees it: with their seat if they have one. Null if it isn't in memory. */
async function getTable({ tableId, userId = null, token = null }) {
  const table = tables.get(Number(tableId));
  if (!table) return null;
  const index = seatOf(table, { userId, token });
  const payload = { table: publicTable(table, index >= 0 ? index : null) };
  if (index >= 0) payload.seat = { index, channel: seatChannel(table.seats[index]) };
  else if (userId && table.dbId) payload.my_pick = table.picks.has(Number(userId)) ? { seat: table.picks.get(Number(userId)) } : null;
  return payload;
}

const roomByCode = (code) => roomCodes.get(String(code || "").toLowerCase()) ?? null;

function lobby() {
  return lobbySnapshot();
}

// ── Tournament seating (tournaments.js) ────────────────────────────────────
/**
 * Seats a tournament table and deals. `players` is four of { user_id } or { bot: level }; a player
 * who isn't there starts on autopilot and takes over when they arrive.
 */
async function createTournamentTable({ tournament, players, length, speed, paid, startInMs = null }) {
  const dbId = await records.createGameRow(pool, { kind: "tournament", length, speed, rated: true, tournament });
  const table = newTable({ id: dbId, dbId, kind: "tournament", length, speed, level: "normal", tournament });
  table.paidTournament = Boolean(paid);
  for (const [index, entry] of players.entries()) {
    if (entry.user_id) {
      const player = await records.loadPlayer(pool, entry.user_id);
      table.seats[index] = humanSeat(table, player ?? { user_id: entry.user_id, username: entry.username ?? `Player ${entry.user_id}` });
      registerSeat(table, index);
    } else {
      table.seats[index] = botSeat(table, entry.bot ?? "normal");
    }
  }
  // A short wait so players can reach the table; whoever isn't there by then starts on autopilot.
  table.startAt = Date.now() + (startInMs ?? 20_000);
  changed(table);
  return table.id;
}

// ── Startup ────────────────────────────────────────────────────────────────
async function init(db, { onTableOver = null } = {}) {
  pool = db;
  overListener = onTableOver;
  const cancelled = await records.cancelUnfinishedGames(pool);
  if (cancelled) console.log(`games: cancelled ${cancelled} unfinished mahjong game(s) from before restart`);
  talentSymbols = await records.listTalentSymbols(pool);
  const refresh = setInterval(() => {
    records
      .listTalentSymbols(pool)
      .then((symbols) => {
        if (symbols.length) talentSymbols = symbols;
      })
      .catch(() => {});
  }, 30 * 60_000);
  refresh.unref?.();

  siteState.onGamesPausedChange((paused) => {
    if (!paused) return;
    // Maintenance: tables still waiting are closed and refunded; games in play finish.
    for (const table of [...tables.values()]) {
      if (table.status === "waiting") void withLock(table.id, () => (table.status === "waiting" ? cancelTable(table, "maintenance") : null)).catch(logError);
    }
  });

  // Emoji, stamps and cheers at a table: decoration on its own channel, never part of the table's state.
  hub.registerAction(
    "mj-react",
    reactions.createReactions({
      publish: hub.publish,
      seatOf: reactionSeat,
      scope: "mahjong",
      ids: reactions.MAHJONG_REACTIONS,
      allow: reactions.mahjongAllows,
      present: (ws, tableKey) => Boolean(ws.gameChannels?.has(`reactions:mahjong:${tableKey}`)),
      onFlush: countCheers,
    }).handle
  );

  hub.registerSnapshotProvider((channel) => {
    if (channel === "lobby:mahjong") return lobbySnapshot();
    const publicMatch = /^mahjong:(\d+)$/.exec(channel);
    if (publicMatch) {
      const table = tables.get(Number(publicMatch[1]));
      return table ? { type: "mahjong", table: publicTable(table) } : null;
    }
    const seatMatch = /^mj-seat:([0-9a-f]{32})$/.exec(channel);
    if (seatMatch) {
      const entry = seatTokens.get(seatMatch[1]);
      const table = entry ? tables.get(entry.tableId) : null;
      return table ? { type: "mahjong", table: publicTable(table, entry.seat) } : null;
    }
    return null;
  });
  hub.onSubscriberCount((channel) => {
    const publicMatch = /^mahjong:(\d+)$/.exec(channel);
    if (publicMatch) {
      const table = tables.get(Number(publicMatch[1]));
      if (table) hub.publish(channel, { type: "spectators", table_id: table.id, spectators: hub.count(channel) });
      return;
    }
    const seatMatch = /^mj-seat:([0-9a-f]{32})$/.exec(channel);
    if (!seatMatch) return;
    const entry = seatTokens.get(seatMatch[1]);
    const table = entry ? tables.get(entry.tableId) : null;
    const seat = table?.seats[entry.seat];
    if (!seat) return;
    if (hub.count(channel) > 0) seat.seen = true;
    seatPresence(table);
  });
}

// A seat connecting or dropping shows on the table, at most once a second per table.
const presenceTimers = new Map();
function seatPresence(table) {
  if (presenceTimers.has(table.id)) return;
  presenceTimers.set(
    table.id,
    setTimeout(() => {
      presenceTimers.delete(table.id);
      if (tables.get(table.id) === table && table.status !== "cancelled") publish(table);
    }, 1000)
  );
}

/** For tests: forget every table and timer. */
function reset() {
  for (const table of tables.values()) clearTimeout(table.timer);
  for (const timer of presenceTimers.values()) clearTimeout(timer);
  lobbyPush.stop();
  tables.clear();
  roomCodes.clear();
  seatTokens.clear();
  userTables.clear();
  guestStarts.clear();
  presenceTimers.clear();
}

module.exports = {
  MEMORY_ID_BASE,
  actOnTable,
  countCheers,
  createGuestTable,
  createTable,
  createTournamentTable,
  getTable,
  init,
  joinTable,
  leaveTable,
  lobby,
  pickWinner,
  publicTable,
  reactionSeat,
  readyUp,
  reset,
  returnToSeat,
  roomByCode,
  startTable,
  tableOfUser,
  withLock,
  // For tests.
  _tables: tables,
  _tick: tick,
};
