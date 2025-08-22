import { GoogleGenAI } from '@google/genai';

/**
 * Evaluates the novelty of a given research draft using an LLM.
 *
 * @param draft - The research draft to evaluate.
 * @param ai - The GoogleGenAI instance.
 * @returns A promise that resolves to a novelty score between 1 and 10.
 */
export const evaluateNovelty = async (
    draft: string,
    ai: GoogleGenAI | null
): Promise<number> => {
    if (!ai || !draft) return 1.0; // Default to low novelty if AI is not available or draft is empty

    const prompt = `On a scale from 1 (common knowledge) to 10 (highly novel and surprising), rate the novelty of the core insight in the following draft.
Focus only on the main takeaway or connection being made. Ignore the quality of the writing.
Provide only the numeric score.

DRAFT:
"""
${draft.slice(0, 15000)}
"""

Return ONLY a single number from 1 to 10.`;

    try {
        const result = await ai.models.generateContent({
            model: 'gemini-1.5-flash',
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: {
                temperature: 0.2,
                stopSequences: ['\n'],
            }
        });
        const scoreText = result.response.text().trim();
        const score = parseFloat(scoreText);

        if (isNaN(score) || score < 1 || score > 10) {
            console.warn(`Novelty evaluation returned an invalid score: "${scoreText}". Defaulting to 1.`);
            return 1.0;
        }
        return score;
    } catch (error) {
        console.error("Error evaluating novelty:", error);
        return 1.0; // Default to low novelty on error
    }
};
