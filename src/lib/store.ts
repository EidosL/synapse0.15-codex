import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { findSynapticLink_legacy } from './ai';
import { type JobView } from './api/insights';
import { runInsightJob } from './jobRunner';

const USE_PY_BACKEND = import.meta.env.VITE_USE_PY_BACKEND === 'true';
import {
    readFileContent,
    chunkNoteContent,
    embedChunks,
    addNoteVectorsToStore
} from './noteService';
import type { Note, Insight, SearchDepth } from './types';
import { getVectorStore } from './vectorStore';
import i18n from '../context/i18n';
import { useLogStore } from './logStore';

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
    activeJob: JobView | null;
    searchDepth: SearchDepth;
    newInsightCount: number;
    language: 'en' | 'zh';
    novelty_scores: number[];
    insight_notes: string[];
    _hasHydrated: boolean;

    // Actions
    setActiveTab: (tab: 'vault' | 'inbox') => void;
    setIsEditing: (isEditing: boolean) => void;
    setViewingNote: (note: Note | null) => void;
    setSearchDepth: (depth: SearchDepth) => void;
    handleSaveNote: (title: string, content: string) => Promise<Note>;
    handleDeleteNote: (noteId: string) => void;
    handleBulkUpload: (files: FileList) => Promise<void>;
    handleFindInsightsForNote: (noteId: string) => Promise<void>;
    handleUpdateInsight: (id: string, status: 'kept' | 'dismissed') => void;
    processNotes: () => Promise<void>;
    setLanguage: (language: 'en' | 'zh') => void;
    setHasHydrated: (hydrated: boolean) => void;
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
            activeJob: null,
            searchDepth: 'contextual',
            newInsightCount: 0,
            language: 'en',
            novelty_scores: [],
            insight_notes: [],
            _hasHydrated: false,

            // Actions
            setActiveTab: (tab) => set({ activeTab: tab }),
            setIsEditing: (isEditing) => set({ isEditing }),
            setViewingNote: (note) => set({ viewingNote: note }),
            setSearchDepth: (depth) => set({ searchDepth: depth }),
            setLanguage: (language) => set({ language }),
            setHasHydrated: (hydrated) => set({ _hasHydrated: hydrated }),

            handleSaveNote: async (title, content) => {
                const { t } = i18n;
                const language = i18n.language as 'en' | 'zh';
                const vectorStore = getVectorStore();

                const savingMsg = t('savingAndChunking');
                useLogStore.getState().addThinkingStep(savingMsg);
                set({ loadingState: { active: true, messages: [] } });

                const parentChunks = await chunkNoteContent(content, title, language);
                const childTexts = parentChunks.flatMap(pc => pc.children.map(c => c.text));

                const newNote: Note = {
                    id: `note-${Date.now()}`,
                    title,
                    content,
                    createdAt: new Date().toISOString(),
                    chunks: childTexts,
                    parentChunks,
                };

                const embeddingMsg = t('embeddingChunks');
                useLogStore.getState().addThinkingStep(embeddingMsg);
                set({ loadingState: { active: true, messages: [] } });
                const embeddings = await embedChunks(childTexts);
                addNoteVectorsToStore(newNote, embeddings, vectorStore);

                set(state => ({ notes: [...state.notes, newNote], isEditing: false }));

                // Don't call processNotes here, as the new note is already processed.
                // await get().processNotes();

                await get().handleFindInsightsForNote(newNote.id);
                return newNote;
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

                const readingMsg = t('readingFiles', { count: files.length });
                useLogStore.getState().addThinkingStep(readingMsg);
                set({ loadingState: { active: true, messages: [] } });

                const notesToProcess = await Promise.all(Array.from(files).map(file => readFileContent(file)));

                const chunkingNotesMsg = t('chunkingNotes', { count: notesToProcess.length });
                useLogStore.getState().addThinkingStep(chunkingNotesMsg);
                set(state => ({ ...state, loadingState: { ...state.loadingState, messages: [] } }));

                const newNotes: Note[] = [];
                for (const [index, noteData] of notesToProcess.entries()) {
                    const progressMsg = t('chunkingProgress', { current: index + 1, total: notesToProcess.length, title: noteData.title });
                    useLogStore.getState().addThinkingStep(progressMsg);
                    set(state => ({ ...state, loadingState: { ...state.loadingState, messages: [] } }));
                    const parentChunks = await chunkNoteContent(noteData.content, noteData.title, language);
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

                const embeddingMsg = t('generatingEmbeddings');
                useLogStore.getState().addThinkingStep(embeddingMsg);
                set({ loadingState: { active: true, messages: [] } });

                const allChildTexts = newNotes.flatMap(note => note.chunks || []);
                const allEmbeddings = await embedChunks(allChildTexts);

                let embeddingIndex = 0;
                for (const note of newNotes) {
                    const noteEmbeddings = allEmbeddings.slice(embeddingIndex, embeddingIndex + (note.chunks?.length || 0));
                    addNoteVectorsToStore(note, noteEmbeddings, vectorStore);
                    embeddingIndex += note.chunks?.length || 0;
                }

                set(state => ({ notes: [...state.notes, ...newNotes], loadingState: { active: false, messages: [] } }));
            },

            handleFindInsightsForNote: async (noteId) => {
                const { notes, searchDepth } = get();
                const note = notes.find(n => n.id === noteId);
                if (!note) return;

                set({ isFindingLinks: noteId, activeJob: null, loadingState: { active: true, messages: [] } });

                if (USE_PY_BACKEND) {
                    console.log("Using Python backend for insights...");
                    const payload = {
                        source_note_id: note.id,
                        notes: [note, ...notes.filter(n => n.id !== noteId)].map(n => ({ id: n.id, content: n.content, title: n.title })),
                    };

                    runInsightJob(
                        payload,
                        (jobUpdate) => {
                            set({ activeJob: jobUpdate });
                            const phase = jobUpdate.progress?.phase ?? 'Starting...';
                            const pct = jobUpdate.progress?.pct ?? 0;
                            useLogStore.getState().addThinkingStep(`${phase} (${pct}%)`);
                        },
                        (finalJob) => {
                            set({ activeJob: finalJob, isFindingLinks: null, loadingState: { active: false, messages: [] } });
                            if (finalJob.status === 'SUCCEEDED' && finalJob.result) {
                                const newInsights: Insight[] = finalJob.result.insights.map((link: any, i: number) => ({
                                    ...link,
                                    newNoteId: note.id,
                                    oldNoteId: 'unknown', // The new backend doesn't provide this yet
                                    id: `insight-${Date.now()}-${i}`,
                                    status: 'new',
                                    createdAt: new Date().toISOString()
                                }));
                                set(state => ({ insights: [...state.insights, ...newInsights], activeTab: 'inbox' }));
                            }
                        },
                        (error) => {
                            console.error("Insight job failed:", error);
                            set({ isFindingLinks: null, loadingState: { active: false, messages: [] } });
                        }
                    );

                } else {
                    console.log("Using legacy TypeScript backend for insights...");
                    const existingNotes = notes.filter(n => n.id !== noteId);
                    if (existingNotes.length > 0) {
                        const { t } = i18n;
                        const language = i18n.language as 'en' | 'zh';
                        const vectorStore = getVectorStore();
                        const links = await findSynapticLink_legacy(
                            note, existingNotes,
                            (loadingState) => {
                                const msg = loadingState.messages[loadingState.messages.length - 1];
                                if (msg) useLogStore.getState().addThinkingStep(msg);
                                set({ loadingState });
                            },
                            vectorStore, language, t, searchDepth
                        );
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
                    set({ isFindingLinks: null, loadingState: { active: false, messages: [] }, activeTab: 'inbox' });
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
                    const chunkingMsg = t('loadingChunking', { count: notesNeedingChunking.length });
                    useLogStore.getState().addThinkingStep(chunkingMsg);
                    set({ loadingState: { active: true, messages: [] } });
                    const updatedNotes = [...notes];

                    for (const [index, note] of notesNeedingChunking.entries()) {
                        const progressMsg = t('chunkingProgress', {current: index + 1, total: notesNeedingChunking.length, title: note.title});
                        useLogStore.getState().addThinkingStep(progressMsg);
                        set(state => ({...state, loadingState: {...state.loadingState, messages: []} }));
                        const parentChunks = await chunkNoteContent(note.content, note.title, language);
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
                    const indexingMsg = t('loadingIndexing', { count: notesToIndex.length });
                    useLogStore.getState().addThinkingStep(indexingMsg);
                    set({ loadingState: { active: true, messages: [] } });

                    const allChildTexts = notesToIndex.flatMap(note => note.chunks || []);
                    const allEmbeddings = await embedChunks(allChildTexts);

                    let embeddingIndex = 0;
                    for (const note of notesToIndex) {
                        const noteEmbeddings = allEmbeddings.slice(embeddingIndex, embeddingIndex + (note.chunks?.length || 0));
                        addNoteVectorsToStore(note, noteEmbeddings, vectorStore);
                        embeddingIndex += note.chunks?.length || 0;
                    }

                    set({ loadingState: { active: false, messages: [] } });
                }
            },
        }),
        {
            name: 'synapse-storage', // name of the item in the storage (must be unique)
            storage: createJSONStorage(() => localStorage), // (optional) by default, 'localStorage' is used
            onRehydrateStorage: () => (state) => {
                state?.setHasHydrated(true);
            },
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
