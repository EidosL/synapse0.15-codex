import React, { useState, useCallback } from 'react';
import { useTranslation } from '../context/LanguageProvider';
import { useStore } from '../lib/store';
import { WebSearchAdapter } from '../agentic/webSearchAdapter';

const searchWeb = new WebSearchAdapter();
import { ai, MODEL_NAME } from '../lib/ai';

export const NoteEditor: React.FC<{ onClose: () => void; }> = ({ onClose }) => {
    const [title, setTitle] = useState('');
    const [content, setContent] = useState('');
    const [selectedText, setSelectedText] = useState('');
    const [isResearching, setIsResearching] = useState(false);
    const { t } = useTranslation();
    const { handleSaveNote, setViewingNote } = useStore();

    const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        if (title.trim() && content.trim()) {
            handleSaveNote(title.trim(), content.trim());
            onClose();
        }
    };

    const handleSelection = useCallback(() => {
        const selection = window.getSelection()?.toString() || '';
        setSelectedText(selection);
    }, []);

    const handleResearch = async () => {
        if (!selectedText || isResearching || !ai) return;

        setIsResearching(true);
        console.log(`Researching: ${selectedText}`);

        try {
            const searchResults = await searchWeb.search(selectedText, 5);
            if (searchResults.length === 0) {
                alert('No web search results found.');
                return;
            }

            const prompt = `Based on the following search results for the query "${selectedText}", please provide a concise summary (2-3 paragraphs). After the summary, list the URLs of the sources in a markdown list.

Search Results:
${searchResults.map(r => `
Title: ${r.title}
URL: ${r.url}
Snippet: ${r.snippet}
`).join('\n---\n')}
`;

            const result = await ai.models.generateContent({
                model: MODEL_NAME,
                contents: [{ role: 'user', parts: [{ text: prompt }] }],
            });

            const summary = result.response.text();

            // Create a new note with the research findings and get the new note object back
            const newResearchNote = await handleSaveNote(`Research: ${selectedText}`, summary);

            // Close the current editor
            onClose();

            // Open the new note for viewing
            setViewingNote(newResearchNote);

        } catch (error) {
            console.error("Research failed:", error);
            alert("An error occurred during the research process.");
        } finally {
            setIsResearching(false);
        }
    };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>{t('newNoteModalTitle')}</h2>
                    <button onClick={onClose} className="modal-close-btn" aria-label="Close note editor">&times;</button>
                </div>
                <form onSubmit={handleSubmit} className="note-editor-form">
                    <input
                        type="text"
                        placeholder={t('noteTitlePlaceholder')}
                        value={title}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTitle(e.target.value)}
                        required
                        aria-label="Note Title"
                    />
                    <textarea
                        placeholder={t('noteContentPlaceholder')}
                        value={content}
                        onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setContent(e.target.value)}
                        onSelect={handleSelection}
                        onMouseUp={handleSelection}
                        onTouchEnd={handleSelection}
                        required
                        aria-label="Note Content"
                    />
                    <div className="note-editor-actions">
                        <button type="submit" className="button">{t('saveNoteButton')}</button>
                        <button type="button" className="button" onClick={handleResearch} disabled={!selectedText || isResearching}>
                            {isResearching ? <div className="spinner-small"></div> : `🔬 ${t('researchButton')}`}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};