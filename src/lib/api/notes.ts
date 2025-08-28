import { Note, NoteId } from '../types';

const API_BASE_URL = 'http://localhost:8000'; // This should be in a config file

// A helper to handle fetch responses
const handleResponse = async (response: Response) => {
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API Error: ${response.statusText} - ${errorText}`);
    }
    return response.json();
};

export const getNotes = async (): Promise<Note[]> => {
    const response = await fetch(`${API_BASE_URL}/api/notes`);
    const notesData = await handleResponse(response);
    // TODO: Need to align the backend's Note schema with the frontend's Note type
    return notesData.map((note: any) => ({
        ...note,
        createdAt: new Date(note.created_at),
        updatedAt: new Date(note.updated_at),
    }));
};

export const createNote = async (noteData: { title: string; content: string }): Promise<Note> => {
    const response = await fetch(`${API_BASE_URL}/api/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(noteData),
    });
    const note = await handleResponse(response);
    return {
        ...note,
        createdAt: new Date(note.created_at),
        updatedAt: new Date(note.updated_at),
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
        ...note,
        createdAt: new Date(note.created_at),
        updatedAt: new Date(note.updated_at),
    };
};

export const deleteNote = async (noteId: NoteId): Promise<Note> => {
    const response = await fetch(`${API_BASE_URL}/api/notes/${noteId}`, {
        method: 'DELETE',
    });
    const note = await handleResponse(response);
    return {
        ...note,
        createdAt: new Date(note.created_at),
        updatedAt: new Date(note.updated_at),
    };
};
