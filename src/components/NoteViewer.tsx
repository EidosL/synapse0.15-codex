import React from 'react';
import type { Note } from '../lib/types';
import { useStore } from '../lib/store';
import { useTranslation } from '../context/LanguageProvider';

declare global {
    interface Window {
        marked: any;
    }
}

export const NoteViewer: React.FC<{ note: Note; onClose: () => void; }> = ({ note, onClose }) => {
    const { setEditingNote } = useStore();
    const { t } = useTranslation();
    const createMarkup = (markdown: string): { __html: string } => ({ __html: window.marked.parse(markdown) });

    const handleEdit = () => {
        setEditingNote(note);
        onClose();
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
                    <div className="content" dangerouslySetInnerHTML={createMarkup(note.content)} />
                </div>
            </div>
        </div>
    );
}