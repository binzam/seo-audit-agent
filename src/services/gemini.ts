import { GoogleGenAI } from "@google/genai";

const DEFAULT_MODEL = "gemini-3.8-flash";

export interface GeminiClient {
  ai: GoogleGenAI;
  model: string;
}

/** Initialises the Gemini SDK from GEMINI_API_KEY (and optional GEMINI_MODEL). */
export function createGeminiClient(
  env: NodeJS.ProcessEnv = process.env,
): GeminiClient {
  const apiKey = env["GEMINI_API_KEY"];

  if (!apiKey) {
    throw new Error("Missing GEMINI_API_KEY in your .env file.");
  }

  return {
    ai: new GoogleGenAI({ apiKey }),
    model: env["GEMINI_MODEL"]?.trim() || DEFAULT_MODEL,
  };
}
