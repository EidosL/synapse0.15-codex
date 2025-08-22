export function clip(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

export function rollingMean(values: number[]): number {
  if (values.length === 0) return 0;
  const sum = values.reduce((a, b) => a + b, 0);
  return sum / values.length;
}
