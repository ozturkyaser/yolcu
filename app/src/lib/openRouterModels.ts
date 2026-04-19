/**
 * Fallback, falls GET /admin/ai-settings keine `availableModels` liefert (alte API).
 * IDs müssen mit api/src/openrouter.ts übereinstimmen.
 */
export const OPENROUTER_MODEL_OPTIONS_FALLBACK: { id: string; label: string }[] = [
  { id: 'openai/gpt-4o', label: 'OpenAI · GPT-4o' },
  { id: 'openai/gpt-4o-mini', label: 'OpenAI · GPT-4o mini' },
  { id: 'openai/o3-mini', label: 'OpenAI · o3-mini' },
  { id: 'anthropic/claude-3.5-sonnet', label: 'Anthropic · Claude 3.5 Sonnet' },
  { id: 'anthropic/claude-3.5-haiku', label: 'Anthropic · Claude 3.5 Haiku' },
  { id: 'google/gemini-2.0-flash-001', label: 'Google · Gemini 2.0 Flash' },
  { id: 'google/gemini-pro-1.5', label: 'Google · Gemini Pro 1.5' },
  { id: 'meta-llama/llama-3.3-70b-instruct', label: 'Meta · Llama 3.3 70B Instruct' },
  { id: 'mistralai/mistral-small-3.1-24b-instruct-128k', label: 'Mistral · Small 3.1 24B' },
  { id: 'deepseek/deepseek-chat', label: 'DeepSeek · Chat' },
]

export const DEFAULT_OPENROUTER_MODEL_ID = 'openai/gpt-4o-mini'
