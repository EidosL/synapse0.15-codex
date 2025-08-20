import { GoogleGenAI, Type } from '@google/genai';
import type { Dispatch, SetStateAction } from 'react';
import type { Note, Insight, InsightThinkingProcess, ParentChunk, ChildChunk } from './types';
import type { VectorStore } from './vectorStore';
import type { Language, translations } from '../context/LanguageProvider';

// --- API & AI ---
export const MODEL_NAME = 'gemini-2.5-flash';
export const EMBEDDING_MODEL_NAME = 'text-embedding-004';
export const RERANK_MODEL_NAME = 'google/gemini-cross-encoder';

let aiInstance: GoogleGenAI | null = null;
if (process.env.API_KEY) {
    aiInstance = new GoogleGenAI({ apiKey: process.env.API_KEY });
} else {
    console.error("API_KEY environment variable not set. AI features will be disabled.");
}

export const ai = aiInstance;

const CHINESE_OUTPUT_INSTRUCTION = "\n\nCRITICAL: You MUST respond exclusively in Simplified Chinese.";

export const safeParseGeminiJson = <T,>(text: string): T | null => {
    let jsonText = text.trim();

    // 1. Attempt to find a JSON blob within markdown fences
    const markdownMatch = jsonText.match(/```(json)?\s*([\s\S]*?)\s*```/);
    if (markdownMatch && markdownMatch[2]) {
        jsonText = markdownMatch[2].trim();
    } else {
        // 2. If no fences, find the first '{' or '[' and the last '}' or ']' to extract a potential JSON object/array.
        // This handles cases where the model provides conversational text around the JSON.
        const firstBracket = jsonText.indexOf('[');
        const firstBrace = jsonText.indexOf('{');
        
        let start = -1;
        // Find the earliest start of a JSON structure
        if (firstBracket === -1) {
            start = firstBrace;
        } else if (firstBrace === -1) {
            start = firstBracket;
        } else {
            start = Math.min(firstBracket, firstBrace);
        }

        if (start !== -1) {
            const lastBracket = jsonText.lastIndexOf(']');
            const lastBrace = jsonText.lastIndexOf('}');
            
            // Find the latest end of a JSON structure
            const end = Math.max(lastBracket, lastBrace);
            
            if (end > start) {
                jsonText = jsonText.substring(start, end + 1);
            }
        }
    }
    
    if (jsonText.toLowerCase() === 'null') {
        return null;
    }

    try {
        // First, try to parse the extracted text as-is.
        return JSON.parse(jsonText) as T;
    } catch (error) {
        console.warn("Initial JSON parsing failed. Attempting to repair common LLM errors.", error);
        try {
            // Repair attempt: Fix unescaped backslashes. This is a common issue.
            const repairedJsonText = jsonText.replace(/\\(?![bfnrt"\\/])/g, '\\\\');
            return JSON.parse(repairedJsonText) as T;
        }
        catch (repairError) {
            console.error("Failed to parse Gemini JSON response, even after repair attempt:", repairError);
            console.error("Original text:", text); // Log the original, raw text from the model
            return null;
        }
    }
};

export const semanticChunker = async (text: string, title: string = '', language: Language): Promise<ParentChunk[]> => {
    const buildStructure = (segments: string[]): ParentChunk[] => {
        return segments.map((seg, idx) => {
            const sentences = seg.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 0);
            const children: ChildChunk[] = sentences.map((s, cIdx) => ({
                id: `${idx}-${cIdx}`,
                text: s
            }));
            return {
                id: `${idx}`,
                text: seg,
                children
            };
        });
    };

    if (!ai) {
        const paras = text.split(/\n\s*\n/).filter(p => p.trim().length > 50);
        return buildStructure(paras);
    }

    let prompt = `You are an expert in semantic text chunking. Your task is to split the following document into a JSON array of semantically coherent chunks.
Each chunk should be a self-contained unit of meaning, typically a few paragraphs long. Do not create chunks that are too short. Merge small paragraphs into larger meaningful chunks. Preserve markdown formatting.
Document Title: ${title}
Document Content:
---
${text.slice(0, 20000)}
---
Return ONLY the JSON array of strings.`;

    if (language === 'zh') {
        prompt += CHINESE_OUTPUT_INSTRUCTION;
    }

    try {
        const response = await ai.models.generateContent({
            model: MODEL_NAME,
            contents: prompt,
            config: {
                responseMimeType: 'application/json',
                responseSchema: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING }
                }
            }
        });
        const chunks = safeParseGeminiJson<string[]>(response.text);
        const parents = chunks && chunks.length > 0 ? chunks : [text];
        return buildStructure(parents);
    } catch (error) {
        console.error("Semantic chunking failed:", error);
        const paras = text.split(/\n\s*\n/).filter(p => p.trim().length > 50);
        return buildStructure(paras);
    }
};


