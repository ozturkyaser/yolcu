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

export class NominatimRequestError extends Error {
  readonly httpStatus: number

  constructor(message: string, httpStatus: number) {
    super(message)
    this.name = 'NominatimRequestError'
    this.httpStatus = httpStatus
  }
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
    signal: AbortSignal.timeout(22_000),
  })

  if (!res.ok) {
    throw new NominatimRequestError(`Nominatim HTTP ${res.status}`, res.status)
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

/** ISO-3166-1 alpha-2, z. B. `DE` – für Routen-Länder (Nominatim Reverse, 1 RPS beachten). */
export async function reverseNominatimCountryCode(
  lat: number,
  lng: number,
  userAgent: string,
): Promise<string | null> {
  const url = new URL('https://nominatim.openstreetmap.org/reverse')
  url.searchParams.set('format', 'jsonv2')
  url.searchParams.set('lat', String(lat))
  url.searchParams.set('lon', String(lng))
  url.searchParams.set('zoom', '3')
  url.searchParams.set('addressdetails', '1')

  const res = await fetch(url.toString(), {
    headers: {
      'User-Agent': userAgent,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(18_000),
  })

  if (!res.ok) return null
  const data = (await res.json()) as { address?: { country_code?: string } }
  const raw = data.address?.country_code
  if (typeof raw !== 'string' || raw.length < 2) return null
  return raw.toUpperCase().slice(0, 2)
}

/**
 * Fallback für Routen-Länder, wenn Nominatim blockiert/leer ist (z. B. fehlender `GEOCODING_USER_AGENT`).
 * BigDataCloud „Client Reverse Geocoding“ (Redirect nach api-bdc.io), ohne API-Key.
 */
export async function reverseBigDataCloudCountryCode(lat: number, lng: number): Promise<string | null> {
  const url = new URL('https://api.bigdatacloud.net/data/reverse-geocode-client')
  url.searchParams.set('latitude', String(lat))
  url.searchParams.set('longitude', String(lng))
  url.searchParams.set('localityLanguage', 'en')

  const ua =
    process.env.GEOCODING_USER_AGENT?.trim() ||
    'YolArkadasim/1.0 (route toll country lookup; https://operations.osmfoundation.org/policies/nominatim/)'

  try {
    const res = await fetch(url.toString(), {
      headers: {
        Accept: 'application/json',
        'User-Agent': ua,
      },
      signal: AbortSignal.timeout(14_000),
      redirect: 'follow',
    })
    if (!res.ok) return null
    const data = (await res.json()) as { countryCode?: string }
    const raw = data.countryCode
    if (typeof raw !== 'string' || raw.length < 2) return null
    const cc = raw.toUpperCase().slice(0, 2)
    return /^[A-Z]{2}$/.test(cc) ? cc : null
  } catch {
    return null
  }
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
    'YolArkadasim/1.0 (dev@yol.local; setze GEOCODING_USER_AGENT in .env laut https://operations.osmfoundation.org/policies/nominatim/)'

  try {
    const results = await searchNominatim(q, ua)
    return { results }
  } catch (err) {
    request.log.warn({ err }, 'geocode search failed')
    const status =
      err instanceof NominatimRequestError
        ? err.httpStatus
        : err instanceof Error &&
            (err.name === 'TimeoutError' || err.name === 'AbortError' || /timeout/i.test(err.message))
          ? 408
          : undefined
    if (status === 403) {
      return reply.status(503).send({
        error:
          'Ortssuche abgelehnt (HTTP 403): In der API-Umgebung einen gültigen GEOCODING_USER_AGENT setzen – Kontakt-E-Mail oder Projekt-URL laut OSM-Nominatim-Richtlinie.',
      })
    }
    if (status === 429) {
      return reply.status(503).send({
        error: 'Ortssuche temporär überlastet (Rate-Limit). Bitte kurz warten und erneut versuchen.',
      })
    }
    if (status === 408) {
      return reply.status(503).send({
        error: 'Ortssuche-Zeitüberschreitung. Netzwerk prüfen und erneut versuchen.',
      })
    }
    return reply.status(503).send({
      error:
        'Ortssuche vorübergehend nicht erreichbar (Nominatim/OSM). Netzwerk, Firewall und GEOCODING_USER_AGENT prüfen.',
    })
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
