import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { Note } from '../lib/types';
import { useStore } from '../lib/store';
import { useTranslation } from '../context/LanguageProvider';
import { fetchChunk, type ChunkResponse } from '../lib/api/chunks';
import { getNote } from '../lib/api/notes';
import { SideBySideViewer } from './SideBySideViewer';

declare global {
    interface Window {
        marked: any;
    }
}

export const NoteViewer: React.FC<{ note: Note; onClose: () => void; }> = ({ note, onClose }) => {
    const { setEditingNote } = useStore();
    const { t } = useTranslation();
    const [chunkPreview, setChunkPreview] = useState<ChunkResponse | null>(null);
    const [compareRight, setCompareRight] = useState<Note | null>(null);
    const [compareOpen, setCompareOpen] = useState(false);
    const createMarkup = (markdown: string): { __html: string } => ({ __html: window.marked.parse(markdown) });

    const handleEdit = () => {
        setEditingNote(note);
        onClose();
    };

    const onContentClick = useCallback(async (e: React.MouseEvent<HTMLDivElement>) => {
        const target = e.target as HTMLElement;
        if (target && target.tagName === 'A') {
            const href = (target as HTMLAnchorElement).getAttribute('href') || '';
            if (href.startsWith('app://chunk/')) {
                e.preventDefault();
                const id = href.replace('app://chunk/', '');
                try {
                    const data = await fetchChunk(id);
                    const original = await getNote(data.noteId);
                    const highlighted = highlightSnippet(original.content, data.content);
                    setCompareRight({ ...original, title: `Original: ${original.title}`, content: highlighted });
                    setCompareOpen(true);
                } catch (err) {
                    console.error('Failed to load chunk', err);
                }
            }
        }
    }, []);

    const highlightSnippet = (markdown: string, snippet: string): string => {
        if (!snippet) return markdown;
        const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const norm = snippet.trim();
        const re = new RegExp(esc(norm));
        if (re.test(markdown)) {
            return markdown.replace(re, `<mark class="chunk-highlight">${norm}</mark>`);
        }
        return markdown;
    };

    return (
         <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content" onClick={e => e.stopPropagation()}>
                 <div className="modal-header">
                    <h2>{note.title}</h2>
                    <div>
                        <button onClick={handleEdit} className="button" style={{marginRight: '1rem'}}>{t('editButton')}</button>
                        <button onClick={onClose} className="modal-close-btn" aria-label="Close note viewer">&times;</button>
                    </div>
                </div>
                <div className="note-viewer">
                    <div className="content" onClick={onContentClick} dangerouslySetInnerHTML={createMarkup(note.content)} />
                </div>
                {compareOpen && compareRight && (
                    <SideBySideViewer
                        note1={note}
                        note2={compareRight}
                        onClose={() => setCompareOpen(false)}
                    />
                )}
            </div>
        </div>
    );
}
