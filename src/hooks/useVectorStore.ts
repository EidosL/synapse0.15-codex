import { useRef } from 'react';
import { VectorStore } from '../lib/vectorStore';

export const useVectorStore = () => {
    const vectorStoreRef = useRef<VectorStore | null>(null);

    if (vectorStoreRef.current === null) {
        vectorStoreRef.current = new VectorStore();
    }

    return vectorStoreRef.current;
};
