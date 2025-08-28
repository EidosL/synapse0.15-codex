// src/agentic/adapters/webSearchAdapter.ts
export class WebSearchAdapter {
  async search(q: string, k: number) {
    // The request is now proxied through our own backend to avoid CORS issues.
    const url = '/api/search';

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
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
        .slice(0, k); // Ensure we have a URL and respect k
    } catch (error: any) {
      console.error('Backend search proxy request failed:', error);
      return []; // Return empty array on failure to avoid crashing the agentic loop.
    }
  }
}
