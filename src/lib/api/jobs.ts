import { JobView } from './insights'; // The JobView type is already defined here

// Prefer env-configured base URL; default to same-origin (empty prefix)
const API_BASE_URL = (import.meta as any).env?.VITE_API_BASE_URL || '';

// A helper to handle fetch responses
const handleResponse = async (response: Response) => {
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API Error: ${response.statusText} - ${errorText}`);
    }
    return response.json();
};

export const getJobStatus = async (jobId: string): Promise<JobView> => {
    const response = await fetch(`${API_BASE_URL}/api/jobs/${jobId}`);
    return handleResponse(response);
};

export type JobEvent = JobView | { error: string; job_id: string };

// Subscribe to job SSE stream. Returns an EventSource and a disposer.
export const subscribeJobEvents = (
    jobId: string,
    onEvent: (e: JobEvent) => void
) => {
    const url = `${API_BASE_URL}/api/jobs/${jobId}/events`;
    const es = new EventSource(url);
    es.onmessage = (ev) => {
        try {
            const data = JSON.parse(ev.data);
            onEvent(data);
        } catch {
            // ignore
        }
    };
    es.onerror = () => {
        // Let consumer decide whether to retry
        es.close();
    };
    return () => es.close();
};
