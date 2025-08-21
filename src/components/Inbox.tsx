import React from 'react';
import { useStore } from '../lib/store';
import { InsightCard } from './InsightCard';
import { useTranslation } from '../context/LanguageProvider';

export const Inbox: React.FC = () => {
    const { insights, notes, handleUpdateInsight } = useStore();
    const { t } = useTranslation();
    const activeInsights = insights.filter(i => i.status !== 'dismissed').sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return (
        <section>
            {activeInsights.length > 0 ? (
                <div className="insight-list">
                    {activeInsights.map(insight => (
                        <InsightCard key={insight.id} insight={insight} notes={notes} onUpdate={handleUpdateInsight} />
                    ))}
                </div>
            ) : (
                <div className="empty-state">
                    <h2>{t('emptyInboxTitle')}</h2>
                    <p>{t('emptyInboxMessage')}</p>
                </div>
            )}
        </section>
    );
};
