import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { pool } from './pool.js'

async function authenticate(request: FastifyRequest, reply: FastifyReply) {
  try {
    await request.jwtVerify()
  } catch {
    return reply.status(401).send({ error: 'Nicht angemeldet' })
  }
}

async function requireAdmin(request: FastifyRequest, reply: FastifyReply) {
  const r = await pool.query<{ role: string }>(`SELECT role FROM users WHERE id = $1`, [
    (request.user as { sub: string }).sub,
  ])
  if (r.rows[0]?.role !== 'admin') {
    return reply.status(403).send({ error: 'Adminrechte erforderlich' })
  }
}

const httpStreamUrl = z
  .string()
  .min(8)
  .max(2000)
  .refine((s) => /^https?:\/\//i.test(s.trim()), 'Nur http(s)-Stream-URLs')

const radioCreateSchema = z.object({
  name: z.string().min(1).max(200),
  streamUrl: httpStreamUrl,
  sortOrder: z.number().int().optional().default(0),
  enabled: z.boolean().optional().default(true),
})

const radioPatchSchema = radioCreateSchema.partial()

function mapRow(row: Record<string, unknown>) {
  return {
    id: row.id,
    name: row.name,
    streamUrl: row.stream_url,
    sortOrder: row.sort_order,
    enabled: row.enabled,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export async function registerRadioRoutes(app: FastifyInstance) {
  app.get('/api/radio/channels', async () => {
    const r = await pool.query(
      `SELECT id, name, stream_url, sort_order, enabled, created_at, updated_at
       FROM radio_channels
       WHERE enabled = true
       ORDER BY sort_order DESC, name ASC
       LIMIT 100`,
    )
    return { channels: r.rows.map(mapRow) }
  })

  app.get('/api/admin/radio/channels', { preHandler: [authenticate, requireAdmin] }, async () => {
    const r = await pool.query(
      `SELECT id, name, stream_url, sort_order, enabled, created_at, updated_at
       FROM radio_channels
       ORDER BY sort_order DESC, name ASC
       LIMIT 200`,
    )
    return { channels: r.rows.map(mapRow) }
  })

  app.post('/api/admin/radio/channels', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
    const parsed = radioCreateSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() })
    const d = parsed.data
    const ins = await pool.query(
      `INSERT INTO radio_channels (name, stream_url, sort_order, enabled)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, stream_url, sort_order, enabled, created_at, updated_at`,
      [d.name.trim(), d.streamUrl.trim(), d.sortOrder, d.enabled],
    )
    return { channel: mapRow(ins.rows[0]!) }
  })

  app.patch('/api/admin/radio/channels/:id', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
    const id = (request.params as { id: string }).id
    const parsed = radioPatchSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() })
    const d = parsed.data
    if (Object.keys(d).length === 0) return reply.status(400).send({ error: 'Keine Felder' })

    const cur = await pool.query(`SELECT id FROM radio_channels WHERE id = $1`, [id])
    if (!cur.rowCount) return reply.status(404).send({ error: 'Kanal nicht gefunden' })

    const parts: string[] = []
    const vals: unknown[] = []
    let n = 1
    const add = (col: string, val: unknown) => {
      parts.push(`${col} = $${n}`)
      vals.push(val)
      n += 1
    }
    if (d.name != null) add('name', d.name.trim())
    if (d.streamUrl != null) add('stream_url', d.streamUrl.trim())
    if (d.sortOrder != null) add('sort_order', d.sortOrder)
    if (d.enabled != null) add('enabled', d.enabled)
    parts.push('updated_at = now()')
    vals.push(id)
    await pool.query(`UPDATE radio_channels SET ${parts.join(', ')} WHERE id = $${n}`, vals)

    const r = await pool.query(
      `SELECT id, name, stream_url, sort_order, enabled, created_at, updated_at FROM radio_channels WHERE id = $1`,
      [id],
    )
    return { channel: mapRow(r.rows[0]!) }
  })

  app.delete('/api/admin/radio/channels/:id', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
    const id = (request.params as { id: string }).id
    const r = await pool.query(`DELETE FROM radio_channels WHERE id = $1 RETURNING id`, [id])
    if (!r.rowCount) return reply.status(404).send({ error: 'Kanal nicht gefunden' })
    return { ok: true }
  })
}
