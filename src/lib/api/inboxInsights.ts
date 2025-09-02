import type { Insight } from "../types";

// Prefer env-configured base URL; default to same-origin
const API_BASE_URL = (import.meta as any).env?.VITE_API_BASE_URL || '';

export interface PersistedInsightRecord {
  id: string;
  new_note_id: string;
  old_note_id?: string | null;
  status: 'new' | 'kept' | 'dismissed' | string;
  payload: any;
  created_at: string;
  updated_at?: string | null;
}

const handleResponse = async (response: Response) => {
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API Error: ${response.statusText} - ${errorText}`);
  }
  return response.json();
};

function recordToInsight(rec: PersistedInsightRecord): Insight {
  const base = rec.payload || {};
  return {
    ...base,
    id: String(rec.id),
    newNoteId: rec.new_note_id,
    oldNoteId: rec.old_note_id || base.oldNoteId || undefined,
    status: (rec.status as any) || base.status || 'new',
    createdAt: base.createdAt || new Date(rec.created_at).toISOString(),
  } as Insight;
}

export async function getAllPersistedInsights(): Promise<Insight[]> {
  const res = await fetch(`${API_BASE_URL}/api/insights/`);
  const data: PersistedInsightRecord[] = await handleResponse(res);
  return data.map(recordToInsight);
}

export async function createInsightsBulk(newNoteId: string, insights: Insight[]): Promise<Insight[]> {
  const items = insights.map(i => ({
    new_note_id: newNoteId,
    old_note_id: i.oldNoteId ?? null,
    status: i.status || 'new',
    payload: { ...i },
  }));
  const res = await fetch(`${API_BASE_URL}/api/insights/bulk`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items }),
  });
  const data: PersistedInsightRecord[] = await handleResponse(res);
  return data.map(recordToInsight);
}

export async function updateInsightStatus(id: string, status: 'new' | 'kept' | 'dismissed'): Promise<Insight> {
  const res = await fetch(`${API_BASE_URL}/api/insights/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  });
  const rec: PersistedInsightRecord = await handleResponse(res);
  return recordToInsight(rec);
}

export async function exportInsightsOnly(newNoteId: string, insights: Insight[]): Promise<Insight[]> {
  const items = insights.map(i => ({
    new_note_id: newNoteId,
    old_note_id: i.oldNoteId ?? null,
    status: i.status || 'new',
    payload: { ...i },
  }));
  const res = await fetch(`${API_BASE_URL}/api/insights/export-only`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(items),
  });
  const data: PersistedInsightRecord[] = await handleResponse(res);
  // Map back to Insight shape; these are not persisted to DB by design
  return data.map(recordToInsight);
}
