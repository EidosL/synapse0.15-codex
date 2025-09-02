import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import { resolve } from 'path';

export default defineConfig(({ mode }) => {
    // Load from .env files and also fall back to real process.env for dev
    const env = loadEnv(mode, '.', '');
    const GOOGLE = env.GOOGLE_API_KEY || env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || '';
    return {
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY || process.env.GEMINI_API_KEY || ''),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY || process.env.GEMINI_API_KEY || ''),
        'process.env.GOOGLE_API_KEY': JSON.stringify(GOOGLE)
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      },
      build: {
        rollupOptions: {
          input: {
            main: resolve(__dirname, 'index.html'),
            devMonitor: resolve(__dirname, 'public/dev-monitor.html'),
          },
        },
      },
      server: {
        proxy: {
          '/api': {
            target: 'http://127.0.0.1:8000',
            changeOrigin: true,
            // Do not rewrite; keep '/api' so FastAPI sees correct prefix
          },
        },
      },
    };
});
