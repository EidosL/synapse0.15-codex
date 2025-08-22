import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import {
    semanticChunker,
    generateBatchEmbeddings,
    findSynapticLink,
} from './ai';
import type { Note, Insight, SearchDepth } from './types';
import { getVectorStore } from './vectorStore';
import i18n from '../context/i18n';

type LoadingState = {
    active: boolean;
    messages: string[];
};

type AppState = {
    notes: Note[];
    insights: Insight[];
    loadingState: LoadingState;
    activeTab: 'vault' | 'inbox';
    isEditing: boolean;
    viewingNote: Note | null;
    isFindingLinks: string | null;
    searchDepth: SearchDepth;
    newInsightCount: number;
    language: 'en' | 'zh';
    novelty_scores: number[];
    insight_notes: string[];

    // Actions
    setActiveTab: (tab: 'vault' | 'inbox') => void;
    setIsEditing: (isEditing: boolean) => void;
    setViewingNote: (note: Note | null) => void;
    setSearchDepth: (depth: SearchDepth) => void;
    handleSaveNote: (title: string, content: string) => Promise<void>;
    handleDeleteNote: (noteId: string) => void;
    handleBulkUpload: (files: FileList) => Promise<void>;
    handleFindInsightsForNote: (noteId: string) => Promise<void>;
    handleUpdateInsight: (id: string, status: 'kept' | 'dismissed') => void;
    processNotes: () => Promise<void>;
    setLanguage: (language: 'en' | 'zh') => void;
};

