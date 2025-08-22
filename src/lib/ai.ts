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
import { useLogStore } from './logStore';
import type { ToolResult } from '../agentic/types';
import { runSelfEvolution } from './evolution';


// --- API & AI ---
export const MODEL_NAME = 'gemini-2.5-flash';
export const EMBEDDING_MODEL_NAME = 'text-embedding-004';
const ENABLE_LOCAL_RERANK = process.env.ENABLE_LOCAL_RERANK === '1';

let aiInstance: GoogleGenAI | null = null;
if (process.env.API_KEY) {
    aiInstance = new GoogleGenAI({ apiKey: process.env.API_KEY });
} else {
    console.error("API_KEY environment variable not set. AI features will be disabled.");
}

export const ai = aiInstance;

// This should only be used for free-text generation, not for JSON mode.
const CHINESE_OUTPUT_INSTRUCTION = "\n\nCRITICAL: You MUST respond exclusively in Simplified Chinese.";

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
    const out: number[][] = Array.from({ length: texts.length }, () => []);
    for (let i = 0; i < texts.length; i++) {
        try {
            const res = await ai.models.embedContent({
                model: EMBEDDING_MODEL_NAME,
                contents: [{ role: 'user', parts: [{ text: texts[i] }] }]
            });
            if (res.embeddings && res.embeddings[0] && res.embeddings[0].values) {
                out[i] = res.embeddings[0].values;
            }
        } catch (innerError) {
            console.error(`Error embedding text at index ${i}`, innerError);
        }
    }
    return out;
};

// --- New Insight Generation Engine (based on "The Architecture of Insight") ---

const INSIGHT_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    mode: { type: Type.STRING, description: "Mode of insight: 'eureka' for restructuring, 'serendipity' for accidental discovery, or 'none'." },
    reframedProblem: { type: Type.STRING, description: "The new, restructured problem representation that unlocked the insight." },
    insightCore: { type: Type.STRING, description: "The core insight in 24 words or less." },
    selectedHypothesisName: { type: Type.STRING, description: "The name of the selected hypothesis from the list below." },
    hypotheses: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING },
          restructuringOps: { type: Type.ARRAY, items: { type: Type.STRING }, description: "e.g., ['invert-constraint','rename-role: container->platform']" },
          statement: { type: Type.STRING, description: "One-sentence hypothesis." },
          predictedEvidence: { type: Type.ARRAY, items: { type: Type.STRING } },
          disconfirmers: { type: Type.ARRAY, items: { type: Type.STRING } },
          analogySource: { type: Type.STRING },
          prior: { type: Type.NUMBER },
          posterior: { type: Type.NUMBER },
        },
        required: ['name','restructuringOps','statement','predictedEvidence','disconfirmers','prior','posterior']
      }
    },
    eurekaMarkers: {
      type: Type.OBJECT,
      properties: {
        suddennessProxy: { type: Type.NUMBER, description: "0-1, how 'all-at-once' the restructuring is." },
        fluency: { type: Type.NUMBER, description: "0-1, post-insight processing ease." },
        conviction: { type: Type.NUMBER, description: "0-1, would you act on it?" },
        positiveAffect: { type: Type.NUMBER, description: "0-1, positive affect proxy." },
      },
      required: ['suddennessProxy', 'fluency', 'conviction', 'positiveAffect']
    },
    bayesianSurprise: { type: Type.NUMBER, description: "Aggregated |posterior-prior|." },
    evidenceRefs: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          noteId: { type: Type.STRING },
          childId: { type: Type.STRING },
          quote: { type: Type.STRING },
        },
        required: ['noteId', 'childId', 'quote']
      }
    },
    serendipity: {
      type: Type.OBJECT,
      properties: {
        trigger: { type: Type.STRING },
        projectedValue: { type: Type.STRING },
        exploitationPlan: { type: Type.STRING },
      }
    },
    test: { type: Type.STRING, description: "A minimal test or measurement to validate the hypothesis." },
    risks: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Uncertainties or potential risks." },
    memoryCues: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Short cues for the next query cycle." }
  },
  required: ['mode','reframedProblem','insightCore','selectedHypothesisName','hypotheses','eurekaMarkers','bayesianSurprise','evidenceRefs','test','risks']
};

type InsightPayload = {
    mode: "eureka" | "serendipity" | "none";
    reframedProblem: string;
    insightCore: string;
    selectedHypothesisName: string;
    hypotheses: Hypothesis[];
    eurekaMarkers: EurekaMarkers;
    bayesianSurprise: number;
    evidenceRefs: { noteId: string; childId: string; quote: string }[];
    serendipity?: SerendipityInfo;
    test: string;
    risks: string[];
    memoryCues: string[];
}

