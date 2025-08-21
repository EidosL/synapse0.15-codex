import React, { useState, useEffect, useCallback, useRef } from 'react';
import * as pdfjsLib from 'https://esm.sh/pdfjs-dist@4.5.136';

import { useStoredState } from '../hooks/useStoredState';
import { VectorStore } from '../lib/vectorStore';
import { ai, generateBatchEmbeddings, findSynapticLink, semanticChunker } from '../lib/ai';
import type { Note, Insight, SearchDepth } from '../lib/types';
import type { Tier } from '../insight/budget';

import { NoteEditor } from './NoteEditor';
import { NoteViewer } from './NoteViewer';
import { InsightCard } from './InsightCard';
import { ThinkingStatus } from './ThinkingStatus';
import { useTranslation } from '../context/LanguageProvider';
import type { Language } from '../context/LanguageProvider';
import { SearchDepthSelector } from './SearchDepthSelector';

// Configure the PDF.js worker to process PDFs off the main thread.
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://esm.sh/pdfjs-dist@4.5.136/build/pdf.worker.mjs`;

export const App: React.FC = () => {
    const [notes, setNotes] = useStoredState<Array<Note>>('synapse-notes', []);
    const [insights, setInsights] = useStoredState<Array<Insight>>('synapse-insights', []);
    const [activeTab, setActiveTab] = useState<'vault' | 'inbox'>('vault');
    const [searchDepth, setSearchDepth] = useStoredState<SearchDepth>('synapse-search-depth', 'contextual');
    
    const [isEditing, setIsEditing] = useState(false);
    const [viewingNote, setViewingNote] = useState<Note | null>(null);
    const [loadingState, setLoadingState] = useState({ active: false, messages: [] as string[] });
    const [isFindingLinks, setIsFindingLinks] = useState<string | null>(null); // Note ID being processed for on-demand insights
    const fileInputRef = useRef<HTMLInputElement>(null);
    const vectorStore = useRef(new VectorStore());

    const { language, toggleLanguage, t } = useTranslation();

    const depthToTier = (depth: SearchDepth): Tier => {
        if (depth === 'deep') return 'pro';
        return 'free';
    };

    useEffect(() => {
        const indexExistingNotes = async () => {
            const notesNeedingChunking = notes.filter(n => !n.parentChunks || n.parentChunks.length === 0);
            if (notesNeedingChunking.length > 0) {
                 setLoadingState({ active: true, messages: [t('loadingChunking', notesNeedingChunking.length)] });
                 const updatedNotes = [...notes];
                 
                 // Process notes sequentially to avoid rate limiting on background chunking.
                 for (const [index, note] of notesNeedingChunking.entries()) {
                     setLoadingState(prev => ({...prev, messages: [t('chunkingProgress', index + 1, notesNeedingChunking.length, note.title)]}));
                     const parentChunks = await semanticChunker(note.content, note.title, language);
                     const noteIndex = updatedNotes.findIndex(n => n.id === note.id);
                     if (noteIndex !== -1) {
                         updatedNotes[noteIndex].parentChunks = parentChunks;
                         updatedNotes[noteIndex].chunks = parentChunks.flatMap(pc => pc.children.map(c => c.text));
                     }
                 }
                 setNotes(updatedNotes); // This triggers the next effect
                 setLoadingState({ active: false, messages: [] });
                 return; // Prevent running the indexing logic below in the same pass
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
    }, [notes, setNotes, language, t]); // Reruns if notes are updated with chunks

    const sortedNotes = [...notes].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const sortedInsights = [...insights].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const activeInsights = sortedInsights.filter(i => i.status !== 'dismissed');
    const newInsightCount = insights.filter(i => i.status === 'new').length;

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

        // Process notes sequentially to avoid hitting API rate limits during chunking.
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
        setLoadingState({ active: true, messages: [t('findingConnectionsFor', noteToProcess.title)] });

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
            // Remove from VectorStore first.
            vectorStore.current.removeNoteVectors(noteIdToDelete);

            // Use functional updates to ensure we are always working with the latest state,
            // preventing issues with stale closures.
            setNotes(prevNotes => prevNotes.filter(note => note.id !== noteIdToDelete));
            setInsights(prevInsights => prevInsights.filter(insight => 
                insight.newNoteId !== noteIdToDelete && insight.oldNoteId !== noteIdToDelete
            ));
        }
    };

    const handleUploadClick = () => fileInputRef.current?.click();

    const onFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        if (event.target.files) {
            handleBulkUpload(event.target.files);
            event.target.value = '';
        }
    };

    const handleUpdateInsight = useCallback((id: string, status: 'kept' | 'dismissed') => {
        setInsights(prevInsights => prevInsights.map(i => i.id === id ? { ...i, status } : i));
    }, [setInsights]);

    return (
        <>
            <input
                type="file"
                ref={fileInputRef}
                onChange={onFileChange}
                multiple
                accept=".md,.txt,text/markdown,text/plain,.pdf,application/pdf"
                style={{ display: 'none' }}
                aria-hidden="true"
            />
            <header>
                <h1>🧠 Synapse</h1>
                <nav>
                    <button className="tab-button" onClick={toggleLanguage} style={{width: "60px"}}>{t('languageToggle')}</button>
                    <button className={`tab-button ${activeTab === 'vault' ? 'active' : ''}`} onClick={() => setActiveTab('vault')}>{t('vaultTab')}</button>
                    <button className={`tab-button ${activeTab === 'inbox' ? 'active' : ''}`} onClick={() => setActiveTab('inbox')}>
                        {t('inboxTab')}
                        {newInsightCount > 0 && <span className="notification-badge">{newInsightCount}</span>}
                    </button>
                </nav>
            </header>
            <main>
                {activeTab === 'vault' && (
                    <section>
                        <div className="vault-header">
                             <h2>{t('vaultTitle')}</h2>
                             <SearchDepthSelector value={searchDepth} onChange={setSearchDepth} />
                            <div className="vault-actions">
                                <button className="button button-secondary" onClick={handleUploadClick}>{t('uploadFilesButton')}</button>
                                <button className="button" onClick={() => setIsEditing(true)}>{t('newNoteButton')}</button>
                            </div>
                        </div>
                        {sortedNotes.length > 0 ? (
                             <div className="note-list">
                                {sortedNotes.map(note => (
                                    <div key={note.id} className="note-card">
                                        <div className="note-card-content"  onClick={() => setViewingNote(note)} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setViewingNote(note)}>
                                            <h3>{note.title}</h3>
                                            <p className="date">{new Date(note.createdAt).toLocaleDateString()}</p>
                                            <p>{note.content}</p>
                                        </div>
                                        <div className="note-card-actions">
                                            {isFindingLinks === note.id ? (
                                                <div className="spinner-small"></div>
                                            ) : (
                                                <button
                                                    className="button-icon"
                                                    title={t('findConnectionsButtonTitle')}
                                                    aria-label={t('findConnectionsButtonTitle')}
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleFindInsightsForNote(note.id);
                                                    }}
                                                >
                                                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v6m-4-2 4 4 4-4m-4 10v6m-4-2 4 4 4-4"/><path d="M3 12h6m12 0h-6"/></svg>
                                                </button>
                                            )}
                                            <button
                                                className="button-icon delete-btn"
                                                title={t('deleteNoteButtonTitle')}
                                                aria-label={t('deleteNoteButtonTitle')}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleDeleteNote(note.id);
                                                }}
                                            >
                                                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="empty-state">
                                <h2>{t('emptyVaultTitle')}</h2>
                                <p>{t('emptyVaultMessage')}</p>
                                <div className="empty-state-actions">
                                    <button className="button" onClick={() => setIsEditing(true)}>{t('newNoteButton')}</button>
                                    <button className="button button-secondary" onClick={handleUploadClick}>{t('uploadFilesButton')}</button>
                                </div>
                            </div>
                        )}
                       
                    </section>
                )}
                {activeTab === 'inbox' && (
                    <section>
                         {activeInsights.length > 0 ? (
                             <div className="insight-list">
                                {activeInsights.map(insight => (
                                    <InsightCard key={insight.id} insight={insight} notes={notes} onUpdate={handleUpdateInsight} />
                                ))}
                             </div>
                         ) : (
                            <div className="empty-state">
                                <h2>{t('emptyInboxTitle')}</h2>
                                <p>{t('emptyInboxMessage')}</p>
                            </div>
                         )}
                    </section>
                )}
            </main>

            {isEditing && <NoteEditor onSave={handleSaveNote} onClose={() => setIsEditing(false)} />}
            {viewingNote && <NoteViewer note={viewingNote} onClose={() => setViewingNote(null)} />}
            {loadingState.active && <ThinkingStatus messages={loadingState.messages} />}


            {!ai && <div style={{position: 'fixed', bottom: 0, left:0, right: 0, background: 'var(--danger-color)', padding: '1rem', textAlign: 'center', color: 'white', zIndex: 2000}}>
                {t('apiKeyWarning')}
            </div>}
        </>
    );
};