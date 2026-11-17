// The coach: what a first-time player needs to know about where their hand stands.
//
// Everything here is pure and computed ONLY from what the seat can see: its own tiles and draws, every
// pond, every open meld, the dora indicators shown, riichi declarations and scores. Never another seat's
// concealed tiles, the live wall or the dead wall. mahjong-sim.test.js scrambles all of that and checks
// the output doesn't move.
//
// The one exception is review(), which only runs once a hand is over (all hands are face up by then).
//
// Output is data and reason codes, never prose: the client owns the wording. The codes are listed in
// the doc comment of the function that produces each one.

const round = require("./round");
const bot = require("./bot");
const { evaluate, payments } = require("./agari");
const { improvements, orphansShanten, sevenPairsShanten, shanten, standardShanten, waitsOf } = require("./shanten");
const { DORA_START, LIVE_END, RINSHAN_START } = require("./wall");
const { KINDS, countKinds, doraFromIndicator, isDragon, isHonor, isRedFive, isSuited, isYaochuu, kindOf, suitOf } = require("./tiles");

const DRAGON_KEYS = Object.freeze({ 31: "yakuhai-white", 32: "yakuhai-green", 33: "yakuhai-red" });
const FORMS = Object.freeze(["standard", "seven_pairs", "thirteen_orphans"]);
// Yaku only a closed hand can have: calling a tile gives them up.
const CLOSED_ONLY = new Set(["riichi", "menzen-tsumo"]);

const kindsOf = (ids) => ids.map(kindOf);
const meldTypeIsTriplet = (type) => type !== "chi";

// ── Shanten and its form ───────────────────────────────────────────────────
/**
 * How far from ready (0 is ready, -1 is complete) and which of the three forms is closest. Ties go to
 * the standard form. `by_form` has every form's number (seven pairs and thirteen orphans are null once
 * a tile has been called).
 */
function shapeOf(counts, melds = 0) {
  const standard = standardShanten(counts, melds);
  const pairs = melds === 0 ? sevenPairsShanten(counts) : null;
  const orphans = melds === 0 ? orphansShanten(counts) : null;
  let best = standard;
  let form = FORMS[0];
  if (pairs !== null && pairs < best) {
    best = pairs;
    form = FORMS[1];
  }
  if (orphans !== null && orphans < best) {
    best = orphans;
    form = FORMS[2];
  }
  return { shanten: best, form, by_form: { standard, seven_pairs: pairs, thirteen_orphans: orphans } };
}

// ── What a win would be worth ──────────────────────────────────────────────
const doraKindsOf = (state) => round.doraIndicators(state).map((tile) => doraFromIndicator(kindOf(tile)));

/**
 * The win this seat would have on `kind` with `resting` (the tiles it holds before the winning tile), by
 * discard or by self-draw. Null when the tiles don't complete the hand. Never reads ura indicators, so the
 * points are what the hand is worth before any ura dora. `exact` is for the tile that is really on the
 * table now (a discard or the drawn tile): it adds the situational yaku the table knows about. Without it
 * the question is "if the tile came later", and only riichi counts.
 */
function previewWin(state, seat, resting, kind, tsumo, { exact = false, chankan = false, tileId = null } = {}) {
  const melds = state.melds[seat];
  const concealed = kindsOf(resting);
  concealed.push(kind);
  if (shanten(countKinds(concealed), melds.length) !== -1) return null;
  let reds = resting.filter(isRedFive).length + (tileId !== null && isRedFive(tileId) ? 1 : 0);
  for (const meld of melds) reds += meld.tiles.filter(isRedFive).length;
  const left = round.remaining(state);
  const first = exact && state.discards[seat] === 0 && !state.called && !state.afterKan;
  const win = evaluate({
    concealed,
    melds: melds.map((meld) => ({ type: meld.type, kind: round.meldKind(meld) })),
    winKind: kind,
    tsumo,
    seatWind: round.seatWind(state, seat),
    roundWind: state.roundWind,
    riichi: state.riichiDeclared === seat ? 0 : state.riichi[seat],
    ippatsu: exact ? state.ippatsu[seat] : false,
    rinshan: exact && tsumo && state.afterKan,
    chankan: exact && chankan,
    haitei: exact && tsumo && left === 0 && !state.afterKan,
    houtei: exact && !tsumo && !chankan && left === 0,
    tenhou: first && tsumo && seat === state.dealer,
    chiihou: first && tsumo && seat !== state.dealer,
    dora: doraKindsOf(state),
    ura: [],
    redFives: reds,
  });
  if (!win) return null;
  const points = win.noYaku ? 0 : payments({ base: win.base, winner: seat, dealer: state.dealer, tsumo, loser: (seat + 1) % 4 }).total;
  return { ok: !win.noYaku, han: win.han, fu: win.fu, yaku: win.yaku.map((entry) => entry.key), limit: win.limit, points };
}

function describeWaits(state, seat, hand, seen) {
  return round.waits(state, seat, hand).map((kind) => ({
    kind,
    left: Math.max(0, 4 - seen[kind]),
    ron: previewWin(state, seat, hand, kind, false),
    tsumo: previewWin(state, seat, hand, kind, true),
  }));
}

const waitRow = (wait) => ({ kind: wait.kind, left: wait.left, ron_ok: Boolean(wait.ron?.ok), tsumo_ok: Boolean(wait.tsumo?.ok), ron: wait.ron, tsumo: wait.tsumo });

// ── Yaku in sight ──────────────────────────────────────────────────────────
/**
 * Yaku this hand has or is heading for, by cheap tests on the tiles alone. Each entry is
 * { key, status } with the key as in agari.js:
 *   status "met"        every way of finishing these tiles scores it (all simples so far, one suit and
 *                       honors, a value triplet, riichi declared)
 *   status "near"       a few tiles away (extra fields say how many: off, pairs, need)
 *   status "available"  closed hands only: riichi (if there are 1,000 points and four tiles left) and
 *                       menzen-tsumo (self-draw) are there to take
 * Keys: riichi, menzen-tsumo, tanyao, yakuhai-white/green/red/seat/round, honitsu, chinitsu,
 * chiitoitsu, toitoi.
 */
