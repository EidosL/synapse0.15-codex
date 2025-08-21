import { getJson } from 'serpapi';

export interface WebSearchResult {
    title: string;
    url: string;
    snippet: string;
}

/**
 * Perform a web search using the SerpAPI provider.
 * @param query The search query string.
 * @returns Array of mapped search results.
 */
export async function search(query: string): Promise<WebSearchResult[]> {
    const apiKey = process.env.SERPAPI_API_KEY;
    if (!apiKey) {
        throw new Error('SERPAPI_API_KEY environment variable not set');
    }

    try {
        const data = await getJson({
            engine: 'google',
            q: query,
            api_key: apiKey
        });
        const results: any[] = data.organic_results || [];
        return results.map((r: any) => ({
            title: r.title ?? '',
            url: r.link ?? '',
            snippet: r.snippet ?? ''
        }));
    } catch (error: any) {
        console.error('SerpAPI search failed:', error);
        throw new Error(`SerpAPI search failed: ${error.message || error}`);
    }
}
