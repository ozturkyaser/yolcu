import { randomBytes } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import multipart from '@fastify/multipart'
import websocket from '@fastify/websocket'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { WebSocket } from 'ws'
import { z } from 'zod'
import { haversineKm } from './geo.js'
import {
  bindSocketUser,
  broadcastGroup,
  clearSocketUser,
  getRoomSockets,
  getSocketUserId,
  joinRoom,
  leaveAllRooms,
} from './realtime.js'
import { pool } from './pool.js'
import { commentVoicePath, ensureVoiceDir, getVoiceStorageDir, groupVoicePath, readVoiceIfExists } from './voiceStorage.js'

async function authenticate(request: FastifyRequest, reply: FastifyReply) {
  try {
    await request.jwtVerify()
  } catch {
    return reply.status(401).send({ error: 'Nicht angemeldet' })
  }
}

const INVITE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

function generateInviteCode(): string {
  const buf = randomBytes(10)
  let s = ''
  for (let i = 0; i < 8; i++) s += INVITE_CHARS[buf[i] % INVITE_CHARS.length]
  return s
}

async function ensureUniqueInvite(): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const code = generateInviteCode()
    const r = await pool.query(`SELECT 1 FROM groups WHERE invite_code = $1`, [code])
    if (r.rowCount === 0) return code
  }
  throw new Error('invite_code collision')
}

async function isGroupMember(groupId: string, userId: string): Promise<boolean> {
  const r = await pool.query(
    `SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2`,
    [groupId, userId],
  )
  return (r.rowCount ?? 0) > 0
}

async function getDisplayName(userId: string): Promise<string> {
  const r = await pool.query(`SELECT display_name FROM users WHERE id = $1`, [userId])
  return r.rows[0]?.display_name ?? 'Nutzer'
}

/** PTT-Session: welche Nutzer-ID hören (null = ganze Gruppe außer Sender). */
const pttNearSession = new Map<string, { recipients: Set<string> | null }>()

const PTT_POS_MAX_AGE_MS = 35 * 60 * 1000

async function computePttRecipientUserIds(
  groupId: string,
  fromUserId: string,
  maxKm: number,
): Promise<{ recipients: Set<string>; error?: string }> {
  const sp = await pool.query(
    `SELECT lat, lng, updated_at FROM map_live_positions WHERE user_id = $1`,
    [fromUserId],
  )
  const sr = sp.rows[0]
  if (!sr) {
    return { recipients: new Set(), error: 'Nah-Funk: Bitte Position auf der Karte teilen.' }
  }
  const ageMs = Date.now() - new Date(sr.updated_at as Date).getTime()
  if (ageMs > PTT_POS_MAX_AGE_MS) {
    return { recipients: new Set(), error: 'Standort zu alt – Position auf der Karte aktualisieren.' }
  }
  const sLat = Number(sr.lat)
  const sLng = Number(sr.lng)
  const members = await pool.query(
    `SELECT gm.user_id, p.lat, p.lng, p.updated_at
     FROM group_members gm
     LEFT JOIN map_live_positions p ON p.user_id = gm.user_id
     WHERE gm.group_id = $1`,
    [groupId],
  )
  const recipients = new Set<string>()
  for (const m of members.rows) {
    const uid = m.user_id as string
    if (uid === fromUserId) continue
    if (m.lat == null || m.lng == null || m.updated_at == null) continue
    const mAge = Date.now() - new Date(m.updated_at as Date).getTime()
    if (mAge > PTT_POS_MAX_AGE_MS) continue
    const km = haversineKm({ lat: sLat, lng: sLng }, { lat: Number(m.lat), lng: Number(m.lng) })
    if (km <= maxKm) recipients.add(uid)
  }
  return { recipients }
}

type GroupMsgRow = {
  id: string
  group_id: string
  user_id: string
  body: string
  created_at: Date
  message_type: string
  voice_duration_ms: number | null
  voice_storage_key: string | null
}

