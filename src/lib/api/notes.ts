import { Note, NoteId } from '../types';

// Prefer env-configured base URL; default to same-origin (empty prefix)
const API_BASE_URL = (import.meta as any).env?.VITE_API_BASE_URL || '';

// A helper to handle fetch responses
const handleResponse = async (response: Response) => {
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API Error: ${response.statusText} - ${errorText}`);
    }
    return response.json();
};

export const getNotes = async (): Promise<Note[]> => {
    const response = await fetch(`${API_BASE_URL}/api/notes/`);
    const notesData = await handleResponse(response);
    return notesData.map((note: any) => ({
        id: String(note.id),
        title: String(note.title || ''),
        content: note.content ?? '',
        createdAt: new Date(note.created_at).toISOString(),
        // chunks are optional; omit unless supplied
    }));
};

export const createNote = async (noteData: { title: string; content: string }): Promise<Note> => {
    const response = await fetch(`${API_BASE_URL}/api/notes/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(noteData),
    });
    const note = await handleResponse(response);
    return {
        id: String(note.id),
        title: String(note.title || ''),
        content: note.content ?? '',
        createdAt: new Date(note.created_at).toISOString(),
    };
};

export const updateNote = async (noteId: NoteId, noteData: Partial<{ title: string; content: string }>): Promise<Note> => {
    const response = await fetch(`${API_BASE_URL}/api/notes/${noteId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(noteData),
    });
    const note = await handleResponse(response);
    return {
        id: String(note.id),
        title: String(note.title || ''),
        content: note.content ?? '',
        createdAt: new Date(note.created_at).toISOString(),
    };
};

export const deleteNote = async (noteId: NoteId): Promise<Note> => {
    const response = await fetch(`${API_BASE_URL}/api/notes/${noteId}`, {
        method: 'DELETE',
    });
    const note = await handleResponse(response);
    return {
        id: String(note.id),
        title: String(note.title || ''),
        content: note.content ?? '',
        createdAt: new Date(note.created_at).toISOString(),
    };
};
