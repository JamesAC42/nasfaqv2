export type Rank = { label: string; rank: number | null; of: number; value: string };

/** 2.79M, 1194.4M, 41.2k: compact counts for channel stats. */
export const fmtBig = (value: number | null | undefined) => {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(value / 1e6).toFixed(abs >= 1e8 ? 1 : 2)}M`;
  if (abs >= 1e4) return `${(value / 1e3).toFixed(1)}k`;
  return Math.round(value).toLocaleString("en-US");
};

export const yen = (value: number | null | undefined) => (value === null || value === undefined ? "—" : `¥${fmtBig(value)}`);
