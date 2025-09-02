
import OpenAI from 'openai';
// Frontend no longer calls Google SDK directly; all LLM/embeddings go via backend
import type { Dispatch, SetStateAction } from 'react';
import type { Note, Insight, InsightThinkingProcess, ParentChunk, SearchDepth, Hypothesis, EurekaMarkers, SerendipityInfo } from './types';
import type { VectorStore } from './vectorStore';
import type { Language, translations } from '../context/LanguageProvider';
import { type Tier, policyFor, deriveBudget, Budget } from '../insight/budget';
import { pickEvidenceSubmodular, type Frag } from '../insight/evidencePicker';
import { capFragmentsByBudget, estTokens } from '../insight/tokenGovernor';
import { counterInsightCheck } from '../insight/counterInsight';
import { computeSignals } from '../insight/signals';
import { shouldDeepen } from '../insight/depthController';
import { logMetrics } from '../insight/logging';
import { rerankLocal } from '../insight/reranker';
import { maybeAutoDeepen } from '../agentic/autoController';
import { WebSearchAdapter } from '../agentic/webSearchAdapter';
import { mindMapTool } from '../agentic/mindMapService';

const searchWeb = new WebSearchAdapter();
import { verifyCandidates } from '../insight/verifier';
import { useStore } from './store';
import { useLogStore } from './logStore';
import type { ToolResult } from '../agentic/types';
import { generateDivergentQuestion } from '../insight/questionGenerator';
import { evaluateNovelty } from '../insight/noveltyEvaluator';


// --- API & AI ---
export const MODEL_NAME = 'gemini-2.5-flash';
export const EMBEDDING_MODEL_NAME = 'text-embedding-004';
const ENABLE_LOCAL_RERANK = process.env.ENABLE_LOCAL_RERANK === '1';

// Vercel AI Gateway client
let gateway: OpenAI | null = null;
if (process.env.VERCEL_AI_GATEWAY_TOKEN) {
    gateway = new OpenAI({
        apiKey: process.env.VERCEL_AI_GATEWAY_TOKEN,
        baseURL: process.env.VERCEL_AI_GATEWAY_URL,
    });
} else {
    console.error('VERCEL_AI_GATEWAY_TOKEN environment variable not set. LLM routing disabled.');
}

// No direct client; use backend route for LLM & embeddings
export const ai = null as any;

export async function routeLlmCall(
    taskName: string,
    messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
    options: Partial<OpenAI.Chat.Completions.ChatCompletionCreateParams> = {}
) {
    // Route via backend API to centralize task→model mapping and provider usage
    const resp = await fetch('/api/llm/route', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskName, messages, options })
    });
    if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`LLM route failed: ${resp.status} ${text}`);
    }
    return await resp.json();
}

// Stream tokens from backend SSE and return the final text
export async function routeLlmStream(
    taskName: string,
    messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
    options: Partial<OpenAI.Chat.Completions.ChatCompletionCreateParams> = {},
    onToken?: (t: string) => void
): Promise<string> {
    const resp = await fetch('/api/llm/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskName, messages, options })
    });
    if (!resp.ok || !resp.body) {
        const text = await resp.text().catch(()=> '');
        throw new Error(`LLM stream failed: ${resp.status} ${text}`);
    }
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let finalText = '';
    for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        // Parse SSE lines
        let idx;
        while ((idx = buf.indexOf('\n\n')) !== -1) {
            const chunk = buf.slice(0, idx).trim();
            buf = buf.slice(idx + 2);
            if (!chunk) continue;
            // Support both comment lines and data lines
            const lines = chunk.split('\n');
            for (const ln of lines) {
                if (ln.startsWith('data:')) {
                    const payload = ln.slice(5).trim();
                    try {
                        const obj = JSON.parse(payload);
                        if (obj.token) {
                            finalText += obj.token;
                            onToken?.(obj.token);
                        } else if (obj.done) {
                            if (typeof obj.text === 'string') finalText = obj.text;
                        }
                    } catch {
                        // ignore JSON parse errors for safety
                    }
                }
            }
        }
    }
    return finalText;
}

export const safeParseGeminiJson = <T,>(text: string): T | null => {
    const jsonText = text.trim();
    if (!jsonText || jsonText.toLowerCase() === 'null') return null;

    try {
        // Standard parsing
        return JSON.parse(jsonText) as T;
    } catch (error) {
        console.warn("Initial JSON parsing failed. Attempting to repair common LLM errors.", error);
        try {
            // Attempt to fix common LLM error of unescaped backslashes in strings
            const repairedJsonText = jsonText.replace(/\\(?![bfnrt"\\/])/g, '\\\\');
            return JSON.parse(repairedJsonText) as T;
        } catch (repairError) {
            console.error("Failed to parse Gemini JSON response, even after repair attempt:", repairError);
            console.error("Original text:", text);
            return null;
        }
    }
};

export const semanticChunker = async (text: string, title: string = '', language: Language): Promise<ParentChunk[]> => {
    const buildStructure = (segments: string[]): ParentChunk[] => {
        return segments.map((seg, idx) => {
            // Use a Unicode-aware regex that handles CJK punctuation.
            const SENT_SPLIT = /(?<=[.!?。！？])\s+/u;
            const sentences = seg.split(SENT_SPLIT).filter(s => s.trim().length > 0);
            return {
                id: `${idx}`,
                text: seg,
                children: sentences.map((s, cIdx) => ({ id: `${idx}-${cIdx}`, text: s }))
            };
        });
    };

    const prompt = `You are an expert in semantic text chunking. Split the document into a JSON array of coherent chunks. Each chunk should be a few paragraphs, merging short paragraphs, preserving markdown. Return ONLY a JSON array of strings.
Document Title: ${title}
Document Content:\n---\n${text.slice(0, 20000)}\n---`;

    try {
        const resp = await routeLlmCall('semanticChunker', [
            { role: 'system', content: 'Return ONLY a JSON array of strings. No commentary.' },
            { role: 'user', content: prompt }
        ], { temperature: 0.2 });
        const choice = resp?.choices?.[0]?.message?.content ?? '';
        const chunks = safeParseGeminiJson<string[]>(typeof choice === 'string' ? choice : '');
        if (chunks && chunks.length > 0) return buildStructure(chunks);
    } catch (error) {
        console.error('Semantic chunking via router failed:', error);
    }
    const paras = text.split(/\n\s*\n/).filter(p => p.trim().length > 50);
    return buildStructure(paras.length > 0 ? paras : [text]);
};

export const generateBatchEmbeddings = async (texts: string[]): Promise<number[][]> => {
    if (texts.length === 0) return [];
    try {
        const resp = await fetch('/api/llm/embed', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: EMBEDDING_MODEL_NAME, texts })
        });
        if (!resp.ok) {
            const t = await resp.text();
            throw new Error(`embed failed: ${resp.status} ${t}`);
        }
        const data = await resp.json();
        return (data?.vectors as number[][]) || texts.map(() => []);
    } catch (error) {
        console.error('Embedding via backend failed:', error);
        return texts.map(() => []);
    }
};
