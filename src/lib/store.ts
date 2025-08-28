import { create } from 'zustand';
import { type JobView } from './api/insights';
import { runInsightJob } from './jobRunner';
import type { Note, Insight, SearchDepth } from './types';
import i18n from '../context/i18n';
import { useLogStore } from './logStore';
import * as api from './api';

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
            set({ notes, isInitialized: true });
        } catch (error) {
            console.error("Failed to load notes from backend:", error);
            set({ isInitialized: true }); // Mark as initialized even on error to prevent re-fetching
        }
    },
    setActiveTab: (tab) => set({ activeTab: tab }),
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
                    const newInsights: Insight[] = finalJob.result.insights.map((link: any, i: number) => ({
                        ...link,
                        newNoteId: note.id,
                        oldNoteId: link.oldNoteId || 'unknown',
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
        xhr.open('POST', 'http://localhost:8000/api/imports/start', true);

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
    },
}));

// Recalculate newInsightCount whenever insights change
useStore.subscribe(
    (state) => state.insights,
    (insights) => {
        const newInsightCount = insights.filter((i) => i.status === 'new').length;
        useStore.setState({ newInsightCount });
    }
);

// Initial call to load notes from the backend
useStore.getState().initialize();
