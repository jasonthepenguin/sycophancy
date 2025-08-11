import OpenAI from "openai";

let _openai: OpenAI | null = null;

export function getOpenAIClient(): OpenAI {
  if (_openai) return _openai;

  const apiKey = process.env.OPENAI_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Missing OpenAI API key. Set OPENAI_KEY or OPENAI_API_KEY in your environment."
    );
  }

  _openai = new OpenAI({ apiKey });
  return _openai;
}


