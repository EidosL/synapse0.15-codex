import { useState, useEffect, useCallback, useRef } from 'react';
import * as pdfjsLib from 'https://esm.sh/pdfjs-dist@4.5.136';

import { useLogStore } from '../lib/logStore';
import { useStoredState } from './useStoredState';
import { VectorStore } from '../lib/vectorStore';
import { ai, generateBatchEmbeddings, findSynapticLink, semanticChunker } from '../lib/ai';
import type { Note, Insight, SearchDepth } from '../lib/types';
import type { Tier } from '../insight/budget';
import { useTranslation } from '../context/LanguageProvider';

pdfjsLib.GlobalWorkerOptions.workerSrc = `https://esm.sh/pdfjs-dist@4.5.136/build/pdf.worker.mjs`;

export const useAppLogic = () => {
    const [notes, setNotes] = useStoredState<Array<Note>>('synapse-notes', []);
    const [insights, setInsights] = useStoredState<Array<Insight>>('synapse-insights', []);
    const [searchDepth, setSearchDepth] = useStoredState<SearchDepth>('synapse-search-depth', 'contextual');
    const [activeTab, setActiveTab] = useState<'vault' | 'inbox'>('vault');
    const [isEditing, setIsEditing] = useState(false);
    const [viewingNote, setViewingNote] = useState<Note | null>(null);
    const [loadingState, setLoadingState] = useState({ active: false, messages: [] as string[] });
    const [isFindingLinks, setIsFindingLinks] = useState<string | null>(null);
    const vectorStore = useRef(new VectorStore());

    const { language, t, toggleLanguage } = useTranslation();

    const depthToTier = (depth: SearchDepth): Tier => {
        if (depth === 'deep') return 'pro';
        return 'free';
    };

    // This effect synchronizes the centralized log store with the local loading state UI
    useEffect(() => {
        const unsubscribe = useLogStore.subscribe(
            (state) => state.thinkingSteps,
            (thinkingSteps) => {
                if (thinkingSteps.length > 0) {
                    setLoadingState(prev => ({ ...prev, messages: thinkingSteps }));
                }
            }
        );
        return unsubscribe;
    }, []);

    useEffect(() => {
        const indexExistingNotes = async () => {
            const notesNeedingChunking = notes.filter(n => !n.parentChunks || n.parentChunks.length === 0);
            if (notesNeedingChunking.length > 0) {
                 setLoadingState({ active: true, messages: [t('loadingChunking', notesNeedingChunking.length)] });
                 const updatedNotes = [...notes];

                 for (const [index, note] of notesNeedingChunking.entries()) {
                     setLoadingState(prev => ({...prev, messages: [t('chunkingProgress', index + 1, notesNeedingChunking.length, note.title)]}));
                     const parentChunks = await semanticChunker(note.content, note.title, language);
                     const noteIndex = updatedNotes.findIndex(n => n.id === note.id);
                     if (noteIndex !== -1) {
                         updatedNotes[noteIndex].parentChunks = parentChunks;
                         updatedNotes[noteIndex].chunks = parentChunks.flatMap(pc => pc.children.map(c => c.text));
                     }
                 }
                 setNotes(updatedNotes);
                 setLoadingState({ active: false, messages: [] });
                 return;
            }

            const notesToIndex = notes.filter(n => n.parentChunks && n.parentChunks.length > 0 && !vectorStore.current.isNoteIndexed(n.id));
            if (notesToIndex.length > 0) {
                setLoadingState({ active: true, messages: [`Indexing ${notesToIndex.length} note(s)...`] });

                for (const note of notesToIndex) {
                    if (note.parentChunks) {
                        const childTexts = note.parentChunks.flatMap(pc => pc.children.map(c => c.text));
                        const mapping = note.parentChunks.flatMap((pc, pi) => pc.children.map((_, ci) => ({ parentIdx: pi, childIdx: ci })));
                        const embeddings = await generateBatchEmbeddings(childTexts);
                        embeddings.forEach((embedding, index) => {
                            if (embedding && embedding.length > 0) {
                                const { parentIdx, childIdx } = mapping[index];
                                vectorStore.current.addVector(`${note.id}:${parentIdx}:${childIdx}`, embedding);
                            }
                        });
                    }
                }

                setLoadingState({ active: false, messages: [] });
            }
        };

        if (ai) {
            indexExistingNotes();
        }
    }, [notes, setNotes, language, t]);

    const handleSaveNote = useCallback(async (title: string, content: string) => {
        const noteId = `note-${Date.now()}`;
        setIsEditing(false);
        setLoadingState({ active: true, messages: [t('savingAndChunking')] });

        const parentChunks = await semanticChunker(content, title, language);
        const childTexts = parentChunks.flatMap(pc => pc.children.map(c => c.text));
        const mapping = parentChunks.flatMap((pc, pi) => pc.children.map((_, ci) => ({ parentIdx: pi, childIdx: ci })));

        const newNote: Note = {
            id: noteId,
            title,
            content,
            createdAt: new Date().toISOString(),
            chunks: childTexts,
            parentChunks
        };

        setLoadingState({ active: true, messages: [t('embeddingChunks')] });

        const embeddings = await generateBatchEmbeddings(childTexts);
        embeddings.forEach((embedding, index) => {
            if (embedding.length > 0) {
                 const { parentIdx, childIdx } = mapping[index];
                 vectorStore.current.addVector(`${newNote.id}:${parentIdx}:${childIdx}`, embedding);
            } else {
                console.error(`Failed to generate embedding for chunk ${index} of new note.`);
            }
        });

        const existingNotes = [...notes];
        setNotes(prevNotes => [...prevNotes, newNote]);

        const links = await findSynapticLink(newNote, existingNotes, setLoadingState, vectorStore.current, language, t, depthToTier(searchDepth));
        if (links.length > 0) {
            const newInsights: Insight[] = links.map((link, i) => ({
                ...link,
                newNoteId: newNote.id,
                id: `insight-${Date.now()}-${i}`,
                status: 'new',
                createdAt: new Date().toISOString()
            }));
            setInsights(prevInsights => [...prevInsights, ...newInsights]);
        }
        setLoadingState({ active: false, messages: [] });
    }, [notes, setNotes, setInsights, language, t, searchDepth]);

    const handleBulkUpload = useCallback(async (files: FileList) => {
        if (files.length === 0) return;

        setLoadingState({ active: true, messages: [t('readingFiles', files.length)] });

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

        setLoadingState(prev => ({ ...prev, messages: [...prev.messages, t('chunkingNotes', notesToProcess.length)] }));

        const newNotes: Note[] = [];
        for (const [index, noteData] of notesToProcess.entries()) {
            setLoadingState(prev => {
                const messages = [...prev.messages];
                messages[messages.length - 1] = t('chunkingProgress', index + 1, notesToProcess.length, noteData.title);
                return { ...prev, messages };
            });

            const parentChunks = await semanticChunker(noteData.content, noteData.title, language);
            const childTexts = parentChunks.flatMap(pc => pc.children.map(c => c.text));

            newNotes.push({
                id: `note-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                title: noteData.title,
                content: noteData.content,
                createdAt: new Date().toISOString(),
                chunks: childTexts,
                parentChunks
            });
        }

        setLoadingState({ active: true, messages: [t('generatingEmbeddings')] });
        const childTextMap = newNotes.flatMap(n => n.parentChunks!.flatMap((pc, pi) => pc.children.map((c, ci) => ({ noteId: n.id, parentIdx: pi, childIdx: ci, text: c.text }))));
        const allChunks = childTextMap.map(c => c.text);

        const embeddings = await generateBatchEmbeddings(allChunks);
        embeddings.forEach((embedding, index) => {
            if (embedding && embedding.length > 0) {
                const { noteId, parentIdx, childIdx } = childTextMap[index];
                vectorStore.current.addVector(`${noteId}:${parentIdx}:${childIdx}`, embedding);
            }
        });

        const allNotes = [...notes, ...newNotes];
        setNotes(allNotes);

        if (newNotes.length === 1) {
            const noteToProcess = newNotes[0];
            setLoadingState(prev => ({ ...prev, messages: [t('findingConnectionsFor', noteToProcess.title)] }));

            const existingNotesForLinkFinding = notes;
            const links = await findSynapticLink(noteToProcess, existingNotesForLinkFinding, setLoadingState, vectorStore.current, language, t, depthToTier(searchDepth));

            if (links.length > 0) {
                 const newInsights: Insight[] = links.map((link, i) => ({
                    ...link,
                    newNoteId: noteToProcess.id,
                    id: `insight-${Date.now()}-bulk-${i}`,
                    status: 'new',
                    createdAt: new Date().toISOString()
                }));
                setInsights(prevInsights => [...prevInsights, ...newInsights]);
            }
        }

        setLoadingState({ active: false, messages: [] });

    }, [notes, setNotes, setInsights, language, t, searchDepth]);

    const handleFindInsightsForNote = useCallback(async (noteId: string) => {
        const noteToProcess = notes.find(n => n.id === noteId);
        if (!noteToProcess) return;

        setIsFindingLinks(noteId);
        // Set loading to active, but let the log store handle the messages
        setLoadingState({ active: true, messages: [] });

        const existingNotes = notes.filter(n => n.id !== noteId);
        const links = await findSynapticLink(noteToProcess, existingNotes, setLoadingState, vectorStore.current, language, t, depthToTier(searchDepth));

        if (links.length > 0) {
            const newInsights: Insight[] = links.map((link, i) => ({
                ...link,
                newNoteId: noteToProcess.id,
                id: `insight-${Date.now()}-ondemand-${i}`,
                status: 'new',
                createdAt: new Date().toISOString()
            }));
            setInsights(prevInsights => [...prevInsights, ...newInsights]);
            setActiveTab('inbox');
        } else {
            alert(t('noNewConnections'));
        }

        setIsFindingLinks(null);
        setLoadingState({ active: false, messages: [] });

    }, [notes, setInsights, language, t, searchDepth]);

    const handleDeleteNote = (noteIdToDelete: string) => {
        if (window.confirm(t('deleteConfirmation'))) {
            vectorStore.current.removeNoteVectors(noteIdToDelete);
            setNotes(prevNotes => prevNotes.filter(note => note.id !== noteIdToDelete));
            setInsights(prevInsights => prevInsights.filter(insight =>
                insight.newNoteId !== noteIdToDelete && insight.oldNoteId !== noteIdToDelete
            ));
        }
    };

    const handleUpdateInsight = useCallback((id: string, status: 'kept' | 'dismissed') => {
        setInsights(prevInsights => prevInsights.map(i => i.id === id ? { ...i, status } : i));
    }, [setInsights]);

    return {
        notes,
        insights,
        searchDepth,
        setSearchDepth,
        loadingState,
        handleSaveNote,
        handleBulkUpload,
        handleFindInsightsForNote,
        handleDeleteNote,
        handleUpdateInsight
    };
};
