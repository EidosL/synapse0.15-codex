import React, { useState, useMemo } from 'react';
import type { Insight, Note, Hypothesis } from '../lib/types';
import { SideBySideViewer } from './SideBySideViewer';
import { useTranslation } from '../context/LanguageProvider';

const DetailSection: React.FC<{ title: string, children: React.ReactNode, className?: string }> = ({ title, children, className }) => (
    <div className={`structural-detail ${className || ''}`}>
        <strong>{title}</strong>
        {children}
    </div>
);

const EurekaMarker: React.FC<{ label: string, value: number }> = ({ label, value }) => (
    <div className="eureka-marker">
        <div className="marker-label">{label}</div>
        <div className="marker-bar-container">
            <div className="marker-bar" style={{ width: `${value * 100}%` }}></div>
        </div>
        <div className="marker-value">{(value * 100).toFixed(0)}%</div>
    </div>
);

const HypothesisCard: React.FC<{ hypothesis: Hypothesis }> = ({ hypothesis }) => {
    const { t } = useTranslation();
    return (
        <div className="hypothesis-card">
            <h4>{hypothesis.name}</h4>
            <p className="statement">"{hypothesis.statement}"</p>
            <div className="hypothesis-details-grid">
                <DetailSection title={t('restructuringOpsLabel')}>
                    <div className="ops-list">
                        {hypothesis.restructuringOps.map((op, i) => <span key={i} className="op-tag">{op}</span>)}
                    </div>
                </DetailSection>
                <DetailSection title={t('predictedEvidenceLabel')}>
                    <ul className="predictions-list">
                        {hypothesis.predictedEvidence.map((ev, i) => <li key={i}>{ev}</li>)}
                    </ul>
                </DetailSection>
                 <DetailSection title={t('disconfirmersLabel')}>
                    <ul className="boundary-conditions">
                        {hypothesis.disconfirmers.map((disc, i) => <li key={i}>{disc}</li>)}
                    </ul>
                </DetailSection>
            </div>
        </div>
    );
};


export const InsightCard: React.FC<{ insight: Insight; notes: Note[]; onUpdate: (id: string, status: 'kept' | 'dismissed') => void; }> = ({ insight, notes, onUpdate }) => {
    const [viewingNotes, setViewingNotes] = useState(false);
    const [isThinkingVisible, setIsThinkingVisible] = useState(false);
    const { t } = useTranslation();
    const newNote = notes.find(n => n.id === insight.newNoteId);
    const oldNote = notes.find(n => n.id === insight.oldNoteId);

    const selectedHypothesis = useMemo(() => 
        insight.hypotheses.find(h => h.name === insight.selectedHypothesisName),
        [insight.hypotheses, insight.selectedHypothesisName]
    );

    if (!newNote || !oldNote || !selectedHypothesis) return null; // Or render a fallback for older insight formats

    const { thinkingProcess, eurekaMarkers } = insight;

    const evidenceByNote = insight.evidenceRefs.reduce((acc, ref) => {
        const note = notes.find(n => n.id === ref.noteId);
        const title = note?.title || 'Unknown Note';
        if (!acc[title]) acc[title] = [];
        acc[title].push(ref.quote);
        return acc;
    }, {} as Record<string, string[]>);


    return (
        <div className={`insight-card ${insight.status === 'kept' ? 'kept' : ''}`}>
             <div className="insight-card-header">{insight.mode.toUpperCase()}</div>
             
             <div className="insight-suggestion">
                <strong>{t('insightCoreLabel')}</strong>
                <blockquote>{insight.insightCore}</blockquote>
             </div>

             <div className="insight-connection-group">
                 <div className="insight-connection">
                    <span>{t('newNoteLabel')}</span>
                    <p>{newNote.title}</p>
                 </div>
                 <div className="insight-connection">
                    <span>{t('connectedToLabel')}</span>
                    <p>{oldNote.title}</p>
                 </div>
            </div>
            
            <div className="structural-details-grid">
                <DetailSection title={t('reframedProblemLabel')} className="full-width">
                    <p>{insight.reframedProblem}</p>
                </DetailSection>
                
                <div className="full-width">
                    <DetailSection title={t('selectedHypothesisLabel')}>
                        <HypothesisCard hypothesis={selectedHypothesis} />
                    </DetailSection>
                </div>

                <DetailSection title={t('eurekaMarkersLabel')}>
                    <div className="eureka-markers-container">
                        <EurekaMarker label={t('convictionLabel')} value={eurekaMarkers.conviction} />
                        <EurekaMarker label={t('fluencyLabel')} value={eurekaMarkers.fluency} />
                        <EurekaMarker label={t('surpriseLabel')} value={insight.bayesianSurprise} />
                    </div>
                </DetailSection>
            </div>


            {insight.evidenceRefs && insight.evidenceRefs.length > 0 && (
                <div className="insight-evidence">
                    <strong>{t('supportingEvidenceLabel')}</strong>
                    {Object.entries(evidenceByNote).map(([title, quotes]) => (
                        <div className="evidence-group" key={title}>
                            <p>{t('fromLabel', title)}</p>
                            <ul>
                                {quotes.map((quote, i) => <li key={`${title}-${i}`}>"{quote}"</li>)}
                            </ul>
                        </div>
                    ))}
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
                        <strong>{t('rankingStep')}</strong>
                        <p><i>{thinkingProcess.rankingRationale || 'Top candidates were selected and sent for deep, structured analysis.'}</i></p>
                    </div>
                </div>
             )}
             {viewingNotes && <SideBySideViewer note1={newNote} note2={oldNote} onClose={() => setViewingNotes(false)} />}
        </div>
    );
}