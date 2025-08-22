import { GoogleGenAI, Type } from '@google/genai';
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
    let jsonText = text.trim();

    // 1. Attempt to find a JSON blob within markdown fences
    const markdownMatch = jsonText.match(/```(json)?\s*([\s\S]*?)\s*```/);
    if (markdownMatch && markdownMatch[2]) {
        jsonText = markdownMatch[2].trim();
    } else {
        // 2. If no fences, find the first '{' or '[' and the last '}' or ']' to extract a potential JSON object/array.
        const firstBracket = jsonText.indexOf('[');
        const firstBrace = jsonText.indexOf('{');
        
        let start = -1;
        if (firstBracket === -1) start = firstBrace;
        else if (firstBrace === -1) start = firstBracket;
        else start = Math.min(firstBracket, firstBrace);

        if (start !== -1) {
            const lastBracket = jsonText.lastIndexOf(']');
            const lastBrace = jsonText.lastIndexOf('}');
            const end = Math.max(lastBracket, lastBrace);
            
            if (end > start) jsonText = jsonText.substring(start, end + 1);
        }
    }
    
    if (jsonText.toLowerCase() === 'null') return null;

    try {
        return JSON.parse(jsonText) as T;
    } catch (error) {
        console.warn("Initial JSON parsing failed. Attempting to repair common LLM errors.", error);
        try {
            const repairedJsonText = jsonText.replace(/\\(?![bfnrt"\\/])/g, '\\\\');
            return JSON.parse(repairedJsonText) as T;
        }
        catch (repairError) {
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
        const response = await ai.models.generateContent({
            model: MODEL_NAME,
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            config: {
                responseMimeType: 'application/json',
                responseSchema: { type: Type.ARRAY, items: { type: Type.STRING } }
            }
        });
        const chunks = safeParseGeminiJson<string[]>(response.candidates?.[0]?.content?.parts?.[0]?.text ?? '');
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

const INSIGHT_SCHEMA = {
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

const generateInsight = async (evidenceChunks: { noteId: string, childId: string, text: string }[], language: Language, temperature: number): Promise<InsightPayload | null> => {
    if (!ai) return null;

    const prompt = `You are an Insight Engine. Your goal is to find a deep, non-obvious connection between the provided evidence chunks from two different notes.

Work in one of two modes:
A) EUREKA: Detect an **impasse**. Propose minimal **restructurings** (rename roles, invert a constraint, introduce an **analogy source domain**). For each hypothesis, compute a **prior** and **posterior**; report **Bayesian surprise** = |posterior–prior|. Prefer solutions that exhibit **striking but explanatory simplicity**.

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
        const response = await ai.models.generateContent({
            model: MODEL_NAME,
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            config: {
                responseMimeType: 'application/json',
                // @ts-ignore
                responseSchema: INSIGHT_SCHEMA,
                temperature
            }
        });
        const result = safeParseGeminiJson<InsightPayload>(response.candidates?.[0]?.content?.parts?.[0]?.text ?? '');
        if (result && result.mode !== 'none') {
            // Precise quote validation
            const chunkMap = new Map<string, string>();
            evidenceChunks.forEach(c => chunkMap.set(`${c.noteId}::${c.childId}`, c.text));
            
            result.evidenceRefs = result.evidenceRefs.filter(ref => {
                const sourceText = chunkMap.get(`${ref.noteId}::${ref.childId}`);
                return sourceText ? sourceText.includes(ref.quote) : false;
            });
            return result;
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
        const response = await ai.models.generateContent({
            model: MODEL_NAME,
            contents: [{ role: 'user', parts: [{ text: `Return JSON with ANY subset of keys: ${RELATIONS.join(', ')}. Each value must be a concise search query derived from:\nTitle: ${note.title ?? ''}\nContent: ${note.content.slice(0, 1000)}` }] }],
            config: {
                responseMimeType: "application/json", responseSchema: {
                    type: Type.OBJECT, properties: RELATIONS.reduce((acc: { [key: string]: { type: Type.STRING } }, key) => {
                        acc[key] = { type: Type.STRING };
                        return acc;
                    }, {}), required: []
                }
            }
        });
        const obj = safeParseGeminiJson<Record<string, string>>(response.candidates?.[0]?.content?.parts?.[0]?.text ?? '') || {};
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

const retrieveCandidateNotesHQ = async (queries: string[], vectorStore: VectorStore, existingNotes: Note[], newNoteId: string, perQueryK = 10, finalK = 8): Promise<string[]> => {
  if (!queries.length || existingNotes.length === 0) return [];

  // 1. Lexical Ranking
  const lexRankedIds = lexicalRankNotes(queries, existingNotes, 40);
  
  // 2. Vector Ranking
  const vecLists: string[][] = [];
  const queryEmbeddings = await generateBatchEmbeddings(queries);

  queryEmbeddings.forEach(embedding => {
      if (embedding && embedding.length > 0) {
          const matches = vectorStore.findNearest(embedding, perQueryK, newNoteId);
          vecLists.push([...new Set(matches.map(m => m.parentChunkId.split(':')[0]))]);
      }
  });

  // 3. Fuse with RRF
  return rrf([...vecLists, lexRankedIds]).slice(0, finalK);
};

const retrieveMultiHopChains = async (
  seedIds: string[],
  existingNotes: Note[],
  vectorStore: VectorStore,
  budget: Budget
): Promise<Note[][]> => {
  const idToNote = new Map(existingNotes.map(n => [n.id, n]));
  const maxDepth = budget.maxHopDepth || 1;
  const groups: Note[][] = [];

  const embedAndRetrieve = async (note: Note): Promise<string[]> => {
    const text = (note.title || note.content).slice(0, 200);
    return retrieveCandidateNotesHQ([text], vectorStore, existingNotes, note.id, budget.perQueryK, budget.perQueryK);
  };

  for (const id of seedIds) {
    const seed = idToNote.get(id);
    if (!seed) continue;
    groups.push([seed]);
    if (maxDepth <= 1) continue;

    let frontier: Note[][] = [[seed]];
    for (let depth = 1; depth < maxDepth; depth++) {
      const next: Note[][] = [];
      for (const chain of frontier) {
        const last = chain[chain.length - 1];
        const neighborIds = await embedAndRetrieve(last);
        for (const nid of neighborIds) {
          if (chain.some(n => n.id === nid)) continue;
          const nb = idToNote.get(nid);
          if (!nb) continue;
          const newChain = [...chain, nb];
          groups.push(newChain);
          next.push(newChain);
        }
      }
      frontier = next;
      if (!frontier.length) break;
    }
  }

  return groups;
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
        const response = await ai.models.generateContent({
            model: MODEL_NAME,
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            config: {
                responseMimeType: "application/json",
                responseSchema: { type: Type.ARRAY, items: { type: Type.STRING } },
                temperature: budget.tempProbe
            }
        });
        return safeParseGeminiJson<string[]>(response.candidates?.[0]?.content?.parts?.[0]?.text ?? '') || [];
    } catch (e) {
        console.error("Self-probing failed:", e);
        return [];
    }
};

const runSynthesisAndRanking = async (
    newNote: Note,
    noteGroups: Note[][],
    setLoadingState: SetLoadingState,
    t: TFunction,
    language: Language,
    searchQueries: string[],
    budget: Budget
): Promise<InsightResult[]> => {
    if (noteGroups.length === 0) return [];

    setLoadingState(prev => ({ ...prev, messages: [...prev.messages, t('thinkingSynthesizing', noteGroups.length)] }));

    const insightPromises = noteGroups.map(async (group) => {
        const mkPool = (note: Note): Frag[] =>
            note.parentChunks?.flatMap(pc => pc.children.map(c => ({
                noteId: note.id,
                parentId: pc.id,
                childId: `${pc.id}::${c.id}`,
                text: c.text,
                tokens: estTokens(c.text)
            }))) ?? [];

        const pool = [
            ...mkPool(newNote),
            ...group.flatMap(mkPool)
        ];
        const queryText = (searchQueries.join(' ') || newNote.title || '').slice(0, 600);

        let picked = pickEvidenceSubmodular(pool, queryText, budget.maxFragments);
        if (ENABLE_LOCAL_RERANK) {
            const pairs = picked.map(p => ({ query: queryText, text: p.text, meta: p }));
            const reranked = await rerankLocal(pairs, budget.maxFragments);
            picked = reranked.map(r => r.meta as Frag);
        }
        picked = capFragmentsByBudget(picked, budget.contextCapChars);

        const evidenceChunks = picked.map(p => ({ noteId: p.noteId, childId: p.childId, text: p.text }));

        const insight = await generateInsight(evidenceChunks, language, budget.tempInsight);

        if (insight) {
            const ctr = await counterInsightCheck(insight.insightCore, evidenceChunks);
            (insight as any).__counter = ctr;
        }
        return { insight, group };
    });

    const insights = (await Promise.all(insightPromises)).filter((i): i is { insight: InsightPayload, group: Note[] } => !!i.insight);
    if (insights.length === 0) return [];

    setLoadingState(prev => ({ ...prev, messages: [...prev.messages, t('thinkingRanking')] }));

    const scoredInsights = insights.map(({ insight, group }) => {
        const { conviction, fluency } = insight.eurekaMarkers;
        const surprise = insight.bayesianSurprise;
        const diversity = new Set(insight.evidenceRefs.map(e => e.childId.split('::')[0])).size;

        const ctr = (insight as any).__counter as { severity?: number } | undefined;
        const penalty = ctr?.severity ? (0.25 * Math.min(1, ctr.severity)) : 0;
        const score = 0.45 * conviction + 0.25 * fluency + 0.20 * surprise + 0.10 * Math.tanh(diversity/6) - penalty;
        return { insight, group, score };
    });

    scoredInsights.sort((a,b) => b.score - a.score);

    const results = scoredInsights.slice(0, 3).map(({ insight, group, score }) => {
        const groupIds = group.map(n => n.id);
        const thinkingProcess: InsightThinkingProcess = {
            searchQueries: [],
            retrievedCandidateIds: groupIds,
            synthesisCandidates: [],
            rankingRationale: `Ranked by cognitive markers: Conviction (${(insight.eurekaMarkers.conviction*100).toFixed(0)}%),Fluency (${(insight.eurekaMarkers.fluency*100).toFixed(0)}%), Bayesian Surprise (${(insight.bayesianSurprise*100).toFixed(0)}%). Final score: ${score.toFixed(2)}`,
        };
        return {
            ...insight,
            newNoteId: newNote.id,
            oldNoteId: groupIds[0],
            thinkingProcess,
            confidence: insight.eurekaMarkers.conviction
        };
    });

    return results;
};


async function postProcessWithAgentic({
  tier, newNote, results
}:{
  tier: 'free'|'pro'; newNote: Note; results: InsightResult[];
}): Promise<InsightResult[]> {
  if (tier !== 'pro' || !results?.length) return results;

  const top = results[0];

  // 1) signals
  const evidenceTexts = (top.evidenceRefs || []).map((e:any)=> e.quote).filter(Boolean);
  const signals = computeSignals({
      queries: top.thinkingProcess?.searchQueries || [],
      candidateScores: results.map(r => r.confidence ?? 0),
      evidenceTexts
  });

  // 2) adaptive budget
  const budget = deriveBudget(tier, signals);

  // 3) maybe deepen using existing controller
  const transcript = await maybeAutoDeepen({
    tier,
    topic: newNote.title || newNote.content.slice(0,120),
    insightCore: top.insightCore || 'Candidate insight',
    evidenceTexts,
    tools: { web: searchWeb, mind: mindMapTool() },
    hooks: { onLog: console.debug, onTool: console.debug },
    budget
  });

  if (transcript) {
    top.thinkingProcess = top.thinkingProcess || {};
    top.thinkingProcess.agenticTranscript = transcript;
  }

  // 4) enumerate candidate answers
  const candidates = (top.hypotheses || []).map(h => ({ text: h.statement, prior: h.prior }));
  candidates.unshift({ text: top.insightCore });

  // 5) grounded verification
  const q = newNote.title || newNote.content.slice(0, 120);
  const verdicts = await verifyCandidates(q, candidates, 3);

  // 6) choose final based on supported verdicts; attach citations
  const supported = verdicts.find(v => v.verdict === 'supported') ?? verdicts[0];

  if (supported) {
    let newInsightCore = supported.candidate.text;
    if (transcript) {
      newInsightCore += ' — refined via agentic research';
    }
    top.insightCore = newInsightCore;
    top.thinkingProcess = top.thinkingProcess || {};
    top.thinkingProcess.verification = supported;
    if (supported.verdict === 'supported') {
      top.confidence = Math.max(top.confidence ?? 0, 0.85);
    }
  } else if (transcript) {
    // if no supported verdict, but we have a transcript, we should still update the core
    top.insightCore += ' — refined via agentic research';
  }

  return results;
}

export const findSynapticLink = async (
    newNote: Note, existingNotes: Note[], setLoadingState: Dispatch<SetStateAction<LoadingState>>, vectorStore: VectorStore,
    language: Language = 'en', t: TFunction, tier: Tier = 'pro'
): Promise<InsightResult[]> => {
    if (existingNotes.length === 0) return [];

    const startTime = Date.now();
    const budget = policyFor(tier);

    let memoryWorkspace = {
        probes: new Set<string>(), retrievedNoteIds: new Set<string>(),
        bestResults: [] as InsightResult[], impasseReason: "Initial search."
    };
    let cycle = 0;
    for (cycle = 1; cycle <= budget.maxCycles; cycle++) {
        let currentQueries: string[];
        if (cycle === 1) {
            setLoadingState({ active: true, messages: [t('thinkingBrainstorming')] });
            currentQueries = await generateSearchQueries(newNote, budget);
        } else {
            setLoadingState(prev => ({ ...prev, messages: [...prev.messages, t('thinkingReflecting')] }));
            currentQueries = await selfProbe(newNote, memoryWorkspace.impasseReason, Array.from(memoryWorkspace.probes), budget);
            if (currentQueries.length === 0) break;
            setLoadingState(prev => ({ ...prev, messages: [...prev.messages, t('thinkingReprobing', memoryWorkspace.impasseReason.substring(0, 40) + '...')] }));
        }
        
        currentQueries.forEach(q => memoryWorkspace.probes.add(q));

        setLoadingState(prev => ({ ...prev, messages: [...prev.messages, t('thinkingSearching')] }));
        const candIds = await retrieveCandidateNotesHQ(
            Array.from(memoryWorkspace.probes), vectorStore, existingNotes, newNote.id,
            budget.perQueryK, budget.finalK
        );
        let noteGroups: Note[][] = [];
        if (budget.maxHopDepth > 1) {
            noteGroups = await retrieveMultiHopChains(candIds, existingNotes, vectorStore, budget);
        } else {
            const candNotes = existingNotes.filter(n => candIds.includes(n.id));
            noteGroups = candNotes.map(n => [n]);
        }
        const flatIds = Array.from(new Set(noteGroups.flat().map(n => n.id)));
        const newCandIds = flatIds.filter(id => !memoryWorkspace.retrievedNoteIds.has(id));
        if (newCandIds.length === 0 && cycle > 1) break;

        newCandIds.forEach(id => memoryWorkspace.retrievedNoteIds.add(id));

        const groupsWithChunks = noteGroups.map(g => g.filter(n => n.parentChunks && n.parentChunks.length > 0)).filter(g => g.length > 0);
        if (groupsWithChunks.length === 0) continue;

        const results = await runSynthesisAndRanking(newNote, groupsWithChunks, setLoadingState, t, language, Array.from(memoryWorkspace.probes), budget);

        if (results.length > 0) {
            const combined = [...memoryWorkspace.bestResults, ...results];
            combined.sort((a,b) => (b.confidence ?? 0) - (a.confidence ?? 0));
            const uniqueResults = Array.from(new Map(combined.map(r => [(r.thinkingProcess?.retrievedCandidateIds || [r.oldNoteId]).join('+'), r])).values());
            memoryWorkspace.bestResults = uniqueResults.slice(0,3);
        }

        const topConfidence = memoryWorkspace.bestResults[0]?.confidence ?? 0;
        if (topConfidence > 0.85 && cycle === 1) break; // Early exit on high confidence in first cycle

        memoryWorkspace.impasseReason = `Best connection has conviction of only ${(topConfidence * 100).toFixed(0)}%. It may lack a clear mechanism or predictive power.`;

        if (cycle < budget.maxCycles) {
            const topResult = memoryWorkspace.bestResults[0];
            const evTexts = topResult?.evidenceRefs.map(r => r.quote) ?? [];
            const candidateScores = memoryWorkspace.bestResults.map(r => r.confidence ?? 0);

            const sig = computeSignals({
                queries: Array.from(memoryWorkspace.probes),
                candidateScores,
                evidenceTexts: evTexts
            });

            const est = {
                tokens: evTexts.reduce((a, b) => a + estTokens(b), 0),
                llmCalls: 1
            };

            logMetrics({
                tier,
                depthCycles: cycle,
                tokensEstimated: est.tokens,
                llmCalls: est.llmCalls,
                candidateNotes: flatIds.length,
                evidenceSnippets: topResult?.evidenceRefs.length ?? 0,
                signals: sig,
                mode: topResult?.mode,
                latencyMs: Date.now() - startTime
            });

            if (!shouldDeepen(cycle, sig, budget)) {
                break;
            }
        }
    }

    memoryWorkspace.bestResults.forEach(r => {
        if (r.thinkingProcess) {
            r.thinkingProcess.searchQueries = Array.from(memoryWorkspace.probes);
            const chainIds = r.thinkingProcess.retrievedCandidateIds || [];
            const allIds = Array.from(new Set([...chainIds, ...Array.from(memoryWorkspace.retrievedNoteIds)]));
            r.thinkingProcess.retrievedCandidateIds = allIds;
        }
    });

    const finalResults = await postProcessWithAgentic({ tier, newNote, results: memoryWorkspace.bestResults });

    return finalResults;
};