function groupMessageToPayload(row: GroupMsgRow, authorName: string) {
  const base = {
    type: 'message' as const,
    messageType: row.message_type as 'text' | 'voice',
    id: row.id,
    groupId: row.group_id,
    userId: row.user_id,
    authorName,
    body: row.body,
    createdAt: row.created_at,
    voiceDurationMs: undefined as number | undefined,
    voiceUrl: undefined as string | undefined,
  }
  if (row.message_type === 'voice' && row.voice_storage_key) {
    base.voiceDurationMs = row.voice_duration_ms ?? undefined
    base.voiceUrl = `/api/groups/${row.group_id}/messages/${row.id}/voice`
  }
  return base
}

async function insertGroupMessage(groupId: string, userId: string, body: string) {
  const r = await pool.query(
    `INSERT INTO group_messages (group_id, user_id, body, message_type)
     VALUES ($1, $2, $3, 'text')
     RETURNING id, group_id, user_id, body, created_at, message_type, voice_duration_ms, voice_storage_key`,
    [groupId, userId, body],
  )
  const row = r.rows[0] as GroupMsgRow
  const authorName = await getDisplayName(userId)
  const payload = groupMessageToPayload(row, authorName)
  broadcastGroup(groupId, payload)
  return payload
}

async function insertGroupVoiceMessage(
  groupId: string,
  userId: string,
  buffer: Buffer,
  mime: string,
  durationMs: number,
  caption: string,
) {
  const cap = caption.slice(0, 4000)
  const r = await pool.query(
    `INSERT INTO group_messages (group_id, user_id, body, message_type, voice_mime, voice_duration_ms, voice_storage_key)
     VALUES ($1, $2, $3, 'voice', $4, $5, '')
     RETURNING id, group_id, user_id, body, created_at, message_type, voice_duration_ms, voice_storage_key`,
    [groupId, userId, cap, mime, Math.round(durationMs)],
  )
  const row = r.rows[0] as GroupMsgRow
  const key = `g-${row.id}.webm`
  ensureVoiceDir()
  writeFileSync(groupVoicePath(row.id), buffer)
  await pool.query(`UPDATE group_messages SET voice_storage_key = $1 WHERE id = $2`, [key, row.id])
  row.voice_storage_key = key
  const authorName = await getDisplayName(userId)
  const payload = groupMessageToPayload(row, authorName)
  broadcastGroup(groupId, payload)
  return payload
}

const groupCreateSchema = z.object({
  name: z.string().min(1).max(120),
  kind: z.enum(['trip', 'permanent']),
})

const joinSchema = z.object({
  inviteCode: z.string().min(6).max(12).transform((s) => s.trim().toUpperCase()),
})

const messageBodySchema = z.object({
  body: z.string().min(1).max(4000),
})

const commentSchema = z.object({
  body: z.string().min(1).max(2000),
})

const poiSchema = z.object({
  name: z.string().min(1).max(200),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  category: z
    .enum(['parking', 'border', 'fuel', 'rest', 'hotel', 'restaurant', 'mosque', 'help', 'other'])
    .optional()
    .default('other'),
  note: z.string().max(500).optional(),
})

const groupConvoyPatchSchema = z.object({
  convoyDestination: z.string().max(200).optional().nullable(),
  convoyDepartureNote: z.string().max(300).optional().nullable(),
  convoyStatus: z.enum(['driving', 'pause', 'fuel', 'border', 'arrived']).optional().nullable(),
})

