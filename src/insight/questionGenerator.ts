import { GoogleGenAI } from '@google/genai';
import type { Language } from '../context/LanguageProvider';

// This should only be used for free-text generation, not for JSON mode.
const CHINESE_OUTPUT_INSTRUCTION = "\n\nCRITICAL: You MUST respond exclusively in Simplified Chinese.";

// --- Divergent Question Generation ---

/**
 * Generates a single, creative, and exploratory question based on a research draft
 * to encourage unexpected insights or analogies from other domains.
 *
 * @param draft - The current research draft or context.
 * @param language - The language for the output.
 * @param ai - The GoogleGenAI instance.
 * @returns A promise that resolves to the divergent question string or null on error.
 */
export const generateDivergentQuestion = async (
    draft: string,
    language: Language,
    ai: GoogleGenAI | null
): Promise<string | null> => {
    if (!ai) return null;

    const prompt = `Based on the following research draft, propose one and only one exploratory question that could lead to unexpected insights or analogies from other domains. The question should be creative, open-ended, and challenge the current frame of reference.

CURRENT DRAFT:
"""
${draft.slice(0, 15000)}
"""
${language === 'zh' ? CHINESE_OUTPUT_INSTRUCTION : ''}
Return ONLY the single question as a raw string, not in a JSON object.`;

    try {
        const result = await ai.models.generateContent({
            model: 'gemini-1.5-flash', // Using the model name directly
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.9 } // Higher temperature for more creative, less predictable output
        });
        return result.response.text();
    } catch (error) {
        console.error("Error generating divergent question:", error);
        return null;
    }
};
