// Pure point-scaling for a hairline net-worth sparkline. Maps a series of
// values to an SVG `points` string, oldest→newest, left→right, top = highest.
// Returns null when there are fewer than two points (no line to draw). A flat
// series (max === min) is centred vertically rather than pinned to an edge.

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

export function sparklinePoints(
  values: number[],
  opts: { width: number; height: number; pad?: number },
): string | null {
  if (values.length < 2) return null;
  const { width, height } = opts;
  const pad = opts.pad ?? 2;
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;
  const step = innerW / (values.length - 1);
  return values
    .map((value, index) => {
      const x = pad + index * step;
      const y =
        range === 0
          ? height / 2
          : pad + innerH * (1 - (value - min) / range);
      return `${round(x)},${round(y)}`;
    })
    .join(" ");
}
