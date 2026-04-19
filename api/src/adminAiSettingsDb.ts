import type { Pool } from 'pg'
import { decryptUserAiSecret } from './userAiCrypto.js'

import { DEFAULT_OPENROUTER_MODEL, isAllowedOpenRouterModelId } from './openrouter.js'

export type AdminAiRow = {
  openai_api_key_encrypted: string | null
  ai_model: string | null
  default_extra_system_prompt: string | null
}

/** Für KI-Aufruf: entschlüsselter Key + Modell (OpenRouter-ID) + Prompt-Zusatz. Basis-URL ist immer OpenRouter. */
export async function getAdminAiDefaultsForMerge(pool: Pool): Promise<{
  apiKey: string | null
  model: string | null
  defaultExtraPrompt: string | null
}> {
  const r = await pool.query<AdminAiRow>(
    `SELECT openai_api_key_encrypted, ai_model, default_extra_system_prompt
     FROM admin_ai_settings WHERE id = 1`,
  )
  const row = r.rows[0]
  if (!row) {
    return { apiKey: null, model: null, defaultExtraPrompt: null }
  }
  let apiKey: string | null = null
  if (row.openai_api_key_encrypted) {
    const d = decryptUserAiSecret(row.openai_api_key_encrypted)
    apiKey = d?.trim() || null
  }
  const rawModel = row.ai_model?.trim() || null
  const model =
    rawModel && isAllowedOpenRouterModelId(rawModel) ? rawModel : rawModel ? DEFAULT_OPENROUTER_MODEL : null
  return {
    apiKey,
    model,
    defaultExtraPrompt: row.default_extra_system_prompt?.trim() || null,
  }
}
