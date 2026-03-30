const nf = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const intf = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

export function fmtNumber(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return nf.format(value);
}

export function fmtInteger(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return intf.format(value);
}

export function fmtPct(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${(value * 100).toFixed(2)}%`;
}

export function fmtDate(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

export function fmtDurationSeconds(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value) || value < 0) return "—";
  const whole = Math.floor(value);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const seconds = whole % 60;
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
}

export function toNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
