import { get_encoding, Tiktoken } from '@dqbd/tiktoken';

let encoder: Tiktoken | null = null;

function getEncoder(): Tiktoken {
  if (!encoder) {
    encoder = get_encoding('cl100k_base');
  }
  return encoder;
}

export function countTokens(text: string): number {
  return getEncoder().encode(text).length;
}
