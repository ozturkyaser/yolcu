import type { Pool } from 'pg'

function clip(s: string, max: number): string {
  const t = s.replace(/\s+/g, ' ').trim()
  if (t.length <= max) return t
  return `${t.slice(0, max)}…`
}

/**
 * Sammelt für eingeloggte Nutzer: eigene Community-Posts, Kommentare, Gruppen-Textnachrichten
 * (nur Gruppen, in denen der Nutzer Mitglied ist). Gesamtlänge begrenzt.
 */
export async function buildPersonalDbExcerpt(pool: Pool, userId: string, maxChars: number): Promise<string> {
  const maxPosts = Math.min(200, Math.max(40, Math.floor(maxChars / 400)))
  const maxComments = Math.min(200, Math.max(40, Math.floor(maxChars / 400)))
  const maxGroupMsgs = Math.min(300, Math.max(60, Math.floor(maxChars / 300)))

  const posts = await pool.query<{ body: string; category: string; created_at: Date }>(
    `SELECT body, category, created_at FROM posts
     WHERE user_id = $1::uuid AND char_length(trim(body)) >= 1
     ORDER BY created_at DESC
     LIMIT $2`,
    [userId, maxPosts],
  )

  const comments = await pool.query<{ body: string; created_at: Date }>(
    `SELECT body, created_at FROM post_comments
     WHERE user_id = $1::uuid AND message_type = 'text' AND char_length(trim(body)) >= 1
     ORDER BY created_at DESC
     LIMIT $2`,
    [userId, maxComments],
  )

  const groupChat = await pool.query<{
    group_name: string
    author_name: string
    body: string
    created_at: Date
  }>(
    `SELECT g.name AS group_name, u.display_name AS author_name, gm.body, gm.created_at
     FROM group_messages gm
     INNER JOIN group_members mem ON mem.group_id = gm.group_id AND mem.user_id = $1::uuid
     INNER JOIN groups g ON g.id = gm.group_id
     INNER JOIN users u ON u.id = gm.user_id
     WHERE gm.message_type = 'text' AND char_length(trim(gm.body)) >= 1
     ORDER BY gm.created_at DESC
     LIMIT $2`,
    [userId, maxGroupMsgs],
  )

  const lines: string[] = []
  lines.push('=== Eigene Community-Meldungen (Auszug) ===')
  for (const r of [...posts.rows].reverse()) {
    const t = new Date(r.created_at).toISOString().slice(0, 16)
    lines.push(`[${t}] [${r.category}] ${clip(r.body, 1200)}`)
  }
  lines.push('')
  lines.push('=== Eigene Kommentare unter Meldungen (Auszug) ===')
  for (const r of [...comments.rows].reverse()) {
    const t = new Date(r.created_at).toISOString().slice(0, 16)
    lines.push(`[${t}] ${clip(r.body, 800)}`)
  }
  lines.push('')
  lines.push('=== Gruppenchats (Text, nur Gruppen mit Mitgliedschaft; Auszug) ===')
  for (const r of [...groupChat.rows].reverse()) {
    const t = new Date(r.created_at).toISOString().slice(0, 16)
    lines.push(`[${t}] [${clip(r.group_name, 40)}] ${r.author_name}: ${clip(r.body, 900)}`)
  }

  let out = lines.join('\n')
  if (out.length > maxChars) out = `${out.slice(0, maxChars)}…`
  return out
}
