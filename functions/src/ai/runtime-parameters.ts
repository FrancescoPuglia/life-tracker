import { defineSecret, defineString } from 'firebase-functions/params';

/** Shared backend-only parameters used by chat and optional report interpretation. */
export const OPENAI_API_KEY = defineSecret('OPENAI_API_KEY', {
  description: 'Backend-only OpenAI API key used by the Responses API.',
});

export const OPENAI_MODEL = defineString('OPENAI_MODEL', {
  default: 'gpt-5.6-terra',
  description: 'Backend-configurable Responses API model. GPT-5.6 Terra balances intelligence and cost.',
});

export const OPENAI_REASONING_EFFORT = defineString('OPENAI_REASONING_EFFORT', {
  default: 'low',
  description: 'Responses reasoning effort: none, low, medium, high, xhigh, or max.',
});

export const AI_MODEL_ROUTING_ENABLED = defineString('AI_MODEL_ROUTING_ENABLED', {
  default: 'false',
  description: 'Exact opt-in switch for evaluated per-workload model routing.',
});

export const AI_MODEL_ROUTING_CONFIG = defineString('AI_MODEL_ROUTING_CONFIG', {
  default: 'not-configured',
  description: 'Versioned non-secret evaluated model-route manifest. Ignored while routing is false.',
});

export const OPENAI_BASE_URL = defineString('OPENAI_BASE_URL', {
  default: 'https://api.openai.com/v1',
  description: 'Backend-only official OpenAI base URL. Loopback is accepted only by the Functions emulator.',
});