const generateInitialDraft = async (newNote: Note, language: Language): Promise<string> => {
    if (!ai) return "Could not generate initial draft because AI is not available.";

    const query = newNote.title || newNote.content.slice(0, 120);
    const draftPrompt = `You are a research assistant. Your goal is to draft an initial hypothesis or insight connecting the following note to potential related concepts.

NOTE TITLE: "${query}"
NOTE CONTENT:
"""
${newNote.content.slice(0, 2000)}
"""

Your task:
1.  Read the note and write a brief, initial draft of a potential connection or insight.
2.  The draft should be a rough starting point for further research.
3.  Crucially, mark any unclear points, assumptions, or areas that need more evidence with the tag "[NEEDS RESEARCH]". For example: "This concept seems related to X, but the exact mechanism is unclear [NEEDS RESEARCH]."
4.  Keep the draft concise (2-4 sentences).

This is a preliminary draft that will be iteratively improved with more information.
${language === 'zh' ? CHINESE_OUTPUT_INSTRUCTION : ''}
Return ONLY the text of the draft.`;

    try {
        const result = await ai.models.generateContent({
            model: MODEL_NAME,
            contents: [{ role: 'user', parts: [{ text: draftPrompt }] }],
            generationConfig: { temperature: 0.8 }
        });
        return result.response.text();
    } catch (error) {
        console.error("Error generating initial draft:", error);
        return `Failed to generate initial draft. Error: ${error instanceof Error ? error.message : String(error)}`;
    }
};


const generateInsight = async (evidenceChunks: { noteId: string, childId: string, text: string }[], language: Language, temperature: number, guidingDraft?: string | null): Promise<InsightPayload | null> => {
    if (!ai) return null;

    const guidingDraftPrompt = guidingDraft
        ? `A guiding research draft has been prepared. Use it as a starting point, but do not be constrained by it. Your primary goal is to find Eureka or Serendipity moments that go beyond this initial draft.

GUIDING DRAFT:
"""
${guidingDraft}
"""`
        : "You are an Insight Engine. Your goal is to find a deep, non-obvious connection between the provided evidence chunks from two different notes.";

    const prompt = `${guidingDraftPrompt}

Work in one of two modes:
A) EUREKA: Detect an **impasse** (in the guiding draft, if provided, or in the evidence). Propose minimal **restructurings** (rename roles, invert a constraint, introduce an **analogy source domain**). For each hypothesis, compute a **prior** and **posterior**; report **Bayesian surprise** = |posterior–prior|. Prefer solutions that exhibit **striking but explanatory simplicity**.

B) SERENDIPITY: If you spot an unexpected pattern, anomaly, or keyword that connects the notes in an accidental way, treat it as a serendipity_trigger. Project its potential value and propose one concrete exploitation step.

RULES:
- You MUST use ONLY the provided evidence chunks. All quotes in 'evidenceRefs' MUST be exact substrings of the provided text for that chunk.
- Ground your entire analysis in the provided evidence. Do not invent information.
- Return ONLY a single, valid JSON object matching the schema.

EVIDENCE CHUNKS (up to 16 most relevant snippets):
---
${evidenceChunks.map(c => `[${c.noteId}::${c.childId}] ${c.text}`).join('\n')}
---`;
    
    try {
        const result = await ai.models.generateContent({
            model: MODEL_NAME,
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: {
                responseMimeType: 'application/json',
                responseSchema: INSIGHT_SCHEMA,
                temperature
            }
        });
        const response = result.response;
        const payload = safeParseGeminiJson<InsightPayload>(response.text());
        if (payload && payload.mode !== 'none') {
            // Precise quote validation
            const chunkMap = new Map<string, string>();
            evidenceChunks.forEach(c => chunkMap.set(`${c.noteId}::${c.childId}`, c.text));
            
            payload.evidenceRefs = payload.evidenceRefs.filter(ref => {
                const sourceText = chunkMap.get(`${ref.noteId}::${ref.childId}`);
                return sourceText ? sourceText.includes(ref.quote) : false;
            });
            return payload;
        }
        return null;
    } catch (error) {
        console.error("Error in generateInsight:", error);
        return null;
    }
};

// --- RAG PIPELINE ---

const RELATIONS = ['Contradiction', 'PracticalApplication', 'HistoricalAnalogy', 'ProblemToSolution', 'DeepSimilarity', 'Mechanism', 'Boundary', 'TradeOff'] as const;
const cheapExpandQueries = (topic: string) => ({
  Contradiction: `${topic} limitation counterexample`, PracticalApplication: `${topic} how to apply implementation`,
  HistoricalAnalogy: `${topic} historical precedent analogous case`, ProblemToSolution: `${topic} bottleneck solution workaround`,
  DeepSimilarity: `${topic} pattern structure isomorphic`, Mechanism: `${topic} mechanism pathway causes via`,
  Boundary: `${topic} only if fails when under condition`, TradeOff: `${topic} trade-off at the cost of diminishing returns`,
});

