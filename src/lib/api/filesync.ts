// Simple client for file sync configuration and actions

const API_BASE_URL = (import.meta as any).env?.VITE_API_BASE_URL || '';

type FilesyncConfig = {
  notes_dir: string;
  insights_dir: string;
  watch_interval_sec: number;
};

async function handle(r: Response) {
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json();
}

export async function getFilesyncConfig(): Promise<FilesyncConfig> {
  const r = await fetch(`${API_BASE_URL}/api/filesync/config`);
  return handle(r);
}

export async function updateFilesyncConfig(cfg: Partial<FilesyncConfig>): Promise<FilesyncConfig> {
  const r = await fetch(`${API_BASE_URL}/api/filesync/config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cfg),
  });
  return handle(r);
}

export async function importNotesNow(): Promise<{ imported: number }> {
  const r = await fetch(`${API_BASE_URL}/api/filesync/import-notes`, { method: 'POST' });
  return handle(r);
}

export async function exportInsightsNow(): Promise<{ exported: number }> {
  const r = await fetch(`${API_BASE_URL}/api/filesync/export-insights`, { method: 'POST' });
  return handle(r);
}

export async function getInsightsFromFiles(): Promise<any[]> {
  const r = await fetch(`${API_BASE_URL}/api/filesync/insights-from-files`);
  return handle(r);
}
