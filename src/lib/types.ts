export interface ChildChunk {
    id: string;
    text: string;
}

export interface ParentChunk {
    id: string;
    text: string;
    children: ChildChunk[];
}

export interface Note {
    id: string;
    title: string;
    content: string;
    createdAt: string;
    /**
     * Flattened list of all child chunk texts. Existing logic relies on this
     * for embedding and similarity calculations.
     */
    chunks?: string[];
    parentChunks?: ParentChunk[];
}

export interface InsightThinkingProcess {
    searchQueries: string[];
    retrievedCandidateIds: string[];
    retrievalEvaluation?: { oldNoteId: string; score: number }[];
    retrievalFallback?: string;
    synthesisCandidates: { oldNoteId: string; explanation: string; connectionType: string; }[];
    rankingRationale?: string;
    cycleNumber?: number;
    impasseReason?: string;
    agenticTranscript?: string;
    refinementSummary?: string;
}

// --- New Insight Structure based on "The Architecture of Insight" ---

export interface EurekaMarkers {
  suddennessProxy: number; // 0-1
  fluency: number;         // 0-1
  conviction: number;      // 0-1
  positiveAffect: number;  // 0-1
}

export interface Hypothesis {
  name: string;
  restructuringOps: string[]; // e.g., ["invert-constraint","rename-role: container->platform"]
  statement: string;
  predictedEvidence: string[];
  disconfirmers: string[];
  analogySource?: string;
  prior: number;
  posterior: number;
}

export interface SerendipityInfo {
    trigger: string;
    projectedValue: string;
    exploitationPlan: string;
}

export interface Insight {
    id:string;
    newNoteId: string;
    oldNoteId: string;
    status: 'new' | 'kept' | 'dismissed';
    createdAt: string;
    thinkingProcess?: InsightThinkingProcess;
    
    // --- New structure from the paper ---
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

    // --- Derived & Deprecated fields ---
    confidence?: number; // Kept for sorting, derived from eurekaMarkers.conviction
    
    // Deprecated fields for backward compatibility.
    // They will not be populated by the new generation logic.
    connectionType?: string;
    oneSentence?: string;
    roleMap?: { role: string, A: string, B: string }[];
    archetypeBasis?: string[];
    disanalogy?: string;
    testableHypothesis?: string;
    hook?: string;
    evidenceA?: string[];
    evidenceB?: string[];
    mechanisticChain?: string[];
    mappingTable?: { source: string, target: string }[];
    boundaryConditions?: string[];
    counterfactual?: string;
}


// --- New types for tiered RAG architecture ---

export type SearchDepth = 'quick' | 'contextual' | 'deep';

export interface SummaryNode {
    id: string;
    title: string;
    summary: string;
    embedding: number[];
    childChunkIds: string[]; // IDs of ParentChunks in this cluster
}

export interface SummaryRelation {
    sourceId: string; // ID of a SummaryNode
    targetId: string; // ID of a SummaryNode
    description: string;
}

export interface KnowledgeGraph {
    nodes: SummaryNode[];
    relations: SummaryRelation[];
}

// --- Types for the new backend clustering ---

export interface BackendDocument {
    id: string;
    title: string;
    content: string;
}

export interface ClusterRequest {
    notes: BackendDocument[];
}

export interface ClusterSummary {
    cluster_id: number;
    summary: string;
    // We might want to add more fields from the backend if available
    // For now, this matches the Python model
}

export interface ClusteringResult {
    chunk_to_cluster_map: Record<string, number>; // Maps chunk_id to cluster_id
    cluster_summaries: ClusterSummary[];
}