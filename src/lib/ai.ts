import OpenAI from 'openai';
import { GoogleGenAI, Type, Schema } from '@google/genai';
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
import { searchWeb } from '../agentic/adapters/searchWeb';
import { mindMapTool } from '../agentic/adapters/mindMapTool';
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

// Google client for embeddings and legacy calls
let aiInstance: GoogleGenAI | null = null;
if (process.env.GOOGLE_API_KEY) {
    aiInstance = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });
} else {
    console.error("GOOGLE_API_KEY environment variable not set. AI features will be disabled.");
}

export const ai = aiInstance;

const TASK_MODEL_MAP: Record<string, string> = {
    semanticChunker: 'groq/meta/llama-3.1-8b',
    evaluateNovelty: 'groq/meta/llama-3.1-8b',
    webSearchSummary: 'groq/meta/llama-3.1-8b',
    generateDivergentQuestion: 'deepseek/deepseek-v3.1-thinking',
    planNextStep: 'deepseek/deepseek-v3.1-thinking',
    generateInsight: 'google/gemini-2.5-pro',
    runSelfEvolution: 'google/gemini-2.5-pro',
};

export async function routeLlmCall(
    taskName: string,
    messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
    options: Partial<OpenAI.Chat.Completions.ChatCompletionCreateParams> = {}
) {
    if (!gateway) throw new Error('LLM gateway not configured');
    const model = TASK_MODEL_MAP[taskName] ?? 'google/gemini-1.5-flash';
    return gateway.chat.completions.create(
        { model, messages, ...options },
        { headers: { 'x-fallback-models': 'google/gemini-1.5-flash' } }
    );
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

    if (!ai) {
        const paras = text.split(/\n\s*\n/).filter(p => p.trim().length > 50);
        return buildStructure(paras.length > 0 ? paras : [text]);
    }

    let prompt = `You are an expert in semantic text chunking. Your task is to split the following document into a JSON array of semantically coherent chunks. Each chunk should be a self-contained unit of meaning, typically a few paragraphs long. Do not create chunks that are too short. Merge small paragraphs into larger meaningful chunks. Preserve markdown formatting.
Document Title: ${title}
Document Content:\n---\n${text.slice(0, 20000)}\n---\nReturn ONLY the JSON array of strings.`;

    // DO NOT add language instructions for JSON-only endpoints. It can corrupt the output.

    try {
        const result = await ai.models.generateContent({
            model: MODEL_NAME,
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: {
                responseMimeType: 'application/json',
                responseSchema: { type: Type.ARRAY, items: { type: Type.STRING } }
            }
        });
        const response = result.response;
        const chunks = safeParseGeminiJson<string[]>(response.text());
        return buildStructure((chunks && chunks.length > 0) ? chunks : [text]);
    } catch (error) {
        console.error("Semantic chunking failed:", error);
        const paras = text.split(/\n\s*\n/).filter(p => p.trim().length > 50);
        return buildStructure(paras.length > 0 ? paras : [text]);
    }
};

export const generateBatchEmbeddings = async (texts: string[]): Promise<number[][]> => {
    if (!ai || texts.length === 0) return texts.map(() => []);

    // Gemini API has a limit on requests per minute. Batching is crucial.
    // It also has a limit on the number of documents per request (e.g., 100).
    const BATCH_SIZE = 100;
    const allEmbeddings: number[][] = [];

    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
        const batchTexts = texts.slice(i, i + BATCH_SIZE);
        try {
            const res = await ai.models.embedContents({
                model: EMBEDDING_MODEL_NAME,
                contents: batchTexts.map(text => ({ role: 'user', parts: [{ text }] }))
            });
            // Ensure the number of embeddings matches the number of texts in the batch
            if (res.embeddings && res.embeddings.length === batchTexts.length) {
                allEmbeddings.push(...res.embeddings.map(e => e.values));
            } else {
                console.error(`Mismatched embedding count for batch starting at index ${i}.`);
                // Fill with empty arrays for the failed batch
                for (let j = 0; j < batchTexts.length; j++) {
                    allEmbeddings.push([]);
                }
            }
        } catch (error) {
            console.error(`Error embedding batch starting at index ${i}:`, error);
            // On error, push empty embeddings for this batch to maintain array length
            for (let j = 0; j < batchTexts.length; j++) {
                allEmbeddings.push([]);
            }
        }
    }
    return allEmbeddings;
};
