import fetch from "node-fetch";
import type { Tool } from './tool';
import type { PlanStep, ToolResult } from '../types';

type ExtractionOut = {
  klass: string; text: string;
  attrs: Record<string, any>;
  spans: { start: number; end: number }[];
  source_uri?: string | null;
};

type ExtractArgs = {
  text_or_url: string;
  prompt_description: string;
  examples: { text: string; extractions: { extraction_class: string; extraction_text: string; attributes?: any }[] }[];
  model_id?: string;
};

export class LangExtractTool implements Tool {
  public name = 'lang_extract';
  private serverUrl: string;

  constructor(serverUrl: string = 'http://127.0.0.1:8080') {
    this.serverUrl = serverUrl;
  }

  public async execute(step: PlanStep): Promise<ToolResult> {
    try {
      const args: ExtractArgs = JSON.parse(step.message);
      const extractions = await this.extract(args);
      const content = `EXTRACTED:\n${JSON.stringify(extractions, null, 2)}`;
      return { action: this.name, ok: true, content };
    } catch (e: any) {
      return { action: this.name, ok: false, content: `Error: ${e.message}` };
    }
  }

  private async extract(args: ExtractArgs): Promise<ExtractionOut[]> {
    const res = await fetch(`${this.serverUrl}/extract`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model_id: "gemini-1.5-flash", ...args }),
    });
    if (!res.ok) throw new Error(`langextract server error: ${res.status}`);
    const json = await res.json();
    return json.items as ExtractionOut[];
  }
}