function yakuInSight(ctx, concealed, melds) {
  const out = [];
  const closed = melds.every((meld) => meld.type === "ankan");
  const counts = countKinds(concealed);

  if (closed) {
    if (ctx.inRiichi) out.push({ key: "riichi", status: "met" });
    else if (ctx.canRiichi) out.push({ key: "riichi", status: "available" });
    out.push({ key: "menzen-tsumo", status: "available" });
  }

  // A called set that holds a terminal or honor rules tanyao out for good.
  if (!melds.some((meld) => meld.kinds.some(isYaochuu))) {
    const outside = concealed.filter(isYaochuu).length;
    if (outside === 0) out.push({ key: "tanyao", status: "met" });
    else if (outside <= 2) out.push({ key: "tanyao", status: "near", off: outside });
  }

  const valueKeys = new Map();
  for (const kind of [31, 32, 33]) valueKeys.set(kind, [DRAGON_KEYS[kind]]);
  const addKey = (kind, key) => valueKeys.set(kind, [...(valueKeys.get(kind) ?? []), key]);
  addKey(ctx.seatWind, "yakuhai-seat");
  addKey(ctx.roundWind, "yakuhai-round");
  for (const [kind, keys] of valueKeys) {
    const melded = melds.some((meld) => meldTypeIsTriplet(meld.type) && meld.kinds[0] === kind);
    for (const key of keys) {
      if (melded || counts[kind] >= 3) out.push({ key, status: "met", kind });
      else if (counts[kind] === 2) out.push({ key, status: "near", kind, need: 1 });
    }
  }

  // One suit (and honors): called sets already fix their suit, only concealed tiles can be swapped.
  const inHand = [0, 0, 0];
  const inMelds = [0, 0, 0];
  let honors = 0;
  for (const kind of concealed) {
    if (isSuited(kind)) inHand[suitOf(kind)] += 1;
    else honors += 1;
  }
  for (const meld of melds) {
    for (const kind of meld.kinds) {
      if (isSuited(kind)) inMelds[suitOf(kind)] += 1;
      else honors += 1;
    }
  }
  let flush = null;
  for (let suit = 0; suit < 3; suit += 1) {
    if (inMelds.some((count, other) => other !== suit && count > 0)) continue;
    const off = inHand[0] + inHand[1] + inHand[2] - inHand[suit];
    const mine = inHand[suit] + inMelds[suit];
    if (mine > 0 && (!flush || off < flush.off)) flush = { suit, off, mine };
  }
  if (flush) {
    const key = honors > 0 ? "honitsu" : "chinitsu";
    if (flush.off === 0) out.push({ key, status: "met", suit: flush.suit });
    else if (flush.off <= 3 && flush.mine >= 6) out.push({ key, status: "near", suit: flush.suit, off: flush.off });
  }

  if (melds.length === 0) {
    const pairs = counts.filter((count) => count >= 2).length;
    const seven = sevenPairsShanten(counts);
    if (seven === 0 || seven === -1) out.push({ key: "chiitoitsu", status: "met", pairs });
    else if (seven <= 2) out.push({ key: "chiitoitsu", status: "near", pairs });
  }

  const sets = melds.filter((meld) => meldTypeIsTriplet(meld.type)).length + counts.filter((count) => count >= 3).length;
  if (sets >= 3 && !melds.some((meld) => meld.type === "chi")) out.push({ key: "toitoi", status: "near", triplets: sets });
  return out;
}

const live = (entries) => entries.filter((entry) => entry.status === "met" || entry.status === "near");

function sightContext(state, seat) {
  return {
    seatWind: round.seatWind(state, seat),
    roundWind: state.roundWind,
    inRiichi: state.riichi[seat] > 0,
    canRiichi: state.riichi[seat] === 0 && state.scores[seat] >= round.RIICHI_STICK && round.remaining(state) >= 4,
  };
}

const meldViews = (state, seat) => state.melds[seat].map((meld) => ({ type: meld.type, kinds: kindsOf(meld.tiles) }));

// ── Choosing a discard ─────────────────────────────────────────────────────
/** How much a tile is worth keeping when two discards are otherwise equal (the same measure bot.js uses). */
function keepScore(state, seat, counts, kind, dora) {
  let value = 0;
  if (dora.includes(kind)) value += 6;
  if (isHonor(kind)) {
    if (counts[kind] >= 2) value += 6;
    else if (isDragon(kind) || kind === round.seatWind(state, seat) || kind === state.roundWind) value += 2;
    return value;
  }
  const n = kind % 9;
  value += 3 - Math.abs(4 - n) * 0.5;
  for (const step of [-2, -1, 1, 2]) {
    const other = n + step;
    if (other >= 0 && other <= 8 && counts[kind + step] > 0) value += Math.abs(step) === 1 ? 2 : 1;
  }
  if (counts[kind] >= 2) value += 3;
  return value;
}

/** The tile id to throw for a kind: the drawn one if it is that kind, else a plain copy before a red five. */
function tileFor(state, options, kind) {
  const same = options.discards.filter((tile) => kindOf(tile) === kind);
  if (state.drawn !== null && same.includes(state.drawn)) return state.drawn;
  return same.find((tile) => !isRedFive(tile)) ?? same[0];
}

function sureSafeAgainst(state, seen, threats, kind) {
  return threats.filter((threat) => bot.safetyAgainst(state, threat, kind, seen) === 100).map((threat) => threat.seat);
}

/**
 * The discard rows, best first. Each row:
 *   { kind, shanten, left, improve: [{kind, left}], riichi, safe_against: [seats], ready, recommended }
 *   shanten  after throwing this kind (0 is ready)
 *   improve  the kinds that would then lower the shanten (or complete a ready hand); left is how many are
 *            still unseen from this seat (4 minus copies in its hand, every pond, every meld, indicators)
 *   left     the total of those
 *   riichi   a riichi can be declared on this discard
 *   safe_against  riichi seats this kind is certainly safe against (thrown by them, or since by anyone)
 *   ready    null unless the discard leaves a ready hand: { waits: [{kind, left, ron_ok, tsumo_ok}],
 *            ron_ok, tsumo_ok (any wait scores a yaku that way), furiten: null | "discard" | "riichi" }
 */
