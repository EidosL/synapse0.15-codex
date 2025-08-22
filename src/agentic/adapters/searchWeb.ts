import type { WebSearch } from '../types';

export const searchWeb: WebSearch = {
  async search(q: string, k: number) {
    const apiKey = process.env.SERPAPI_API_KEY;
    if (!apiKey) {
      console.error('SERPAPI_API_KEY environment variable not set. Web search will not work.');
      return [];
    }

    const params = new URLSearchParams({
      engine: 'google',
      q: q,
      num: k.toString(),
      api_key: apiKey,
    });

    const url = `https://serpapi.com/search?${params.toString()}`;

    try {
      const response = await fetch(url);
      if (!response.ok) {
        console.error(`SerpAPI request failed with status ${response.status}: ${await response.text()}`);
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
        .slice(0, k); // Ensure we have a URL and respect k
    } catch (error: any) {
      console.error('SerpAPI search failed:', error);
      return []; // Return empty array on failure to avoid crashing the agentic loop.
    }
  },
};
