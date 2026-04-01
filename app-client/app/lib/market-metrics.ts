import type { CandlePoint } from "@/app/lib/types";

function sortCandles(candles: CandlePoint[]) {
  return [...candles].sort((a, b) => String(a.bucket).localeCompare(String(b.bucket)));
}

export function getCandleClose(point: CandlePoint) {
  return point.close_mark ?? point.close;
}

export function computeDailyPriceChangePct(currentPrice: number | null, candles: CandlePoint[]) {
  const validCandles = sortCandles(candles).filter((point) => getCandleClose(point) !== null);
  if (validCandles.length < 2) return null;

  const previousClose = getCandleClose(validCandles[validCandles.length - 2]);
  const latestClose = currentPrice ?? getCandleClose(validCandles[validCandles.length - 1]);

  if (previousClose === null || latestClose === null || previousClose === 0) return null;
  return (latestClose - previousClose) / previousClose;
}

export function computeDailyVolumeChange(currentVolume: number | null, candles: CandlePoint[]) {
  const validCandles = sortCandles(candles).filter((point) => point.volume_shares !== null && point.volume_shares !== undefined);
  if (validCandles.length < 2) return { absolute: null, pct: null };

  const previousVolume = validCandles[validCandles.length - 2]?.volume_shares ?? null;
  const latestVolume = currentVolume ?? validCandles[validCandles.length - 1]?.volume_shares ?? null;

  if (previousVolume === null || latestVolume === null) {
    return { absolute: null, pct: null };
  }

  return {
    absolute: latestVolume - previousVolume,
    pct: previousVolume === 0 ? null : (latestVolume - previousVolume) / previousVolume,
  };
}
