import React, { useState, useEffect } from 'react';
import { useLogStore } from '../lib/logStore';
import { ThinkingStatus } from './ThinkingStatus';
import { useTranslation } from '../context/LanguageProvider';

export const ThinkingIndicator: React.FC = () => {
    const thinkingSteps = useLogStore(state => state.thinkingSteps);
    const [open, setOpen] = useState(false);
    const { t } = useTranslation();

    useEffect(() => {
        if (thinkingSteps.length === 0 && open) {
            setOpen(false);
        }
    }, [thinkingSteps, open]);

    if (thinkingSteps.length === 0) return null;

    return (
        <>
            {!open && (
                <div className="thinking-indicator" onClick={() => setOpen(true)}>
                    🧠 {t('thinkingInProgress')}
                </div>
            )}
            {open && <ThinkingStatus messages={thinkingSteps} onClose={() => setOpen(false)} />}
        </>
    );
};