export const generateEmbedding = async (text: string): Promise<number[]> => {
    if (!ai) return [];
    try {
        const result = await ai.models.embedContent({
            model: EMBEDDING_MODEL_NAME,
            contents: text,
        });
        return result.embeddings[0].values;
    } catch (error) {
        console.error("Error generating embedding:", error);
        return [];
    }
};

export const generateBatchEmbeddings = async (texts: string[]): Promise<number[][]> => {
    if (!ai || texts.length === 0) return texts.map(() => []);
    try {
        const res = await ai.models.embedContent({
            model: EMBEDDING_MODEL_NAME,
            contents: texts,
        });
        if (!res?.embeddings || res.embeddings.length !== texts.length) {
            throw new Error('SDK did not return one embedding per input, falling back.');
        }
        return res.embeddings.map(e => e.values);
    } catch (error) {
        console.warn("Batch embedding failed, using micro-batch fallback:", error);
        const out: number[][] = new Array(texts.length).fill([]);
        const BATCH_SIZE = 100; // text-embedding-004 has a higher batch limit
        for (let i = 0; i < texts.length; i += BATCH_SIZE) {
            const chunk = texts.slice(i, i + BATCH_SIZE);
            try {
                 const chunkRes = await ai.models.embedContent({
                    model: EMBEDDING_MODEL_NAME,
                    contents: chunk,
                });
                if (chunkRes?.embeddings && chunkRes.embeddings.length === chunk.length) {
                    chunkRes.embeddings.forEach((v, k) => out[i+k] = v.values);
                }
            } catch (innerError) {
                 console.error(`Error in micro-batch starting at index ${i}`, innerError)
            }
        }
        return out;
    }
};


// --- QUALITY-FIRST RAG PIPELINE ---

// 1) Canonical relation types + normalizer
const RELATIONS = [
  'Contradiction',
  'PracticalApplication',
  'HistoricalAnalogy',
  'ProblemToSolution',
  'DeepSimilarity',
  'Mechanism',
  'Boundary',
  'TradeOff',
] as const;

type Relation = typeof RELATIONS[number];

const canonicalizeRelation = (s: string): Relation | null => {
  const t = s.replace(/\s|-/g, '').toLowerCase();
  const map: Record<string, Relation> = {
    contradiction: 'Contradiction',
    practicalapplication: 'PracticalApplication',
    practical: 'PracticalApplication',
    historicalanalogy: 'HistoricalAnalogy',
    problemtosolution: 'ProblemToSolution',
    problemsolution: 'ProblemToSolution',
    deepsimilarity: 'DeepSimilarity',
    mechanism: 'Mechanism',
    boundary: 'Boundary',
    tradeoff: 'TradeOff',
    'trade-off': 'TradeOff',
    // Chinese mappings
    '矛盾': 'Contradiction',
    '实际应用': 'PracticalApplication',
    '历史类比': 'HistoricalAnalogy',
    '问题到解决方案': 'ProblemToSolution',
    '深度相似性': 'DeepSimilarity',
    '机制': 'Mechanism',
    '边界': 'Boundary',
    '权衡': 'TradeOff',
  };
  const found = Object.keys(map).find(key => t.includes(key));
  return found ? map[found] : null;
};


// STAGE 1: Query Expansion (Robust Version)
const buildRelationSchema = () => ({
  type: Type.OBJECT,
  properties: RELATIONS.reduce((acc, key) => ({ ...acc, [key]: { type: Type.STRING } }), {}),
  required: []
});

const cheapExpandQueries = (topic: string) => ({
  Contradiction:        `${topic} limitation counterexample contradiction`,
  PracticalApplication: `${topic} how to apply implementation checklist`,
  HistoricalAnalogy:    `${topic} historical precedent analogous case`,
  ProblemToSolution:    `${topic} bottleneck solution workaround`,
  DeepSimilarity:       `${topic} pattern structure isomorphic`,
  Mechanism:            `${topic} mechanism pathway causes via`,
  Boundary:             `${topic} only if fails when under condition`,
  TradeOff:             `${topic} trade-off at the cost of diminishing returns`
});

