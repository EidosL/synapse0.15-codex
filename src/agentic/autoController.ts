export interface AutoDeepenResult {
    result?: any;
    transcript?: string;
    summary?: string;
}

export const maybeAutoDeepen = async (
    topResult: any,
    setLoadingState: (updater: any) => void,
    t: (key: any, ...args: any[]) => string,
    _language: any,
    _budget: any
): Promise<AutoDeepenResult | null> => {
    setLoadingState((prev: any) => ({ ...prev, messages: [...prev.messages, t('thinkingDeepening', 1)] }));
    return null;
};
