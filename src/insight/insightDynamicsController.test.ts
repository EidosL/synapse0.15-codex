import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InsightDynamicsController } from './insightDynamicsController';
import type { Signals } from './signals';

// Helper to create mock signals
const mockSignals = (overrides: Partial<Signals> = {}): Signals => ({
  sim_entities: 0.5,
  sim_relations: 0.2, // novelty
  sim_constraints: 0.5,
  entropy: 0.3,
  ...overrides,
});

test('InsightDynamicsController initializes with correct defaults', (t) => {
  const controller = new InsightDynamicsController();
  assert.strictEqual(controller.W_c, 0, 'Initial W_c should be 0');
  assert.strictEqual(controller.alpha_blend, 0.5, 'Initial alpha_blend should be 0.5');
  assert.strictEqual(controller.lambda_observe, 'recursive', 'Initial lambda_observe should be recursive');
  assert.strictEqual(controller.zone, 'safe', 'Initial zone should be safe');
  assert.strictEqual(controller.memoryAction, null, 'Initial memoryAction should be null');
});

test('InsightDynamicsController updates state correctly', (t) => {
  const controller = new InsightDynamicsController();
  controller.update(0.5, mockSignals(), 0);
  assert.strictEqual(controller.zone, 'transit', 'Zone should be transit for delta_s=0.5');
  assert.strictEqual(controller.memoryAction, null, 'Memory action should be null for delta_s=0.5');
  assert(controller.W_c > 0, 'W_c should be positive');
  assert.strictEqual(controller.lambda_observe, 'recursive', 'Lambda should be recursive for first step');
});

test('Progression guard allows bridging correctly', (t) => {
  const controller = new InsightDynamicsController();
  controller.update(0.3, mockSignals(), 0);
  assert.strictEqual(controller.isBridgeAllowed(), false, 'Bridge should not be allowed on first step');

  const signals = mockSignals({ sim_constraints: 0.4, entropy: 0.2 });
  controller.update(0.6, signals, 0.3);
  assert.strictEqual(controller.lambda_observe, 'recursive', 'Lambda should be recursive for digging');
  assert.strictEqual(controller.isBridgeAllowed(), true, 'Bridge should be allowed when in recursive state after t>1');
});

test('Progression guard blocks bridging when tension increases', (t) => {
  const controller = new InsightDynamicsController();
  controller.update(0.7, mockSignals(), 0);
  assert.strictEqual(controller.isBridgeAllowed(), false, 'Bridge not allowed on first step');
  controller.update(0.3, mockSignals({ entropy: 0.8 }), 0.7);
  assert.strictEqual(controller.lambda_observe, 'chaotic', 'Lambda should be chaotic when tension increases');
  assert.strictEqual(controller.isBridgeAllowed(), false, 'Bridge should be blocked when lambda is chaotic');
});

test('Memory action triggers correctly', (t) => {
  let controller = new InsightDynamicsController();
  controller.update(0.2, mockSignals({ entropy: 0.8 }), 0.8);
  assert.strictEqual(controller.lambda_observe, 'chaotic', 'Lambda should be chaotic');
  assert.strictEqual(controller.memoryAction, 'record(hard)', 'Should trigger hard record for chaotic lambda');

  controller = new InsightDynamicsController();
  const signals = mockSignals({ sim_constraints: 0.9, entropy: 0.1 });
  controller.update(0.8, signals, 0.7);
  controller.update(0.9, signals, 0.8);
  assert.strictEqual(controller.lambda_observe, 'convergent', 'Lambda should be convergent for Eureka');
  assert.strictEqual(controller.memoryAction, 'record(exemplar)', 'Should trigger exemplar record for eureka');
});

test('Lambda observe state transitions', (t) => {
  // Convergent (Eureka)
  let controller = new InsightDynamicsController();
  const eurekaSignals = mockSignals({ sim_constraints: 0.9, entropy: 0.1 });
  controller.update(0.8, eurekaSignals, 0.7); // prime it
  controller.update(0.9, eurekaSignals, 0.8);
  assert.strictEqual(controller.lambda_observe, 'convergent');

  // Recursive (Digging) - achieved by default when no other state is met and delta_s decreases
  controller = new InsightDynamicsController();
  const diggingSignals = mockSignals({ sim_constraints: 0.1, entropy: 0.1 });
  controller.update(0.5, diggingSignals, 0.4); // prime it
  controller.update(0.6, diggingSignals, 0.5);
  assert.strictEqual(controller.lambda_observe, 'recursive');

  // Divergent (Serendipity)
  controller = new InsightDynamicsController();
  const serendipitySignals = mockSignals({ sim_relations: 0.9, sim_entities: 0.9 });
  controller.update(0.5, serendipitySignals, 0.1); // prime
  controller.update(0.9, serendipitySignals, 0.05); // big jump in sim to get high gain
  assert.strictEqual(controller.lambda_observe, 'divergent');

  // Chaotic (Reset)
  controller = new InsightDynamicsController();
  controller.update(0.7, mockSignals(), 0.6); // prime
  controller.update(0.3, mockSignals({ entropy: 0.8 }), 0.7);
  assert.strictEqual(controller.lambda_observe, 'chaotic');
});