const generateSearchQueries = async (note: Note): Promise<string[]> => {
    const topic = (note.title || '').trim() || note.content.slice(0, 120);
    const cheap = cheapExpandQueries(topic);
    if (!ai) return Object.values(cheap).slice(0, 5);

    try {
        const response = await ai.models.generateContent({
            model: MODEL_NAME,
            contents: `Return JSON with ANY subset of keys: ${RELATIONS.join(', ')}.
Each value must be a concise search query derived from:
Title: ${note.title}
Content: ${note.content.slice(0, 1000)}`,
            config: { responseMimeType: "application/json", responseSchema: buildRelationSchema() }
        });
        const obj = safeParseGeminiJson<Record<string, string>>(response.text) || {};
        const merged = Array.from(new Set([
            ...Object.values(obj).filter(Boolean),
            ...Object.values(cheap), // Add fallback for coverage
        ]));
        return merged.slice(0, 8); // Cap for cost
    } catch (error) {
        console.error("Error generating search queries, using fallback:", error);
        return Object.values(cheap).slice(0, 5);
    }
};

// STAGE 2: Quality-first hybrid retrieval (vector + lexical) with RRF

const tokenize = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g,' ').split(/\s+/).filter(w => w.length>2);

const tfIdfScores = (queries: string[], notes: Note[]) => {
  const terms = new Set<string>();
  queries.forEach(q => tokenize(q).forEach(t => terms.add(t)));
  const allTerms = Array.from(terms);

  const N = notes.length;
  const df = new Map<string, number>();
  for (const t of allTerms) df.set(t, 0);
  
  for (const n of notes) {
    const seen = new Set(tokenize(n.title + ' ' + n.content));
    for (const t of allTerms) if (seen.has(t)) df.set(t, (df.get(t) || 0) + 1);
  }
  const idf = new Map<string, number>();
  for (const t of allTerms) idf.set(t, Math.log((N + 1) / ((df.get(t) || 0) + 1)) + 1);

  const scores = new Map<string, number>();
  for (const n of notes) {
    const tokens = tokenize(n.title + ' ' + n.content);
    const tf = new Map<string, number>();
    tokens.forEach(t => tf.set(t, (tf.get(t) || 0) + 1));
    const len = tokens.length || 1;
    let s = 0;
    for (const t of allTerms) {
      const tfv = (tf.get(t) || 0) / len;
      s += tfv * (idf.get(t) || 0);
    }
    scores.set(n.id, s);
  }
  return Array.from(scores.entries())
    .sort((a,b)=> b[1]-a[1])
    .map(([id,score]) => ({id, score}));
};

const rrf = (rankedLists: string[][], k = 60) => {
  const score = new Map<string, number>();
  for (const list of rankedLists) {
    list.forEach((id, idx) => {
      const r = idx + 1;
      score.set(id, (score.get(id) || 0) + 1 / (k + r));
    });
  }
  return Array.from(score.entries()).sort((a,b)=> b[1]-a[1]).map(([id]) => id);
};

const retrieveCandidateNotesHQ = async (
  queries: string[],
  vectorStore: VectorStore,
  notes: Note[],
  newNoteId: string,
  perQueryK = 10,
  finalK = 8
): Promise<string[]> => {
  if (!queries.length || !notes.length) return [];

  const vecLists: string[][] = [];
  const queryEmbeddings = await generateBatchEmbeddings(queries);

  queryEmbeddings.forEach(embedding => {
      if (embedding.length > 0) {
          const matches = vectorStore.findNearest(embedding, perQueryK, newNoteId);
          // Map child chunk matches back to their parent chunks then note IDs
          const noteIds = matches.map(m => m.parentChunkId.split(':')[0]);
          vecLists.push(noteIds);
      }
  });

  // RRF expects unique items per list. We will fuse de-duplicated lists.
  const uniqueNoteIdVecLists = vecLists.map(list => [...new Set(list)]);

  const lexRank = tfIdfScores(queries, notes)
      .slice(0, perQueryK * 2).map(x => x.id);

  const fused = rrf([...uniqueNoteIdVecLists, lexRank]);
  return fused.slice(0, finalK);
};

// Evaluate retrieval relevance using LLM
export const evaluateRetrieval = async (
    queries: string[],
    candidates: Note[]
): Promise<{ oldNoteId: string; score: number }[]> => {
    if (!ai) {
        return candidates.map(c => ({ oldNoteId: c.id, score: 1 }));
    }

    const results: { oldNoteId: string; score: number }[] = [];
    for (const note of candidates) {
        const prompt = `You are evaluating how relevant a note is to a set of search queries. ` +
            `Rate the relevance from 0 to 1 where 1 is highly relevant. ` +
            `Return JSON {"score": <number>}.\nQueries: ${queries.join("; ")}\n` +
            `Note title: ${note.title}\nContent: ${note.content.slice(0, 500)}`;
        try {
            const resp = await ai.models.generateContent({
                model: MODEL_NAME,
                contents: prompt,
                config: {
                    responseMimeType: 'application/json',
                    responseSchema: {
                        type: Type.OBJECT,
                        properties: {
                            score: { type: Type.NUMBER }
                        }
                    }
                }
            });
            const parsed = safeParseGeminiJson<{ score: number }>(resp.text);
            results.push({ oldNoteId: note.id, score: parsed?.score ?? 0 });
        } catch (err) {
            console.error('Retrieval evaluation failed:', err);
            results.push({ oldNoteId: note.id, score: 0 });
        }
    }
    return results;
};