const generateSearchQueries = async (note: Note, budget: Budget): Promise<string[]> => {
    const topic = (note.title || '').trim() || note.content.slice(0, 120);
    const cheap = cheapExpandQueries(topic);
    if (!ai) return Object.values(cheap).slice(0, budget.maxQueries);
    try {
        const result = await ai.models.generateContent({
            model: MODEL_NAME,
            contents: [{ role: 'user', parts: [{ text: `Return JSON with ANY subset of keys: ${RELATIONS.join(', ')}. Each value must be a concise search query derived from:\nTitle: ${note.title ?? ''}\nContent: ${note.content.slice(0, 1000)}` }] }],
            generationConfig: {
                responseMimeType: "application/json", responseSchema: {
                    type: Type.OBJECT, properties: RELATIONS.reduce((acc: { [key: string]: { type: Type.STRING } }, key) => {
                        acc[key] = { type: Type.STRING };
                        return acc;
                    }, {}), required: []
                }
            }
        });
        const response = result.response;
        const obj = safeParseGeminiJson<Record<string, string>>(response.text()) || {};
        return Array.from(new Set([...Object.values(obj).filter(Boolean), ...Object.values(cheap)])).slice(0, budget.maxQueries);
    } catch (error) {
        console.error("Error generating search queries, using fallback:", error);
        return Object.values(cheap).slice(0, budget.maxQueries);
    }
};

const tokenize = (s: string) => s.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5\s]/g,' ').split(/\s+/).filter(w=>w.length>1);

const lexicalRankNotes = (queries: string[], notes: Note[], topN=40): string[] => {
  const qTerms = new Set(queries.flatMap(tokenize));
  const scored = notes.map(n => {
    const text = `${n.title} ${n.content}`;
    const toks = tokenize(text);
    const tf = new Map<string, number>();
    toks.forEach(t => tf.set(t, (tf.get(t)||0)+1));
    let score = 0;
    qTerms.forEach(t => score += (tf.get(t)||0));
    return { id: n.id, score };
  });
  return scored.sort((a,b)=>b.score-a.score).slice(0, topN).map(x=>x.id);
};

const rrf = (rankedLists: string[][], k = 60) => {
  const score = new Map<string, number>();
  for (const list of rankedLists) {
    list.forEach((id, idx) => score.set(id, (score.get(id) || 0) + 1 / (k + idx + 1)));
  }
  return Array.from(score.entries()).sort((a,b)=> b[1]-a[1]).map(([id]) => id);
};

const retrieveCandidateNotesHQ = async (
    queries: string[], vectorStore: VectorStore, existingNotes: Note[], newNoteId: string, budget: Budget
): Promise<string[]> => {
  if (!queries.length || existingNotes.length === 0) return [];

  // 1. Lexical Ranking
  const lexRankedIds = lexicalRankNotes(queries, existingNotes, 40);
  
  // 2. Vector Ranking
  const vecLists: string[][] = [];
  const queryEmbeddings = await generateBatchEmbeddings(queries);

  queryEmbeddings.forEach(embedding => {
      if (embedding && embedding.length > 0) {
          const matches = vectorStore.findNearest(embedding, budget.perQueryK, newNoteId);
          vecLists.push([...new Set(matches.map(m => m.parentChunkId.split(':')[0]))]);
      }
  });

  // 3. Fuse with RRF
  const fused = rrf([...vecLists, lexRankedIds]);

  // 4. Inject Wildcards
  if (budget.maxWildcards > 0) {
      const fusedSet = new Set(fused);
      const available = existingNotes.filter(n => !fusedSet.has(n.id) && n.id !== newNoteId);
      for (let i = 0; i < budget.maxWildcards && available.length > 0; i++) {
          const randIdx = Math.floor(Math.random() * available.length);
          const wildcardId = available[randIdx].id;
          fused.push(wildcardId);
          available.splice(randIdx, 1); // Ensure we don't pick the same one again
      }
  }

  return fused.slice(0, budget.finalK);
};


// --- Orchestrator for the RAG pipeline ---

type LoadingState = { active: boolean; messages: string[] };
type SetLoadingState = Dispatch<SetStateAction<LoadingState>>;
type TFunction = (key: keyof typeof translations.en, ...args: any[]) => string;
type InsightResult = Omit<Insight, 'id' | 'status' | 'createdAt'>;

const selfProbe = async (note: Note, impasseReason: string, existingProbes: string[], budget: Budget): Promise<string[]> => {
    if (!ai) return [];
    const prompt = `Initial analysis of "${note.title}" failed to find a connection due to: "${impasseReason}".
Existing search queries were: ${JSON.stringify(existingProbes)}.
Generate a JSON array of 2 new, diverse search queries to overcome this failure.
- Q1: Query for missing context within the primary domain.
- Q2: Query for an analogy from a distant domain (e.g., biology, economics, physics) to reframe the problem.
Return ONLY the JSON array of strings.`;
    try {
        const result = await ai.models.generateContent({
            model: MODEL_NAME,
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: {
                responseMimeType: "application/json",
                responseSchema: { type: Type.ARRAY, items: { type: Type.STRING } },
                temperature: budget.tempProbe
            }
        });
        const response = result.response;
        return safeParseGeminiJson<string[]>(response.text()) || [];
    } catch (e) {
        console.error("Self-probing failed:", e);
        return [];
    }
};

