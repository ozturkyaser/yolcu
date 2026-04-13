import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** Standard: ./data/voice; überschreibbar per VOICE_STORAGE_DIR */
export function getVoiceStorageDir(): string {
  const env = process.env.VOICE_STORAGE_DIR?.trim()
  if (env) return env
  return join(process.cwd(), 'data', 'voice')
}

export function ensureVoiceDir(): void {
  const dir = getVoiceStorageDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

export function groupVoicePath(messageId: string): string {
  return join(getVoiceStorageDir(), `g-${messageId}.webm`)
}

export function commentVoicePath(commentId: string): string {
  return join(getVoiceStorageDir(), `c-${commentId}.webm`)
}

export function readVoiceIfExists(path: string): import('node:fs').ReadStream | null {
  try {
    if (!existsSync(path) || statSync(path).size < 1) return null
    return createReadStream(path)
  } catch {
    return null
  }
}
