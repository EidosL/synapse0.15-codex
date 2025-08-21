// src/agentic/adapters/langextract.ts
import fetch from "node-fetch";
import { MemoryType } from "../memory/types";
import type { MemoryStore } from "../memory/stores/base";
import { route as defaultRoute } from "../memory/router";

type ExtractionOut = {
  klass: string; text: string;
  attrs: Record<string, any>;
  spans: { start: number; end: number }[];
  source_uri?: string | null;
};

export async function runLangExtract(
  serverUrl: string,
  args: {
    text_or_url: string;
    prompt_description: string;
    examples: { text: string; extractions: { extraction_class: string; extraction_text: string; attributes?: any }[] }[];
    model_id?: string;
  }
): Promise<ExtractionOut[]> {
  const res = await fetch(`${serverUrl}/extract`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model_id: "gemini-2.5-flash", ...args }),
  });
  if (!res.ok) throw new Error(`langextract ${res.status}`);
  const json = await res.json();
  return json.items as ExtractionOut[];
}

const CLASS_TO_TYPE: Record<string, MemoryType> = {
  entity: MemoryType.SEMANTIC,
  relation: MemoryType.SEMANTIC,
  event: MemoryType.EPISODIC,
  step: MemoryType.PROCEDURAL,
  pii: MemoryType.VAULT,
};

export async function ingestExtractions(
  store: MemoryStore,
  exts: ExtractionOut[],
  topic: string,
  role?: string
) {
  for (const e of exts) {
    const type = CLASS_TO_TYPE[e.klass] ?? MemoryType.CORE;
    const summary = `${e.klass}:${e.text}`.slice(0, 140);
    const content = JSON.stringify({ attrs: e.attrs, spans: e.spans, src: e.source_uri ?? null });
    await store.upsert({
      type, role, topic,
      summary, content,
      weight: 1.0, // bump supported claims later
      tags: Object.keys(e.attrs || {}),
      // keep only pointers; no raw blobs
    });
    // Optional: create mind-map edges (entity ↔ event, entity ↔ relation) using attrs
  }
}