export const useStore = create<AppState>()(
    persist(
        (set, get) => ({
            notes: [],
            insights: [],
            loadingState: { active: false, messages: [] },
            activeTab: 'vault',
            isEditing: false,
            viewingNote: null,
            isFindingLinks: null,
            searchDepth: 'contextual',
            newInsightCount: 0,
            language: 'en',
            novelty_scores: [],
            insight_notes: [],

            // Actions
            setActiveTab: (tab) => set({ activeTab: tab }),
            setIsEditing: (isEditing) => set({ isEditing }),
            setViewingNote: (note) => set({ viewingNote: note }),
            setSearchDepth: (depth) => set({ searchDepth: depth }),
            setLanguage: (language) => set({ language }),

            handleSaveNote: async (title, content) => {
                const { t } = i18n;
                const language = i18n.language as 'en' | 'zh';
                const vectorStore = getVectorStore();
                const noteId = `note-${Date.now()}`;

                set({ loadingState: { active: true, messages: [t('savingAndChunking')] } });

                const parentChunks = await semanticChunker(content, title, language);
                const childTexts = parentChunks.flatMap(pc => pc.children.map(c => c.text));
                const mapping = parentChunks.flatMap((pc, pi) => pc.children.map((_, ci) => ({ parentIdx: pi, childIdx: ci })));

                const newNote: Note = {
                    id: noteId,
                    title,
                    content,
                    createdAt: new Date().toISOString(),
                    chunks: childTexts,
                    parentChunks,
                };

                set({ loadingState: { active: true, messages: [t('embeddingChunks')] } });

                const embeddings = await generateBatchEmbeddings(childTexts);
                embeddings.forEach((embedding, index) => {
                    if (embedding.length > 0) {
                        const { parentIdx, childIdx } = mapping[index];
                        vectorStore.addVector(`${newNote.id}:${parentIdx}:${childIdx}`, embedding);
                    }
                });

                set(state => ({ notes: [...state.notes, newNote], isEditing: false }));
                get().processNotes();
                await get().handleFindInsightsForNote(newNote.id);
            },

            handleDeleteNote: (noteId) => {
                const { t } = i18n;
                if (window.confirm(t('deleteConfirmation'))) {
                    const vectorStore = getVectorStore();
                    vectorStore.removeNoteVectors(noteId);
                    set(state => ({
                        notes: state.notes.filter(n => n.id !== noteId),
                        insights: state.insights.filter(i => i.newNoteId !== noteId && i.oldNoteId !== noteId),
                    }));
                }
            },

            handleBulkUpload: async (files) => {
                if (files.length === 0) return;
                const { t } = i18n;
                const language = i18n.language as 'en' | 'zh';
                const vectorStore = getVectorStore();

                set({ loadingState: { active: true, messages: [t('readingFiles', { count: files.length })] } });

                const notesToProcess = await Promise.all(Array.from(files).map(async (file) => {
                    let content = '';
                    if (file.type === 'application/pdf') {
                        try {
                            const arrayBuffer = await file.arrayBuffer();
                            const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
                            const pageTexts = await Promise.all(
                                Array.from({ length: pdf.numPages }, (_, i) => i + 1).map(async pageNum => {
                                    const page = await pdf.getPage(pageNum);
                                    const textContent = await page.getTextContent();
                                    return textContent.items.map((item: any) => item.str).join(' ');
                                })
                            );
                            content = pageTexts.join('\n\n');
                        } catch (error) {
                            console.error(`Failed to process PDF ${file.name}:`, error);
                            content = `Error reading PDF: ${file.name}. The file might be corrupted or protected.`;
                        }
                    } else {
                        content = await file.text();
                    }
                    const title = file.name.replace(/\.(md|txt|pdf)$/i, '');
                    return { title, content };
                }));

                set(state => ({ ...state, loadingState: { ...state.loadingState, messages: [t('chunkingNotes', { count: notesToProcess.length })] } }));

                const newNotes: Note[] = [];
                for (const [index, noteData] of notesToProcess.entries()) {
                     set(state => ({ ...state, loadingState: { ...state.loadingState, messages: [t('chunkingProgress', { current: index + 1, total: notesToProcess.length, title: noteData.title })] } }));
                    const parentChunks = await semanticChunker(noteData.content, noteData.title, language);
                    const childTexts = parentChunks.flatMap(pc => pc.children.map(c => c.text));

                    newNotes.push({
                        id: `note-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                        title: noteData.title,
                        content: noteData.content,
                        createdAt: new Date().toISOString(),
                        chunks: childTexts,
                        parentChunks,
                    });
                }

                set({ loadingState: { active: true, messages: [t('generatingEmbeddings')] } });
                const childTextMap = newNotes.flatMap(n => n.parentChunks!.flatMap((pc, pi) => pc.children.map((c, ci) => ({ noteId: n.id, parentIdx: pi, childIdx: ci, text: c.text }))));
                const allChunks = childTextMap.map(c => c.text);

                const embeddings = await generateBatchEmbeddings(allChunks);
                embeddings.forEach((embedding, index) => {
                    if (embedding && embedding.length > 0) {
                        const { noteId, parentIdx, childIdx } = childTextMap[index];
                        vectorStore.addVector(`${noteId}:${parentIdx}:${childIdx}`, embedding);
                    }
                });

                set(state => ({ notes: [...state.notes, ...newNotes], loadingState: { active: false, messages: [] } }));
            },

            handleFindInsightsForNote: async (noteId) => {
                const { notes, searchDepth } = get();
                const note = notes.find(n => n.id === noteId);
                if (note) {
                    set({ isFindingLinks: noteId });
                    const existingNotes = notes.filter(n => n.id !== noteId);
                    if (existingNotes.length > 0) {
                        const { t } = i18n;
                        const language = i18n.language as 'en' | 'zh';
                        const vectorStore = getVectorStore();
                        const links = await findSynapticLink(note, existingNotes, (loadingState) => set({loadingState}), vectorStore, language, t, searchDepth);
                        if (links.length > 0) {
                            const newInsights: Insight[] = links.map((link, i) => ({
                                ...link,
                                newNoteId: note.id,
                                id: `insight-${Date.now()}-${i}`,
                                status: 'new',
                                createdAt: new Date().toISOString()
                            }));
                            set(state => ({ insights: [...state.insights, ...newInsights] }));
                        }
                    }
                    set({ isFindingLinks: null, activeTab: 'inbox' });
                }
            },

            handleUpdateInsight: (id, status) => {
                set(state => ({
                    insights: state.insights.map(i => i.id === id ? { ...i, status } : i),
                }));
            },

            processNotes: async () => {
                const { notes } = get();
                const { t } = i18n;
                const language = i18n.language as 'en' | 'zh';
                const vectorStore = getVectorStore();
                 const notesNeedingChunking = notes.filter(n => !n.parentChunks || n.parentChunks.length === 0);
                if (notesNeedingChunking.length > 0) {
                    set({ loadingState: { active: true, messages: [t('loadingChunking', { count: notesNeedingChunking.length })] } });
                    const updatedNotes = [...notes];

                    for (const [index, note] of notesNeedingChunking.entries()) {
                        set(state => ({...state, loadingState: {...state.loadingState, messages: [t('chunkingProgress', {current: index + 1, total: notesNeedingChunking.length, title: note.title})]} }));
                        const parentChunks = await semanticChunker(note.content, note.title, language);
                        const noteIndex = updatedNotes.findIndex(n => n.id === note.id);
                        if (noteIndex !== -1) {
                            updatedNotes[noteIndex].parentChunks = parentChunks;
                            updatedNotes[noteIndex].chunks = parentChunks.flatMap(pc => pc.children.map(c => c.text));
                        }
                    }
                    set({ notes: updatedNotes, loadingState: { active: false, messages: [] } });
                    return;
                }

                const notesToIndex = notes.filter(n => n.parentChunks && n.parentChunks.length > 0 && !vectorStore.isNoteIndexed(n.id));
                if (notesToIndex.length > 0) {
                    set({ loadingState: { active: true, messages: [`Indexing ${notesToIndex.length} note(s)...`] } });

                    for (const note of notesToIndex) {
                        if (note.parentChunks) {
                            const childTexts = note.parentChunks.flatMap(pc => pc.children.map(c => c.text));
                            const mapping = note.parentChunks.flatMap((pc, pi) => pc.children.map((_, ci) => ({ parentIdx: pi, childIdx: ci })));
                            const embeddings = await generateBatchEmbeddings(childTexts);
                            embeddings.forEach((embedding, index) => {
                                if (embedding && embedding.length > 0) {
                                    const { parentIdx, childIdx } = mapping[index];
                                    vectorStore.addVector(`${note.id}:${parentIdx}:${childIdx}`, embedding);
                                }
                            });
                        }
                    }
                    set({ loadingState: { active: false, messages: [] } });
                }
            },
        }),
        {
            name: 'synapse-storage', // name of the item in the storage (must be unique)
            storage: createJSONStorage(() => localStorage), // (optional) by default, 'localStorage' is used
            partialize: (state) => ({
                notes: state.notes,
                insights: state.insights,
                searchDepth: state.searchDepth,
                language: state.language,
            }),
        }
    )
);

// Recalculate newInsightCount whenever insights change
useStore.subscribe(
    (state) => state.insights,
    (insights) => {
        const newInsightCount = insights.filter((i) => i.status === 'new').length;
        useStore.setState({ newInsightCount });
    }
);

// Initial call to process notes
useStore.getState().processNotes();