const analyzeDraftForGaps = async (draft: string, noteQuery: string, priorQueries: string[], budget: Budget): Promise<string[]> => {
    if (!ai) return [];
    const gapPrompt = `You are an assistant analyzing a research draft for missing information. Your goal is to suggest targeted search queries to fill the gaps.

Original Note/Query: "${noteQuery}"
Prior Search Queries: ${JSON.stringify(priorQueries)}
Current Draft:
"""
${draft}
"""

Instructions:
1.  Read the draft and identify specific gaps, unsupported claims, or placeholders like "[NEEDS RESEARCH]".
2.  For each gap, generate a focused search query that would likely find the missing information or evidence.
3.  Do not suggest queries that are too similar to the prior search queries.
4.  Return a JSON array of 2-3 new, diverse search query strings. If no gaps are found, return an empty array.

Return ONLY the JSON array of strings.`;

    try {
        const result = await ai.models.generateContent({
            model: MODEL_NAME,
            contents: [{ role: 'user', parts: [{ text: gapPrompt }] }],
            generationConfig: {
                responseMimeType: "application/json",
                responseSchema: { type: Type.ARRAY, items: { type: Type.STRING } },
                temperature: budget.tempProbe,
            }
        });
        const response = result.response;
        return safeParseGeminiJson<string[]>(response.text()) || [];
    } catch (e) {
        console.error("Gap analysis for search queries failed:", e);
        return [];
    }
};

const integrateEvidenceIntoDraft = async (draft: string, evidenceNotes: Note[], language: Language): Promise<string> => {
    if (!ai || evidenceNotes.length === 0) return draft;

    let retrievedContent = "";
    for (const note of evidenceNotes) {
        // Simple heuristic to not overwhelm the context window
        if (retrievedContent.length < 6000) {
            retrievedContent += `--- From Note: "${note.title}" ---\n${note.content.slice(0, 1500)}...\n\n`;
        }
    }

    if (!retrievedContent) return draft;

    const denoisePrompt = `You are a research assistant. Your task is to integrate new information into a draft insight, improving it by filling gaps and adding evidence.

Current Draft:
"""
${draft}
"""

Newly Retrieved Information:
"""
${retrievedContent}
"""

Instructions:
1.  Carefully read the "Current Draft" and the "Newly Retrieved Information".
2.  Integrate the new information into the draft where it is most relevant.
3.  Focus on filling in sections marked with "[NEEDS RESEARCH]" or strengthening unsupported claims.
4.  If the new information provides a source, you can add a citation like [Source: Note Title].
5.  Maintain the draft's original structure and coherence. The goal is to refine and expand, not to rewrite completely.
6.  If the new information is not relevant, return the original draft unchanged.
${language === 'zh' ? CHINESE_OUTPUT_INSTRUCTION : ''}
Return ONLY the updated draft text.`;

    try {
        const result = await ai.models.generateContent({
            model: MODEL_NAME,
            contents: [{ role: 'user', parts: [{ text: denoisePrompt }] }],
            generationConfig: { temperature: 0.5 }
        });
        return result.response.text();
    } catch (error) {
        console.error("Error integrating evidence into draft:", error);
        return draft; // Return original draft on error
    }
};

type UserFeedback = { insightCore: string; vote: 'up' | 'down' };

