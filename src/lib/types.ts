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
    // The new deep synthesis steps will be captured in the final insight object itself,
    // so the thinking process can be simplified slightly or expanded later if needed.
}

export interface Insight {
    id:string;
    newNoteId: string;
    oldNoteId: string;
    status: 'new' | 'kept' | 'dismissed';
    createdAt: string;
    thinkingProcess?: InsightThinkingProcess;
    
    // --- Deep Schema Fields ---
    connectionType: string;
    oneSentence: string;              // The crisp bridge line (replaces 'explanation')
    mechanisticChain?: string[];      // 3-5 causal steps
    stateVariables?: string[];        // named entities/variables that change
    mappingTable?: { source: string, target: string }[]; // for Analogies
    boundaryConditions?: string[];    // “only if…/fails when…”
    counterfactual?: string;          // nearest-change “if not A then…”
    disanalogy?: string;              // at least one key mismatch
    predictions?: string[];           // 1-2 testable predictions
    
    // --- Evidence & Confidence ---
    evidenceA?: string[];
    evidenceB?: string[];
    confidence?: number;
}
