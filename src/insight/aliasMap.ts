// Offline you can populate this map from your corpus.
export type AliasMap = Record<string, string>;
export const CANON: AliasMap = {
  "llm": "large language model",
  "foundation model": "large language model",
  "latency": "latency",
  "through-put": "throughput",
  // ...
};

export const canonicalize = (s:string) => {
  const tokens = s.toLowerCase().split(/\W+/).filter(Boolean);
  return tokens.map(t => CANON[t] ?? t);
};
