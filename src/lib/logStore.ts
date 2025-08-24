import { create } from 'zustand';
import i18n from '../context/i18n';

export type DevLog = {
  timestamp: string;
  source: 'agent' | 'system' | 'tool';
  type: 'plan' | 'result' | 'info' | 'error';
  content: any;
};

type LogStoreState = {
  // User-facing "thinking" process
  thinkingSteps: string[];
  // Detailed logs for the dev monitor
  devLogs: DevLog[];
  // Reference to the dev monitor window
  devWindow: Window | null;

  // Actions
  startRun: () => void;
  addThinkingStep: (step: string) => void;
  addDevLog: (log: Omit<DevLog, 'timestamp'>) => void;
  setDevWindow: (win: Window | null) => void;
};

export const useLogStore = create<LogStoreState>((set, get) => ({
  thinkingSteps: [],
  devLogs: [],
  devWindow: null,

  startRun: () => {
    // Clear logs from the previous run
    set({ thinkingSteps: [], devLogs: [] });
    // Add an initial "Thinking..." message for the user
    get().addThinkingStep(i18n.t('thinkingInProgress'));
    get().addDevLog({
        source: 'system',
        type: 'info',
        content: 'New insight run started.'
    });
  },

  addThinkingStep: (step: string) => {
    set(state => {
        // Replace "Thinking..." with the first real step, otherwise append.
        const newSteps = state.thinkingSteps[0] === i18n.t('thinkingInProgress')
            ? [step]
            : [...state.thinkingSteps, step];
        return { thinkingSteps: newSteps };
    });
  },

  addDevLog: (log: Omit<DevLog, 'timestamp'>) => {
    const newLog = { ...log, timestamp: new Date().toISOString() };
    set(state => ({ devLogs: [...state.devLogs, newLog] }));

    // Forward the log to the dev window if it's open
    get().devWindow?.postMessage({ type: 'devlog', log: newLog }, '*');
  },

  setDevWindow: (win: Window | null) => {
    set({ devWindow: win });
    if (win) {
        // When a new window is attached, send it all existing logs for the current run
        win.postMessage({ type: 'history', logs: get().devLogs }, '*');
    }
  },
}));