function discardRows(state, seat, options, help, seen, threats) {
  const counts = countKinds(kindsOf(state.hands[seat]));
  const melds = state.melds[seat].length;
  const dora = doraKindsOf(state);
  const ponded = new Set(state.ponds[seat].map((entry) => kindOf(entry.tile)));
  const riichiKinds = new Set(options.riichi.map(kindOf));
  const rows = [];
  const old = [];
  const tried = new Set();
  for (const tile of options.discards) {
    const kind = kindOf(tile);
    if (tried.has(kind)) continue;
    tried.add(kind);
    counts[kind] -= 1;
    const result = improvements(counts, melds, seen);
    const keep = keepScore(state, seat, counts, kind, dora);
    counts[kind] += 1;
    old.push({ kind, shanten: result.shanten, useful: result.left, kinds: result.kinds });

    const waiting = help.tenpai_discards[kind] ?? null;
    let improve = result.kinds.map((other) => ({ kind: other, left: Math.max(0, 4 - seen[other]) }));
    let ready = null;
    if (waiting && result.shanten === 0) {
      improve = waiting.map((wait) => ({ kind: wait.kind, left: wait.left }));
      const rows2 = waiting.map(waitRow);
      let furiten = null;
      if (state.riichiFuriten[seat]) furiten = "riichi";
      else if (waiting.some((wait) => wait.kind === kind || ponded.has(wait.kind))) furiten = "discard";
      ready = { waits: rows2.map(({ kind: waitKind, left, ron_ok, tsumo_ok }) => ({ kind: waitKind, left, ron_ok, tsumo_ok })), ron_ok: rows2.some((wait) => wait.ron_ok), tsumo_ok: rows2.some((wait) => wait.tsumo_ok), furiten };
    }
    rows.push({
      kind,
      shanten: result.shanten,
      left: improve.reduce((sum, entry) => sum + entry.left, 0),
      improve,
      riichi: riichiKinds.has(kind),
      safe_against: threats.length ? sureSafeAgainst(state, seen, threats, kind) : [],
      ready,
      recommended: false,
      keep,
    });
  }
  rows.sort((a, b) => a.shanten - b.shanten || b.left - a.left || a.keep - b.keep || a.kind - b.kind);
  return { rows, old };
}

const flawed = (row) => Boolean(row.ready && (!(row.ready.ron_ok || row.ready.tsumo_ok) || row.ready.furiten));

/**
 * One recommended move, as { action, kind, tile, riichi, code, ...params, danger }.
 *
 * action "tsumo" (win now) or "discard". `danger` lists the riichi seats the tile is not certainly safe
 * against (empty when nobody is in riichi). Codes:
 *   win_now                      {han, fu, points, yaku}  you can win by self-draw
 *   riichi_locked                you are in riichi: the drawn tile goes
 *   safe_against_riichi          {seat}  folding or tied for best, and certainly safe against that riichi
 *   least_risky_against_riichi   {seat}  folding: no sure-safe tile, this is the least dangerous
 *   avoids_furiten               {waits, left}  a ready discard that isn't furiten
 *   ready_with_yaku              {waits, left}  a ready discard that has a yaku (an open hand needs one)
 *   makes_ready                  {waits, left}  the discard leaves the hand ready
 *   keeps_yaku                   {yaku}  "tanyao" (open all-simples plan) or "yakuhai" (a value honor kept)
 *   isolated_honor               a lone honor that goes with nothing
 *   isolated_terminal            a lone 1 or 9 with no neighbors
 *   keeps_most_draws             {count}  keeps the most tiles that move the hand forward
 *   least_useful                 nothing improves the hand: the least useful tile
 */
function suggest(state, seat, options, rows, seen, threats) {
  if (options.tsumo) {
    const win = previewWin(state, seat, round.restingHand(state, seat), kindOf(state.drawn), true, { exact: true, tileId: state.drawn });
    return { action: "tsumo", kind: kindOf(state.drawn), tile: state.drawn, riichi: false, code: "win_now", han: win?.han ?? 0, fu: win?.fu ?? 0, points: win?.points ?? 0, yaku: win?.yaku ?? [], danger: [] };
  }
  const danger = (kind) => threats.filter((threat) => bot.safetyAgainst(state, threat, kind, seen) < 100).map((threat) => threat.seat);
  if (state.riichi[seat]) {
    const kind = kindOf(state.drawn);
    return { action: "discard", kind, tile: state.drawn, riichi: false, code: "riichi_locked", danger: danger(kind) };
  }

  const picked = bot.chooseDiscard(state, seat, options, "hard", () => 0.5);
  let row = rows.find((candidate) => candidate.kind === picked.entry.kind) ?? rows[0];
  let code = null;
  const params = {};
  const waitsInfo = (r) => ({ waits: r.ready.waits.length, left: r.left });

  if (picked.folding) {
    const sure = threats.length && row.safe_against.length === threats.length;
    code = sure ? "safe_against_riichi" : "least_risky_against_riichi";
    params.seat = threats[0].seat;
  } else {
    if (flawed(row)) {
      const alt = rows.find((candidate) => candidate.shanten === row.shanten && candidate.ready && !flawed(candidate));
      if (alt) {
        code = row.ready.furiten ? "avoids_furiten" : "ready_with_yaku";
        row = alt;
        Object.assign(params, waitsInfo(alt));
      }
    }
    if (!code && threats.length && row.safe_against.length === threats.length) {
      code = "safe_against_riichi";
      params.seat = threats[0].seat;
    }
    const counts = countKinds(kindsOf(state.hands[seat]));
    if (!code && row.ready) {
      code = "makes_ready";
      Object.assign(params, waitsInfo(row));
    }
    if (!code) {
      const plan = bot.planOf(state, seat, counts);
      if (plan === "tanyao" && isYaochuu(row.kind)) {
        code = "keeps_yaku";
        params.yaku = "tanyao";
      } else if (plan === "any" && !round.isClosed(state, seat) && live(yakuInSight(sightContext(state, seat), kindsOf(state.hands[seat]).filter((_, at) => state.hands[seat][at] !== tileFor(state, options, row.kind)), meldViews(state, seat))).some((entry) => entry.key.startsWith("yakuhai") && entry.status === "met")) {
        code = "keeps_yaku";
        params.yaku = "yakuhai";
      }
    }
    if (!code && isHonor(row.kind) && counts[row.kind] === 1) code = "isolated_honor";
    if (!code && isYaochuu(row.kind) && !isHonor(row.kind) && counts[row.kind] === 1) {
      const n = row.kind % 9;
      const near = [-2, -1, 1, 2].some((step) => n + step >= 0 && n + step <= 8 && counts[row.kind + step] > 0);
      if (!near) code = "isolated_terminal";
    }
    if (!code) {
      if (row.left > 0) {
        code = "keeps_most_draws";
        params.count = row.left;
      } else {
        code = "least_useful";
      }
    }
  }
  row.recommended = true;
  const riichi = !picked.folding && row.shanten === 0 && row.riichi && row.left > 0;
  return { action: "discard", kind: row.kind, tile: tileFor(state, options, row.kind), riichi, code, ...params, danger: threats.length ? danger(row.kind) : [] };
}