// STAGE 3: Contextual Focusing, Batch Synthesis & Verification
const cosine = (a:number[], b:number[]) => {
  let s=0, na=0, nb=0;
  for (let i=0;i<a.length;i++){ s+=a[i]*b[i]; na+=a[i]*a[i]; nb+=b[i]*b[i]; }
  return s / (Math.sqrt(na)*Math.sqrt(nb) + 1e-9);
};

const findBestChunkPair = (noteA: Note, noteB: Note, vectorStore: VectorStore): { aSnips: string[], bSnips: string[] } => {
    const flatten = (note: Note): { texts: string[]; vectors: number[][] } => {
        const texts: string[] = [];
        const vectors: number[][] = [];
        note.parentChunks?.forEach((pc, pi) => {
            pc.children.forEach((child, ci) => {
                texts.push(child.text);
                const v = vectorStore.getVector(`${note.id}:${pi}:${ci}`);
                if (v) vectors.push(v);
            });
        });
        return { texts, vectors };
    };

    const { texts: chunksA, vectors: vectorsA } = flatten(noteA);
    const { texts: chunksB, vectors: vectorsB } = flatten(noteB);
    if (chunksA.length === 0 || chunksB.length === 0) return { aSnips: [], bSnips: []};

    if (vectorsA.length === 0 || vectorsB.length === 0) return { aSnips: [], bSnips: []};

    let maxSim = -1;
    let bestPair = { idxA: 0, idxB: 0 };

    for(let i = 0; i < vectorsA.length; i++) {
        for (let j = 0; j < vectorsB.length; j++) {
            const sim = cosine(vectorsA[i], vectorsB[j]);
            if (sim > maxSim) {
                maxSim = sim;
                bestPair = { idxA: i, idxB: j };
            }
        }
    }

    const { idxA, idxB } = bestPair;
    // Context window: include chunk before and after the best match
    const getContextualSnips = (chunks: string[], index: number) => {
        const snips = [];
        if (index > 0) snips.push(chunks[index - 1]);
        snips.push(chunks[index]);
        if (index < chunks.length - 1) snips.push(chunks[index + 1]);
        return snips;
    }
    
    return {
        aSnips: getContextualSnips(chunksA, idxA),
        bSnips: getContextualSnips(chunksB, idxB),
    };
}


const LEX_HINTS = {
  Mechanism: [/because|due to|via|leads to|mediated by|mechanism|pathway/i],
  Boundary:  [/only if|under|assuming|fails when|valid when|unless/i],
  TradeOff:  [/at the cost of|trade[\s-]?off|diminishing returns|increase.*decrease|Pareto/i],
  Contradiction:[/however|but|contradict|except that/i],
  PracticalApplication:[/how to|apply|implementation|steps|checklist/i],
  HistoricalAnalogy:[/analog(y|ous)|precedent|as in|like in/i],
  ProblemToSolution:[/bottleneck|solution|workaround|fix|mitigate/i],
  DeepSimilarity:[/isomorphic|structure|pattern|topology/i],
} as const;

const pickHint = (a: string, b: string): Relation => {
  const blob = `${a}\n${b}`;
  let best: {r: Relation, s:number} | null = null;
  (Object.keys(LEX_HINTS) as Relation[]).forEach(r => {
    const s = Math.min((LEX_HINTS[r].reduce((acc,rx)=> acc + ((blob.match(rx)||[]).length), 0)), 3)/3;
    if (!best || s > best.s) best = { r, s };
  });
  return best?.r || 'DeepSimilarity';
};


type ShallowSynthOut = {
  id: string; // oldNoteId
  connectionType: Relation;
  explanation: string;
  evidenceA: string[];
  evidenceB: string[];
  confidence: number;
};

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').replace(/[“”"']/g, '"').replace(/[–—]/g, '-').trim();
const containsQuote = (full: string, q: string) => norm(full).includes(norm(q));

