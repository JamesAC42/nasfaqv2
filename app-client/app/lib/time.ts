export function timeAgo(value: string | null | undefined, now = Date.now()) {
  if (!value) return "";
  const then = new Date(value).getTime();
  if (!Number.isFinite(then)) return "";
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function signedPct(fraction: number | null | undefined, digits = 2) {
  if (fraction === null || fraction === undefined || !Number.isFinite(fraction)) return "—";
  const pct = fraction * 100;
  if (Math.abs(pct) < 0.5 * 10 ** -digits) return `±${(0).toFixed(digits)}%`;
  return `${pct > 0 ? "+" : ""}${pct.toFixed(digits)}%`;
}

export function toneOf(fraction: number | null | undefined): "up" | "down" | "flat" {
  if (fraction === null || fraction === undefined || !Number.isFinite(fraction) || Math.abs(fraction) < 0.00005) return "flat";
  return fraction > 0 ? "up" : "down";
}

export function money(value: number | null | undefined, { compact = false } = {}) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  if (compact && Math.abs(value) >= 10_000) return `${value < 0 ? "-" : ""}$${(Math.abs(value) / 1000).toFixed(1)}k`;
  return `${value < 0 ? "-" : ""}$${Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
