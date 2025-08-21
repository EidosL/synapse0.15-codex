// Stub interface so you can plug ONNX / TFJS later.
// For now, return input order.
export type Pair = { query: string; text: string; meta?: any };
export async function rerankLocal(pairs: Pair[], topN: number) {
  return pairs.slice(0, topN).map((p, i) => ({ ...p, score: 1 - i/(topN+1) }));
}
