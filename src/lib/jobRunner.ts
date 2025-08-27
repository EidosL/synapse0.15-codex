import { startInsights, getStatus, cancelJob, type JobView } from "./api/insights";

type PollOpts = { initialDelayMs?: number; maxDelayMs?: number; factor?: number; timeoutMs?: number };

// This is a non-hook version of the logic in useInsightJob.ts
// It uses a callback to provide updates to the calling store.
export function runInsightJob(
    payload: any,
    onUpdate: (job: JobView) => void,
    onComplete: (job: JobView) => void,
    onError: (error: string) => void,
    poll: PollOpts = {}
) {
    let cancelled = false;
    let pollTimeoutId: number;

    const cleanup = () => {
        if (pollTimeoutId) clearTimeout(pollTimeoutId);
    };

    const cancel = async (jobId?: string) => {
        cancelled = true;
        cleanup();
        if (jobId) {
            try {
                const finalState = await cancelJob(jobId);
                onUpdate(finalState);
            } catch (e: any) {
                onError(e?.message ?? "Failed to cancel job");
            }
        }
    };

    const start = async () => {
        try {
            const { job_id } = await startInsights(payload);
            let delay = poll.initialDelayMs ?? 750;
            const maxDelay = poll.maxDelayMs ?? 5000;
            const factor = poll.factor ?? 1.5;
            const deadline = poll.timeoutMs ? Date.now() + poll.timeoutMs : null;

            const tick = async () => {
                if (cancelled) return;
                try {
                    const s = await getStatus(job_id);
                    onUpdate(s);

                    if (s.status === "SUCCEEDED" || s.status === "FAILED" || s.status === "CANCELLED") {
                        onComplete(s);
                        cleanup();
                        return;
                    }

                    if (deadline && Date.now() > deadline) {
                        await cancel(job_id);
                        onError("Job timed out.");
                        return;
                    }

                    delay = Math.min(maxDelay, Math.floor(delay * factor));
                    pollTimeoutId = window.setTimeout(tick, delay);
                } catch (e: any) {
                    onError(e?.message ?? "Polling failed");
                    cleanup();
                }
            };

            // Start the first tick
            pollTimeoutId = window.setTimeout(tick, delay);

        } catch (e: any) {
            onError(e?.message ?? "Failed to start job");
            cleanup();
        }
    };

    start();

    // The caller can't directly cancel, but this is the structure.
    // The store will need to manage cancellation if required.
    return { cancel };
}
