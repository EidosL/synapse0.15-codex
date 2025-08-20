import React, { useState } from 'react';
import type { Insight, Note } from '../lib/types';
import { SideBySideViewer } from './SideBySideViewer';
import { useTranslation } from '../context/LanguageProvider';

export const InsightCard: React.FC<{ insight: Insight; notes: Note[]; onUpdate: (id: string, status: 'kept' | 'dismissed') => void; }> = ({ insight, notes, onUpdate }) => {
    const [viewingNotes, setViewingNotes] = useState(false);
    const [isThinkingVisible, setIsThinkingVisible] = useState(false);
    const { t } = useTranslation();
    const newNote = notes.find(n => n.id === insight.newNoteId);
    const oldNote = notes.find(n => n.id === insight.oldNoteId);

    if (!newNote || !oldNote) return null;

    const { thinkingProcess } = insight;

    const renderStructuralDetail = (title: string, content: React.ReactNode) => (
        <div className="structural-detail">
            <strong>{title}</strong>
            {content}
        </div>
    );

    return (
        <div className={`insight-card ${insight.status === 'kept' ? 'kept' : ''}`}>
             <div className="insight-card-header">{insight.connectionType}</div>
             <div className="insight-connection">
                <span>{t('newNoteLabel')}</span>
                <p>{newNote.title}</p>
             </div>
             <div className="insight-connection">
                <span>{t('connectedToLabel')}</span>
                <p>{oldNote.title}</p>
             </div>
             <div className="insight-suggestion">
                <strong>{t('synapseSuggestsLabel')}</strong>
                <blockquote>{insight.oneSentence}</blockquote>
             </div>

            <div className="structural-details-grid">
                {insight.mechanisticChain && insight.mechanisticChain.length > 0 && renderStructuralDetail(
                    t('mechanisticChainLabel'),
                    <ol className="mechanistic-chain">
                        {insight.mechanisticChain.map((step, i) => <li key={i}>{step}</li>)}
                    </ol>
                )}
                 {insight.mappingTable && insight.mappingTable.length > 0 && renderStructuralDetail(
                    t('analogyMappingLabel'),
                    <table className="mapping-table">
                        <thead>
                            <tr>
                                <th>{t('sourceLabel', newNote.title)}</th>
                                <th>{t('targetLabel', oldNote.title)}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {insight.mappingTable.map((row, i) => (
                                <tr key={i}>
                                    <td>{row.source}</td>
                                    <td>{row.target}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
                 {insight.boundaryConditions && insight.boundaryConditions.length > 0 && renderStructuralDetail(
                    t('boundaryConditionsLabel'),
                    <ul className="boundary-conditions">
                        {insight.boundaryConditions.map((cond, i) => <li key={i}>{cond}</li>)}
                    </ul>
                )}
                {insight.disanalogy && renderStructuralDetail(t('keyDisanalogyLabel'), <p><i>{insight.disanalogy}</i></p>)}
                {insight.counterfactual && renderStructuralDetail(t('counterfactualLabel'), <p><i>{insight.counterfactual}</i></p>)}
                {insight.predictions && insight.predictions.length > 0 && renderStructuralDetail(
                    t('testablePredictionsLabel'),
                    <ul className="predictions-list">
                        {insight.predictions.map((pred, i) => <li key={i}>{pred}</li>)}
                    </ul>
                )}
            </div>


             {insight.confidence && (
                <div className="insight-confidence">
                    <strong>{t('confidenceLabel')}</strong> {Math.round(insight.confidence * 100)}%
                </div>
            )}

            {(insight.evidenceA?.length || insight.evidenceB?.length) && (
                <div className="insight-evidence">
                    <strong>{t('supportingEvidenceLabel')}</strong>
                    {insight.evidenceA && insight.evidenceA.length > 0 && (
                        <div className="evidence-group">
                            <p>{t('fromLabel', newNote.title)}</p>
                            <ul>
                                {insight.evidenceA.map((quote, i) => <li key={`a-${i}`}>"{quote}"</li>)}
                            </ul>
                        </div>
                    )}
                    {insight.evidenceB && insight.evidenceB.length > 0 && (
                         <div className="evidence-group">
                            <p>{t('fromLabel', oldNote.title)}</p>
                            <ul>
                                {insight.evidenceB.map((quote, i) => <li key={`b-${i}`}>"{quote}"</li>)}
                            </ul>
                        </div>
                    )}
                </div>
            )}


             <div className="insight-actions">
                <button className="button button-secondary" onClick={() => setViewingNotes(true)}>{t('viewSideBySideButton')}</button>
                {insight.status === 'new' && (
                    <>
                        <button className="button keep-btn" onClick={() => onUpdate(insight.id, 'kept')}>{t('keepButton')}</button>
                        <button className="button dismiss-btn" onClick={() => onUpdate(insight.id, 'dismissed')}>{t('dismissButton')}</button>
                    </>
                )}
                {thinkingProcess && (
                    <button className="thinking-process-toggle" onClick={() => setIsThinkingVisible(!isThinkingVisible)}>
                       {isThinkingVisible ? t('hideThinkingProcess') : t('showThinkingProcess')}
                    </button>
                )}
             </div>
             {isThinkingVisible && thinkingProcess && (
                <div className="insight-thinking-process">
                    <h4>{t('cognitiveScaffoldingProcessTitle')}</h4>
                    <div className="thinking-step">
                        <strong>{t('planningStep')}</strong>
                        <ul>
                            {thinkingProcess.searchQueries.map((q, i) => <li key={i}>"{q}"</li>)}
                        </ul>
                    </div>
                    <div className="thinking-step">
                        <strong>{t('retrievalStep')}</strong>
                        <ul>
                            {thinkingProcess.retrievedCandidateIds.map(id => {
                                const note = notes.find(n => n.id === id);
                                return <li key={id}>{note?.title || 'Unknown Note'}</li>;
                            })}
                        </ul>
                    </div>
                    <div className="thinking-step">
                        <strong>{t('synthesisStep')}</strong>
                         <ul>
                            {thinkingProcess.synthesisCandidates.map((cand, i) => {
                                 const note = notes.find(n => n.id === cand.oldNoteId);
                                 return <li key={i}><strong>{cand.connectionType} with "{note?.title}":</strong> {cand.explanation}</li>
                            })}
                        </ul>
                    </div>
                    <div className="thinking-step">
                        <strong>{t('rankingStep')}</strong>
                        <p><i>{thinkingProcess.rankingRationale || 'Top candidates were selected based on confidence, novelty, and diversity, then sent for deep, structured analysis and peer review.'}</i></p>
                    </div>
                </div>
             )}
             {viewingNotes && <SideBySideViewer note1={newNote} note2={oldNote} onClose={() => setViewingNotes(false)} />}
        </div>
    );
}