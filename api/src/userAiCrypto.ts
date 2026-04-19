import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'

const SALT = Buffer.from('yol-user-ai-v1', 'utf8')

function encryptionKey(): Buffer | null {
  const secret = process.env.AI_USER_SECRET?.trim() || process.env.JWT_SECRET?.trim()
  if (!secret) return null
  return scryptSync(secret, SALT, 32)
}

/** AES-256-GCM; Rückgabe Base64(iv+tag+ciphertext). */
export function encryptUserAiSecret(plain: string): string | null {
  const key = encryptionKey()
  if (!key) return null
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, enc]).toString('base64')
}

export function decryptUserAiSecret(encoded: string): string | null {
  const key = encryptionKey()
  if (!key) return null
  try {
    const buf = Buffer.from(encoded, 'base64')
    if (buf.length < 29) return null
    const iv = buf.subarray(0, 12)
    const tag = buf.subarray(12, 28)
    const data = buf.subarray(28)
    const decipher = createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')
  } catch {
    return null
  }
}