const batchSynthesizeAndVerify = async (
  newNote: Note, candNotes: Note[], vectorStore: VectorStore, language: Language = 'en'
): Promise<ShallowSynthOut[]> => {
    if (!ai || candNotes.length === 0) return [];
    
    type SynthInput = {
      id: string; 
      relationHint: Relation;
      aTitle: string; aSnips: string[];
      bTitle: string; bSnips: string[];
    };

    const synthInputs: SynthInput[] = candNotes.map(candNote => {
        const { aSnips, bSnips } = findBestChunkPair(newNote, candNote, vectorStore);
        return {
            id: candNote.id,
            relationHint: pickHint(aSnips.join('\n'), bSnips.join('\n')),
            aTitle: newNote.title, aSnips,
            bTitle: candNote.title, bSnips,
        };
    }).filter(item => item.aSnips.length > 0 && item.bSnips.length > 0);

    if (synthInputs.length === 0) return [];

    let prompt = `You are a rigorous research synthesizer.
For EACH item, produce ONE profound, non-obvious, SINGLE-SENTENCE connection between Note A and Note B based on the provided snippets.
Start from relationHint if plausible; you may change it if evidence contradicts.
Return JSON array with fields:
- id (string) — must equal the input id
- connectionType (enum: ${RELATIONS.join(', ')})
- explanation (string) — ONE sentence
- evidenceA (array<string>) — 1-2 VERBATIM snippets (<=12 words) from A's snippets that support the claim
- evidenceB (array<string>) — 1-2 VERBATIM snippets (<=12 words) from B's snippets that support the claim
- confidence (number 0..1)
If you cannot justify the claim with quotes from BOTH A and B, output explanation="" for that item.

Now the items:
${JSON.stringify(synthInputs, null, 2)}
`;

  if (language === 'zh') {
    prompt += CHINESE_OUTPUT_INSTRUCTION;
  }

  const res = await ai.models.generateContent({
    model: MODEL_NAME,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            id: { type: Type.STRING },
            connectionType: { type: Type.STRING },
            explanation: { type: Type.STRING },
            evidenceA: { type: Type.ARRAY, items: { type: Type.STRING } },
            evidenceB: { type: Type.ARRAY, items: { type: Type.STRING } },
            confidence: { type: Type.NUMBER },
          },
          required: ["id","connectionType","explanation","evidenceA","evidenceB","confidence"]
        }
      }
    }
  });

  const raw = safeParseGeminiJson<any[]>(res.text) || [];
  const out: ShallowSynthOut[] = [];

  for (const r of raw) {
    const rel = canonicalizeRelation(r.connectionType);
    if (!rel || !r.explanation) continue;

    const sourceNote = candNotes.find(n => n.id === r.id);
    if (!sourceNote) continue;
    
    const ea = (r.evidenceA || []).filter((q:string) => q.split(/\s+/).length <= 12);
    const eb = (r.evidenceB || []).filter((q:string) => q.split(/\s+/).length <= 12);
    
    // Verification quality gate: at least ONE valid quote from each side, checked against the FULL original content.
    const okA = ea.length > 0 && ea.some((q:string) => containsQuote(newNote.content, q));
    const okB = eb.length > 0 && eb.some((q:string) => containsQuote(sourceNote.content, q));
    if (!okA || !okB) continue;

    out.push({
      id: r.id,
      connectionType: rel,
      explanation: r.explanation.trim().replace(/\s+/g,' '),
      evidenceA: ea.slice(0,2),
      evidenceB: eb.slice(0,2),
      confidence: Math.max(0, Math.min(1, r.confidence ?? 0.5)),
    });
  }
  return out;
};

// STAGE 4: Quality-first ranking (entailment + novelty + diversity)
const rankInsightsQualityFirst = async (
  newNote: Note,
  candidates: Note[],
  synths: ShallowSynthOut[],
  top = 3
): Promise<(ShallowSynthOut & { novelty: number })[]> => {
  if (synths.length === 0) return [];
  const textsToEmbed = synths.map(s => {
    const c = candidates.find(x => x.id === s.id)!;
    return [
      newNote.title + ' ' + newNote.content.slice(0,512),
      c.title + ' ' + c.content.slice(0,512),
      s.explanation
    ] as const;
  }).flat();
  
  const vecs = await generateBatchEmbeddings(textsToEmbed);
  const triples: { synth: ShallowSynthOut, vE: number[], novelty: number }[] = [];
  for (let i=0;i<synths.length;i++){
    const vA = vecs[i*3], vB = vecs[i*3+1], vE = vecs[i*3+2];
    const simNotes = (vA.length && vB.length) ? cosine(vA, vB) : 0;
    const novelty = 1 - Math.min(simNotes, 0.95);
    triples.push({ synth: synths[i], vE, novelty });
  }

  const scored = triples.map(t => {
    const relBonus =
      t.synth.connectionType === 'Boundary' || t.synth.connectionType === 'Mechanism' ? 0.05 :
      t.synth.connectionType === 'TradeOff' ? 0.03 : 0;
    const specificity = (t.synth.evidenceA.join(' ').match(/\d/) || t.synth.evidenceB.join(' ').match(/\d/)) ? 0.05 : 0;
    const score = 0.55 * t.synth.confidence + 0.30 * t.novelty + 0.10 * specificity + relBonus;
    return { ...t, score };
  }).sort((a,b)=> b.score - a.score);

  // MMR for diversity
  let remaining = [...scored];
  const selected: (typeof scored[number])[] = [];
  const lambda = 0.7; 

  if (remaining.length > 0) {
    selected.push(remaining.shift()!);
  }
  
  while (selected.length < Math.min(top, scored.length) && remaining.length > 0) {
    let best = -1;
    let bestVal = -Infinity;
    
    for (let i=0; i < remaining.length; i++) {
        const cand = remaining[i];
        const simToSel = Math.max(
            ...selected.map(s => (cand.vE.length && s.vE.length) ? cosine(cand.vE, s.vE) : 0)
        );
        const val = lambda * cand.score - (1-lambda) * simToSel;
        if (val > bestVal) { bestVal = val; best = i; }
    }
    
    if (best !== -1) {
      selected.push(remaining.splice(best, 1)[0]);
    } else {
        break;
    }
  }
  return selected.map(x => ({ ...x.synth, novelty: x.novelty }));
};


