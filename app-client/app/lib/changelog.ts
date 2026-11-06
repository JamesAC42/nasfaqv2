// What's new, for players: the /changelog page (and the refresh notice links to it). Newest first.
//
// Each entry is its own JSON file in app/changelog/entries/ (its README has the rules), so PRs that
// add entries never touch the same file and never conflict. Only bigger, player-visible features get
// an entry; small fixes don't.
//
// Server-only: it reads the folder with fs. The /changelog page is static, so this runs during
// `next build`, and a file that's misnamed or malformed fails the build (CI runs it on every PR).

import fs from "node:fs";
import path from "node:path";

export type ChangeKind = "new" | "improved" | "fixed";

export type ChangelogEntry = {
  /** The day it went out (ET), ISO. */
  date: string;
  title: string;
  changes: Array<{ kind: ChangeKind; text: string }>;
};

const ENTRIES_DIR = path.join(process.cwd(), "app", "changelog", "entries");
// YYYY-MM-DD-HHMM-slug.json: the date and ET time it was written, then a short name.
const FILE_NAME = /^(\d{4}-\d{2}-\d{2})-(\d{4})-[a-z0-9]+(?:-[a-z0-9]+)*\.json$/;
const KINDS: ReadonlySet<string> = new Set<ChangeKind>(["new", "improved", "fixed"]);

function readEntry(file: string): ChangelogEntry {
  const match = FILE_NAME.exec(file);
  if (!match) throw new Error(`changelog: ${file} should be named YYYY-MM-DD-HHMM-short-name.json`);
  const fail = (why: string): never => {
    throw new Error(`changelog: ${file}: ${why}`);
  };
  let data: unknown;
  try {
    data = JSON.parse(fs.readFileSync(path.join(ENTRIES_DIR, file), "utf8"));
  } catch (error) {
    return fail(`not valid JSON (${(error as Error).message})`);
  }
  const { title, changes, ...rest } = (data ?? {}) as Record<string, unknown>;
  if (Object.keys(rest).length) fail(`unexpected keys: ${Object.keys(rest).join(", ")}`);
  if (typeof title !== "string" || !title.trim()) fail("needs a title");
  if (!Array.isArray(changes) || changes.length === 0) fail("needs at least one change");
  for (const change of changes as unknown[]) {
    const { kind, text } = (change ?? {}) as Record<string, unknown>;
    if (typeof kind !== "string" || !KINDS.has(kind)) fail(`each change's kind is "new", "improved" or "fixed"`);
    if (typeof text !== "string" || !text.trim()) fail("each change needs text");
  }
  return { date: match[1], title: title as string, changes: changes as ChangelogEntry["changes"] };
}

export const CHANGELOG: ChangelogEntry[] = fs
  .readdirSync(ENTRIES_DIR)
  .filter((file) => file.endsWith(".json"))
  .sort()
  .reverse()
  .map(readEntry);
