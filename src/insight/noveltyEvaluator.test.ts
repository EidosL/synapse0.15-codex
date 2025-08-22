import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateNovelty } from './noveltyEvaluator';
import type { GoogleGenAI } from '@google/genai';

// Helper to create a mock AI object for testing
const createMockAi = () => ({
    models: {
        generateContent: async () => ({
            response: { text: () => '' }
        })
    }
});

test('evaluateNovelty should return a numeric score from the AI', async () => {
    const mockAi = createMockAi();
    mock.method(mockAi.models, 'generateContent', async () => ({
        response: {
            text: () => '8.5'
        }
    }));

    const draft = "A highly novel insight about quantum consciousness.";
    const score = await evaluateNovelty(draft, mockAi as unknown as GoogleGenAI);

    assert.strictEqual(score, 8.5);
});

test('evaluateNovelty should handle non-numeric responses gracefully', async () => {
    const mockAi = createMockAi();
    mock.method(mockAi.models, 'generateContent', async () => ({
        response: {
            text: () => 'This is not a number.'
        }
    }));

    const draft = "A draft.";
    const score = await evaluateNovelty(draft, mockAi as unknown as GoogleGenAI);

    assert.strictEqual(score, 1.0);
});

test('evaluateNovelty should handle scores outside the 1-10 range', async () => {
    const mockAi = createMockAi();
    mock.method(mockAi.models, 'generateContent', async () => ({
        response: {
            text: () => '11'
        }
    }));

    const draft = "A draft.";
    const score = await evaluateNovelty(draft, mockAi as unknown as GoogleGenAI);

    assert.strictEqual(score, 1.0);
});

test('evaluateNovelty should return 1.0 if AI is not available', async () => {
    const score = await evaluateNovelty("some draft", null);
    assert.strictEqual(score, 1.0);
});

test('evaluateNovelty should handle AI errors gracefully', async () => {
    const mockAi = createMockAi();
    mock.method(mockAi.models, 'generateContent', async () => {
        throw new Error("AI is tired.");
    });

    const draft = "A draft.";
    const score = await evaluateNovelty(draft, mockAi as unknown as GoogleGenAI);

    assert.strictEqual(score, 1.0);
});
