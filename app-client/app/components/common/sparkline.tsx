import { memo, useMemo } from "react";

/**
 * Minimal SVG sparkline. Scales to its container (preserveAspectRatio none,
 * non-scaling stroke). Pass `fill` for an area under the line and `dot` to
 * mark the latest value.
 */
export const Sparkline = memo(function Sparkline({
  values,
  tone = "flat",
  width = 100,
  height = 24,
  fill = false,
  dot = false,
  className,
}: {
  values: number[];
  tone?: "up" | "down" | "flat" | "blue";
  width?: number;
  height?: number;
  fill?: boolean;
  dot?: boolean;
  className?: string;
}) {
  const geometry = useMemo(() => {
    const clean = values.filter((value) => Number.isFinite(value));
    if (clean.length < 2) return null;
    const min = Math.min(...clean);
    const max = Math.max(...clean);
    const range = max - min || 1;
    const points = clean.map((value, index) => [
      (index / (clean.length - 1)) * width,
      height - 1.5 - ((value - min) / range) * (height - 3),
    ]);
    const line = points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
    return { line, area: `0,${height} ${line} ${width},${height}`, end: points[points.length - 1] };
  }, [height, values, width]);

  if (!geometry) return <svg viewBox={`0 0 ${width} ${height}`} className={className} aria-hidden="true" />;

  const color = tone === "up" ? "var(--up)" : tone === "down" ? "var(--down)" : tone === "blue" ? "var(--blue)" : "var(--mid)";
  return (
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className={className} aria-hidden="true">
      {fill ? <polygon points={geometry.area} fill={color} opacity={0.12} /> : null}
      <polyline points={geometry.line} fill="none" stroke={color} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      {dot ? <circle cx={geometry.end[0]} cy={geometry.end[1]} r={2} fill={color} /> : null}
    </svg>
  );
});