// ── The way to a win ───────────────────────────────────────────────────────
/**
 * Where the hand stands on actually winning.
 *   subject   "hand" (the tiles held now), "after_discard" (the hand after the suggested discard, on a
 *             turn) or "complete" (a self-draw win is in hand)
 *   discard_kind  for after_discard
 *   ready     the subject is ready (or complete)
 *   can_win_now  null when not ready, else a row per winning tile:
 *             { kind, left, ron_ok, tsumo_ok, ron, tsumo } where ron and tsumo are null or
 *             { ok, han, fu, yaku, limit, points } (points before ura dora, honba and sticks)
 *   yaku_in_sight  see yakuInSight()
 *   blocked   why a ready hand can't win, or an open hand can't ever: [{code, ...}]
 *       furiten_own_discard  {kinds}  waiting on tiles it has thrown itself: no ron, tsumo still wins
 *       furiten_passed       passed a winning tile this turn around: no ron until its next discard
 *       furiten_riichi       passed a winning tile in riichi: no ron for the rest of the hand
 *       no_yaku_open_hand    ready but open with no yaku on any wait: it can't win at all
 *       no_tiles_left        every tile it waits on is already visible
 *       no_yaku_in_sight     (extra) an open hand that isn't ready and has no yaku met or near
 */
function winPath(state, seat, { subject, discardKind = null, concealed, waits, furitenFlag, closed, rowsComplete = null }) {
  const sight = yakuInSight(sightContext(state, seat), concealed, meldViews(state, seat));
  const ready = subject === "complete" || waits.length > 0;
  const blocked = [];
  const thrown = new Set(state.ponds[seat].map((entry) => kindOf(entry.tile)));
  if (discardKind !== null) thrown.add(discardKind);
  if (ready && subject !== "complete") {
    const own = waits.filter((wait) => thrown.has(wait.kind)).map((wait) => wait.kind);
    if (furitenFlag === "riichi" || state.riichiFuriten[seat]) blocked.push({ code: "furiten_riichi" });
    else if (furitenFlag === "passed") blocked.push({ code: "furiten_passed" });
    if (own.length) blocked.push({ code: "furiten_own_discard", kinds: own });
    if (!closed && waits.every((wait) => !wait.ron?.ok && !wait.tsumo?.ok)) blocked.push({ code: "no_yaku_open_hand" });
    if (waits.every((wait) => wait.left === 0)) blocked.push({ code: "no_tiles_left" });
  } else if (!ready && !closed && live(sight).length === 0) {
    blocked.push({ code: "no_yaku_in_sight" });
  }
  return {
    subject,
    discard_kind: discardKind,
    ready,
    can_win_now: ready ? (subject === "complete" ? rowsComplete : waits.map(waitRow)) : null,
    yaku_in_sight: sight,
    blocked,
  };
}

// ── Calls ──────────────────────────────────────────────────────────────────
/** The best way to throw a tile from `counts` with `melds` sets called: its shanten, preferring to shed terminals and honors. */
function bestDiscardAfter(counts, melds) {
  let best = null;
  for (let kind = 0; kind < KINDS; kind += 1) {
    if (counts[kind] === 0) continue;
    counts[kind] -= 1;
    const value = shanten(counts, melds);
    counts[kind] += 1;
    if (!best || value < best.shanten || (value === best.shanten && isYaochuu(kind) && !isYaochuu(best.kind))) best = { kind, shanten: value };
  }
  return best;
}

const keysOf = (entries) => entries.map((entry) => entry.key);

/**
 * Whether a ready hand has a yaku on any wait, by ron or tsumo, as agari.js reads it. Used for a hand that
 * doesn't exist yet (after a call), so riichi and the situational yaku are left out.
 */
function readyHasYaku(state, seat, concealed, melds) {
  const counts = countKinds(concealed);
  const calls = melds.map((meld) => ({ type: meld.type, kind: Math.min(...meld.kinds) }));
  for (let kind = 0; kind < KINDS; kind += 1) {
    if (counts[kind] >= 4) continue;
    counts[kind] += 1;
    if (shanten(counts, calls.length) === -1) {
      const kinds = [];
      for (let at = 0; at < KINDS; at += 1) for (let i = 0; i < counts[at]; i += 1) kinds.push(at);
      for (const tsumo of [false, true]) {
        const win = evaluate({ concealed: kinds, melds: calls, winKind: kind, tsumo, seatWind: round.seatWind(state, seat), roundWind: state.roundWind, riichi: 0, ippatsu: false, dora: [], ura: [], redFives: 0 });
        if (win && !win.noYaku) {
          counts[kind] -= 1;
          return true;
        }
      }
    }
    counts[kind] -= 1;
  }
  return false;
}

/** `exact` is readyHasYaku() when the hand after the call is ready, else null (the cheap test has to do). */
function recommendCall(from, to, closedNow, after, gives, exact) {
  if (exact === false || (exact === null && live(after).length === 0)) return "skip";
  if (to > from) return "skip";
  const secured = exact === true || after.some((entry) => entry.status === "met");
  if (to < from) return gives.length || (!closedNow && secured) ? "take" : "either";
  return gives.length ? "either" : "skip";
}

/**
 * What taking a call would do. Returns the effects and a recommendation for chi, pon or an open kan on the
 * discard `tile`, using `tiles` (the pair from the hand) for chi and pon.
 */
