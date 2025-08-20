import React from 'react';
import type { Note } from '../lib/types';

declare global {
    interface Window {
        marked: any;
    }
}

export const NoteViewer: React.FC<{ note: Note; onClose: () => void; }> = ({ note, onClose }) => {
    const createMarkup = (markdown: string): { __html: string } => ({ __html: window.marked.parse(markdown) });
    return (
         <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content" onClick={e => e.stopPropagation()}>
                 <div className="modal-header">
                    <h2>{note.title}</h2>
                    <button onClick={onClose} className="modal-close-btn" aria-label="Close note viewer">&times;</button>
                </div>
                <div className="note-viewer">
                    <div className="content" dangerouslySetInnerHTML={createMarkup(note.content)} />
                </div>
            </div>
        </div>
    );
}