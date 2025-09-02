import React, { useState, useCallback, useEffect } from 'react';
import { useTranslation } from '../context/LanguageProvider';
import { useStore } from '../lib/store';
import { type Note } from '../lib/types';

export const NoteEditor: React.FC<{ note: Partial<Note>; onClose: () => void; }> = ({ note, onClose }) => {
    const [title, setTitle] = useState('');
    const [content, setContent] = useState('');
    const [selectedText, setSelectedText] = useState('');
    const { t } = useTranslation();
    const { handleSaveNote, setViewingNote } = useStore();

    useEffect(() => {
        setTitle(note.title || '');
        setContent(note.content || '');
    }, [note]);

    const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        if (title.trim() && content.trim()) {
            handleSaveNote({ ...note, title: title.trim(), content: content.trim() });
            onClose();
        }
    };

    const handleSelection = useCallback(() => {
        const selection = window.getSelection()?.toString() || '';
        setSelectedText(selection);
    }, []);

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>{note.id ? t('editNoteModalTitle') : t('newNoteModalTitle')}</h2>
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
                    </div>
                </form>
            </div>
        </div>
    );
};