// --- STAGE 5: DEEP SYNTHESIS (PROPOSE -> CRITIC) ---
// Helper to find relevant context sentences
const topSentencesFor = (sourceText: string, queryText: string, k: number): string[] => {
    const sentences = sourceText.replace(/\n+/g, ' ').match(/[^.!?]+[.!?]+/g) || [];
    if (sentences.length === 0) return [sourceText.slice(0, 500)];

    const queryTokens = new Set(queryText.toLowerCase().split(/\s+/).filter(w => w.length > 2));
    if (queryTokens.size === 0) return sentences.slice(0, k);

    const scored = sentences.map(sentence => {
        const sentenceTokens = sentence.toLowerCase().split(/\s+/);
        const score = sentenceTokens.reduce((acc, token) => acc + (queryTokens.has(token) ? 1 : 0), 0);
        return { sentence, score };
    });

    return scored.sort((a, b) => b.score - a.score).slice(0, k).map(s => s.sentence);
};

// The new deep insight type and schema for the AI
type DeepSynthOut = Omit<Insight, 'id' | 'newNoteId' | 'oldNoteId' | 'status' | 'createdAt' | 'thinkingProcess'> & { id: string };

const DEEP_SCHEMA = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      id: { type: Type.STRING },
      connectionType: { type: Type.STRING },
      oneSentence: { type: Type.STRING },
      mechanisticChain: { type: Type.ARRAY, items: { type: Type.STRING } },
      stateVariables: { type: Type.ARRAY, items: { type: Type.STRING } },
      mappingTable: {
        type: Type.ARRAY,
        items: { type: Type.OBJECT, properties: {
          source: { type: Type.STRING }, target: { type: Type.STRING }
        }, required: ['source','target'] }
      },
      boundaryConditions: { type: Type.ARRAY, items: { type: Type.STRING } },
      counterfactual: { type: Type.STRING },
      disanalogy: { type: Type.STRING },
      predictions: { type: Type.ARRAY, items: { type: Type.STRING } },
      evidenceA: { type: Type.ARRAY, items: { type: Type.STRING } },
      evidenceB: { type: Type.ARRAY, items: { type: Type.STRING } },
      confidence: { type: Type.NUMBER },
    },
    required: ['id','connectionType','oneSentence','evidenceA','evidenceB','confidence']
  }
};