const runSynthesisAndRanking = async (
    newNote: Note,
    candNotes: Note[],
    setLoadingState: SetLoadingState,
    t: TFunction,
    language: Language,
    searchQueries: string[],
    budget: Budget,
    userFeedback: UserFeedback[] = [],
    guidingDraft: string | null = null
): Promise<{ results: InsightResult[], candIds: string[] }> => {
    if (candNotes.length === 0) return { results: [], candIds: [] };

    setLoadingState(prev => ({ ...prev, messages: [...prev.messages, t('thinkingSynthesizing', candNotes.length)] }));
    
    const insightPromises = candNotes.map(async (candNote) => {
        const mkPool = (note: Note): Frag[] =>
            note.parentChunks?.flatMap(pc => pc.children.map(c => ({
                noteId: note.id,
                parentId: pc.id,
                childId: `${pc.id}::${c.id}`,
                text: c.text,
                tokens: estTokens(c.text)
            }))) ?? [];

        const pool = [...mkPool(newNote), ...mkPool(candNote)];
        const queryText = (searchQueries.join(' ') || newNote.title || '').slice(0, 600);

        let picked = pickEvidenceSubmodular(pool, queryText, budget.maxFragments);
        if (ENABLE_LOCAL_RERANK) {
            const pairs = picked.map(p => ({ query: queryText, text: p.text, meta: p }));
            const reranked = await rerankLocal(pairs, budget.maxFragments);
            picked = reranked.map(r => r.meta as Frag);
        }
        picked = capFragmentsByBudget(picked, budget.contextCapChars);

        const evidenceChunks = picked.map(p => ({ noteId: p.noteId, childId: p.childId, text: p.text }));

        const insight = await generateInsight(evidenceChunks, language, budget.tempInsight, guidingDraft);

        if (insight) {
            const ctr = await counterInsightCheck(insight.insightCore, evidenceChunks);
            (insight as any).__counter = ctr;
        }
        return insight;
    });

    const insights = (await Promise.all(insightPromises)).filter((i): i is InsightPayload => !!i);
    if (insights.length === 0) return { results: [], candIds: candNotes.map(c => c.id) };

    setLoadingState(prev => ({ ...prev, messages: [...prev.messages, t('thinkingRanking')] }));

    const jaccard = (a: Set<string>, b: Set<string>) => {
        const intersection = new Set([...a].filter(x => b.has(x)));
        const union = new Set([...a, ...b]);
        return union.size === 0 ? 0 : intersection.size / union.size;
    };
    const feedbackTokens = userFeedback.map(f => ({ vote: f.vote, tokens: new Set(tokenize(f.insightCore)) }));
    
    const scoredInsights = insights.map((insight, i) => {
        const { conviction, fluency } = insight.eurekaMarkers;
        const surprise = insight.bayesianSurprise;
        const diversity = new Set(insight.evidenceRefs.map(e => e.childId.split('::')[0])).size;
        
        const insightTokens = new Set(tokenize(insight.insightCore));
        let feedbackScore = 0;
        if (feedbackTokens.length > 0) {
            const similarities = feedbackTokens.map(f => ({ vote: f.vote, score: jaccard(insightTokens, f.tokens) }));
            const maxUpvote = Math.max(0, ...similarities.filter(s => s.vote === 'up').map(s => s.score));
            const maxDownvote = Math.max(0, ...similarities.filter(s => s.vote === 'down').map(s => s.score));
            feedbackScore = maxUpvote - maxDownvote; // [-1, 1]
        }

        const ctr = (insight as any).__counter as { severity?: number } | undefined;
        const penalty = ctr?.severity ? (0.25 * Math.min(1, ctr.severity)) : 0;
        const score = (0.40 * conviction) + (0.25 * fluency) + (0.15 * surprise) + (0.10 * Math.tanh(diversity/6)) + (0.10 * feedbackScore) - penalty;
        return { insight, oldNoteId: candNotes[i].id, score };
    });
    
    scoredInsights.sort((a,b) => b.score - a.score);

    const results = scoredInsights.slice(0, 3).map(({ insight, oldNoteId, score }) => {
        const thinkingProcess: InsightThinkingProcess = {
            searchQueries: [],
            retrievedCandidateIds: candNotes.map(c => c.id),
            synthesisCandidates: [], 
            rankingRationale: `Ranked by cognitive markers: Conviction (${(insight.eurekaMarkers.conviction*100).toFixed(0)}%), Fluency (${(insight.eurekaMarkers.fluency*100).toFixed(0)}%), Bayesian Surprise (${(insight.bayesianSurprise*100).toFixed(0)}%). Final score: ${score.toFixed(2)}`,
        };
        return {
            ...insight,
            newNoteId: newNote.id,
            oldNoteId,
            thinkingProcess,
            confidence: insight.eurekaMarkers.conviction
        };
    });

    return { results, candIds: candNotes.map(c => c.id) };
};

const generateConstellationInsight = async (
    evidenceChunks: { noteId: string, childId: string, text: string }[],
    language: Language,
    temperature: number
): Promise<InsightPayload | null> => {
    if (!ai) return null;

    const prompt = `You are a "Constellation" Insight Engine. Your goal is to find a deep, non-obvious connection that **unites all three** of the provided evidence sources.

- Source 1 (from the newest note) is the starting point.
- Source 2 (from a connected note) is the first link.
- Source 3 (from a 'bridge' note) is a second-hop connection.

Identify a unifying theme, pattern, analogy, or principle. Frame the insight as a "constellation" that reveals how all three are related.

RULES:
- You MUST use ONLY the provided evidence chunks. All quotes in 'evidenceRefs' MUST be exact substrings of the provided text for that chunk.
- Ground your entire analysis in the provided evidence. Do not invent information.
- Return ONLY a single, valid JSON object matching the schema.

EVIDENCE CHUNKS (from 3 notes):
---
${evidenceChunks.map(c => `[${c.noteId}::${c.childId}] ${c.text}`).join('\n')}
---`;

    try {
        const result = await ai.models.generateContent({
            model: MODEL_NAME,
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: {
                responseMimeType: 'application/json',
                responseSchema: INSIGHT_SCHEMA,
                temperature
            }
        });
        const response = result.response;
        const payload = safeParseGeminiJson<InsightPayload>(response.text());
        if (payload && payload.mode !== 'none') {
            const chunkMap = new Map<string, string>();
            evidenceChunks.forEach(c => chunkMap.set(`${c.noteId}::${c.childId}`, c.text));

            payload.evidenceRefs = payload.evidenceRefs.filter(ref => {
                const sourceText = chunkMap.get(`${ref.noteId}::${ref.childId}`);
                return sourceText ? sourceText.includes(ref.quote) : false;
            });
            return payload;
        }
        return null;
    } catch (error) {
        console.error("Error in generateConstellationInsight:", error);
        return null;
    }
};

