import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { verifyCandidates } from './verifier';
import { searchWeb } from '../agentic/adapters/searchWeb';

test('verifyCandidates should return supported for affirming snippets', async () => {
    mock.method(searchWeb, 'search', async (query: string, k: number) => {
        return [{
            title: 'Example',
            url: 'http://example.com',
            snippet: 'This snippet strongly affirms the candidate text.'
        }];
    });

    const candidates = [{ text: 'candidate text' }];
    const verdicts = await verifyCandidates('test question', candidates);

    assert.strictEqual(verdicts.length, 1);
    assert.strictEqual(verdicts[0].verdict, 'supported');
    assert.strictEqual(verdicts[0].citations.length, 1);
    assert.strictEqual(verdicts[0].citations[0].url, 'http://example.com');
});

test('verifyCandidates should return uncertain for neutral snippets', async () => {
    mock.method(searchWeb, 'search', async (query: string, k: number) => {
        return [{
            title: 'Example',
            url: 'http://example.com',
            snippet: 'This snippet is about something else entirely.'
        }];
    });

    const candidates = [{ text: 'candidate text' }];
    const verdicts = await verifyCandidates('test question', candidates);

    assert.strictEqual(verdicts.length, 1);
    assert.strictEqual(verdicts[0].verdict, 'uncertain');
});

test('verifyCandidates should return refuted when no results are found', async () => {
    mock.method(searchWeb, 'search', async (query: string, k: number) => {
        return [];
    });

    const candidates = [{ text: 'candidate text' }];
    const verdicts = await verifyCandidates('test question', candidates);

    assert.strictEqual(verdicts.length, 1);
    assert.strictEqual(verdicts[0].verdict, 'refuted');
});
