import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldDeepen } from './depthController';
import { policyFor } from './budget';
import type { Signals } from './signals';

test('does not exceed max depth', () => {
  const budget = policyFor('pro');
  const signals: Signals = { seedCoverage: 0.5, novelty: 0.5, rerankMargin: 0.5, entropy: 0.5 };
  assert.equal(shouldDeepen(budget.maxCycles, signals, budget), false);
});

test('early exit when benefit low', () => {
  const budget = policyFor('pro');
  const signals: Signals = { seedCoverage: 0, novelty: 0, rerankMargin: 0, entropy: 1 };
  assert.equal(shouldDeepen(1, signals, budget), false);
});