const findBridgingInsight = async (
    baseInsight: InsightResult,
    newNote: Note,
    existingNotes: Note[],
    vectorStore: VectorStore,
    budget: Budget,
    language: Language
): Promise<InsightResult | null> => {
    const noteA = existingNotes.find(n => n.id === baseInsight.oldNoteId);
    if (!noteA) return null;

    // 1. Find bridge candidates related to Note A
    const bridgeQueries = await generateSearchQueries(noteA, budget);
    if (bridgeQueries.length === 0) return null;

    const notesToSearch = existingNotes.filter(n => n.id !== newNote.id && n.id !== noteA.id);
    const bridgeCandIds = await retrieveCandidateNotesHQ(bridgeQueries, vectorStore, notesToSearch, noteA.id, budget);
    const bridgeCands = existingNotes.filter(n => bridgeCandIds.slice(0, 2).includes(n.id)); // Try top 2 bridges
    if (bridgeCands.length === 0) return null;

    // 2. Synthesize a 3-way "constellation" insight
    const mkPool = (note: Note): Frag[] =>
        note.parentChunks?.flatMap(pc => pc.children.map(c => ({
            noteId: note.id,
            parentId: pc.id,
            childId: `${pc.id}::${c.id}`,
            text: c.text,
            tokens: estTokens(c.text)
        }))) ?? [];

    let bestConstellation: InsightResult | null = null;

    for (const noteB of bridgeCands) {
        const pool = [...mkPool(newNote), ...mkPool(noteA), ...mkPool(noteB)];
        const queryText = (bridgeQueries.join(' ') || noteA.title || '').slice(0, 600);

        let picked = pickEvidenceSubmodular(pool, queryText, budget.maxFragments);
        picked = capFragmentsByBudget(picked, budget.contextCapChars);
        const evidenceChunks = picked.map(p => ({ noteId: p.noteId, childId: p.childId, text: p.text }));

        const insightPayload = await generateConstellationInsight(evidenceChunks, language, budget.tempInsight);

        if (insightPayload) {
            const result: InsightResult = {
                ...insightPayload,
                newNoteId: newNote.id,
                oldNoteId: noteB.id, // The "old" note is now the bridge note
                thinkingProcess: {
                    searchQueries: bridgeQueries,
                    retrievedCandidateIds: bridgeCandIds,
                    synthesisCandidates: [],
                    rankingRationale: `Constellation insight found by bridging ${newNote.id} -> ${noteA.id} -> ${noteB.id}`,
                    constellationSourceIds: [newNote.id, noteA.id, noteB.id]
                },
                confidence: insightPayload.eurekaMarkers.conviction
            };
            if ((result.confidence ?? 0) > (bestConstellation?.confidence ?? 0)) {
                bestConstellation = result;
            }
        }
    }

    return bestConstellation;
};


const runAgenticRefinement = async ({
    insight, tier, topic, budget, hooks
}: {
    insight: InsightResult; tier: Tier; topic: string; budget: Budget; hooks: { onLog: (s:string)=>void, onTool: (r:ToolResult)=>void }
}): Promise<InsightResult | null> => {
    if (tier !== 'pro') return null;

    const evidenceTexts = (insight.evidenceRefs || []).map((e: any) => e.quote).filter(Boolean);

    const transcript = await maybeAutoDeepen({
        tier,
        topic: topic,
        insightCore: insight.insightCore || 'Candidate insight',
        evidenceTexts,
        tools: { web: searchWeb, mind: mindMapTool() },
        hooks,
        budget
    });

    if (transcript) {
        const refinedInsight = { ...insight };
        refinedInsight.thinkingProcess = refinedInsight.thinkingProcess || {};
        refinedInsight.thinkingProcess.agenticTranscript = transcript;
        refinedInsight.insightCore += ' — refined via agentic research';
        // Boost confidence slightly after refinement to encourage selection
        refinedInsight.confidence = (refinedInsight.confidence ?? 0) * 1.1;
        return refinedInsight;
    }

    return null;
};