function callEffects(state, seat, type, tile, tiles, ctx) {
  const callKind = kindOf(tile);
  const handTiles = tiles ?? state.hands[seat].filter((held) => kindOf(held) === callKind);
  const used = kindsOf(handTiles);
  const after = ctx.counts.slice();
  for (const kind of used) after[kind] -= 1;
  const meldTiles = [...handTiles, tile];
  const nextMelds = ctx.meldCount + 1;
  const best = type === "kan" ? { kind: null, shanten: shanten(after, nextMelds) } : bestDiscardAfter(after, nextMelds);
  const concealed = [];
  for (let kind = 0; kind < KINDS; kind += 1) for (let i = 0; i < after[kind] - (best.kind === kind ? 1 : 0); i += 1) concealed.push(kind);
  const newMeld = { type: type === "kan" ? "minkan" : type, kinds: type === "chi" ? [callKind, ...used].sort((a, b) => a - b) : type === "pon" ? [callKind, ...used] : [callKind, callKind, callKind, callKind] };
  const afterSight = yakuInSight(sightContext(state, seat), concealed, [...meldViews(state, seat), newMeld]);
  const beforeLive = live(ctx.sight);
  const afterLive = live(afterSight);
  const exact = best.shanten === 0 ? readyHasYaku(state, seat, concealed, [...meldViews(state, seat), newMeld]) : null;
  const gives = afterSight.filter((entry) => entry.status === "met" && !ctx.sight.some((before) => before.key === entry.key && before.status === "met"));
  const givenKeys = new Set(keysOf(gives));
  const kept = afterLive.filter((entry) => !givenKeys.has(entry.key) && beforeLive.some((before) => before.key === entry.key) && !CLOSED_ONLY.has(entry.key));
  const lost = beforeLive.filter((entry) => !CLOSED_ONLY.has(entry.key) && !afterLive.some((next) => next.key === entry.key));

  const effects = [];
  if (ctx.closed) effects.push({ code: "opens_hand_no_riichi" });
  effects.push({ code: "shanten_change", from: ctx.shape.shanten, to: best.shanten });
  if (gives.length) effects.push({ code: "gives_yaku", yaku: keysOf(gives) });
  if (kept.length) effects.push({ code: "keeps_yaku", yaku: keysOf(kept) });
  if (lost.length) effects.push({ code: "loses_yaku", yaku: keysOf(lost) });
  if (exact === false || (exact === null && afterLive.length === 0)) effects.push({ code: "no_yaku_in_sight" });
  if (type === "kan") effects.push({ code: "adds_dora_indicator" });
  const doraKinds = doraKindsOf(state);
  const worth = meldTiles.filter((held) => isRedFive(held) || doraKinds.includes(kindOf(held))).length;
  if (worth) effects.push({ code: "meld_has_dora", count: worth });
  return { effects, recommend: recommendCall(ctx.shape.shanten, best.shanten, ctx.closed, afterSight, gives, exact) };
}

/** Advice for every option the seat is offered in the calls phase: ron, kan, pon, chi. */
function callAdvice(state, seat, options, ctx) {
  const out = [];
  const tile = options.tile;
  if (options.ron) {
    const win = previewWin(state, seat, state.hands[seat], kindOf(tile), false, { exact: true, chankan: Boolean(state.pending) && state.pending.kind !== "discard", tileId: tile });
    out.push({ option: { type: "ron" }, effects: [{ code: "wins_hand", tsumo: false, han: win?.han ?? 0, fu: win?.fu ?? 0, points: win?.points ?? 0, yaku: win?.yaku ?? [], limit: win?.limit ?? null }], recommend: "take" });
  }
  if (options.kan) out.push({ option: { type: "kan" }, ...callEffects(state, seat, "kan", tile, null, ctx) });
  for (const type of ["pon", "chi"]) {
    for (const tiles of options[type] ?? []) {
      const entry = callEffects(state, seat, type, tile, tiles, ctx);
      if (tiles.some(isRedFive)) entry.effects.push({ code: "uses_red_five" });
      out.push({ option: { type, tiles: [...tiles] }, ...entry });
    }
  }
  return out;
}

/** Advice for what the turn offers besides discarding: tsumo, riichi, closed and added kans. */
function turnAdvice(state, seat, options, ctx, rows, threats) {
  const out = [];
  if (options.tsumo) {
    const win = previewWin(state, seat, round.restingHand(state, seat), kindOf(state.drawn), true, { exact: true, tileId: state.drawn });
    out.push({ option: { type: "tsumo" }, effects: [{ code: "wins_hand", tsumo: true, han: win?.han ?? 0, fu: win?.fu ?? 0, points: win?.points ?? 0, yaku: win?.yaku ?? [], limit: win?.limit ?? null }], recommend: "take" });
  }
  const seenKinds = new Set();
  for (const tile of options.riichi) {
    const kind = kindOf(tile);
    if (seenKinds.has(kind)) continue;
    seenKinds.add(kind);
    const row = rows.find((candidate) => candidate.kind === kind);
    const effects = [{ code: "adds_yaku", yaku: "riichi" }, { code: "locks_hand" }, { code: "costs_stick", points: round.RIICHI_STICK }];
    let recommend = "either";
    if (row?.ready) {
      effects.push({ code: "waits_left", waits: row.ready.waits.length, left: row.left });
      if (row.ready.ron_ok) effects.push({ code: "already_has_yaku" });
      if (row.ready.furiten) effects.push({ code: "furiten_wait", kind: row.ready.furiten });
      if (row.left === 0) recommend = "skip";
      else if (!row.ready.ron_ok && !row.ready.furiten) recommend = "take";
    }
    if (options.tsumo) {
      effects.push({ code: "tsumo_available" });
      recommend = "skip";
    }
    out.push({ option: { type: "riichi", kind, tile }, effects, recommend });
  }
  const afterKan = (kind, closedKan) => {
    const after = ctx.counts.slice();
    after[kind] -= closedKan ? 4 : 1;
    return shanten(after, ctx.meldCount + (closedKan ? 1 : 0));
  };
  const kanEntry = (type, kind) => {
    const to = afterKan(kind, type === "ankan");
    const effects = [{ code: "adds_dora_indicator" }, { code: "shanten_change", from: ctx.shape.shanten, to }];
    if (type === "ankan") effects.push({ code: "keeps_closed" });
    let recommend = "either";
    if (to > ctx.shape.shanten || threats.length) recommend = "skip";
    return { option: { type, kind }, effects, recommend };
  };
  for (const kind of options.ankan) out.push(kanEntry("ankan", kind));
  for (const kind of options.kakan) out.push(kanEntry("kakan", kind));
  return out;
}