export async function registerSocialRoutes(app: FastifyInstance) {
  await app.register(multipart, { limits: { fileSize: 3 * 1024 * 1024 } })
  await app.register(websocket)

  app.get('/api/ws', { websocket: true }, (ws: WebSocket, request) => {
    const url = new URL(request.url, 'http://localhost')
    const token = url.searchParams.get('token')
    if (!token) {
      ws.close()
      return
    }

    let userId: string
    try {
      const payload = app.jwt.verify(token) as { sub: string }
      userId = payload.sub
    } catch {
      ws.close()
      return
    }

    bindSocketUser(ws, userId)

    ws.on('close', () => {
      leaveAllRooms(ws)
      clearSocketUser(ws)
    })

    ws.on('message', (raw: WebSocket.RawData) => {
      void (async () => {
        let msg: {
          type?: string
          groupId?: string
          body?: string
          phase?: string
          pcmBase64?: string
          sampleRate?: number
          nearbyOnly?: boolean
          nearbyKm?: number
        }
        try {
          msg = JSON.parse(String(raw)) as typeof msg
        } catch {
          return
        }

        if (msg.type === 'join' && msg.groupId) {
          const ok = await isGroupMember(msg.groupId, userId)
          if (!ok) {
            ws.send(JSON.stringify({ type: 'error', error: 'Kein Zugriff auf diese Gruppe' }))
            return
          }
          joinRoom(ws, msg.groupId)
          ws.send(JSON.stringify({ type: 'joined', groupId: msg.groupId }))
          return
        }

        if (msg.type === 'chat' && msg.groupId && msg.body) {
          const parsed = messageBodySchema.safeParse({ body: msg.body })
          if (!parsed.success) return
          const ok = await isGroupMember(msg.groupId, userId)
          if (!ok) {
            ws.send(JSON.stringify({ type: 'error', error: 'Kein Zugriff' }))
            return
          }
          try {
            await insertGroupMessage(msg.groupId, userId, parsed.data.body)
          } catch (e) {
            app.log.error(e)
            ws.send(JSON.stringify({ type: 'error', error: 'Senden fehlgeschlagen' }))
          }
          return
        }

        if (msg.type === 'voice_ptt' && msg.groupId && msg.phase) {
          const ok = await isGroupMember(msg.groupId, userId)
          if (!ok) {
            ws.send(JSON.stringify({ type: 'error', error: 'Kein Zugriff' }))
            return
          }
          if (!['start', 'chunk', 'end'].includes(msg.phase)) return
          if (msg.phase === 'chunk') {
            if (!msg.pcmBase64 || msg.pcmBase64.length > 180_000) return
          }

          const pttKey = `${msg.groupId}:${userId}`

          if (msg.phase === 'start') {
            const nearbyOnly = Boolean(msg.nearbyOnly)
            const km = Math.min(100, Math.max(1, Number(msg.nearbyKm) || 25))
            if (nearbyOnly) {
              const { recipients, error } = await computePttRecipientUserIds(msg.groupId, userId, km)
              if (error) {
                ws.send(JSON.stringify({ type: 'error', error }))
                return
              }
              pttNearSession.set(pttKey, { recipients })
            } else {
              pttNearSession.set(pttKey, { recipients: null })
            }
          }

          const sess = pttNearSession.get(pttKey) ?? { recipients: null }
          if (msg.phase === 'end') {
            pttNearSession.delete(pttKey)
          }

          const authorName = await getDisplayName(userId)
          const payload = {
            type: 'voice_ptt' as const,
            groupId: msg.groupId,
            userId,
            authorName,
            phase: msg.phase,
            sampleRate: msg.phase === 'start' ? msg.sampleRate : undefined,
            pcmBase64: msg.phase === 'chunk' ? msg.pcmBase64 : undefined,
          }
          const rawOut = JSON.stringify(payload)

          const room = getRoomSockets(msg.groupId)
          if (!room?.size) return

          for (const client of room) {
            if (client.readyState !== 1) continue
            const uid = getSocketUserId(client)
            if (!uid || uid === userId) continue
            if (sess.recipients !== null && !sess.recipients.has(uid)) continue
            try {
              client.send(rawOut)
            } catch {
              /* ignore */
            }
          }
        }
      })()
    })
  })

  app.get('/api/groups', { preHandler: authenticate }, async (request) => {
    const r = await pool.query(
      `SELECT g.id, g.name, g.kind, g.invite_code, g.created_at, gm.role,
        (SELECT COUNT(*)::int FROM group_members gm2 WHERE gm2.group_id = g.id) AS member_count
       FROM groups g
       INNER JOIN group_members gm ON gm.group_id = g.id AND gm.user_id = $1
       ORDER BY g.created_at DESC`,
      [request.user.sub],
    )
    return {
      groups: r.rows.map((row) => ({
        id: row.id,
        name: row.name,
        kind: row.kind,
        inviteCode: row.invite_code,
        role: row.role,
        memberCount: row.member_count,
        createdAt: row.created_at,
      })),
    }
  })

  app.post('/api/groups', { preHandler: authenticate }, async (request, reply) => {
    const parsed = groupCreateSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() })

    const invite = await ensureUniqueInvite()
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const g = await client.query(
        `INSERT INTO groups (name, kind, invite_code, created_by)
         VALUES ($1, $2, $3, $4)
         RETURNING id, name, kind, invite_code, created_at`,
        [parsed.data.name, parsed.data.kind, invite, request.user.sub],
      )
      const row = g.rows[0]
      await client.query(
        `INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, 'admin')`,
        [row.id, request.user.sub],
      )
      await client.query('COMMIT')
      return {
        group: {
          id: row.id,
          name: row.name,
          kind: row.kind,
          inviteCode: row.invite_code,
          role: 'admin',
          memberCount: 1,
          createdAt: row.created_at,
        },
      }
    } catch (e) {
      await client.query('ROLLBACK')
      throw e
    } finally {
      client.release()
    }
  })

  /** Gemeinsame Gruppen mit einem anderen Nutzer (für Karte → Nachricht). Muss vor /api/groups/:id stehen. */
  app.get('/api/groups/shared-with/:userId', { preHandler: authenticate }, async (request, reply) => {
    const rawId = (request.params as { userId: string }).userId
    const parsedId = z.string().uuid().safeParse(rawId)
    if (!parsedId.success) return reply.status(400).send({ error: 'Ungültige Nutzer-ID' })
    const otherId = parsedId.data
    if (otherId === request.user.sub) {
      return { groups: [] as { id: string; name: string }[] }
    }
    const r = await pool.query(
      `SELECT g.id, g.name
       FROM groups g
       INNER JOIN group_members me ON me.group_id = g.id AND me.user_id = $1
       INNER JOIN group_members them ON them.group_id = g.id AND them.user_id = $2
       ORDER BY g.name ASC`,
      [request.user.sub, otherId],
    )
    return {
      groups: r.rows.map((row) => ({ id: row.id, name: row.name })),
    }
  })

  app.post('/api/groups/join', { preHandler: authenticate }, async (request, reply) => {
    const parsed = joinSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() })

    const g = await pool.query(`SELECT id FROM groups WHERE invite_code = $1`, [parsed.data.inviteCode])
    const groupId = g.rows[0]?.id
    if (!groupId) return reply.status(404).send({ error: 'Code unbekannt' })

    try {
      await pool.query(
        `INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, 'member')
         ON CONFLICT (group_id, user_id) DO NOTHING`,
        [groupId, request.user.sub],
      )
    } catch {
      return reply.status(400).send({ error: 'Beitritt fehlgeschlagen' })
    }

    const full = await pool.query(
      `SELECT g.id, g.name, g.kind, g.invite_code, g.created_at, gm.role,
        (SELECT COUNT(*)::int FROM group_members gm2 WHERE gm2.group_id = g.id) AS member_count
       FROM groups g
       JOIN group_members gm ON gm.group_id = g.id AND gm.user_id = $2
       WHERE g.id = $1`,
      [groupId, request.user.sub],
    )
    const row = full.rows[0]
    return {
      group: {
        id: row.id,
        name: row.name,
        kind: row.kind,
        inviteCode: row.invite_code,
        role: row.role,
        memberCount: row.member_count,
        createdAt: row.created_at,
      },
    }
  })

  app.get('/api/groups/:id', { preHandler: authenticate }, async (request, reply) => {
    const id = (request.params as { id: string }).id
    if (!(await isGroupMember(id, request.user.sub))) {
      return reply.status(403).send({ error: 'Kein Zugriff' })
    }
    const g = await pool.query(
      `SELECT id, name, kind, invite_code, created_at,
              convoy_destination, convoy_departure_note, convoy_status
       FROM groups WHERE id = $1`,
      [id],
    )
    const group = g.rows[0]
    if (!group) return reply.status(404).send({ error: 'Nicht gefunden' })

    const members = await pool.query(
      `SELECT u.id, u.display_name, gm.role, gm.joined_at
       FROM group_members gm
       JOIN users u ON u.id = gm.user_id
       WHERE gm.group_id = $1
       ORDER BY gm.joined_at ASC`,
      [id],
    )

    return {
      group: {
        id: group.id,
        name: group.name,
        kind: group.kind,
        inviteCode: group.invite_code,
        createdAt: group.created_at,
        convoyDestination: group.convoy_destination ?? null,
        convoyDepartureNote: group.convoy_departure_note ?? null,
        convoyStatus: group.convoy_status ?? null,
      },
      members: members.rows.map((m) => ({
        id: m.id,
        displayName: m.display_name,
        role: m.role,
        joinedAt: m.joined_at,
      })),
    }
  })

  app.patch('/api/groups/:id/convoy', { preHandler: authenticate }, async (request, reply) => {
    const id = (request.params as { id: string }).id
    const parsed = groupConvoyPatchSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() })

    const roleR = await pool.query(
      `SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2`,
      [id, request.user.sub],
    )
    if (roleR.rows[0]?.role !== 'admin') {
      return reply.status(403).send({ error: 'Nur Gruppen-Admins können den Konvoi bearbeiten.' })
    }

    const d = parsed.data
    const sets: string[] = []
    const params: unknown[] = []
    let n = 1
    if (d.convoyDestination !== undefined) {
      sets.push(`convoy_destination = $${n++}`)
      params.push(d.convoyDestination)
    }
    if (d.convoyDepartureNote !== undefined) {
      sets.push(`convoy_departure_note = $${n++}`)
      params.push(d.convoyDepartureNote)
    }
    if (d.convoyStatus !== undefined) {
      sets.push(`convoy_status = $${n++}`)
      params.push(d.convoyStatus)
    }
    if (sets.length === 0) {
      return reply.status(400).send({ error: 'Keine Felder zum Aktualisieren.' })
    }
    params.push(id)
    const u = await pool.query(
      `UPDATE groups SET ${sets.join(', ')} WHERE id = $${n} RETURNING id, convoy_destination, convoy_departure_note, convoy_status`,
      params,
    )
    const row = u.rows[0]
    if (!row) return reply.status(404).send({ error: 'Nicht gefunden' })
    return {
      convoy: {
        convoyDestination: row.convoy_destination ?? null,
        convoyDepartureNote: row.convoy_departure_note ?? null,
        convoyStatus: row.convoy_status ?? null,
      },
    }
  })

  app.get('/api/groups/:id/messages', { preHandler: authenticate }, async (request, reply) => {
    const id = (request.params as { id: string }).id
    if (!(await isGroupMember(id, request.user.sub))) {
      return reply.status(403).send({ error: 'Kein Zugriff' })
    }
    const limit = Math.min(100, Number((request.query as { limit?: string }).limit) || 80)
    const r = await pool.query(
      `SELECT m.id, m.body, m.created_at, m.user_id, m.message_type, m.voice_duration_ms, m.voice_storage_key, m.group_id,
              u.display_name AS author_name
       FROM group_messages m
       JOIN users u ON u.id = m.user_id
       WHERE m.group_id = $1
       ORDER BY m.created_at ASC
       LIMIT $2`,
      [id, limit],
    )
    return {
      messages: r.rows.map((row) => {
        const messageType = (row.message_type as string) || 'text'
        const base = {
          id: row.id,
          body: row.body,
          createdAt: row.created_at,
          userId: row.user_id,
          authorName: row.author_name,
          messageType: messageType as 'text' | 'voice',
          voiceDurationMs: undefined as number | undefined,
          voiceUrl: undefined as string | undefined,
        }
        if (messageType === 'voice' && row.voice_storage_key) {
          base.voiceDurationMs = row.voice_duration_ms ?? undefined
          base.voiceUrl = `/api/groups/${row.group_id}/messages/${row.id}/voice`
        }
        return base
      }),
    }
  })

  app.get('/api/groups/:id/messages/:messageId/voice', { preHandler: authenticate }, async (request, reply) => {
    const id = (request.params as { id: string }).id
    const messageId = (request.params as { messageId: string }).messageId
    if (!(await isGroupMember(id, request.user.sub))) {
      return reply.status(403).send({ error: 'Kein Zugriff' })
    }
    const r = await pool.query(
      `SELECT message_type, voice_storage_key, voice_mime FROM group_messages WHERE id = $1 AND group_id = $2`,
      [messageId, id],
    )
    const row = r.rows[0]
    if (!row || row.message_type !== 'voice' || !row.voice_storage_key) {
      return reply.status(404).send({ error: 'Nicht gefunden' })
    }
    const fullPath = join(getVoiceStorageDir(), row.voice_storage_key)
    const stream = readVoiceIfExists(fullPath)
    if (!stream) return reply.status(404).send({ error: 'Datei fehlt' })
    reply.header('Content-Type', row.voice_mime || 'audio/webm')
    reply.header('Cache-Control', 'private, max-age=3600')
    return reply.send(stream)
  })

  app.post('/api/groups/:id/messages/voice', { preHandler: authenticate }, async (request, reply) => {
    const id = (request.params as { id: string }).id
    if (!(await isGroupMember(id, request.user.sub))) {
      return reply.status(403).send({ error: 'Kein Zugriff' })
    }
    let buffer: Buffer | null = null
    let mime = 'audio/webm'
    let durationMs = 0
    let caption = ''
    const parts = request.parts()
    for await (const part of parts) {
      if (part.type === 'field') {
        if (part.fieldname === 'durationMs') {
          durationMs = Math.min(120_000, Math.max(0, Number(part.value) || 0))
        }
        if (part.fieldname === 'caption') {
          caption = String(part.value ?? '').slice(0, 4000)
        }
      }
      if (part.type === 'file' && part.fieldname === 'audio') {
        buffer = await part.toBuffer()
        if (part.mimetype) mime = part.mimetype
      }
    }
    if (!buffer || buffer.length < 80) {
      return reply.status(400).send({ error: 'Audiodatei fehlt oder zu klein' })
    }
    if (durationMs <= 0) durationMs = 1000
    try {
      const payload = await insertGroupVoiceMessage(id, request.user.sub, buffer, mime, durationMs, caption)
      return { message: payload }
    } catch (e) {
      app.log.error(e)
      return reply.status(500).send({ error: 'Sprachnachricht konnte nicht gespeichert werden' })
    }
  })

  app.post('/api/groups/:id/messages', { preHandler: authenticate }, async (request, reply) => {
    const id = (request.params as { id: string }).id
    if (!(await isGroupMember(id, request.user.sub))) {
      return reply.status(403).send({ error: 'Kein Zugriff' })
    }
    const parsed = messageBodySchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() })

    const payload = await insertGroupMessage(id, request.user.sub, parsed.data.body)
    return { message: payload }
  })

  app.get('/api/posts/:id/comments', async (request, reply) => {
    const id = (request.params as { id: string }).id
    const r = await pool.query(
      `SELECT c.id, c.body, c.created_at, c.message_type, c.voice_duration_ms, c.voice_storage_key, c.post_id,
              u.id AS user_id, u.display_name AS author_name
       FROM post_comments c
       JOIN users u ON u.id = c.user_id
       WHERE c.post_id = $1
       ORDER BY c.created_at ASC`,
      [id],
    )
    return {
      comments: r.rows.map((row) => {
        const messageType = (row.message_type as string) || 'text'
        const base = {
          id: row.id,
          body: row.body,
          createdAt: row.created_at,
          author: { id: row.user_id, displayName: row.author_name },
          messageType: messageType as 'text' | 'voice',
          voiceDurationMs: undefined as number | undefined,
          voiceUrl: undefined as string | undefined,
        }
        if (messageType === 'voice' && row.voice_storage_key) {
          base.voiceDurationMs = row.voice_duration_ms ?? undefined
          base.voiceUrl = `/api/posts/${row.post_id}/comments/${row.id}/voice`
        }
        return base
      }),
    }
  })

  app.get('/api/posts/:postId/comments/:commentId/voice', { preHandler: authenticate }, async (request, reply) => {
    const { postId, commentId } = request.params as { postId: string; commentId: string }
    const r = await pool.query(
      `SELECT c.message_type, c.voice_storage_key, c.voice_mime
       FROM post_comments c WHERE c.id = $1 AND c.post_id = $2`,
      [commentId, postId],
    )
    const row = r.rows[0]
    if (!row || row.message_type !== 'voice' || !row.voice_storage_key) {
      return reply.status(404).send({ error: 'Nicht gefunden' })
    }
    const fullPath = join(getVoiceStorageDir(), row.voice_storage_key)
    const stream = readVoiceIfExists(fullPath)
    if (!stream) return reply.status(404).send({ error: 'Datei fehlt' })
    reply.header('Content-Type', row.voice_mime || 'audio/webm')
    reply.header('Cache-Control', 'private, max-age=3600')
    return reply.send(stream)
  })

  app.post('/api/posts/:id/comments', { preHandler: authenticate }, async (request, reply) => {
    const id = (request.params as { id: string }).id
    const parsed = commentSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() })

    const p = await pool.query(`SELECT id FROM posts WHERE id = $1`, [id])
    if (!p.rows[0]) return reply.status(404).send({ error: 'Post nicht gefunden' })

    const r = await pool.query(
      `INSERT INTO post_comments (post_id, user_id, body, message_type)
       VALUES ($1, $2, $3, 'text')
       RETURNING id, body, created_at, message_type, voice_duration_ms, voice_storage_key`,
      [id, request.user.sub, parsed.data.body],
    )
    const row = r.rows[0]
    const u = await pool.query(`SELECT id, display_name FROM users WHERE id = $1`, [request.user.sub])
    const author = u.rows[0]
    return {
      comment: {
        id: row.id,
        body: row.body,
        createdAt: row.created_at,
        author: { id: author.id, displayName: author.display_name },
        messageType: 'text' as const,
      },
    }
  })

  app.post('/api/posts/:id/comments/voice', { preHandler: authenticate }, async (request, reply) => {
    const id = (request.params as { id: string }).id
    const p = await pool.query(`SELECT id FROM posts WHERE id = $1`, [id])
    if (!p.rows[0]) return reply.status(404).send({ error: 'Post nicht gefunden' })

    let buffer: Buffer | null = null
    let mime = 'audio/webm'
    let durationMs = 0
    let caption = ''
    const parts = request.parts()
    for await (const part of parts) {
      if (part.type === 'field') {
        if (part.fieldname === 'durationMs') {
          durationMs = Math.min(60_000, Math.max(0, Number(part.value) || 0))
        }
        if (part.fieldname === 'caption') {
          caption = String(part.value ?? '').slice(0, 2000)
        }
      }
      if (part.type === 'file' && part.fieldname === 'audio') {
        buffer = await part.toBuffer()
        if (part.mimetype) mime = part.mimetype
      }
    }
    if (!buffer || buffer.length < 80) {
      return reply.status(400).send({ error: 'Audiodatei fehlt oder zu klein' })
    }
    if (durationMs <= 0) durationMs = 1000

    const cap = caption.slice(0, 2000)
    const ins = await pool.query(
      `INSERT INTO post_comments (post_id, user_id, body, message_type, voice_mime, voice_duration_ms, voice_storage_key)
       VALUES ($1, $2, $3, 'voice', $4, $5, '')
       RETURNING id, body, created_at, post_id, message_type, voice_duration_ms`,
      [id, request.user.sub, cap, mime, Math.round(durationMs)],
    )
    const row = ins.rows[0]
    const key = `c-${row.id}.webm`
    ensureVoiceDir()
    writeFileSync(commentVoicePath(row.id), buffer)
    await pool.query(`UPDATE post_comments SET voice_storage_key = $1 WHERE id = $2`, [key, row.id])
    const u = await pool.query(`SELECT id, display_name FROM users WHERE id = $1`, [request.user.sub])
    const author = u.rows[0]
    return {
      comment: {
        id: row.id,
        body: row.body,
        createdAt: row.created_at,
        author: { id: author.id, displayName: author.display_name },
        messageType: 'voice' as const,
        voiceDurationMs: row.voice_duration_ms ?? undefined,
        voiceUrl: `/api/posts/${row.post_id}/comments/${row.id}/voice`,
      },
    }
  })

  app.get('/api/pois', async (request, reply) => {
    const q = z
      .object({
        lat: z.coerce.number().min(-90).max(90),
        lng: z.coerce.number().min(-180).max(180),
        radiusKm: z.coerce.number().min(1).max(500).optional().default(80),
      })
      .safeParse(request.query)
    if (!q.success) return reply.status(400).send({ error: q.error.flatten() })

    const { lat, lng, radiusKm } = q.data
    const dLat = radiusKm / 111
    const cosLat = Math.cos((lat * Math.PI) / 180)
    const dLng = radiusKm / (111 * Math.max(Math.abs(cosLat), 0.2))

    const r = await pool.query(
      `SELECT id, name, category, lat, lng, note, created_at, created_by
       FROM map_pois
       WHERE lat BETWEEN $1 - $2 AND $1 + $2
         AND lng BETWEEN $3 - $4 AND $3 + $4
       ORDER BY created_at DESC
       LIMIT 200`,
      [lat, dLat, lng, dLng],
    )
    return {
      pois: r.rows.map((row) => ({
        id: row.id,
        name: row.name,
        category: row.category,
        lat: row.lat,
        lng: row.lng,
        note: row.note,
        createdAt: row.created_at,
        createdBy: row.created_by,
      })),
    }
  })

  app.post('/api/pois', { preHandler: authenticate }, async (request, reply) => {
    const parsed = poiSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() })

    const r = await pool.query(
      `INSERT INTO map_pois (created_by, name, category, lat, lng, note)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, name, category, lat, lng, note, created_at, created_by`,
      [
        request.user.sub,
        parsed.data.name,
        parsed.data.category,
        parsed.data.lat,
        parsed.data.lng,
        parsed.data.note ?? null,
      ],
    )
    const row = r.rows[0]
    return {
      poi: {
        id: row.id,
        name: row.name,
        category: row.category,
        lat: row.lat,
        lng: row.lng,
        note: row.note,
        createdAt: row.created_at,
        createdBy: row.created_by,
      },
    }
  })
}
