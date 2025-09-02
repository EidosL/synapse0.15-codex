import { create } from 'zustand';
import { type JobView } from './api/insights';
import { runInsightJob } from './jobRunner';
import type { Note, Insight, SearchDepth } from './types';
import i18n from '../context/i18n';
import { useLogStore } from './logStore';
import * as api from './api';
import { createInsightsBulk, getAllPersistedInsights, updateInsightStatus as apiUpdateInsightStatus, exportInsightsOnly } from './api/inboxInsights';

// --- Simple client-side persistence keys ---
const LS_INSIGHTS_KEY = 'synapse.insights.v1';
const LS_ACTIVE_TAB_KEY = 'synapse.activeTab.v1';

type LoadingState = {
    active: boolean;
    messages: string[];
};

type AppState = {
    notes: Note[];
    insights: Insight[];
    loadingState: LoadingState;
    activeTab: 'vault' | 'inbox';
    editingNote: Note | null;
    viewingNote: Note | null;
    isFindingLinks: string | null;
    activeJob: JobView | null;
    searchDepth: SearchDepth;
    newInsightCount: number;
    language: 'en' | 'zh';
    isInitialized: boolean;

    // Actions
    initialize: () => Promise<void>;
    setActiveTab: (tab: 'vault' | 'inbox') => void;
    setEditingNote: (note: Note | null) => void;
    setViewingNote: (note: Note | null) => void;
    setSearchDepth: (depth: SearchDepth) => void;
    handleSaveNote: (noteToSave: Partial<Note>) => Promise<Note>;
    handleDeleteNote: (noteId: string) => void;
    handleBulkUpload: (files: FileList) => Promise<void>;
    handleFindInsightsForNote: (noteId: string) => Promise<void>;
    handleUpdateInsight: (id: string, status: 'kept' | 'dismissed') => void;
    setLanguage: (language: 'en' | 'zh') => void;
};

