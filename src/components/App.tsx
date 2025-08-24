import React, { useRef, useCallback, useEffect } from 'react';
import { useStore } from '../lib/store';
import { useLogStore } from '../lib/logStore';

import { NoteEditor } from './NoteEditor';
import { NoteViewer } from './NoteViewer';
import { ThinkingIndicator } from './ThinkingIndicator';
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
        newInsightCount,
        handleSaveNote,
        handleBulkUpload,
    } = useStore();
    
    const fileInputRef = useRef<HTMLInputElement>(null);
    const { t, toggleLanguage } = useTranslation();

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        if (params.get('dev_mode') === 'true') {
            const devWindow = window.open('/dev-monitor.html', 'SynapseDevMonitor');

            const handleDevMonitorMessage = (event: MessageEvent) => {
                if (event.source === devWindow && event.data.type === 'dev-monitor-ready') {
                    useLogStore.getState().setDevWindow(devWindow);
                }
            };

            window.addEventListener('message', handleDevMonitorMessage);

            return () => {
                window.removeEventListener('message', handleDevMonitorMessage);
                useLogStore.getState().setDevWindow(null);
            };
        }
    }, []);


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
            <header className="app-header">
                <div className="logo">
                    <h1>🧠 Synapse</h1>
                </div>
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

            {isEditing && <NoteEditor onClose={() => setIsEditing(false)} />}
            {viewingNote && <NoteViewer note={viewingNote} onClose={() => setViewingNote(null)} />}
            <ThinkingIndicator />

            {!ai && <div style={{position: 'fixed', bottom: 0, left:0, right: 0, background: 'var(--danger-color)', padding: '1rem', textAlign: 'center', color: 'white', zIndex: 2000}}>
                {t('apiKeyWarning')}
            </div>}
        </>
    );
};