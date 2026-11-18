// A wall arranged on purpose, for the tutorial's guided hand and for tests. Real games never use
// this: their walls come from the sealed seed (wall.js).
//
// You say which tiles each seat is dealt, what comes off the wall in order, and optionally the
// replacement tiles and indicators. Every other slot is filled with the tiles left over, shuffled by
// a fixed seed so the same call always gives the same wall.

const { DORA_START, LIVE_END, RINSHAN_START, URA_START, seededPicker } = require("./wall");
const { TILES, parseTiles } = require("./tiles");

const FILL_SEED = "00".repeat(32);

/**
 * stackWall({ dealer, hands, draws, rinshan, dora, ura, fill })
 *
 *   hands    four entries by seat: notation ("123m456p789s1122z") or tile ids, up to 13 tiles each
 *   draws    tiles in the order they are drawn, starting with the dealer's first draw
 *   rinshan  replacement tiles for kans, in order (up to 4)
 *   dora     dora indicators in the order they turn (up to 5); ura likewise
 *   fill     a number that picks a different arrangement of the leftover tiles
 *
 * Returns the 136 tile ids as round.createHand() wants them.
 */
function stackWall({ dealer = 0, hands = [], draws = "", rinshan = "", dora = "", ura = "", fill = 0 } = {}) {
  const used = new Set();
  const wall = new Array(TILES).fill(null);
  const read = (value) => {
    if (Array.isArray(value)) {
      for (const id of value) {
        if (used.has(id)) throw new Error(`stackWall: tile ${id} used twice`);
        used.add(id);
      }
      return value;
    }
    return parseTiles(value || "", used);
  };
  const place = (index, id) => {
    if (wall[index] !== null) throw new Error(`stackWall: slot ${index} set twice`);
    wall[index] = id;
  };

  for (let seat = 0; seat < 4; seat += 1) {
    const tiles = read(hands[seat]);
    if (tiles.length > 13) throw new Error("stackWall: a dealt hand is 13 tiles");
    // Tile i of the deal goes to seat (dealer + i) % 4.
    const turn = (seat - dealer + 4) % 4;
    tiles.forEach((id, index) => place(index * 4 + turn, id));
  }
  read(draws).forEach((id, index) => place(52 + index, id));
  read(rinshan).forEach((id, index) => place(RINSHAN_START + index, id));
  read(dora).forEach((id, index) => place(DORA_START + index, id));
  read(ura).forEach((id, index) => place(URA_START + index, id));
  if (wall.slice(52, LIVE_END).filter((id) => id !== null).length > LIVE_END - 52) throw new Error("stackWall: too many draws");

  const rest = [];
  for (let id = 0; id < TILES; id += 1) if (!used.has(id)) rest.push(id);
  const pick = seededPicker(FILL_SEED, fill);
  for (let i = rest.length - 1; i > 0; i -= 1) {
    const j = pick(i + 1);
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  let next = 0;
  for (let index = 0; index < TILES; index += 1) if (wall[index] === null) wall[index] = rest[next++];
  return wall;
}

module.exports = { stackWall };
