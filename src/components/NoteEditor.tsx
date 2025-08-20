import React, { useState } from 'react';
import { useTranslation } from '../context/LanguageProvider';

export const NoteEditor: React.FC<{ onSave: (title: string, content: string) => void; onClose: () => void; }> = ({ onSave, onClose }) => {
    const [title, setTitle] = useState('');
    const [content, setContent] = useState('');
    const { t } = useTranslation();

    const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        if (title.trim() && content.trim()) {
            onSave(title.trim(), content.trim());
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
                        required
                        aria-label="Note Content"
                    />
                    <button type="submit" className="button">{t('saveNoteButton')}</button>
                </form>
            </div>
        </div>
    );
};