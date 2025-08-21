export function hasConsensus(messages: string[]): boolean {
  // toy rule: if last N messages include 3 ACCEPT markers
  const trail = messages.slice(-10).join("\n");
  const m = trail.match(/\bACCEPT\b/g);
  return !!m && m.length >= 3;
}
