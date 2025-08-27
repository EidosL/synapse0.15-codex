import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateNovelty } from './noveltyEvaluator';

test('evaluateNovelty', async (t) => {
  await t.test('should return a numeric score from the AI', async () => {
    const draft = 'A highly novel insight about quantum consciousness.';
    const score = await evaluateNovelty(draft, async () => ({
      choices: [{ message: { content: '8.5' } }]
    } as any));
    assert.strictEqual(score, 8.5);
  });

  await t.test('should handle non-numeric responses gracefully', async () => {
    const draft = 'A draft.';
    const score = await evaluateNovelty(draft, async () => ({
      choices: [{ message: { content: 'This is not a number.' } }]
    } as any));
    assert.strictEqual(score, 1.0);
  });

  await t.test('should handle scores outside the 1-10 range', async () => {
    const draft = 'A draft.';
    const score = await evaluateNovelty(draft, async () => ({
      choices: [{ message: { content: '11' } }]
    } as any));
    assert.strictEqual(score, 1.0);
  });

  await t.test('should handle AI errors gracefully', async () => {
    const draft = 'A draft.';
    const score = await evaluateNovelty(draft, async () => {
      throw new Error('AI is tired.');
    });
    assert.strictEqual(score, 1.0);
  });
});
