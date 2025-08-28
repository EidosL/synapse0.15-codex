// src/agentic/langExtractService.ts
import { LangExtractAdapter } from "./langExtractAdapter";
import { MemoryType } from "../memory/types";
import type { MemoryStore } from "../memory/stores/base";

type ExtractionOut = {
  klass: string; text: string;
  attrs: Record<string, any>;
  spans: { start: number; end: number }[];
  source_uri?: string | null;
};

const langExtractAdapter = new LangExtractAdapter(""); // Server URL will be configured elsewhere

export async function runLangExtract(
  serverUrl: string,
  args: {
    text_or_url: string;
    prompt_description: string;
    examples: { text: string; extractions: { extraction_class: string; extraction_text: string; attributes?: any }[] }[];
    model_id?: string;
  }
): Promise<ExtractionOut[]> {
  // This is a bit of a hack, the serverUrl should be injected more cleanly
  if ((langExtractAdapter as any).serverUrl !== serverUrl) {
    (langExtractAdapter as any).serverUrl = serverUrl;
  }
  return langExtractAdapter.extract(args);
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
