import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DepthController } from './depthController';
import { policyFor, type Budget } from './budget';
import type { Signals } from './signals';

const mockSignals = (overrides: Partial<Signals> = {}): Signals => ({
  sim_entities: 0.5,
  sim_relations: 0.5,
  sim_constraints: 0.5,
  entropy: 0.5,
  ...overrides,
});

test('DepthController does not exceed max depth', () => {
  const budget = policyFor('pro'); // maxCycles is likely > 1
  const controller = new DepthController(budget);

  // Create signals that would normally allow deepening
  const signals = mockSignals({ sim_entities: 0.1, sim_relations: 0.1, sim_constraints: 0.1 }); // high delta_s

  // Simulate deepening until the budget is exhausted
  let canDeepen = true;
  for (let i = 0; i < budget.maxCycles; i++) {
    canDeepen = controller.shouldDeepen(signals);
    // The bridge is not always allowed, so we can't assert true here.
    // The important part is the final check.
  }

  const finalDeepen = controller.shouldDeepen(signals);
  assert.strictEqual(finalDeepen, false, 'shouldDeepen must return false when maxCycles is reached');
});

test('DepthController follows WFGY bridging logic', () => {
  const budget = policyFor('pro');
  const controller = new DepthController(budget);

  // Step 1: High tension. shouldDeepen will update the controller, but isBridgeAllowed will be false.
  const highTensionSignals = mockSignals({ sim_entities: 0.1, sim_relations: 0.2, sim_constraints: 0.1 }); // delta_s = 0.86
  assert.strictEqual(controller.shouldDeepen(highTensionSignals), false, 'shouldDeepen should be false on the first step');

  // Step 2: Tension decreases. Now isBridgeAllowed should be true.
  const lowTensionSignals = mockSignals({ sim_entities: 0.8, sim_relations: 0.9, sim_constraints: 0.7 }); // delta_s = 0.16
  assert.strictEqual(controller.shouldDeepen(lowTensionSignals), true, 'shouldDeepen should be true when tension decreases');

  // Step 3: Tension increases again. isBridgeAllowed should be false.
  assert.strictEqual(controller.shouldDeepen(highTensionSignals), false, 'shouldDeepen should be false when tension increases');
});
