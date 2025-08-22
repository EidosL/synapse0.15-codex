import React, { useState, useEffect, useRef } from 'react';
import type { DevLog } from '../lib/logStore';

export const DevMonitor: React.FC = () => {
    const [logs, setLogs] = useState<DevLog[]>([]);
    const logsEndRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            // Optional: Check origin for security
            // if (event.origin !== window.location.origin) {
            //     return;
            // }

            const { type, log, logs: history } = event.data;

            if (type === 'history' && Array.isArray(history)) {
                setLogs(history);
            } else if (type === 'devlog' && log) {
                setLogs(prevLogs => [...prevLogs, log]);
            }
        };

        window.addEventListener('message', handleMessage);

        // Announce that the window is ready to receive logs
        if (window.opener) {
            window.opener.postMessage({ type: 'dev-monitor-ready' }, window.opener.location.origin);
        }


        return () => {
            window.removeEventListener('message', handleMessage);
        };
    }, []);

    useEffect(() => {
        logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [logs]);

    return (
        <div className="dev-monitor">
            <header>
                <h1>🛠️ Dev Monitor</h1>
            </header>
            <main>
                <pre>{JSON.stringify(logs, null, 2)}</pre>
                <div ref={logsEndRef} />
            </main>
            <style>{`
                body { font-family: sans-serif; background-color: #f0f0f0; color: #333; margin: 0; }
                .dev-monitor header { background-color: #333; color: white; padding: 0.5rem 1rem; }
                .dev-monitor header h1 { font-size: 1.2rem; margin: 0; }
                .dev-monitor main { padding: 1rem; }
                .dev-monitor pre { white-space: pre-wrap; word-wrap: break-word; background-color: #fff; border: 1px solid #ddd; padding: 1rem; border-radius: 4px; }
            `}</style>
        </div>
    );
};
