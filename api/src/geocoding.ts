import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'

/** Antwortzeile Nominatim (format=jsonv2). */
type NominatimRow = {
  lat?: string
  lon?: string
  display_name?: string
  type?: string
}

export type GeocodeHitDto = {
  lat: number
  lng: number
  label: string
  kind?: string
}

export async function searchNominatim(query: string, userAgent: string): Promise<GeocodeHitDto[]> {
  const url = new URL('https://nominatim.openstreetmap.org/search')
  url.searchParams.set('format', 'jsonv2')
  url.searchParams.set('q', query)
  url.searchParams.set('limit', '8')
  url.searchParams.set('addressdetails', '0')

  const res = await fetch(url.toString(), {
    headers: {
      'User-Agent': userAgent,
      Accept: 'application/json',
    },
  })

  if (!res.ok) {
    throw new Error(`Nominatim HTTP ${res.status}`)
  }

  const data = (await res.json()) as NominatimRow[]
  if (!Array.isArray(data)) return []

  const out: GeocodeHitDto[] = []
  for (const row of data) {
    const lat = row.lat != null ? Number.parseFloat(row.lat) : Number.NaN
    const lng = row.lon != null ? Number.parseFloat(row.lon) : Number.NaN
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) continue
    out.push({
      lat,
      lng,
      label: typeof row.display_name === 'string' ? row.display_name : `${lat}, ${lng}`,
      kind: typeof row.type === 'string' ? row.type : undefined,
    })
  }
  return out
}

const geocodeQuerySchema = z.object({ q: z.string().max(220) })

async function geocodeSearchHandler(request: FastifyRequest, reply: FastifyReply) {
  const parsed = geocodeQuerySchema.safeParse(request.query)
  if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() })

  const q = parsed.data.q.trim()
  if (q.length < 2) {
    return reply.status(400).send({ error: 'Suchbegriff zu kurz (mindestens 2 Zeichen).' })
  }

  const ua =
    process.env.GEOCODING_USER_AGENT?.trim() ||
    'YolArkadasim/1.0 (dev; setze GEOCODING_USER_AGENT in .env laut OSM-Richtlinie)'

  try {
    const results = await searchNominatim(q, ua)
    return { results }
  } catch (err) {
    request.log.warn({ err }, 'geocode search failed')
    return reply.status(503).send({ error: 'Ortssuche vorübergehend nicht erreichbar.' })
  }
}

/**
 * Ortssuche (Nominatim). Per Plugin + Präfix registriert (zuverlässig neben anderen Fastify-Plugins).
 * Zusätzlich `/geocode/search` ohne `/api`, falls ein Proxy das Präfix entfernt.
 */
export async function registerGeocodeRoutes(app: FastifyInstance) {
  await app.register(
    async (instance) => {
      instance.get('/search', geocodeSearchHandler)
    },
    { prefix: '/api/geocode' },
  )
  await app.register(
    async (instance) => {
      instance.get('/search', geocodeSearchHandler)
    },
    { prefix: '/geocode' },
  )
}
