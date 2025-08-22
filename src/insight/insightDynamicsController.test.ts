import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InsightDynamicsController } from './insightDynamicsController';

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
  // delta_s = 0.5 -> transit zone, small progression
  controller.update(0.5);

  assert.strictEqual(controller.zone, 'transit', 'Zone should be transit for delta_s=0.5');
  assert.strictEqual(controller.memoryAction, null, 'Memory action should be null for delta_s=0.5');
  assert(controller.W_c > 0, 'W_c should be positive');
  assert.strictEqual(controller.lambda_observe, 'chaotic', 'Lambda should be chaotic for first step with large delta');
});

test('Progression guard allows bridging correctly', (t) => {
  const controller = new InsightDynamicsController();

  // Step 1: High tension
  controller.update(0.7); // risk zone
  assert.strictEqual(controller.isBridgeAllowed(), false, 'Bridge should not be allowed on first step');

  // Step 2: Tension decreases significantly
  controller.update(0.3); // safe zone
  assert.strictEqual(controller.isBridgeAllowed(), true, 'Bridge should be allowed when delta_s decreases');
});

test('Progression guard blocks bridging when tension increases', (t) => {
  const controller = new InsightDynamicsController();

  controller.update(0.3);
  assert.strictEqual(controller.isBridgeAllowed(), false, 'Bridge not allowed on first step');

  controller.update(0.7);
  assert.strictEqual(controller.isBridgeAllowed(), false, 'Bridge should be blocked when delta_s increases');
});

test('Memory action triggers correctly', (t) => {
  const controller = new InsightDynamicsController();

  controller.update(0.8); // risk zone
  assert.strictEqual(controller.memoryAction, 'record(hard)', 'Should trigger hard record for high delta_s');

  controller.update(0.2); // safe zone
  assert.strictEqual(controller.memoryAction, 'record(exemplar)', 'Should trigger exemplar record for low delta_s');

  controller.update(0.5); // transit zone
  assert.strictEqual(controller.memoryAction, null, 'Should have no memory action for transit delta_s');
});

test('Lambda observe state transitions', (t) => {
  const controller = new InsightDynamicsController();

  // Convergent
  controller.update(0.5);
  controller.update(0.4);
  controller.update(0.3);
  assert.strictEqual(controller.lambda_observe, 'convergent');

  // Recursive
  controller.update(0.3);
  controller.update(0.301);
  controller.update(0.302);
  assert.strictEqual(controller.lambda_observe, 'recursive');

  // Chaotic
  controller.update(0.8);
  assert.strictEqual(controller.lambda_observe, 'chaotic');
});

test('BBAM alpha_blend calculation', (t) => {
  const controller = new InsightDynamicsController();
  // With W_c=0, alpha_blend should be 0.5
  assert.strictEqual(controller.alpha_blend, 0.5);

  // With positive W_c, alpha_blend should increase
  controller.update(0.7); // This will make W_c positive
  assert(controller.alpha_blend > 0.5, 'alpha_blend should increase with positive W_c');

  // With negative W_c, alpha_blend should decrease
  // This requires an anchor flip to make Phi negative.
  controller.update(0.1, 0.1); // Pass anchor_delta > h_anchor to flip alt to -1

  // Trace: delta_s_now=0.1, delta_s_prev=0.7. prog=0.6, P=0.6.
  // Phi = -0.15. W_c = 0.1*0.6 - 0.15 = -0.09. W_c is negative.
  // tanh(W_c) is negative, so alpha_blend should be < 0.5.
  assert(controller.W_c < 0, 'W_c should be negative after anchor flip');
  assert(controller.alpha_blend < 0.5, 'alpha_blend should decrease with negative W_c');
});