async function postProcessWithAgentic({
  tier, newNote, results
}:{
  tier: 'free'|'pro'; newNote: Note; results: InsightResult[];
}): Promise<InsightResult[]> {
  if (tier !== 'pro' || !results?.length) return results;

  const top = results[0];
  const transcript = top.thinkingProcess?.agenticTranscript;

  // 1) enumerate candidate answers
  const candidates = (top.hypotheses || []).map(h => ({ text: h.statement, prior: h.prior }));
  candidates.unshift({ text: top.insightCore });

  // 2) grounded verification
  const q = newNote.title || newNote.content.slice(0, 120);
  const verdicts = await verifyCandidates(q, candidates, 3);

  // 3) choose final based on supported verdicts; attach citations
  const supported = verdicts.find(v => v.verdict === 'supported') ?? verdicts[0];

  if (supported) {
    let newInsightCore = supported.candidate.text;
    // Keep the refinement tag if it existed
    if (transcript && !newInsightCore.includes('refined via')) {
      newInsightCore += ' — refined via agentic research';
    }
    top.insightCore = newInsightCore;
    top.thinkingProcess = top.thinkingProcess || {};
    top.thinkingProcess.verification = supported;
    if (supported.verdict === 'supported') {
      top.confidence = Math.max(top.confidence ?? 0, 0.85);
    }
  }

  return results;
}