// ── The coach for one seat ─────────────────────────────────────────────────
const cache = new WeakMap();

function memoized(state, seat, compute) {
  let bySeat = cache.get(state);
  if (!bySeat) {
    bySeat = new Map();
    cache.set(state, bySeat);
  }
  const hit = bySeat.get(seat);
  if (hit && hit.seq === state.seq) return hit.value;
  const value = compute();
  bySeat.set(seat, { seq: state.seq, value });
  return value;
}

const furitenFlagOf = (state, seat) => (state.riichiFuriten[seat] ? "riichi" : state.tempFuriten[seat] ? "passed" : null);

function analyzeTurn(state, seat, options, help) {
  const seen = bot.seenCounts(state, seat);
  const hand = state.hands[seat];
  const counts = countKinds(kindsOf(hand));
  const meldCount = state.melds[seat].length;
  const closed = round.isClosed(state, seat);
  const shape = shapeOf(counts, meldCount);
  const threats = bot.threats(state, seat);
  const { rows, old } = discardRows(state, seat, options, help, seen, threats);
  if (!rows.length) return null;

  const bestShanten = Math.min(...old.map((entry) => entry.shanten));
  const bestUseful = Math.max(...old.filter((entry) => entry.shanten === bestShanten).map((entry) => entry.useful));
  const suggestion = suggest(state, seat, options, rows, seen, threats);
  const front = rows.findIndex((row) => row.kind === suggestion.kind);
  if (front > 0) rows.unshift(...rows.splice(front, 1));

  let path;
  if (options.tsumo) {
    const win = previewWin(state, seat, round.restingHand(state, seat), kindOf(state.drawn), true, { exact: true, tileId: state.drawn });
    path = winPath(state, seat, { subject: "complete", concealed: kindsOf(hand), waits: [], closed, rowsComplete: [{ kind: kindOf(state.drawn), left: Math.max(0, 4 - seen[kindOf(state.drawn)]), ron_ok: false, tsumo_ok: true, ron: null, tsumo: win }] });
  } else {
    const row = rows.find((candidate) => candidate.kind === suggestion.kind) ?? rows[0];
    const concealed = kindsOf(hand);
    concealed.splice(concealed.indexOf(row.kind), 1);
    path = winPath(state, seat, { subject: "after_discard", discardKind: row.kind, concealed, waits: help.tenpai_discards[row.kind] ?? [], furitenFlag: null, closed });
  }

  const ctx = { counts, meldCount, closed, shape };
  return {
    shanten: bestShanten,
    discards: old,
    best: old.filter((entry) => entry.shanten === bestShanten && entry.useful === bestUseful).map((entry) => entry.kind),
    shape,
    improvers: rows.map(({ keep, ...row }) => row),
    suggestion,
    win_path: path,
    call_advice: turnAdvice(state, seat, options, ctx, rows, threats),
    riichi_seats: threats.map((threat) => threat.seat),
  };
}

function analyzeCalls(state, seat, options, help) {
  const counts = countKinds(kindsOf(state.hands[seat]));
  const meldCount = state.melds[seat].length;
  const closed = round.isClosed(state, seat);
  const shape = shapeOf(counts, meldCount);
  const sight = yakuInSight(sightContext(state, seat), kindsOf(state.hands[seat]), meldViews(state, seat));
  const furiten = round.furitenOf(state, seat);
  const path = winPath(state, seat, { subject: "hand", concealed: kindsOf(state.hands[seat]), waits: help.waits, furitenFlag: furiten === "riichi" ? "riichi" : furiten === "passed" ? "passed" : null, closed });
  return {
    shanten: shape.shanten,
    discards: [],
    best: [],
    shape,
    improvers: [],
    suggestion: null,
    win_path: path,
    call_advice: callAdvice(state, seat, options, { counts, meldCount, closed, shape, sight }),
    riichi_seats: bot.threats(state, seat).map((threat) => threat.seat),
  };
}

/**
 * Coach data for one seat, or null when nothing is asked of it. On a turn: shanten (the existing field:
 * the best after discarding), discards and best (existing), plus shape, improvers, suggestion, win_path,
 * call_advice and riichi_seats. While a discard is being answered: the same without discards. Once the hand
 * is over: { shanten, discards: [], best: [], review }.
 */
function analyze(state, seat, options, help = null) {
  if (state.phase === "over") {
    return memoized(state, seat, () => {
      const result = review(state, seat);
      return { shanten: result?.final.shanten ?? 0, discards: [], best: [], review: result };
    });
  }
  if (!options) return null;
  return memoized(state, seat, () => {
    // view.js needs this module, so it is loaded here rather than at the top.
    const given = help ?? require("./view").basicHelp(state, seat, options);
    return options.phase === "turn" ? analyzeTurn(state, seat, options, given) : analyzeCalls(state, seat, options, given);
  });
}

// ── After the hand ─────────────────────────────────────────────────────────
function waitsFor(hand, melds) {
  if (hand.length % 3 !== 1) return [];
  const counts = countKinds(kindsOf(hand));
  const found = waitsOf(counts, melds.length);
  if (!found.length) return found;
  for (const meld of melds) for (const tile of meld.tiles) counts[kindOf(tile)] += 1;
  return found.filter((kind) => counts[kind] < 4);
}

