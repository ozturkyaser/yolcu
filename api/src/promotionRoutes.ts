import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { pool } from './pool.js'

const langSchema = z.enum(['de', 'tr', 'en'])

function mapPromotionRow(row: Record<string, unknown>) {
  return {
    id: row.id as string,
    internalName: row.internal_name as string,
    headlineDe: row.headline_de as string,
    headlineTr: row.headline_tr as string,
    headlineEn: row.headline_en as string,
    bodyDe: row.body_de as string,
    bodyTr: row.body_tr as string,
    bodyEn: row.body_en as string,
    imageUrl: row.image_url as string,
    ctaLabelDe: row.cta_label_de as string,
    ctaLabelTr: row.cta_label_tr as string,
    ctaLabelEn: row.cta_label_en as string,
    ctaUrl: row.cta_url as string,
    startsAt: row.starts_at as string,
    endsAt: row.ends_at as string,
    isActive: row.is_active as boolean,
    priority: row.priority as number,
    showAgainAfterMinutes: Number(row.show_again_after_minutes ?? 60),
    impressionCount: Number(row.impression_count),
    clickCount: Number(row.click_count),
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  }
}

function pickLocalized(
  lang: z.infer<typeof langSchema>,
  de: string,
  tr: string,
  en: string,
): string {
  if (lang === 'tr') return tr || de || en
  if (lang === 'en') return en || de || tr
  return de || tr || en
}

export async function registerPromotionRoutes(app: FastifyInstance) {
  app.get('/api/promotions/active', async (request, reply) => {
    const q = z.object({ lang: langSchema.optional().default('de') }).safeParse(request.query)
    if (!q.success) return reply.status(400).send({ error: q.error.flatten() })
    const lang = q.data.lang

    const r = await pool.query(
      `SELECT id, internal_name, headline_de, headline_tr, headline_en,
              body_de, body_tr, body_en, image_url,
              cta_label_de, cta_label_tr, cta_label_en, cta_url,
              starts_at, ends_at, is_active, priority, show_again_after_minutes,
              impression_count, click_count, created_at, updated_at
       FROM promotion_campaigns
       WHERE is_active = true
         AND starts_at <= now()
         AND ends_at >= now()
       ORDER BY priority DESC, created_at DESC
       LIMIT 1`,
    )
    const row = r.rows[0]
    if (!row) return { promotion: null }

    const m = mapPromotionRow(row)
    const headline = pickLocalized(lang, m.headlineDe, m.headlineTr, m.headlineEn)
    const body = pickLocalized(lang, m.bodyDe, m.bodyTr, m.bodyEn)
    const ctaLabel = pickLocalized(lang, m.ctaLabelDe, m.ctaLabelTr, m.ctaLabelEn)
    if (!headline.trim() || !ctaLabel.trim()) {
      return { promotion: null }
    }

    return {
      promotion: {
        id: m.id,
        headline,
        body: body.trim(),
        imageUrl: m.imageUrl.trim(),
        ctaLabel,
        ctaUrl: m.ctaUrl.trim(),
        startsAt: m.startsAt,
        endsAt: m.endsAt,
        showAgainAfterMinutes: m.showAgainAfterMinutes,
      },
    }
  })

  async function validateActiveCampaign(id: string) {
    const r = await pool.query(
      `SELECT id FROM promotion_campaigns
       WHERE id = $1
         AND is_active = true
         AND starts_at <= now()
         AND ends_at >= now()`,
      [id],
    )
    return r.rowCount ? r.rows[0] : null
  }

  app.post('/api/promotions/:id/impression', async (request, reply) => {
    const id = (request.params as { id: string }).id
    const u = await validateActiveCampaign(id)
    if (!u) return reply.status(404).send({ error: 'Keine aktive Kampagne' })

    await pool.query(
      `UPDATE promotion_campaigns SET impression_count = impression_count + 1, updated_at = now() WHERE id = $1`,
      [id],
    )
    return { ok: true }
  })

  app.post('/api/promotions/:id/click', async (request, reply) => {
    const id = (request.params as { id: string }).id
    const u = await validateActiveCampaign(id)
    if (!u) return reply.status(404).send({ error: 'Keine aktive Kampagne' })

    const r = await pool.query<{ cta_url: string }>(
      `UPDATE promotion_campaigns SET click_count = click_count + 1, updated_at = now() WHERE id = $1 RETURNING cta_url`,
      [id],
    )
    const url = r.rows[0]?.cta_url?.trim() ?? ''
    return { ok: true, ctaUrl: url }
  })
}
