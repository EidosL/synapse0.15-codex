import React from 'react';
import type { Note } from '../lib/types';
import { useTranslation } from '../context/LanguageProvider';

declare global {
    interface Window {
        marked: any;
    }
}

export const SideBySideViewer: React.FC<{ note1: Note; note2: Note; onClose: () => void; }> = ({ note1, note2, onClose }) => {
    const { t } = useTranslation();
    const createMarkup = (markdown: string): { __html: string } => ({ __html: window.marked.parse(markdown) });
    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content side-by-side" onClick={e => e.stopPropagation()}>
                 <div className="modal-header">
                    <h2>{t('comparingNotesTitle')}</h2>
                    <button onClick={onClose} className="modal-close-btn" aria-label="Close comparison view">&times;</button>
                </div>
                <div className="side-by-side-container">
                    <div className="note-viewer">
                        <h3>{note1.title}</h3>
                        <div className="content" dangerouslySetInnerHTML={createMarkup(note1.content)} />
                    </div>
                    <div className="note-viewer">
                        <h3>{note2.title}</h3>
                        <div className="content" dangerouslySetInnerHTML={createMarkup(note2.content)} />
                    </div>
                </div>
            </div>
        </div>
    );
};