"use client";

import { memo } from "react";
import type { CandlePoint, MarketLiveOrderFlowPoint } from "@/app/lib/types";
import styles from "@/app/components/market/mini-charts.module.scss";

/** Buy bars up, sell bars down, from a live-order flow series. `cursor` (0-1) marks "now". */
export const FlowBars = memo(function FlowBars({ points, cursor }: { points: MarketLiveOrderFlowPoint[]; cursor?: number | null }) {
  const W = 400;
  const H = 180;
  const mid = H / 2;
  const n = Math.max(points.length, 1);
  const max = Math.max(1, ...points.map((point) => Math.max(point.buy_quantity, point.sell_quantity)));
  const bw = W / n;
  return (
    <svg className={styles.chart} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
      <line x1="0" x2={W} y1={mid} y2={mid} className={styles.axis} />
      {points.map((point, index) => {
        const hb = (point.buy_quantity / max) * (mid - 6);
        const hs = (point.sell_quantity / max) * (mid - 6);
        const x = index * bw + bw * 0.12;
        const w = Math.max(1, bw * 0.76);
        return (
          <g key={point.bucket || index}>
            {hb > 0 ? <rect x={x} y={mid - hb} width={w} height={hb} className={styles.buy} /> : null}
            {hs > 0 ? <rect x={x} y={mid + 1} width={w} height={hs} className={styles.sell} /> : null}
          </g>
        );
      })}
      {cursor !== null && cursor !== undefined ? <line x1={cursor * W} x2={cursor * W} y1="0" y2={H} className={styles.cursor} /> : null}
    </svg>
  );
});

/** Plain OHLC candles. */
export const MiniCandles = memo(function MiniCandles({ candles }: { candles: CandlePoint[] }) {
  const W = 400;
  const H = 180;
  const clean = candles.filter((candle) => candle.open !== null && candle.close !== null);
  if (clean.length < 2) return <div className={styles.empty}>Not enough trading yet.</div>;
  const lows = clean.map((candle) => candle.low ?? Math.min(candle.open!, candle.close!));
  const highs = clean.map((candle) => candle.high ?? Math.max(candle.open!, candle.close!));
  const min = Math.min(...lows);
  const max = Math.max(...highs);
  const range = max - min || 1;
  const y = (value: number) => 6 + (1 - (value - min) / range) * (H - 12);
  const bw = W / clean.length;
  return (
    <div className={styles.wrap}>
      <svg className={styles.chart} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
        {clean.map((candle, index) => {
          const up = candle.close! >= candle.open!;
          const x = index * bw + bw / 2;
          const top = y(Math.max(candle.open!, candle.close!));
          const bottom = y(Math.min(candle.open!, candle.close!));
          return (
            <g key={candle.bucket || index} className={up ? styles.buy : styles.sell}>
              <line x1={x} x2={x} y1={y(highs[index])} y2={y(lows[index])} className={styles.wick} />
              <rect x={x - bw * 0.32} y={top} width={bw * 0.64} height={Math.max(1, bottom - top)} />
            </g>
          );
        })}
      </svg>
      <span className={styles.hi}>{max.toFixed(2)}</span>
      <span className={styles.lo}>{min.toFixed(2)}</span>
    </div>
  );
});
