import React from 'react';
import { useStore } from '../lib/store';
import { SearchDepthSelector } from './SearchDepthSelector';
import { useTranslation } from '../context/LanguageProvider';

interface VaultProps {
    onUploadClick: () => void;
}

export const Vault: React.FC<VaultProps> = ({ onUploadClick }) => {
    const {
        notes,
        searchDepth,
        isFindingLinks,
        setSearchDepth,
        setEditingNote,
        setViewingNote,
        handleFindInsightsForNote,
        handleDeleteNote,
    } = useStore();
    const { t } = useTranslation();
    const sortedNotes = [...notes].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return (
        <section>
            <div className="vault-header">
                <h2>{t('vaultTitle')}</h2>
                <SearchDepthSelector value={searchDepth} onChange={setSearchDepth} />
                <div className="vault-actions">
                    <button className="button button-secondary" onClick={onUploadClick}>{t('uploadFilesButton')}</button>
                    <button className="button" onClick={() => setEditingNote({})}>{t('newNoteButton')}</button>
                </div>
            </div>
            {sortedNotes.length > 0 ? (
                <div className="note-list">
                    {sortedNotes.map(note => (
                        <div key={note.id} className="note-card">
                            <div className="note-card-content" onClick={() => setViewingNote(note)} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setViewingNote(note)}>
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
                        <button className="button" onClick={() => setEditingNote({})}>{t('newNoteButton')}</button>
                        <button className="button button-secondary" onClick={onUploadClick}>{t('uploadFilesButton')}</button>
                    </div>
                </div>
            )}
        </section>
    );
};
