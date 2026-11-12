// Mínimos quadrados ordinários, sem dependência numérica para duas variáveis.
export function summary(values: number[]) {
  if (!values.length)
    return {
      amostras: 0,
      media: null,
      mediana: null,
      desvioPadrao: null,
      maximo: null,
    };
  const sorted = [...values].sort((a, b) => a - b);
  const media = values.reduce((a, b) => a + b, 0) / values.length;
  const middle = Math.floor(sorted.length / 2);
  return {
    amostras: values.length,
    media,
    mediana:
      sorted.length % 2
        ? sorted[middle]!
        : (sorted[middle - 1]! + sorted[middle]!) / 2,
    desvioPadrao: Math.sqrt(
      values.reduce((sum, x) => sum + (x - media) ** 2, 0) / values.length,
    ),
    maximo: sorted.at(-1)!,
  };
}

export function regression(points: [number, number][]) {
  if (points.length < 3) return null;
  const xMean = points.reduce((s, [x]) => s + x, 0) / points.length;
  const yMean = points.reduce((s, [, y]) => s + y, 0) / points.length;
  const xx = points.reduce((s, [x]) => s + (x - xMean) ** 2, 0);
  if (xx === 0) return null;
  const slope =
    points.reduce((s, [x, y]) => s + (x - xMean) * (y - yMean), 0) / xx;
  const intercept = yMean - slope * xMean;
  const residual = points.reduce(
    (s, [x, y]) => s + (y - (intercept + slope * x)) ** 2,
    0,
  );
  const total = points.reduce((s, [, y]) => s + (y - yMean) ** 2, 0);
  return {
    slope,
    intercept,
    r2: total === 0 ? null : Math.max(0, 1 - residual / total),
  };
}

export function groupBy<T>(items: T[], key: (item: T) => string) {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const group = groups.get(k) ?? [];
    group.push(item);
    groups.set(k, group);
  }
  return [...groups.entries()];
}
