// A signed-out visitor's practice table is theirs through a seat token alone (POST /guest hands it
// out). Kept per table id in sessionStorage, so it goes with the tab and nothing else.

const KEY = "nasfaq.mahjong.seats";

function read(): Record<string, string> {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

export function getSeatToken(tableId: number | string): string | null {
  if (typeof window === "undefined") return null;
  const token = read()[String(tableId)];
  return typeof token === "string" && /^[0-9a-f]{32}$/.test(token) ? token : null;
}

export function saveSeatToken(tableId: number | string, token: string) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify({ ...read(), [String(tableId)]: token }));
  } catch {
    // Private window or blocked storage: the guest just can't come back to this table.
  }
}

export function forgetSeatToken(tableId: number | string) {
  if (typeof window === "undefined") return;
  try {
    const all = read();
    delete all[String(tableId)];
    window.sessionStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // ignore
  }
}

/** The header to add to a call about this table, if the visitor holds a seat token for it. */
export function seatHeaders(tableId: number | string): Record<string, string> {
  const token = getSeatToken(tableId);
  return token ? { "X-Mahjong-Seat": token } : {};
}
