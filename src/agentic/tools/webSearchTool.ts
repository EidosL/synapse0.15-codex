import type { PlanStep, ToolResult } from '../types';
import { routeLlmCall } from '../../lib/ai';
import type { Tool } from './tool';

export class WebSearchTool implements Tool {
  public name = 'web_search';

  public async execute(step: PlanStep): Promise<ToolResult> {
    const hits = await this.search(step.message, 5);
    const bullets = hits.map(h => `• ${h.title}: ${h.snippet}`).join('\n');

    let summary = '';
    try {
      const resp = await routeLlmCall('webSearchSummary', [
        { role: 'system', content: 'Summarize key facts. Use only provided bullets. No new claims. Return plain text.' },
        { role: 'user', content: `Goal: ${step.expected}\nBullets:\n${bullets}` },
      ]);
      const choice = resp.choices?.[0]?.message?.content;
      summary = (typeof choice === 'string') ? choice : '';
    } catch (e) {
      console.error('webSearchSummary routing failed, falling back to bullets. Error:', e);
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
