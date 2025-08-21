import type { WebSearch } from '../types';
import { getJson } from 'serpapi';

export const searchWeb: WebSearch = {
  async search(q: string, k: number) {
    // This implementation uses the serpapi library directly, as was present
    // in the codebase, instead of fetching from a backend API route.
    // This assumes the API key is available in the environment.
    const apiKey = process.env.SERPAPI_API_KEY;
    if (!apiKey) {
        console.error('SERPAPI_API_KEY environment variable not set. Web search will not work.');
        return [];
    }

    try {
        const data = await getJson({
            engine: 'google',
            q: q,
            num: k, // Ask for k results
            api_key: apiKey
        });
        const results: any[] = data.organic_results || [];
        return results.map((r: any) => ({
            title: r.title ?? 'Untitled',
            snippet: r.snippet ?? '',
            url: r.link ?? '',
        })).filter(r => r.url).slice(0, k); // Ensure we have a URL and respect k
    } catch (error: any) {
        console.error('SerpAPI search failed:', error);
        return []; // Return empty array on failure to avoid crashing the agentic loop.
    }
  }
};
