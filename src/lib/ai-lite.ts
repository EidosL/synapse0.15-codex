import { GoogleGenAI } from '@google/genai';

export const MODEL_NAME = 'gemini-2.5-flash';
export const EMBEDDING_MODEL_NAME = 'text-embedding-004';

let aiInstance: GoogleGenAI | null = null;
try {
  if (typeof process !== 'undefined' && process.env && process.env.GOOGLE_API_KEY) {
    aiInstance = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });
  }
} catch {
  aiInstance = null;
}

export const ai = aiInstance;

export const safeParseGeminiJson = <T,>(text: string): T | null => {
  const jsonText = text.trim();
  if (!jsonText || jsonText.toLowerCase() === 'null') return null;
  try {
    return JSON.parse(jsonText) as T;
  } catch {
    try {
      const repaired = jsonText.replace(/\\(?![bfnrt"\\/])/g, '\\\\');
      return JSON.parse(repaired) as T;
    } catch {
      return null;
    }
  }
};

