// Shape checks for the Learn pages' hand lab: is a 14-tile closed hand a complete shape, how does it
// split, and what does a 13-tile hand wait on. It mirrors the server's own checks (shanten.js waitsOf,
// agari.js decompose): four sets and a pair, seven different pairs, or thirteen orphans; a tile the
// hand already holds all four of is never a wait. Shape only: whether a hand also has a yaku is the
// scorer's business, so the Learn pages say "completes the shape", never "wins".

import { KINDS, YAOCHUU_KINDS, type TileKind } from "@/app/lib/games/mahjong/tiles";

export type ShapeGroup = { type: "run" | "triplet" | "pair"; kind: TileKind };
export type Shape = { form: "standard" | "pairs" | "orphans"; groups: ShapeGroup[] };

const isSuited = (kind: TileKind) => kind < 27;

/** Every way 3n+2 tiles split into sets and one pair (the first found is enough to show). */
function standard(counts: number[]): ShapeGroup[] | null {
  const sets: ShapeGroup[] = [];
  const walk = (start: number): boolean => {
    let i = start;
    while (i < KINDS && counts[i] === 0) i += 1;
    if (i >= KINDS) return true;
    if (counts[i] >= 3) {
      counts[i] -= 3;
      sets.push({ type: "triplet", kind: i });
      if (walk(i)) {
        counts[i] += 3;
        return true;
      }
      sets.pop();
      counts[i] += 3;
    }
    if (isSuited(i) && i % 9 <= 6 && counts[i + 1] > 0 && counts[i + 2] > 0) {
      counts[i] -= 1;
      counts[i + 1] -= 1;
      counts[i + 2] -= 1;
      sets.push({ type: "run", kind: i });
      const ok = walk(i);
      counts[i] += 1;
      counts[i + 1] += 1;
      counts[i + 2] += 1;
      if (ok) return true;
      sets.pop();
    }
    return false;
  };
  for (let pair = 0; pair < KINDS; pair += 1) {
    if (counts[pair] < 2) continue;
    counts[pair] -= 2;
    sets.length = 0;
    const ok = walk(0);
    counts[pair] += 2;
    if (ok) return [...sets, { type: "pair" as const, kind: pair }].sort((a, b) => a.kind - b.kind || order(a) - order(b));
  }
  return null;
}

const order = (group: ShapeGroup) => (group.type === "pair" ? 1 : 0);

/** How a 14-tile closed hand reads as a complete shape, or null if it doesn't. */
export function readShape(counts: readonly number[]): Shape | null {
  const total = counts.reduce((sum, count) => sum + count, 0);
  if (total !== 14) return null;
  const copy = [...counts];
  const groups = standard(copy);
  if (groups) return { form: "standard", groups };
  const pairs = counts.map((count, kind) => (count === 2 ? kind : -1)).filter((kind) => kind >= 0);
  if (pairs.length === 7) return { form: "pairs", groups: pairs.map((kind) => ({ type: "pair", kind })) };
  if (YAOCHUU_KINDS.every((kind) => counts[kind] >= 1) && YAOCHUU_KINDS.some((kind) => counts[kind] === 2) && YAOCHUU_KINDS.reduce((sum, kind) => sum + counts[kind], 0) === 14) {
    return { form: "orphans", groups: [] };
  }
  return null;
}

/** The kinds that complete a 13-tile closed hand's shape. Empty when it isn't ready. */
export function waitsOf(counts: readonly number[]): TileKind[] {
  const total = counts.reduce((sum, count) => sum + count, 0);
  if (total !== 13) return [];
  const waits: TileKind[] = [];
  const copy = [...counts];
  for (let kind = 0; kind < KINDS; kind += 1) {
    if (copy[kind] >= 4) continue;
    copy[kind] += 1;
    if (readShape(copy)) waits.push(kind);
    copy[kind] -= 1;
  }
  return waits;
}

/** The tiles in a group, as kinds: a run's three, a triplet's three, a pair's two. */
export const groupKinds = (group: ShapeGroup): TileKind[] =>
  group.type === "run" ? [group.kind, group.kind + 1, group.kind + 2] : group.type === "triplet" ? [group.kind, group.kind, group.kind] : [group.kind, group.kind];