/** Plays a finished hand's log forward, keeping what the review needs. */
function replay(log, seat) {
  const hands = [[], [], [], []];
  const melds = [[], [], [], []];
  const ponds = [[], [], [], []];
  const riichiAt = [null, null, null, null];
  const doraTiles = [];
  const own = { discards: 0, readyTurn: null, mistakes: [], safeAfter: [] };
  let discardNo = 0;
  let rinshan = 0;
  let draws = 0;
  let kuikae = [];
  let result = null;
  let dealer = 0;

  const markReady = () => {
    if (own.readyTurn === null && waitsFor(hands[seat], melds[seat]).length) own.readyTurn = own.discards;
  };
  const isPondedBy = (who, kind) => ponds[who].some((entry) => kindOf(entry.tile) === kind);
  const sureSafe = (kind, against) => isPondedBy(against, kind) || [0, 1, 2, 3].some((other) => other !== against && ponds[other].some((entry) => entry.n > riichiAt[against] && kindOf(entry.tile) === kind));

  for (const event of log) {
    switch (event.t) {
      case "deal":
        for (let who = 0; who < 4; who += 1) hands[who] = [...event.hands[who]];
        doraTiles.push(event.dora);
        dealer = event.dealer;
        markReady();
        break;
      case "draw":
        hands[event.s].push(event.tile);
        if (event.rinshan) rinshan += 1;
        else draws += 1;
        kuikae = [];
        break;
      case "discard": {
        const who = event.s;
        const kind = kindOf(event.tile);
        if (who === seat) {
          if (riichiAt[seat] === null) {
            const counts = countKinds(kindsOf(hands[seat]));
            const m = melds[seat].length;
            let best = Infinity;
            const better = [];
            let actual = null;
            for (let other = 0; other < KINDS; other += 1) {
              if (counts[other] === 0 || kuikae.includes(other)) continue;
              counts[other] -= 1;
              const value = shape2(counts, m);
              counts[other] += 1;
              if (other === kind) actual = value;
              if (value < best) {
                best = value;
                better.length = 0;
              }
              if (value === best) better.push(other);
            }
            if (actual !== null && best < actual) own.mistakes.push({ turn: own.discards + 1, discard: kind, from: best, to: actual, better: better.slice(0, 3) });
          }
          const against = [0, 1, 2, 3].filter((other) => other !== seat && riichiAt[other] !== null);
          if (against.length) own.safeAfter.push({ against: against[0], safe: against.every((other) => sureSafe(kind, other)), turn: own.discards + 1, seats: against });
        }
        const index = hands[who].indexOf(event.tile);
        if (index >= 0) hands[who].splice(index, 1);
        discardNo += 1;
        ponds[who].push({ tile: event.tile, called: false, riichi: Boolean(event.riichi), n: discardNo });
        kuikae = [];
        if (who === seat) {
          own.discards += 1;
          markReady();
        }
        break;
      }
      case "pon":
      case "chi":
      case "minkan": {
        for (const held of event.tiles) {
          const index = hands[event.s].indexOf(held);
          if (index >= 0) hands[event.s].splice(index, 1);
        }
        melds[event.s].push({ type: event.t, tiles: [...event.tiles, event.tile], from: event.from });
        const last = ponds[event.from][ponds[event.from].length - 1];
        if (last) last.called = true;
        if (event.t === "pon") kuikae = [kindOf(event.tile)];
        else if (event.t === "chi") kuikae = round.chiKuikae(kindOf(event.tile), kindOf(event.tiles[0]), kindOf(event.tiles[1]));
        break;
      }
      case "ankan":
        for (const held of event.tiles) hands[event.s].splice(hands[event.s].indexOf(held), 1);
        melds[event.s].push({ type: "ankan", tiles: [...event.tiles] });
        break;
      case "kakan": {
        hands[event.s].splice(hands[event.s].indexOf(event.tile), 1);
        const meld = melds[event.s].find((entry) => entry.type === "pon" && kindOf(entry.tiles[0]) === kindOf(event.tile));
        if (meld) {
          meld.type = "kakan";
          meld.tiles.push(event.tile);
        }
        break;
      }
      case "dora":
        doraTiles.push(event.tile);
        break;
      case "riichi": {
        // The riichi discard is the last one that seat made.
        const pond = ponds[event.s];
        riichiAt[event.s] = pond.length ? pond[pond.length - 1].n : 0;
        break;
      }
      case "end":
        result = event.result;
        break;
      default:
        break;
    }
  }
  return { hands, melds, ponds, riichiAt, doraTiles, own, discardNo, rinshan, draws, result, dealer };
}

const shape2 = (counts, melds) => shanten(counts, melds);

/**
 * Where every copy of `kind` ended up, as counts:
 *   own_hand, own_melds, own_discards (still in the seat's pond), other_discards, other_melds (a tile the
 *   seat threw that someone called is here), other_hands, dora_indicators, wall (never drawn), dead_wall.
 * `wall` and `dead_wall` are null when the wall isn't known; `unseen` is always what's left of the four.
 */
function whereCopies(kind, seat, sim, wall) {
  const copies = { own_hand: 0, own_melds: 0, own_discards: 0, other_discards: 0, other_melds: 0, other_hands: 0, dora_indicators: 0, wall: null, dead_wall: null, unseen: 0 };
  for (let who = 0; who < 4; who += 1) {
    const mine = who === seat;
    for (const tile of sim.hands[who]) if (kindOf(tile) === kind) copies[mine ? "own_hand" : "other_hands"] += 1;
    for (const meld of sim.melds[who]) for (const tile of meld.tiles) if (kindOf(tile) === kind) copies[mine ? "own_melds" : "other_melds"] += 1;
    for (const entry of sim.ponds[who]) if (!entry.called && kindOf(entry.tile) === kind) copies[mine ? "own_discards" : "other_discards"] += 1;
  }
  for (const tile of sim.doraTiles) if (kindOf(tile) === kind) copies.dora_indicators += 1;
  const known = Object.values(copies).reduce((sum, value) => sum + (typeof value === "number" ? value : 0), 0) - copies.unseen;
  copies.unseen = Math.max(0, 4 - known);
  if (wall) {
    const livePos = 52 + sim.draws;
    const liveEnd = LIVE_END - sim.rinshan;
    let inWall = 0;
    let inDead = 0;
    for (let at = livePos; at < wall.length; at += 1) {
      if (kindOf(wall[at]) !== kind) continue;
      const rinshanDrawn = at >= RINSHAN_START && at < RINSHAN_START + sim.rinshan;
      const indicator = at >= DORA_START && at < DORA_START + sim.doraTiles.length;
      if (rinshanDrawn || indicator) continue;
      if (at < liveEnd) inWall += 1;
      else inDead += 1;
    }
    copies.wall = inWall;
    copies.dead_wall = inDead;
  }
  return copies;
}

