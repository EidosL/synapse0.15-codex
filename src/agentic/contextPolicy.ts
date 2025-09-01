import { countTokens } from './tokenizer';

export function clampTranscript(transcript: string[], maxTokens: number): string[] {
  const result: string[] = [];
  let total = 0;
  for (let i = transcript.length - 1; i >= 0; i--) {
    const entry = transcript[i];
    const tokens = countTokens(entry);
    if (total + tokens > maxTokens) break;
    total += tokens;
    result.unshift(entry);
  }
  return result;
}
