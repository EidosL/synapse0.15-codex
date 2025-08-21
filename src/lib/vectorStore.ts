class VectorStore {
    private vectors: Map<string, number[]> = new Map();
    // Map of child chunk ID to its parent chunk ID (e.g., noteId:pIndex)
    private childToParent: Map<string, string> = new Map();

    private dotProduct(vecA: number[], vecB: number[]): number {
        return vecA.reduce((sum, val, i) => sum + val * vecB[i], 0);
    }

    private magnitude(vec: number[]): number {
        return Math.sqrt(vec.reduce((sum, val) => sum + val * val, 0));
    }

    private cosineSimilarity(vecA: number[], vecB: number[]): number {
        const dot = this.dotProduct(vecA, vecB);
        const magA = this.magnitude(vecA);
        const magB = this.magnitude(vecB);
        if (magA === 0 || magB === 0) return 0;
        return dot / (magA * magB);
    }

    addVector(chunkId: string, vector: number[], parentId?: string) {
        this.vectors.set(chunkId, vector);
        if (parentId) this.childToParent.set(chunkId, parentId);
    }
    
    getVector(chunkId: string): number[] | undefined {
        return this.vectors.get(chunkId);
    }

    removeNoteVectors(noteId: string) {
        const keysToDelete: string[] = [];
        for (const key of this.vectors.keys()) {
            if (key.startsWith(`${noteId}:`)) {
                keysToDelete.push(key);
            }
        }
        keysToDelete.forEach(key => {
            this.vectors.delete(key);
            this.childToParent.delete(key);
        });
    }

    isNoteIndexed(noteId: string): boolean {
        for (const key of this.vectors.keys()) {
            if (key.startsWith(`${noteId}:`)) {
                return true;
            }
        }
        return false;
    }
    findNearest(queryVector: number[], k: number, noteIdToExclude: string): { chunkId: string; parentChunkId: string }[] {
        const similarities: { id: string; similarity: number }[] = [];


        for (const [chunkId, noteVector] of this.vectors.entries()) {
            // chunkId format: "noteId:parentIndex:childIndex"
            if (chunkId.startsWith(`${noteIdToExclude}:`)) {
                continue;
            }

            const similarity = this.cosineSimilarity(queryVector, noteVector);
            similarities.push({ id: chunkId, similarity });
        }

        similarities.sort((a, b) => b.similarity - a.similarity);
        return similarities.slice(0, k).map(s => {
            const parts = s.id.split(':');
            const parentChunkId = parts.slice(0, 2).join(':');
            return { chunkId: s.id, parentChunkId };
        });
    }
}

const vectorStoreInstance = new VectorStore();

export const getVectorStore = () => {
    return vectorStoreInstance;
};