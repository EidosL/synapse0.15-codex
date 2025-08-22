import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { generateDivergentQuestion } from './questionGenerator';
import type { GoogleGenAI } from '@google/genai';

// Helper to create a mock AI object for testing
const createMockAi = () => ({
    models: {
        generateContent: async () => ({
            response: { text: () => '' }
        })
    }
});

test('generateDivergentQuestion should return a question from the AI', async () => {
    const mockAi = createMockAi();
    mock.method(mockAi.models, 'generateContent', async () => ({
        response: {
            text: () => 'What if we applied principles of mycelial networks to data routing?'
        }
    }));

    const draft = "This paper discusses data routing protocols for mesh networks.";
    const question = await generateDivergentQuestion(draft, 'en', mockAi as unknown as GoogleGenAI);

    assert.strictEqual(question, 'What if we applied principles of mycelial networks to data routing?');
});

test('generateDivergentQuestion should return null if AI is not available', async () => {
    const question = await generateDivergentQuestion("some draft", 'en', null);
    assert.strictEqual(question, null);
});

test('generateDivergentQuestion should handle AI errors gracefully', async () => {
    const mockAi = createMockAi();
    mock.method(mockAi.models, 'generateContent', async () => {
        throw new Error("AI apocalypse!");
    });

    const draft = "This paper discusses data routing protocols for mesh networks.";
    const question = await generateDivergentQuestion(draft, 'en', mockAi as unknown as GoogleGenAI);

    assert.strictEqual(question, null);
});
