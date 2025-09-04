import React, { useRef, useCallback, useEffect, useState } from 'react';
import { useStore } from '../lib/store';
import { useLogStore } from '../lib/logStore';

import { NoteEditor } from './NoteEditor';
import { NoteViewer } from './NoteViewer';
import { ThinkingIndicator } from './ThinkingIndicator';
import { ThinkingStatus } from './ThinkingStatus';
import { useTranslation } from '../context/LanguageProvider';
import { Vault } from './Vault';
import { Inbox } from './Inbox';
import { ai } from '../lib/ai-lite';
import { SettingsModal } from './SettingsModal';
import { YaoTongPanel } from './YaoTongPanel';

export const App: React.FC = () => {
    const {
        activeTab,
        setActiveTab,
        editingNote,
        setEditingNote,
        viewingNote,
        setViewingNote,
        newInsightCount,
        handleSaveNote,
        handleBulkUpload,
        activeJob,
        isFindingLinks, // We can use this OR activeJob to show loading
    } = useStore();

    const fileInputRef = useRef<HTMLInputElement>(null);
    const { t, toggleLanguage } = useTranslation();
    const thinkingSteps = useLogStore(state => state.thinkingSteps);

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

    const [backendReady, setBackendReady] = useState<boolean>(false);
    const [showSettings, setShowSettings] = useState<boolean>(false);
    const [showYaoTong, setShowYaoTong] = useState<boolean>(false);
    useEffect(() => {
        // Probe backend health to decide whether to show API key warning
        fetch('/api/health').then(async (r) => {
            if (!r.ok) return;
            const h = await r.json();
            if (h && (h.llmConfigured || h.serpapiConfigured)) {
                setBackendReady(true);
            }
        }).catch(() => {});
    }, []);

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
                    <button className="tab-button" onClick={() => setShowSettings(true)} style={{marginLeft: 8}}>设置</button>
                    <button className="tab-button" onClick={() => setShowYaoTong(true)} style={{marginLeft: 8}}>药童</button>
                </nav>
            </header>
            <main>
                {activeTab === 'vault' && <Vault onUploadClick={handleUploadClick} />}
                {activeTab === 'inbox' && <Inbox />}
            </main>

            {editingNote && <NoteEditor note={editingNote} onClose={() => setEditingNote(null)} />}
            {viewingNote && <NoteViewer note={viewingNote} onClose={() => setViewingNote(null)} />}
            {(isFindingLinks || !!activeJob) && (
                <ThinkingStatus job={activeJob} legacySteps={thinkingSteps} />
            )}

            {!ai && !backendReady && <div style={{position: 'fixed', bottom: 0, left:0, right: 0, background: 'var(--danger-color)', padding: '1rem', textAlign: 'center', color: 'white', zIndex: 2000}}>
                {t('apiKeyWarning')}
            </div>}

            {showSettings && <SettingsModal open={showSettings} onClose={() => setShowSettings(false)} />}
            {showYaoTong && <YaoTongPanel onClose={() => setShowYaoTong(false)} />}
        </>
    );
};
