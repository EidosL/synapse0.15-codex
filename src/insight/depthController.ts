import type { Budget } from './budget';
import type { Signals } from './signals';
import { shouldEscalate } from './signals';

/**
 * Decide whether another retrieval cycle should be executed.
 *
 * @param currentDepth - 1-indexed depth of the current retrieval loop
 * @param signals - heuristic signals derived from the current results
 * @param budget - budget configuration for the current tier
 * @returns true if probing should continue, false to stop
 */
export function shouldDeepen(
  currentDepth: number,
  signals: Signals,
  budget: Budget
): boolean {
  // Stop if we've exhausted the allowed depth.
  if (currentDepth >= budget.maxCycles) return false;

  // Estimate cost of going deeper: assume one more LLM call and payload
  // proportional to accumulated context.
  const estTokens = budget.contextCapChars * currentDepth;
  const estCalls = currentDepth;

  return shouldEscalate(signals, estTokens, estCalls);
}