// Propose Function
const deepPropose = async (newNote: Note, cands: Note[], language: Language = 'en'): Promise<DeepSynthOut[]> => {
  if (!ai || cands.length === 0) return [];
  
  type DeepSynthInput = {
    id: string; aTitle: string; aSnips: string[]; aQuotePool: string[];
    bTitle: string; bSnips: string[]; bQuotePool: string[]; relationHint: string;
  };

  const items: DeepSynthInput[] = cands.map(c => {
    const aSn = topSentencesFor(newNote.content, c.title + ' ' + c.content, 5);
    const bSn = topSentencesFor(c.content, newNote.title + ' ' + newNote.content, 5);
    const aPool = aSn.flatMap(s => s.split(/[.;!?]/)).map(x => x.trim()).filter(x => x && x.split(/\s+/).length <= 12 && x.length > 5).slice(0, 15);
    const bPool = bSn.flatMap(s => s.split(/[.;!?]/)).map(x => x.trim()).filter(x => x && x.split(/\s+/).length <= 12 && x.length > 5).slice(0, 15);
    return {
      id: c.id, aTitle: newNote.title, aSnips: aSn, aQuotePool: aPool,
      bTitle: c.title, bSnips: bSn, bQuotePool: bPool,
      relationHint: pickHint(aSn.join(' '), bSn.join(' '))
    };
  });

  let prompt = `You are a rigorous research synthesizer. For EACH item, produce a DEEP connection with STRUCTURE.
Rules:
- If Mechanism/ProblemToSolution: provide a 3–5 step mechanisticChain (verbs of causation).
- If HistoricalAnalogy/DeepSimilarity: provide a mappingTable of roles (at least 3 rows) AND one explicit disanalogy.
- If Boundary/TradeOff: provide boundaryConditions (2+) or metric trade-off and a counterfactual.
- CRITICAL: The evidenceA and evidenceB arrays MUST contain EXACT, UNCHANGED, VERBATIM substrings from the provided aQuotePool and bQuotePool arrays respectively. Do NOT paraphrase, invent, or alter the quotes in any way. If you cannot find a direct quote for a side, leave its evidence array empty for that item.
- Provide 1–2 testable predictions where possible.
- Keep oneSentence ≤ 40 words.
Return a JSON array conforming to the provided schema.
ITEMS:
${JSON.stringify(items, null, 2)}`;

  if (language === 'zh') {
    prompt += CHINESE_OUTPUT_INSTRUCTION;
  }

  const res = await ai.models.generateContent({
    model: MODEL_NAME, contents: prompt,
    config: { responseMimeType: 'application/json', responseSchema: DEEP_SCHEMA }
  });

  return safeParseGeminiJson<DeepSynthOut[]>(res.text) || [];
};

// Critic Function
const deepCritic = async (proposals: DeepSynthOut[], noteA: Note, notesB: Note[], language: Language = 'en'): Promise<DeepSynthOut[]> => {
    if (!ai || proposals.length === 0) return proposals;

    const fullA = noteA.content;
    const fullBMap = new Map(notesB.map(n => [n.id, n.content]));

    const verified: DeepSynthOut[] = [];
    for (const p of proposals) {
        const fullB = fullBMap.get(p.id);
        if (!fullB) continue;
        const okA = (p.evidenceA || []).every(q => containsQuote(fullA, q));
        const okB = (p.evidenceB || []).every(q => containsQuote(fullB, q));
        if (okA && okB) verified.push(p);
    }
    if (!verified.length) return [];

    let prompt = `You are a skeptical but constructive peer reviewer. For EACH item, critically evaluate and revise:
- **Evidence:** VERIFY that all quotes in evidenceA and evidenceB are EXACT substrings of the original notes. If not, REMOVE the item. This is a non-negotiable rule.
- **Structure:**
  - For Mechanism/ProblemToSolution, is the mechanisticChain a clear, causal sequence of at least 3 steps? If not, try to rewrite it or lower confidence.
  - For Analogy/DeepSimilarity, does the mappingTable have at least 3 meaningful rows and a clear disanalogy? If not, improve them or lower confidence.
  - For Boundary/TradeOff, are the boundaryConditions specific and non-obvious? If vague (e.g., "context matters"), make them concrete or lower confidence.
- **Clarity:** Tighten oneSentence to be maximally clear and concise (≤ 35 words).
- **Falsifiability:** If predictions are unfalsifiable, rewrite them to be more concrete or lower confidence.

Return the same JSON array, but only include items that PASS the evidence check. For items that pass, apply your revisions to improve them.`;

    if (language === 'zh') {
        prompt += CHINESE_OUTPUT_INSTRUCTION;
    }

    const res = await ai.models.generateContent({
        model: MODEL_NAME,
        contents: `${prompt}\nITEMS:\n${JSON.stringify(verified, null, 2)}`,
        config: { responseMimeType: 'application/json', responseSchema: DEEP_SCHEMA }
    });
    return safeParseGeminiJson<DeepSynthOut[]>(res.text) || [];
};

// Depth-aware ranking
const depthScore = (p: DeepSynthOut) => {
  const chain = (p.mechanisticChain?.length || 0);
  const mapRows = (p.mappingTable?.length || 0);
  const hasDis = p.disanalogy ? 1 : 0;
  const hasCF = p.counterfactual ? 1 : 0;
  const preds = (p.predictions?.length || 0);
  const cues = (p.oneSentence.match(/\b(because|via|leads to|causes|thereby|thus|因为|通过|导致|造成|从而|因此)\b/gi) || []).length;
  return 0.35*chain + 0.25*mapRows + 0.15*hasDis + 0.10*hasCF + 0.10*Math.min(2,preds) + 0.05*cues;
};