export const findSynapticLink = async (
    newNote: Note, existingNotes: Note[], setLoadingState: Dispatch<SetStateAction<LoadingState>>, vectorStore: VectorStore,
    language: Language = 'en', t: TFunction, tier: Tier = 'pro'
): Promise<InsightResult[]> => {
    if (existingNotes.length === 0) return [];

    const { startRun, addThinkingStep, addDevLog } = useLogStore.getState();
    startRun();

    const hooks = {
        onLog: (log: string) => {
            addThinkingStep(log);
            addDevLog({ source: 'agent', type: 'plan', content: log });
        },
        onTool: (toolResult: ToolResult) => {
            addDevLog({ source: 'tool', type: 'result', content: toolResult });
        },
    };

    const startTime = Date.now();
    const budget = policyFor(tier);

    let memoryWorkspace = {
        probes: new Set<string>(), retrievedNoteIds: new Set<string>(),
        bestResults: [] as InsightResult[], impasseReason: "Initial search.",
        agenticRefinements: 0,
        currentDraft: null as string | null,
    };

    memoryWorkspace.currentDraft = await generateInitialDraft(newNote, language);
    if (memoryWorkspace.currentDraft) {
        hooks.onLog?.(`Initial draft generated: "${memoryWorkspace.currentDraft.slice(0, 100)}..."`);
        addDevLog({ source: 'agent', type: 'draft', content: memoryWorkspace.currentDraft });
    }

    let cycle = 0;
    // This is now a context-building loop
    for (cycle = 1; cycle <= budget.maxCycles; cycle++) {
        let currentQueries: string[];
        if (cycle === 1) {
            setLoadingState({ active: true, messages: [t('thinkingBrainstorming')] });
            currentQueries = await generateSearchQueries(newNote, budget);
        } else {
            setLoadingState(prev => ({ ...prev, messages: [...prev.messages, t('thinkingReflecting')] }));
            if (memoryWorkspace.currentDraft) {
                hooks.onLog?.('Analyzing draft for knowledge gaps to drive next search cycle...');
                currentQueries = await analyzeDraftForGaps(memoryWorkspace.currentDraft, newNote.title || newNote.content.slice(0,120), Array.from(memoryWorkspace.probes), budget);
            } else {
                currentQueries = [];
            }
            if (currentQueries.length === 0) {
                hooks.onLog?.('No new queries generated from draft. Ending context building.');
                break; // Exit loop if no new research directions
            }
        }
        
        currentQueries.forEach(q => memoryWorkspace.probes.add(q));

        setLoadingState(prev => ({ ...prev, messages: [...prev.messages, t('thinkingSearching')] }));
        const candIds = await retrieveCandidateNotesHQ(
            Array.from(memoryWorkspace.probes), vectorStore, existingNotes, newNote.id,
            budget
        );
        const newCandIds = candIds.filter(id => !memoryWorkspace.retrievedNoteIds.has(id));
        if (newCandIds.length === 0 && cycle > 1) {
            hooks.onLog?.('No new notes found. Ending context building.');
            break;
        }
        
        const newCandNotes = existingNotes.filter(n => newCandIds.includes(n.id) && n.parentChunks && n.parentChunks.length > 0);

        if (newCandNotes.length > 0 && memoryWorkspace.currentDraft) {
            setLoadingState(prev => ({ ...prev, messages: [...prev.messages, t('thinkingSynthesizing', newCandNotes.length)] }));
            const updatedDraft = await integrateEvidenceIntoDraft(memoryWorkspace.currentDraft, newCandNotes, language);
            memoryWorkspace.currentDraft = updatedDraft;
            hooks.onLog?.(`Draft updated with evidence from ${newCandNotes.length} new note(s).`);
            addDevLog({ source: 'agent', type: 'draft', content: updatedDraft });
        }

        newCandIds.forEach(id => memoryWorkspace.retrievedNoteIds.add(id));
        
        memoryWorkspace.impasseReason = `Context built over ${cycle} cycle(s). Final draft is ready for insight generation.`;
    }

    // --- Insight Generation Step (after context-building loop) ---
    setLoadingState(prev => ({ ...prev, messages: [...prev.messages, t('thinkingSynthesizing', memoryWorkspace.retrievedNoteIds.size)] }));
    const allRetrievedNotes = existingNotes.filter(n => memoryWorkspace.retrievedNoteIds.has(n.id) && n.parentChunks && n.parentChunks.length > 0);
    if (allRetrievedNotes.length > 0) {
        const { results } = await runSynthesisAndRanking(newNote, allRetrievedNotes, setLoadingState, t, language, Array.from(memoryWorkspace.probes), budget, [], memoryWorkspace.currentDraft);
        if (results.length > 0) {
            const uniqueResults = Array.from(new Map(results.map(r => [r.oldNoteId, r])).values());
            memoryWorkspace.bestResults = uniqueResults.slice(0,3);
        }
    }

    // --- Multi-hop Expansion ---
    if (budget.enableMultiHop && memoryWorkspace.bestResults.length > 0) {
        hooks.onLog?.('Checking for multi-hop constellation insights...');
        const constellationInsight = await findBridgingInsight(
            memoryWorkspace.bestResults[0], newNote, existingNotes, vectorStore, budget, language
        );
        if (constellationInsight) {
            if ((constellationInsight.confidence ?? 0) > (memoryWorkspace.bestResults[0].confidence ?? 0)) {
                memoryWorkspace.bestResults.unshift(constellationInsight);
                const uniqueResults = Array.from(new Map(memoryWorkspace.bestResults.map(r => [r.oldNoteId, r])).values());
                memoryWorkspace.bestResults = uniqueResults.slice(0,3);
                hooks.onLog?.(`Found a superior constellation insight bridging via note ${constellationInsight.oldNoteId}.`);
            }
        }
    }

    // --- Agentic Refinement ---
    if (tier === 'pro' && memoryWorkspace.bestResults.length > 0) {
        const topConfidence = memoryWorkspace.bestResults[0]?.confidence ?? 0;
        if (memoryWorkspace.agenticRefinements < budget.maxAgenticRefinementsPerRun && topConfidence < 0.7) {
            setLoadingState(prev => ({ ...prev, messages: [...prev.messages, t('thinkingRefining')] }));
            addDevLog({ source: 'system', type: 'info', content: 'Entering agentic refinement loop.' });
            const refined = await runAgenticRefinement({
                insight: memoryWorkspace.bestResults[0],
                tier,
                topic: newNote.title || newNote.content.slice(0, 120),
                budget,
                hooks,
            });
            if (refined) {
                memoryWorkspace.bestResults[0] = refined;
                memoryWorkspace.agenticRefinements++;
                hooks.onLog?.('Insight refined using agentic loop.');
            }
        }
    }

    memoryWorkspace.bestResults.forEach(r => {
        if (r.thinkingProcess) {
            r.thinkingProcess.searchQueries = Array.from(memoryWorkspace.probes);
            r.thinkingProcess.retrievedCandidateIds = Array.from(memoryWorkspace.retrievedNoteIds);
        }
    });

    // --- Self-Evolution Step ---
    if (tier === 'pro' && budget.enableSelfEvolution && memoryWorkspace.bestResults.length > 0) {
        hooks.onLog?.('Entering self-evolution stage to refine the final insight...');
        setLoadingState(prev => ({ ...prev, messages: [...prev.messages, t('thinkingRefining')] }));
        const insightToEvolve = memoryWorkspace.bestResults[0];
        const evolvedInsightCore = await runSelfEvolution(insightToEvolve.insightCore, language);
        if (evolvedInsightCore !== insightToEvolve.insightCore) {
            insightToEvolve.insightCore = evolvedInsightCore;
            if(insightToEvolve.thinkingProcess) {
                insightToEvolve.thinkingProcess.rankingRationale += ' | Evolved via multi-variant merging.';
            }
            insightToEvolve.confidence = Math.min(1.0, (insightToEvolve.confidence ?? 0.7) * 1.1); // Boost confidence
            hooks.onLog?.('Self-evolution complete. Insight has been merged from multiple variants.');
            addDevLog({ source: 'agent', type: 'insight-evolved', content: evolvedInsightCore });
        }
    }

    const finalResults = await postProcessWithAgentic({ tier, newNote, results: memoryWorkspace.bestResults });

    return finalResults;
};
