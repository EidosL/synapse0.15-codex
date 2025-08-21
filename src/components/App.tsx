import React, { useRef, useCallback } from 'react';
import { useStore } from '../lib/store';
import { NoteEditor } from './NoteEditor';
import { NoteViewer } from './NoteViewer';
import { ThinkingStatus } from './ThinkingStatus';
import { useTranslation } from '../context/LanguageProvider';
import { Vault } from './Vault';
import { Inbox } from './Inbox';
import { ai } from '../lib/ai';

export const App: React.FC = () => {
    const {
        activeTab,
        setActiveTab,
        isEditing,
        setIsEditing,
        viewingNote,
        setViewingNote,
        loadingState,
        newInsightCount,
        handleSaveNote,
        handleBulkUpload,
    } = useStore();
    
    const fileInputRef = useRef<HTMLInputElement>(null);
    const { t, toggleLanguage } = useTranslation();

    const handleUploadClick = () => fileInputRef.current?.click();

    const onFileChange = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
        if (event.target.files) {
            await handleBulkUpload(event.target.files);
            event.target.value = '';
        }
    }, [handleBulkUpload]);

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
                {activeTab === 'vault' && <Vault onUploadClick={handleUploadClick} />}
                {activeTab === 'inbox' && <Inbox />}
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