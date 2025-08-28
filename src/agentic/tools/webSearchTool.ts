import type { PlanStep, ToolResult } from '../types';
import { ai, MODEL_NAME } from '../../lib/ai';
import type { Tool } from './tool';

export class WebSearchTool implements Tool {
  public name = 'web_search';

  public async execute(step: PlanStep): Promise<ToolResult> {
    const hits = await this.search(step.message, 5);
    const bullets = hits.map(h => `• ${h.title}: ${h.snippet}`).join('\n');

    let summary = '';
    if (ai) {
      const stream = await ai.models.generateContentStream({
        model: MODEL_NAME,
        contents: `Summarize key facts useful for: "${step.expected}". Use only these bullets, no new claims.\n${bullets}`
      });
      for await (const chunk of stream) {
        const text = chunk.text ?? '';
        summary += text;
      }
    } else {
      summary = bullets;
    }

    return {
      action: this.name,
      ok: true,
      content: `WEB_SUMMARY:\n${summary || bullets}`,
      citations: hits.map(h => ({ url: h.url })),
    };
  }

  private async search(q: string, k: number) {
    const url = '/api/search';

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ q, k }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`Backend search proxy failed with status ${response.status}: ${errorText}`);
        return [];
      }
      const data = await response.json();
      const results: any[] = data.organic_results || [];
      return results
        .map((r: any) => ({
          title: r.title ?? 'Untitled',
          snippet: r.snippet ?? '',
          url: r.link ?? '',
        }))
        .filter(r => r.url)
        .slice(0, k);
    } catch (error: any) {
      console.error('Backend search proxy request failed:', error);
      return [];
    }
  }
}
