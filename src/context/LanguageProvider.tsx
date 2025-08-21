import React from 'react';
import { I18nextProvider, useTranslation as useTranslationi18next } from 'react-i18next';
import i18n from './i18n';
import { useStore } from '../lib/store';

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { language } = useStore();

    React.useEffect(() => {
        i18n.changeLanguage(language);
    }, [language]);

    return (
        <I18nextProvider i18n={i18n}>
            {children}
        </I18nextProvider>
    );
};

export const useTranslation = () => {
    const { t } = useTranslationi18next();
    const { language, setLanguage } = useStore();

    const toggleLanguage = () => {
        const newLang = language === 'en' ? 'zh' : 'en';
        setLanguage(newLang);
    };

    return { t, toggleLanguage, language };
}