import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './src/components/App';
import { LanguageProvider } from './src/context/LanguageProvider';

const container = document.getElementById('root');
if (container) {
    const root = createRoot(container);
    root.render(
        <LanguageProvider>
            <App />
        </LanguageProvider>
    );
} else {
    console.error("Root container not found. Failed to mount the application.");
}