export const useStore = create<AppState>()((set, get) => ({
    notes: [],
    insights: [],
    loadingState: { active: false, messages: [] },
    activeTab: 'vault',
    editingNote: null,
    viewingNote: null,
    isFindingLinks: null,
    activeJob: null,
    searchDepth: 'contextual',
    newInsightCount: 0,
    language: 'en',
    isInitialized: false,

    // Actions
    initialize: async () => {
        try {
            const notes = await api.getNotes();
            // Try server-side persisted insights first, then fall back to localStorage
            let persistedInsights: Insight[] = [];
            try {
                persistedInsights = await getAllPersistedInsights();
            } catch {
                try {
                    const raw = localStorage.getItem(LS_INSIGHTS_KEY);
                    if (raw) persistedInsights = JSON.parse(raw);
                } catch {}
            }

            let persistedTab: 'vault' | 'inbox' | null = null;
            try {
                const rawTab = localStorage.getItem(LS_ACTIVE_TAB_KEY);
                if (rawTab === 'vault' || rawTab === 'inbox') persistedTab = rawTab;
            } catch {}

            set({
                notes,
                insights: persistedInsights || [],
                activeTab: persistedTab || 'vault',
                isInitialized: true,
            });
        } catch (error) {
            console.error("Failed to load notes from backend:", error);
            // Even on error, attempt to restore local insights and tab so UI is usable
            let persistedInsights: Insight[] = [];
            try {
                const raw = localStorage.getItem(LS_INSIGHTS_KEY);
                if (raw) persistedInsights = JSON.parse(raw);
            } catch {}

            let persistedTab: 'vault' | 'inbox' | null = null;
            try {
                const rawTab = localStorage.getItem(LS_ACTIVE_TAB_KEY);
                if (rawTab === 'vault' || rawTab === 'inbox') persistedTab = rawTab;
            } catch {}

            set({ insights: persistedInsights || [], activeTab: persistedTab || 'vault', isInitialized: true });
        }
    },
    setActiveTab: (tab) => {
        try { localStorage.setItem(LS_ACTIVE_TAB_KEY, tab); } catch {}
        set({ activeTab: tab });
    },
    setEditingNote: (note) => set({ editingNote: note }),
    setViewingNote: (note) => set({ viewingNote: note }),
    setSearchDepth: (depth) => set({ searchDepth: depth }),
    setLanguage: (language) => set({ language }),

    handleSaveNote: async (noteToSave) => {
        set({ loadingState: { active: true, messages: [] } });
        try {
            let savedNote: Note;
            if (noteToSave.id) {
                savedNote = await api.updateNote(noteToSave.id, noteToSave);
            } else {
                savedNote = await api.createNote({
                    title: noteToSave.title || '',
                    content: noteToSave.content || '',
                });
            }

            set(state => {
                const existingNoteIndex = state.notes.findIndex(n => n.id === savedNote.id);
                const newNotes = [...state.notes];
                if (existingNoteIndex !== -1) {
                    newNotes[existingNoteIndex] = savedNote;
                } else {
                    newNotes.push(savedNote);
                }
                return { notes: newNotes, editingNote: null };
            });

            await get().handleFindInsightsForNote(savedNote.id);

            return savedNote;
        } catch (error) {
            console.error("Failed to save note to backend:", error);
            return noteToSave as Note;
        } finally {
            set({ loadingState: { active: false, messages: [] } });
        }
    },

    handleDeleteNote: async (noteId) => {
        const { t } = i18n;
        if (window.confirm(t('deleteConfirmation'))) {
            try {
                await api.deleteNote(noteId);
                set(state => ({
                    notes: state.notes.filter(n => n.id !== noteId),
                    insights: state.insights.filter(i => i.newNoteId !== noteId && i.oldNoteId !== noteId),
                }));
            } catch (error) {
                console.error("Failed to delete note from backend:", error);
            }
        }
    },

    handleFindInsightsForNote: async (noteId) => {
        const note = get().notes.find(n => n.id === noteId);
        if (!note) return;

        set({ isFindingLinks: noteId, activeJob: null, loadingState: { active: true, messages: [] } });

        const payload = { source_note_id: note.id };

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
                    const draftInsights: Insight[] = finalJob.result.insights.map((link: any, i: number) => ({
                        ...link,
                        newNoteId: note.id,
                        oldNoteId: link.oldNoteId || 'unknown',
                        id: `temp-${Date.now()}-${i}`,
                        status: 'new',
                        createdAt: new Date().toISOString()
                    }));
                    (async () => {
                        try {
                            const syncOnline = (localStorage.getItem('synapse.syncInsightsOnline') ?? 'true') === 'true';
                            const saved = syncOnline
                                ? await createInsightsBulk(note.id, draftInsights)
                                : await exportInsightsOnly(note.id, draftInsights);
                            set(state => ({ insights: [...state.insights, ...saved], activeTab: 'inbox' }));
                        } catch (e) {
                            console.error('Failed to persist insights; using local state only', e);
                            set(state => ({ insights: [...state.insights, ...draftInsights], activeTab: 'inbox' }));
                        }
                        try { localStorage.setItem(LS_ACTIVE_TAB_KEY, 'inbox'); } catch {}
                    })();
                }
            },
            (error) => {
                console.error("Insight job failed:", error);
                set({ isFindingLinks: null, loadingState: { active: false, messages: [] } });
            }
        );
    },

    handleBulkUpload: async (files) => {
        if (files.length === 0) return;
        const { t } = i18n;

        const uploadingMsg = t('readingFiles', { count: files.length });
        useLogStore.getState().addThinkingStep(uploadingMsg);
        set({ loadingState: { active: true, messages: [] } });

        const formData = new FormData();
        Array.from(files).forEach(file => {
            formData.append('files', file, file.name);
        });

        const xhr = new XMLHttpRequest();
        // Use same-origin path so Vite dev proxy or production server handles it
        xhr.open('POST', '/api/imports/start', true);

        xhr.upload.onprogress = (event) => {
            if (event.lengthComputable) {
                const percentComplete = Math.round((event.loaded / event.total) * 100);
                useLogStore.getState().addThinkingStep(`Uploading... ${percentComplete}%`);
            }
        };

        xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
                const response = JSON.parse(xhr.responseText);
                const jobId = response.job_id;

                useLogStore.getState().addThinkingStep('Upload complete. Processing on backend...');

                const poll = setInterval(async () => {
                    try {
                        const jobStatus = await api.getJobStatus(jobId);
                        set({ activeJob: jobStatus });
                        const phase = jobStatus.progress?.phase ?? 'Processing...';
                        const pct = jobStatus.progress?.pct ?? 0;
                        useLogStore.getState().addThinkingStep(`${phase} (${pct}%)`);

                        if (jobStatus.status === 'SUCCEEDED' || jobStatus.status === 'FAILED') {
                            clearInterval(poll);
                            set({ activeJob: null, loadingState: { active: false, messages: [] } });
                            get().initialize();
                        }
                    } catch (error) {
                        console.error("Failed to get job status:", error);
                        clearInterval(poll);
                        set({ activeJob: null, loadingState: { active: false, messages: [] } });
                    }
                }, 2000);

            } else {
                console.error('Upload failed:', xhr.statusText);
                set({ loadingState: { active: false, messages: [] } });
            }
        };

        xhr.onerror = () => {
            console.error('Upload failed:', xhr.statusText);
            set({ loadingState: { active: false, messages: [] } });
        };

        xhr.send(formData);
    },

    handleUpdateInsight: (id, status) => {
        set(state => ({
            insights: state.insights.map(i => i.id === id ? { ...i, status } : i),
        }));
        (async () => {
            try { await apiUpdateInsightStatus(id, status); } catch (e) { console.warn('Failed to update insight on server', e); }
        })();
    },
}));

// Recalculate newInsightCount whenever insights change
useStore.subscribe(
    (state) => state.insights,
    (insights) => {
        const newInsightCount = insights.filter((i) => i.status === 'new').length;
        useStore.setState({ newInsightCount });
        // Persist insights so they survive page refreshes
        try { localStorage.setItem(LS_INSIGHTS_KEY, JSON.stringify(insights)); } catch {}
    }
);

// Initial call to load notes from the backend
useStore.getState().initialize();
