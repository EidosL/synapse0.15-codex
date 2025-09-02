// src/lib/api/insights.ts
export type JobState = "QUEUED"|"RUNNING"|"SUCCEEDED"|"FAILED"|"CANCELLED";
export type Phase = "candidate_selection"|"initial_synthesis"|"agent_refinement"|"finalizing";

export interface Insight {
  insight_id: string;
  title: string;
  score: number;
  snippet?: string;
}

export interface JobView {
  job_id: string;
  status: JobState;
  progress?: { phase: Phase; pct: number };
  started_at: string;
  updated_at: string;
  metrics: { notes_considered: number; clusters: number; llm_calls: number; elapsed_ms: number };
  partial_results: Insight[];
  result?: { version: string; insights: Insight[] } | null;
  error?: { code: string; message: string } | null;
  trace_id: string;
  log?: string;
}

export async function startInsights(payload: any): Promise<{job_id:string; trace_id:string}> {
  const res = await fetch("/api/generate-insights", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`startInsights failed: ${res.status}`);
  return res.json();
}

export async function getStatus(jobId: string): Promise<JobView> {
  // Align with backend routes under /api/jobs/{job_id}
  const res = await fetch(`/api/jobs/${jobId}`, { method: "GET" });
  if (res.status === 410) throw new Error("JOB_EXPIRED");
  if (!res.ok) throw new Error(`getStatus failed: ${res.status}`);
  return res.json();
}

export async function cancelJob(jobId: string): Promise<JobView> {
  const res = await fetch(`/api/jobs/${jobId}/cancel`, { method: "POST" });
  if (!res.ok) throw new Error(`cancelJob failed: ${res.status}`);
  return res.json();
}
