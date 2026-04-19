/**
 * Chat-Completions (OpenAI-kompatibel). Produktiv: OpenRouter als zentraler Endpunkt.
 *
 * Priorität: `AI_*` überschreibt `OPENAI_*` (Abwärtskompatibilität).
 */

import { DEFAULT_OPENROUTER_MODEL, OPENROUTER_API_BASE } from './openrouter.js'

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
    (process.env.AI_MODEL ?? process.env.OPENAI_MODEL)?.trim() || DEFAULT_OPENROUTER_MODEL
  const baseUrl =
    (process.env.AI_BASE_URL ?? process.env.OPENAI_BASE_URL)?.trim() || OPENROUTER_API_BASE
  const timeoutRaw = Number(process.env.AI_TIMEOUT_MS ?? process.env.OPENAI_TIMEOUT_MS ?? 30_000)
  const timeoutMs = Number.isFinite(timeoutRaw) && timeoutRaw >= 5000 ? Math.min(timeoutRaw, 120_000) : 30_000

  return { apiKey, model, baseUrl: baseUrl.replace(/\/$/, ''), timeoutMs }
}

/**
 * API-Key: Server-.env (OPENAI/AI_*) → Admin-DB → optional Legacy-Nutzerprofil.
 * Modell: Admin-DB → .env → Legacy-Profil → OpenRouter-Default.
 * Basis-URL: immer OpenRouter, außer explizit AI_BASE_URL / OPENAI_BASE_URL in der Umgebung (Betrieb).
 */
export function resolveAiConfigWithUserOverride(params: {
  admin?: { apiKey?: string | null; model?: string | null; baseUrl?: string | null } | null
  user?: { apiKey?: string | null; model?: string | null; baseUrl?: string | null } | null
} | null): ResolvedAiConfig | null {
  const envCfg = resolveAiConfig()
  const envKey =
    (process.env.AI_API_KEY ?? process.env.OPENAI_API_KEY)?.trim() ||
    envCfg?.apiKey ||
    null
  const adminKey = params?.admin?.apiKey?.trim() || null
  const userKey = params?.user?.apiKey?.trim() || null
  const apiKey = envKey || adminKey || userKey || null
  if (!apiKey) return null

  const model =
    params?.admin?.model?.trim() ||
    params?.user?.model?.trim() ||
    envCfg?.model ||
    (process.env.AI_MODEL ?? process.env.OPENAI_MODEL)?.trim() ||
    DEFAULT_OPENROUTER_MODEL
  const baseUrlRaw =
    (process.env.AI_BASE_URL ?? process.env.OPENAI_BASE_URL)?.trim() || OPENROUTER_API_BASE
  const timeoutMs = envCfg?.timeoutMs ?? 30_000
  return { apiKey, model, baseUrl: baseUrlRaw.replace(/\/$/, ''), timeoutMs }
}

export async function callChatCompletions(
  messages: ChatMessage[],
  opts?: { temperature?: number; config?: ResolvedAiConfig | null },
): Promise<{ content: string; model: string } | null> {
  const cfg = opts?.config !== undefined ? opts.config : resolveAiConfig()
  if (!cfg || messages.length === 0) return null

  const headers: Record<string, string> = {
    Authorization: `Bearer ${cfg.apiKey}`,
    'Content-Type': 'application/json',
  }
  if (cfg.baseUrl.includes('openrouter.ai')) {
    const referer =
      process.env.OPENROUTER_HTTP_REFERER?.trim() ||
      process.env.PUBLIC_WEB_APP_URL?.trim() ||
      ''
    if (referer) headers['HTTP-Referer'] = referer
    headers['X-Title'] = process.env.OPENROUTER_APP_TITLE?.trim() || 'Yol'
  }

  const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: 'POST',
    headers,
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