// --- Orchestrator for the RAG pipeline ---
type LoadingState = { active: boolean; messages: string[] };
type SetLoadingState = Dispatch<SetStateAction<LoadingState>>;
type TFunction = (key: keyof typeof translations.en, ...args: any[]) => string;


export const findSynapticLink = async (
    newNote: Note, 
    existingNotes: Note[], 
    setLoadingState: SetLoadingState, 
    vectorStore: VectorStore,
    language: Language = 'en',
    t: TFunction
): Promise<Omit<Insight, 'id' | 'status' | 'createdAt'>[]> => {
    if (existingNotes.length === 0) return [];
    const MIN_CONF = 0.65;

    // Stage 1
    setLoadingState({ active: true, messages: [t('thinkingBrainstorming')] });
    let queries = await generateSearchQueries(newNote);
    if (queries.length === 0) return [];

    // Stage 2
    setLoadingState(prev => ({ ...prev, messages: [...prev.messages, t('thinkingSearching')] }));
    const MIN_RELEVANCE = 0.3;
    const MAX_RETRIEVAL_RETRIES = 2;
    let candIds: string[] = [];
    let candNotes: Note[] = [];
    let retrievalEval: { oldNoteId: string; score: number }[] = [];
    let avgRel = 0;
    let attempt = 0;
    let usedFallback = false;

    while (attempt < MAX_RETRIEVAL_RETRIES) {
        candIds = await retrieveCandidateNotesHQ(queries, vectorStore, existingNotes, newNote.id, 10, 8);
        candNotes = existingNotes.filter(n => candIds.includes(n.id) && n.chunks && n.chunks.length > 0);
        if (candNotes.length > 0) {
            retrievalEval = await evaluateRetrieval(queries, candNotes);
            avgRel = retrievalEval.reduce((s, r) => s + r.score, 0) / (retrievalEval.length || 1);
            if (avgRel >= MIN_RELEVANCE) break;
        }
        
        queries = await generateSearchQueries(newNote); // Refresh queries on failure
        attempt++;
    }

    if (candNotes.length === 0) {
        setLoadingState({ active: false, messages: [] });
        return [];
    }
    
    // Stage 3
    setLoadingState(prev => ({ ...prev, messages: [...prev.messages, t('thinkingSynthesizing', candNotes.length)] }));
    const shallowSynthesisResults = await batchSynthesizeAndVerify(newNote, candNotes, vectorStore, language);
    const verified = shallowSynthesisResults.filter(v => v.confidence >= MIN_CONF);
    if (verified.length === 0) {
        setLoadingState({ active: false, messages: [] });
        return [];
    }

    // Stage 4
    setLoadingState(prev => ({ ...prev, messages: [...prev.messages, t('thinkingRanking')] }));
    const topSynths = await rankInsightsQualityFirst(newNote, candNotes, verified, 3);
    const topCandNotes = existingNotes.filter(n => topSynths.some(s => s.id === n.id));
    if (topCandNotes.length === 0) {
        setLoadingState({ active: false, messages: [] });
        return [];
    }

    // Stage 5
    setLoadingState(prev => ({ ...prev, messages: [...prev.messages, t('thinkingDeepening', topSynths.length)] }));
    const proposals = await deepPropose(newNote, topCandNotes, language);
    
    setLoadingState(prev => ({ ...prev, messages: [...prev.messages, t('thinkingCritiquing')] }));
    const finalInsights = await deepCritic(proposals, newNote, topCandNotes, language);
    if (finalInsights.length === 0) {
        setLoadingState({ active: false, messages: [] });
        return [];
    }
    
    // Final Ranking
    const scoredInsights = finalInsights.map(p => {
        const novelty = topSynths.find(s => s.id === p.id)?.novelty || 0.5;
        const score = 0.5 * p.confidence + 0.35 * depthScore(p) + 0.15 * novelty;
        return { ...p, score };
    }).sort((a,b) => b.score - a.score);

    // Final Assembly
    return scoredInsights.map(synth => {
        const { id, score, ...rest } = synth;
        const thinkingProcess: InsightThinkingProcess = {
            searchQueries: queries,
            retrievedCandidateIds: candIds,
            retrievalEvaluation: retrievalEval,
            synthesisCandidates: shallowSynthesisResults.map(v => ({
                oldNoteId: v.id, explanation: v.explanation, connectionType: v.connectionType
            })),
            rankingRationale: `Final rank based on weighted score of confidence, novelty, and structural depth.`,
        };

        return {
            newNoteId: newNote.id,
            oldNoteId: id,
            thinkingProcess,
            ...rest,
        };
    });
};
