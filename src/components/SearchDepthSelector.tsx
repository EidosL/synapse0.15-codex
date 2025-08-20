import React from 'react';
import type { SearchDepth } from '../lib/types';
import { useTranslation } from '../context/LanguageProvider';

interface SearchDepthSelectorProps {
    value: SearchDepth;
    onChange: (value: SearchDepth) => void;
}

export const SearchDepthSelector: React.FC<SearchDepthSelectorProps> = ({ value, onChange }) => {
    const { t } = useTranslation();
    const depths: { id: SearchDepth, label: string }[] = [
        { id: 'quick', label: t('depthQuick') },
        { id: 'contextual', label: t('depthContextual') },
        { id: 'deep', label: t('depthDeep') },
    ];

    return (
        <div className="depth-selector" role="radiogroup" aria-label="Search Depth">
            {depths.map(depth => (
                <button
                    key={depth.id}
                    className={value === depth.id ? 'active' : ''}
                    onClick={() => onChange(depth.id)}
                    role="radio"
                    aria-checked={value === depth.id}
                >
                    {depth.label}
                </button>
            ))}
        </div>
    );
};
