// src/agentic/adapters/langExtractAdapter.ts
import fetch from "node-fetch";

type ExtractionOut = {
  klass: string; text: string;
  attrs: Record<string, any>;
  spans: { start: number; end: number }[];
  source_uri?: string | null;
};

export class LangExtractAdapter {
  private serverUrl: string;

  /**
   * @param serverUrl The URL of the langextract server.
   */
  constructor(serverUrl: string) {
    this.serverUrl = serverUrl;
  }

  async extract(args: {
    text_or_url: string;
    prompt_description: string;
    examples: { text: string; extractions: { extraction_class: string; extraction_text: string; attributes?: any }[] }[];
    model_id?: string;
  }): Promise<ExtractionOut[]> {
    const res = await fetch(`${this.serverUrl}/extract`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model_id: "gemini-2.5-flash", ...args }),
    });
    if (!res.ok) throw new Error(`langextract ${res.status}`);
    const json = await res.json();
    return json.items as ExtractionOut[];
  }
}
