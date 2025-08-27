// src/hooks/useInsightJob.ts
import { useEffect, useRef, useState } from "react";
import { startInsights, getStatus, cancelJob, type JobView } from "../lib/api/insights";

type PollOpts = { initialDelayMs?: number; maxDelayMs?: number; factor?: number; timeoutMs?: number };

export function useInsightJob(flagUsePyBackend: boolean) {
  const [job, setJob] = useState<JobView | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<number>(0);
  const cancelledRef = useRef(false);

  async function run(payload: any, poll: PollOpts = {}) {
    if (!flagUsePyBackend) {
        console.log("Python backend is disabled, not starting job.");
        return;
    }
    setLoading(true); setError(null); setJob(null); cancelledRef.current = false;

    try {
        const { job_id } = await startInsights(payload);
        let delay = poll.initialDelayMs ?? 750;
        const maxDelay = poll.maxDelayMs ?? 5000;
        const factor = poll.factor ?? 1.5;
        const deadline = poll.timeoutMs ? Date.now() + poll.timeoutMs : null;

        const tick = async () => {
            if (cancelledRef.current) return;
            try {
                const s = await getStatus(job_id);
                setJob(s);
                if (s.status === "SUCCEEDED" || s.status === "FAILED" || s.status === "CANCELLED") {
                    setLoading(false);
                    return;
                }
                if (deadline && Date.now() > deadline) {
                    await cancel();
                    setError("Job timed out.");
                    return;
                }
                delay = Math.min(maxDelay, Math.floor(delay * factor));
                pollRef.current = window.setTimeout(tick, delay);
            } catch (e: any) {
                setError(e?.message ?? "Polling failed");
                setLoading(false);
            }
        };

        // Start the first tick
        pollRef.current = window.setTimeout(tick, delay);

    } catch (e: any) {
        setError(e?.message ?? "Failed to start job");
        setLoading(false);
    }
  }

  async function cancel() {
    cancelledRef.current = true;
    if (pollRef.current) window.clearTimeout(pollRef.current);

    if (job?.job_id && job.status === "RUNNING") {
        try {
            const finalState = await cancelJob(job.job_id);
            setJob(finalState);
        } catch { /* ignore cancel errors */ }
    }
    setLoading(false);
  }

  // Cleanup effect to cancel polling on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) {
        window.clearTimeout(pollRef.current);
      }
    };
  }, []);

  return { job, loading, error, run, cancel };
}
