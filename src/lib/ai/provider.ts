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

/**
 * Actually ping the AI provider to verify connectivity.
 * For Ollama, hits /api/tags to check if it's running and list models.
 * For OpenAI, does a lightweight models.list call.
 * Returns { reachable, modelFound, models?, error? }
 */
export async function pingAIProvider(): Promise<{
  reachable: boolean;
  modelFound: boolean;
  models?: string[];
  error?: string;
}> {
  try {
    const config = getAIConfig();

    if (config.provider === 'ollama') {
      // Ollama exposes /api/tags at the base (without /v1)
      const ollamaBase = (process.env.OLLAMA_BASE_URL || 'http://localhost:11434/v1').replace(/\/v1\/?$/, '');
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      try {
        const res = await fetch(`${ollamaBase}/api/tags`, { signal: controller.signal });
        clearTimeout(timeout);

        if (!res.ok) {
          return { reachable: true, modelFound: false, error: `Ollama returned ${res.status}` };
        }

        const data = await res.json();
        const modelNames: string[] = (data.models || []).map((m: any) => m.name?.split(':')[0] || m.name);
        const targetModel = config.chatModel;
        const found = modelNames.some(n => n === targetModel || n.startsWith(targetModel));

        return { reachable: true, modelFound: found, models: modelNames };
      } catch (e: any) {
        clearTimeout(timeout);
        if (e.name === 'AbortError') {
          return { reachable: false, modelFound: false, error: 'Ollama timeout (5s)' };
        }
        return { reachable: false, modelFound: false, error: e.message || 'Connection failed' };
      }
    }

    // OpenAI: lightweight check
    try {
      await config.client.models.list();
      return { reachable: true, modelFound: true };
    } catch (e: any) {
      return { reachable: false, modelFound: false, error: e.message || 'OpenAI unreachable' };
    }
  } catch (e: any) {
    return { reachable: false, modelFound: false, error: e.message || 'Config error' };
  }
}
