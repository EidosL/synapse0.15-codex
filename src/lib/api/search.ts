import { NoteId } from '../types';

const API_BASE_URL = (import.meta as any).env?.VITE_API_BASE_URL || '';

interface SearchResult {
    chunk_id: string;
    score: number;
}

// A helper to handle fetch responses
const handleResponse = async (response: Response) => {
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API Error: ${response.statusText} - ${errorText}`);
    }
    return response.json();
};

export const findSimilarChunks = async (noteId: NoteId, k: number): Promise<SearchResult[]> => {
    const response = await fetch(`${API_BASE_URL}/api/search/similar_chunks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note_id: noteId, k }),
    });
    return handleResponse(response);
};
