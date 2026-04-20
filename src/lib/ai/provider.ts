// src/lib/ai/provider.ts
// AI Provider abstraction - supports OpenAI and Ollama (OpenAI-compatible API)

import OpenAI from 'openai';

export type AIProvider = 'openai' | 'ollama';

interface ProviderConfig {
  provider: AIProvider;
  client: OpenAI;
  chatModel: string;
  embedModel: string | null;
  maxTokens: number;
  supportsTools: boolean;
}

function getProviderConfig(): ProviderConfig {
  const providerEnv = (process.env.AI_PROVIDER || 'ollama').toLowerCase();

  if (providerEnv === 'openai') {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey || apiKey === 'sk-proj-YOUR_KEY_HERE') {
      throw new Error(
        'OPENAI_API_KEY is not configured. Set it in .env.local or switch to AI_PROVIDER=ollama'
      );
    }

    return {
      provider: 'openai',
      client: new OpenAI({ apiKey }),
      chatModel: process.env.OPENAI_CHAT_MODEL || 'gpt-3.5-turbo',
      embedModel: process.env.OPENAI_EMBED_MODEL || 'text-embedding-3-small',
      maxTokens: 4000,
      supportsTools: true,
    };
  }

  // Default: Ollama (OpenAI-compatible endpoint)
  const baseURL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434/v1';
  const chatModel = process.env.OLLAMA_CHAT_MODEL || 'llama3.2';
  const embedModel = process.env.OLLAMA_EMBED_MODEL || null;

  return {
    provider: 'ollama',
    client: new OpenAI({
      baseURL,
      apiKey: 'ollama', // Ollama doesn't need a real key but the client requires one
    }),
    chatModel,
    embedModel,
    maxTokens: 4000,
    supportsTools: false, // Most Ollama models don't support tool calling
  };
}

let _config: ProviderConfig | null = null;

export function getAIConfig(): ProviderConfig {
  if (!_config) {
    _config = getProviderConfig();
  }
  return _config;
}

export function isAIAvailable(): boolean {
  try {
    getAIConfig();
    return true;
  } catch {
    return false;
  }
}
