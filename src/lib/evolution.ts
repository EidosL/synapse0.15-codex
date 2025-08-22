import { ai, MODEL_NAME, CHINESE_OUTPUT_INSTRUCTION, safeParseGeminiJson } from './ai';
import type { Language } from '../context/LanguageProvider';

export const runSelfEvolution = async (finalDraft: string, language: Language): Promise<string> => {
    if (!ai) return finalDraft;

    // === 1. Variant Generation ===
    const focuses = [
        "highlighting technical depth and specific evidence, creating a rigorous, academic tone",
        "emphasizing broad connections and analogies to other fields, creating a creative, lateral-thinking tone",
        "focusing on practical implications and actionable outcomes, creating a pragmatic, business-oriented tone"
    ];
    let variants: string[] = [];
    for (const focus of focuses) {
        const variantPrompt = `You are an expert researcher. Your task is to refine the following insight draft with a specific focus.
Focus: ${focus}.

Draft:
"""
${finalDraft}
"""
${language === 'zh' ? CHINESE_OUTPUT_INSTRUCTION : ''}
Return ONLY the refined draft text.`;
        try {
            const result = await ai.models.generateContent({
                model: MODEL_NAME,
                contents: [{ role: 'user', parts: [{ text: variantPrompt }] }],
                generationConfig: { temperature: 0.7 }
            });
            variants.push(result.response.text().trim());
        } catch (e) { console.error(`Self-evolution (variant gen) failed for focus ${focus}:`, e); }
    }
    variants.push(finalDraft); // Add the original draft as a variant
    variants = [...new Set(variants.filter(v => v.length > 20))]; // Deduplicate and filter out empty variants
    if (variants.length < 2) return finalDraft;

    // === 2. Evaluation ===
    let evaluations: { variant: number; score: number; feedback: string }[] = [];
    const evalPrompt = `You are an evaluator. You will be given multiple proposed insights. Score each from 1 to 10 on overall quality (is it convincing, well-supported, novel, and clear?). Also, provide brief feedback on its strengths or weaknesses.

${variants.map((v, i) => `Insight Variant #${i + 1}:\n"""${v}"""`).join("\n\n")}

Respond with ONLY a valid JSON list of objects, like this: [{"variant": 1, "score": 8, "feedback": "..."}].`;

    try {
        const result = await ai.models.generateContent({
            model: MODEL_NAME,
            contents: [{ role: 'user', parts: [{ text: evalPrompt }] }],
            generationConfig: { responseMimeType: "application/json" }
        });
        evaluations = safeParseGeminiJson<any[]>(result.response.text()) || [];
    } catch (e) { console.error("Self-evolution (evaluation) failed:", e); }

    // === 3. Merging ===
    if (evaluations.length > 0) {
        evaluations.sort((a, b) => b.score - a.score);
    } else {
        // Fallback: if eval fails, just use the first two variants
        evaluations = variants.slice(0,2).map((_, i) => ({ variant: i + 1, score: 5, feedback: "N/A" }));
    }

    const topVariants = evaluations.slice(0, 2).map(e => {
        const index = e.variant - 1;
        return (index >= 0 && index < variants.length) ? variants[index] : null;
    }).filter((v): v is string => v !== null);

    if (topVariants.length < 2) return topVariants[0] || finalDraft;

    const mergePrompt = `You are a master synthesizer. Your task is to merge the best aspects of the following insight drafts into a single, superior insight.

Draft 1:
"""
${topVariants[0]}
"""

Draft 2:
"""
${topVariants[1]}
"""

Guidelines:
-   Preserve the most important evidence, arguments, and novel ideas from each draft.
-   Ensure the merged insight is coherent, well-structured, and not repetitive.
-   Create a concise, clear narrative that includes the key points from both drafts.
${language === 'zh' ? CHINESE_OUTPUT_INSTRUCTION : ''}
Return ONLY the merged insight text.`;

    try {
        const result = await ai.models.generateContent({
            model: MODEL_NAME,
            contents: [{ role: 'user', parts: [{ text: mergePrompt }] }],
            generationConfig: { temperature: 0.4 }
        });
        return result.response.text().trim();
    } catch (e) {
        console.error("Self-evolution (merging) failed:", e);
        return topVariants[0]; // Fallback to the best variant if merge fails
    }
};
