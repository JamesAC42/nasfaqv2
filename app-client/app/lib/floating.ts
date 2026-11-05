// Things that float over the page (the miniplayer, the chat window): where they sit, kept inside the
// window and off what they mustn't cover. Positions are distances from the right and bottom edges,
// so they hold when the window is resized.

export const FLOAT_MARGIN = 12;

export type Offset = { right: number; bottom: number };

export function readOffset(key: string): Offset | null {
  try {
    const raw = JSON.parse(localStorage.getItem(key) ?? "null") as Partial<Offset> | null;
    return raw && Number.isFinite(raw.right) && Number.isFinite(raw.bottom) ? { right: raw.right as number, bottom: raw.bottom as number } : null;
  } catch {
    return null;
  }
}

export function saveOffset(key: string, offset: Offset) {
  try {
    localStorage.setItem(key, JSON.stringify(offset));
  } catch {
    /* storage blocked: it just won't be remembered */
  }
}

export const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/**
 * Height taken at the foot of the window (0 where nothing is there): the phone/tablet bottom nav,
 * and any fixed bar sitting on it (data-bottom-bar: the stock page's buy and sell buttons).
 */
export function bottomInset() {
  let top = window.innerHeight;
  for (const el of document.querySelectorAll<HTMLElement>("[data-bottom-nav], [data-bottom-bar]")) {
    const rect = el.getBoundingClientRect();
    if (rect.height > 0) top = Math.min(top, rect.top);
  }
  return Math.max(0, window.innerHeight - top);
}

/** A page calls this when something marked data-keep-clear (an order ticket) appears. */
export function announceKeepClear() {
  window.dispatchEvent(new Event("nasfaq:keep-clear"));
}

export function onKeepClearChange(listener: () => void) {
  window.addEventListener("nasfaq:keep-clear", listener);
  return () => window.removeEventListener("nasfaq:keep-clear", listener);
}

/**
 * Where a box's left edge goes so that it covers nothing marked data-keep-clear, moved sideways only
 * as far as it needs to. data-keep-clear="column" is a sticky column, which counts for its whole
 * width at any scroll position; anything else counts where it is right now. Tries leftwards first
 * (most of what's kept clear lives on the right of the page). Null when neither side has room.
 */
export function leftClearOfKeepOuts(left: number, top: number, width: number, height: number) {
  const zones = Array.from(document.querySelectorAll<HTMLElement>("[data-keep-clear]"))
    .map((el) => ({ rect: el.getBoundingClientRect(), column: el.dataset.keepClear === "column" }))
    .filter(({ rect }) => rect.width > 0 && rect.height > 0);
  const hitAt = (x: number) =>
    zones.find(({ rect, column }) => x < rect.right + FLOAT_MARGIN && x + width > rect.left - FLOAT_MARGIN && (column || (top < rect.bottom + FLOAT_MARGIN && top + height > rect.top - FLOAT_MARGIN)));
  for (const direction of [-1, 1]) {
    let x = left;
    for (let pass = 0; pass <= zones.length; pass += 1) {
      const hit = hitAt(x);
      if (!hit) return x;
      x = direction < 0 ? hit.rect.left - width - FLOAT_MARGIN : hit.rect.right + FLOAT_MARGIN;
      if (x < FLOAT_MARGIN || x + width > window.innerWidth - FLOAT_MARGIN) break;
    }
  }
  return null;
}
