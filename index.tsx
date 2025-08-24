import React, { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './src/components/App';
import { LanguageProvider } from './src/context/LanguageProvider';
import { useStore } from './src/lib/store';

const AppInitializer: React.FC = () => {
    const hasHydrated = useStore(state => state._hasHydrated);

    if (!hasHydrated) {
        // You can render a loading spinner or any placeholder here
        return <p>Loading...</p>;
    }

    return (
        <LanguageProvider>
            <App />
        </LanguageProvider>
    );
};

const container = document.getElementById('root');
if (container) {
    const root = createRoot(container);
    root.render(<AppInitializer />);
} else {
    console.error("Root container not found. Failed to mount the application.");
}