const reviewCache = new WeakMap();

/**
 * Looks back at a finished hand from one seat. `source` is the final state or a kept record with a `log`
 * (game.next's summary); pass the hand's `wall` (state.wall, or buildWall(seed, index) once the seed is
 * out) to split the unseen copies into the wall and the dead wall. Null until the hand is over.
 *
 *   { seat, outcome, delta, ready_turn,
 *     final: { won, shanten, form, waits: [{kind, won_on, copies}], improve: [{kind, copies}], furiten_kinds },
 *     moments: [at most two] }
 *   outcome  won_tsumo | won_ron | dealt_in | lost_to_tsumo | lost_to_ron | draw_ready | draw_not_ready | aborted
 *   ready_turn  how many discards the seat had made when its hand was first ready (0 from the deal), or null
 *   final.shanten  -1 for a win; waits when ready; improve (the kinds that would have helped) when not
 *   Moment codes, best first:
 *     discarded_winning_shape  {turn, discard, from, to, better}  a discard left it `to` from ready when
 *                              `better` would have kept it at `from` (only reported when `from` <= 1)
 *     dealt_in_after_riichi    {to, tile, riichi_seat}  threw the tile someone won on, after a riichi was down
 *     dealt_in                 {to, tile}  threw the tile someone won on
 *     ready_but_furiten        {kinds}  ready at the end but waiting on tiles it had thrown itself
 *     folded_safely            {against, discards}  after a riichi, every discard was a sure-safe tile
 *     waited_on_dead_tiles     {kinds}  ready at the end and no copy of any wait left in the wall
 *     won_by_draw_with_n_left  {left}  won by self-draw with this many tiles left to draw
 */
function review(source, seat, { wall = null } = {}) {
  const log = source?.log;
  if (!Array.isArray(log) || !log.length || log[log.length - 1].t !== "end") return null;
  const known = wall ?? (Array.isArray(source.wall) && source.wall.length === 136 ? source.wall : null);
  const key = `${seat}:${log.length}:${known ? 1 : 0}`;
  let held = reviewCache.get(log);
  if (!held) {
    held = new Map();
    reviewCache.set(log, held);
  }
  if (held.has(key)) return held.get(key);
  const value = buildReview(source, seat, known);
  held.set(key, value);
  return value;
}

function buildReview(source, seat, wall) {
  const sim = replay(source.log, seat);
  const result = sim.result;
  const wins = result.type === "win" ? result.wins : [];
  const mine = wins.find((win) => win.seat === seat) ?? null;

  const resting = [...sim.hands[seat]];
  if (mine?.tsumo) {
    const at = resting.indexOf(mine.tile);
    if (at >= 0) resting.splice(at, 1);
  }
  const counts = countKinds(kindsOf(resting));
  const meldsHeld = sim.melds[seat];
  const shape = shapeOf(counts, meldsHeld.length);
  const waits = waitsFor(resting, meldsHeld);
  const thrown = new Set(sim.ponds[seat].map((entry) => kindOf(entry.tile)));
  const furitenKinds = waits.filter((kind) => thrown.has(kind));
  const winKind = mine ? kindOf(mine.tile) : null;

  const final = { won: Boolean(mine), shanten: mine ? -1 : shape.shanten, form: shape.form, waits: [], improve: [], furiten_kinds: furitenKinds };
  if (waits.length) {
    final.waits = waits.map((kind) => ({ kind, won_on: kind === winKind, copies: whereCopies(kind, seat, sim, wall) }));
  } else if (!mine && resting.length % 3 === 1) {
    const seenNone = new Array(KINDS).fill(0);
    const { kinds } = improvements(counts, meldsHeld.length, seenNone);
    final.improve = kinds.map((kind) => ({ kind, copies: whereCopies(kind, seat, sim, wall) }));
  }

  const dealtIn = wins.find((win) => win.from === seat) ?? null;
  let outcome;
  if (mine) outcome = mine.tsumo ? "won_tsumo" : "won_ron";
  else if (dealtIn) outcome = "dealt_in";
  else if (result.type === "win") outcome = wins.some((win) => win.tsumo) ? "lost_to_tsumo" : "lost_to_ron";
  else if (result.reason === "exhaustive" || result.reason === "nagashi") outcome = result.tenpai?.[seat] ? "draw_ready" : "draw_not_ready";
  else outcome = "aborted";

  const moments = [];
  const worst = [...sim.own.mistakes].filter((entry) => entry.from <= 1).sort((a, b) => b.to - b.from - (a.to - a.from) || a.turn - b.turn)[0];
  if (worst) moments.push({ code: "discarded_winning_shape", turn: worst.turn, discard: worst.discard, from: worst.from, to: worst.to, better: worst.better });
  if (dealtIn) {
    const riichiSeat = [0, 1, 2, 3].find((other) => other !== seat && sim.riichiAt[other] !== null);
    if (riichiSeat !== undefined) moments.push({ code: "dealt_in_after_riichi", to: dealtIn.seat, tile: kindOf(dealtIn.tile), riichi_seat: riichiSeat });
    else moments.push({ code: "dealt_in", to: dealtIn.seat, tile: kindOf(dealtIn.tile) });
  }
  if (!mine && waits.length && furitenKinds.length) moments.push({ code: "ready_but_furiten", kinds: furitenKinds });
  if (!mine && !dealtIn && sim.riichiAt[seat] === null && sim.own.safeAfter.length >= 2 && sim.own.safeAfter.every((entry) => entry.safe)) {
    moments.push({ code: "folded_safely", against: sim.own.safeAfter[0].against, discards: sim.own.safeAfter.length });
  }
  if (!mine && waits.length && final.waits.every((entry) => entry.copies.wall === 0)) {
    moments.push({ code: "waited_on_dead_tiles", kinds: waits });
  }
  if (mine?.tsumo) moments.push({ code: "won_by_draw_with_n_left", left: LIVE_END - sim.rinshan - 52 - sim.draws });

  return { seat, outcome, delta: result.deltas?.[seat] ?? 0, ready_turn: sim.own.readyTurn, final, moments: moments.slice(0, 2) };
}

module.exports = { analyze, callAdvice, describeWaits, previewWin, review, shapeOf, winPath, yakuInSight };
