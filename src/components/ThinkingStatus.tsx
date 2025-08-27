import React from 'react';
import type { JobView } from '../lib/api/insights';

// The new props for the component
interface ThinkingStatusProps {
    job: JobView | null;
    legacySteps: string[];
}

export const ThinkingStatus: React.FC<ThinkingStatusProps> = ({ job, legacySteps }) => {
    // New Python Backend Path
    if (job) {
        const { status, progress, partial_results, error } = job;
        const phase = progress?.phase.replace(/_/g, ' ') ?? 'Initializing...';
        const pct = progress?.pct ?? 0;

        let content;
        if (status === 'FAILED') {
            content = (
                <div className="error-content">
                    <h4>Job Failed</h4>
                    <p>{error?.code}: {error?.message}</p>
                </div>
            );
        } else {
            content = (
                <>
                    <div className="progress-bar-container">
                        <div className="progress-bar" style={{ width: `${pct}%` }}></div>
                    </div>
                    <p className="progress-label">{phase} ({pct}%)</p>
                    {partial_results && partial_results.length > 0 && (
                        <div className="partial-results">
                            <h5>Early Insights:</h5>
                            <ul>
                                {partial_results.map(insight => (
                                    <li key={insight.insight_id}>{insight.title}</li>
                                ))}
                            </ul>
                        </div>
                    )}
                </>
            );
        }

        return (
            <div className="thinking-status-overlay">
                <div className="thinking-status-content">
                    <div className="thinking-status-header">
                        <h3>🧠 Synapse is Thinking...</h3>
                        {/* A cancel button could be added here later */}
                    </div>
                    {content}
                </div>
            </div>
        );
    }

    // Legacy TypeScript Path
    if (legacySteps.length === 0) return null;
    const completedMessages = legacySteps.slice(0, -1);
    const currentMessage = legacySteps[legacySteps.length - 1];

    return (
        <div className="thinking-status-overlay">
            <div className="thinking-status-content">
                <div className="thinking-status-header">
                    <h3>🧠 Synapse is Thinking (Legacy)...</h3>
                </div>
                <ul className="thinking-status-log">
                    {completedMessages.map((msg, index) => (
                        <li key={index} className="completed">
                            <span className="icon">✅</span>
                            <span>{msg}</span>
                        </li>
                    ))}
                    {currentMessage && (
                         <li className="in-progress">
                             <span className="icon"><div className="spinner"></div></span>
                             <span>{currentMessage}</span>
                        </li>
                    )}
                </ul>
            </div>
        </div>
    );
};
