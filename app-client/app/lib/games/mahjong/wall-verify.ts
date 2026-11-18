// Checks a finished game's wall in the browser, with Web Crypto: the same steps as
// api/src/services/games/mahjong/wall.js (docs/games/MAHJONG_DESIGN.md, "The wall").
//
//  1. SHA-256 of the seed's bytes equals the hash published when the game started.
//  2. For every hand n, a Fisher-Yates shuffle of tile ids 0-135 driven by SHA-256("<seed>|<n>|<counter>")
//     blocks (four bytes per draw, biased values thrown away) gives a wall. Tiles are dealt from the
//     front, 13 to each seat starting with the dealer, then drawn in order; the last 14 are the dead
//     wall (4 replacement tiles, 5 dora indicators, 5 ura indicators). The log of the hand must match.

import type { HandResult, LogEvent, RecordedHand } from "@/app/lib/games/mahjong/types";

const TILES = 136;
const LIVE_END = 122;
const RINSHAN_START = LIVE_END;
const DORA_START = LIVE_END + 4;
const URA_START = LIVE_END + 9;
const DEAL = 13;

const hex = (bytes: ArrayBuffer) => Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
const fromHex = (text: string) => Uint8Array.from(text.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16));
const digest = (bytes: Uint8Array) => crypto.subtle.digest("SHA-256", bytes as BufferSource);

export const isSeed = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{64}$/.test(value);

/** What is published before the game: the SHA-256 of the seed's 32 bytes. */
export async function seedHash(seed: string): Promise<string> {
  return hex(await digest(fromHex(seed)));
}

/** The wall of hand `handIndex` for a seed (wall.js buildWall). */
export async function buildWall(seed: string, handIndex: number): Promise<number[]> {
  if (!isSeed(seed)) throw new Error("The seed must be 64 hex characters");
  const encoder = new TextEncoder();
  let counter = 0;
  let block = new DataView(new ArrayBuffer(0));
  let offset = 0;
  const nextWord = async () => {
    if (offset >= block.byteLength) {
      block = new DataView(await digest(encoder.encode(`${seed}|${handIndex}|${counter}`)));
      counter += 1;
      offset = 0;
    }
    const word = block.getUint32(offset, false);
    offset += 4;
    return word;
  };
  const pick = async (n: number) => {
    const limit = Math.floor(0x1_0000_0000 / n) * n;
    for (;;) {
      const word = await nextWord();
      if (word < limit) return word % n;
    }
  };
  const wall = Array.from({ length: TILES }, (_, id) => id);
  for (let i = TILES - 1; i > 0; i -= 1) {
    const j = await pick(i + 1);
    [wall[i], wall[j]] = [wall[j], wall[i]];
  }
  return wall;
}

const sameList = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((value, index) => value === b[index]);

/** Compares a hand's log with the wall it should have come from. Returns what didn't match; empty means it all did. */
export function checkHandAgainstWall(wall: readonly number[], log: readonly LogEvent[], result?: HandResult): string[] {
  const problems: string[] = [];
  const deal = log.find((event) => event.t === "deal");
  if (!deal || deal.t !== "deal") return ["The log has no deal."];
  const dealt: number[][] = [[], [], [], []];
  for (let i = 0; i < DEAL * 4; i += 1) dealt[(deal.dealer + i) % 4].push(wall[i]);
  for (let seat = 0; seat < 4; seat += 1) {
    if (!sameList([...dealt[seat]].sort((a, b) => a - b), [...(deal.hands[seat] ?? [])].sort((a, b) => a - b))) problems.push(`Seat ${seat + 1} was dealt different tiles than the wall gives.`);
  }
  if (deal.dora !== wall[DORA_START]) problems.push("The first dora indicator is not the one in the wall.");
  let live = DEAL * 4;
  let rinshan = 0;
  let doraShown = 1;
  for (const event of log) {
    if (event.t === "draw") {
      const expected = event.rinshan ? wall[RINSHAN_START + rinshan++] : wall[live++];
      if (event.tile !== expected) problems.push(`A ${event.rinshan ? "replacement " : ""}draw by seat ${event.s + 1} is not the next tile in the wall.`);
    } else if (event.t === "dora") {
      if (event.tile !== wall[DORA_START + doraShown]) problems.push("A dora indicator is not the next one in the wall.");
      doraShown += 1;
    }
  }
  const ended = log.find((event): event is Extract<LogEvent, { t: "end" }> => event.t === "end");
  const end = result ?? ended?.result;
  const ura = end?.type === "win" ? end.ura : [];
  ura.forEach((tile, index) => {
    if (tile !== wall[URA_START + index]) problems.push("An ura indicator is not the one in the wall.");
  });
  return problems;
}

export type HandWallCheck = { index: number; ok: boolean; problems: string[] };
export type WallCheck = {
  /** SHA-256 of the seed equals the published hash. */
  seedOk: boolean;
  computedHash: string;
  hands: HandWallCheck[];
  /** The seed matches and every hand reproduces. */
  ok: boolean;
};

/** The whole check for a finished game: needs the seed, the published hash and every hand's log. */
export async function verifyGame(record: { game: { seed: string | null; seed_hash: string }; hands: readonly RecordedHand[] }): Promise<WallCheck> {
  const seed = record.game.seed;
  if (!isSeed(seed)) return { seedOk: false, computedHash: "", hands: [], ok: false };
  const computedHash = await seedHash(seed);
  const seedOk = computedHash === record.game.seed_hash;
  const hands: HandWallCheck[] = [];
  for (const hand of record.hands) {
    if (!hand.log) {
      hands.push({ index: hand.index, ok: false, problems: ["No log for this hand."] });
      continue;
    }
    const wall = await buildWall(seed, hand.index);
    const problems = checkHandAgainstWall(wall, hand.log, hand.result);
    hands.push({ index: hand.index, ok: problems.length === 0, problems });
  }
  return { seedOk, computedHash, hands, ok: seedOk && hands.every((hand) => hand.ok) };
}
