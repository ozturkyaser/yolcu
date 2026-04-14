/**
 * Zentrale OpenAI-kompatible Chat-Completions (Konfiguration über .env).
 *
 * Priorität: `AI_*` überschreibt `OPENAI_*` (Abwärtskompatibilität).
 */

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string }

export type ResolvedAiConfig = {
  apiKey: string
  model: string
  baseUrl: string
  timeoutMs: number
}

export function resolveAiConfig(): ResolvedAiConfig | null {
  const apiKey = (process.env.AI_API_KEY ?? process.env.OPENAI_API_KEY)?.trim()
  if (!apiKey) return null

  const model =
    (process.env.AI_MODEL ?? process.env.OPENAI_MODEL)?.trim() || 'gpt-4o-mini'
  const baseUrl =
    (process.env.AI_BASE_URL ?? process.env.OPENAI_BASE_URL)?.trim() ||
    'https://api.openai.com/v1'
  const timeoutRaw = Number(process.env.AI_TIMEOUT_MS ?? process.env.OPENAI_TIMEOUT_MS ?? 30_000)
  const timeoutMs = Number.isFinite(timeoutRaw) && timeoutRaw >= 5000 ? Math.min(timeoutRaw, 120_000) : 30_000

  return { apiKey, model, baseUrl: baseUrl.replace(/\/$/, ''), timeoutMs }
}

export async function callChatCompletions(
  messages: ChatMessage[],
  opts?: { temperature?: number },
): Promise<{ content: string; model: string } | null> {
  const cfg = resolveAiConfig()
  if (!cfg || messages.length === 0) return null

  const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cfg.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: cfg.model,
      temperature: opts?.temperature ?? 0.2,
      messages,
    }),
    signal: AbortSignal.timeout(cfg.timeoutMs),
  })

  if (!res.ok) return null
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>
    model?: string
  }
  const content = data.choices?.[0]?.message?.content?.trim()
  if (!content) return null
  return { content, model: data.model ?? cfg.model }
}
