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

const createListingSchema = z.object({
  offerKind: z.enum(['passenger', 'cargo', 'both']),
  routeFrom: z.string().min(1).max(200),
  routeTo: z.string().min(1).max(200),
  departureNote: z.string().max(500).optional().default(''),
  freeSeats: z.number().int().min(0).max(12).nullable().optional(),
  cargoSpaceNote: z.string().max(500).optional().default(''),
  details: z.string().min(1).max(2000),
})

function validateListingBusinessRules(
  data: z.infer<typeof createListingSchema>,
  reply: FastifyReply,
): boolean {
  const seats = data.freeSeats ?? null
  if (data.offerKind === 'passenger' || data.offerKind === 'both') {
    if (seats == null || seats < 1) {
      reply.status(400).send({ error: 'Bei Mitfahrt: mindestens einen freien Platz angeben (1–12).' })
      return false
    }
  }
  if (data.offerKind === 'cargo' || data.offerKind === 'both') {
    if (data.cargoSpaceNote.trim().length < 2) {
      reply
        .status(400)
        .send({ error: 'Bei Ware: kurz beschreiben (z. B. Kofferraum, Dachbox, max. Gewicht).' })
      return false
    }
  }
  return true
}

const patchListingSchema = z.object({
  status: z.enum(['open', 'closed']),
})

const createRequestSchema = z.object({
  requestKind: z.enum(['passenger', 'cargo']),
  message: z.string().max(800).optional().default(''),
})

const patchRequestSchema = z.object({
  status: z.enum(['withdrawn', 'accepted', 'declined']),
})

type ListingRow = {
  id: string
  user_id: string
  display_name: string
  offer_kind: string
  route_from: string
  route_to: string
  departure_note: string
  free_seats: number | null
  cargo_space_note: string
  details: string
  status: string
  created_at: Date
  pending_request_count?: number | string
}

function mapListing(row: ListingRow) {
  return {
    id: row.id,
    userId: row.user_id,
    authorName: row.display_name,
    offerKind: row.offer_kind,
    routeFrom: row.route_from,
    routeTo: row.route_to,
    departureNote: row.departure_note,
    freeSeats: row.free_seats,
    cargoSpaceNote: row.cargo_space_note,
    details: row.details,
    status: row.status,
    createdAt: row.created_at,
    pendingRequestCount:
      row.pending_request_count != null ? Number(row.pending_request_count) : undefined,
  }
}

export async function registerRideShareRoutes(app: FastifyInstance) {
  app.get('/api/ride-listings', async (request, reply) => {
    const q = z
      .object({
        mine: z.enum(['1']).optional(),
        offerKind: z.enum(['passenger', 'cargo', 'both']).optional(),
      })
      .safeParse(request.query)
    if (!q.success) return reply.status(400).send({ error: q.error.flatten() })

    const { mine, offerKind } = q.data

    if (mine === '1') {
      try {
        await request.jwtVerify()
      } catch {
        return reply.status(401).send({ error: 'Nicht angemeldet' })
      }
    }

    const uid = mine === '1' ? (request.user as { sub: string }).sub : null

    const r = await pool.query<ListingRow & { display_name: string }>(
      `SELECT l.id, l.user_id, u.display_name, l.offer_kind, l.route_from, l.route_to,
              l.departure_note, l.free_seats, l.cargo_space_note, l.details, l.status, l.created_at,
              (SELECT COUNT(*)::int FROM ride_requests r
               WHERE r.listing_id = l.id AND r.status = 'pending') AS pending_request_count
       FROM ride_listings l
       JOIN users u ON u.id = l.user_id
         WHERE ($1::uuid IS NULL OR l.user_id = $1)
         AND ($2::text IS NULL OR l.offer_kind = $2 OR l.offer_kind = 'both')
         AND ($1::uuid IS NOT NULL OR l.status = 'open')
       ORDER BY l.created_at DESC
       LIMIT 100`,
      [uid, offerKind ?? null],
    )

    return { listings: r.rows.map((row) => mapListing(row)) }
  })

  app.get('/api/ride-listings/:id', async (request, reply) => {
    const id = (request.params as { id: string }).id
    const r = await pool.query<ListingRow & { display_name: string }>(
      `SELECT l.id, l.user_id, u.display_name, l.offer_kind, l.route_from, l.route_to,
              l.departure_note, l.free_seats, l.cargo_space_note, l.details, l.status, l.created_at,
              (SELECT COUNT(*)::int FROM ride_requests r2
               WHERE r2.listing_id = l.id AND r2.status = 'pending') AS pending_request_count
       FROM ride_listings l
       JOIN users u ON u.id = l.user_id
       WHERE l.id = $1`,
      [id],
    )
    const row = r.rows[0]
    if (!row) return reply.status(404).send({ error: 'Angebot nicht gefunden' })
    return { listing: mapListing(row) }
  })

  app.post('/api/ride-listings', { preHandler: authenticate }, async (request, reply) => {
    const parsed = createListingSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() })
    if (!validateListingBusinessRules(parsed.data, reply)) return

    const d = parsed.data
    const ins = await pool.query(
      `INSERT INTO ride_listings (
         user_id, offer_kind, route_from, route_to, departure_note, free_seats, cargo_space_note, details
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [
        request.user.sub,
        d.offerKind,
        d.routeFrom.trim(),
        d.routeTo.trim(),
        d.departureNote.trim(),
        d.freeSeats ?? null,
        d.cargoSpaceNote.trim(),
        d.details.trim(),
      ],
    )
    const newId = ins.rows[0]?.id as string
    const full = await pool.query<ListingRow & { display_name: string }>(
      `SELECT l.id, l.user_id, u.display_name, l.offer_kind, l.route_from, l.route_to,
              l.departure_note, l.free_seats, l.cargo_space_note, l.details, l.status, l.created_at,
              0::int AS pending_request_count
       FROM ride_listings l
       JOIN users u ON u.id = l.user_id
       WHERE l.id = $1`,
      [newId],
    )
    return { listing: mapListing(full.rows[0]!) }
  })

  app.patch('/api/ride-listings/:id', { preHandler: authenticate }, async (request, reply) => {
    const id = (request.params as { id: string }).id
    const parsed = patchListingSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() })

    const own = await pool.query(`SELECT user_id FROM ride_listings WHERE id = $1`, [id])
    if (!own.rows[0]) return reply.status(404).send({ error: 'Angebot nicht gefunden' })
    if (own.rows[0].user_id !== request.user.sub) {
      return reply.status(403).send({ error: 'Nur der Anbieter kann das Angebot ändern.' })
    }

    await pool.query(`UPDATE ride_listings SET status = $1 WHERE id = $2`, [parsed.data.status, id])
    const full = await pool.query<ListingRow & { display_name: string }>(
      `SELECT l.id, l.user_id, u.display_name, l.offer_kind, l.route_from, l.route_to,
              l.departure_note, l.free_seats, l.cargo_space_note, l.details, l.status, l.created_at,
              (SELECT COUNT(*)::int FROM ride_requests r
               WHERE r.listing_id = l.id AND r.status = 'pending') AS pending_request_count
       FROM ride_listings l
       JOIN users u ON u.id = l.user_id
       WHERE l.id = $1`,
      [id],
    )
    return { listing: mapListing(full.rows[0]!) }
  })

  app.post('/api/ride-listings/:id/requests', { preHandler: authenticate }, async (request, reply) => {
    const listingId = (request.params as { id: string }).id
    const parsed = createRequestSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() })

    const lr = await pool.query<{ user_id: string; offer_kind: string; status: string }>(
      `SELECT user_id, offer_kind, status FROM ride_listings WHERE id = $1`,
      [listingId],
    )
    const listing = lr.rows[0]
    if (!listing) return reply.status(404).send({ error: 'Angebot nicht gefunden' })
    if (listing.status !== 'open') return reply.status(400).send({ error: 'Angebot ist geschlossen.' })
    if (listing.user_id === request.user.sub) {
      return reply.status(400).send({ error: 'Eigene Fahrt nicht anfragen.' })
    }

    const ok =
      (parsed.data.requestKind === 'passenger' &&
        (listing.offer_kind === 'passenger' || listing.offer_kind === 'both')) ||
      (parsed.data.requestKind === 'cargo' &&
        (listing.offer_kind === 'cargo' || listing.offer_kind === 'both'))
    if (!ok) {
      return reply.status(400).send({ error: 'Diese Art der Anfrage passt nicht zum Angebot.' })
    }

    try {
      const ins = await pool.query(
        `INSERT INTO ride_requests (listing_id, requester_id, request_kind, message)
         VALUES ($1, $2, $3, $4)
         RETURNING id, listing_id, requester_id, request_kind, message, status, created_at`,
        [listingId, request.user.sub, parsed.data.requestKind, parsed.data.message.trim()],
      )
      const row = ins.rows[0]
      const u = await pool.query(`SELECT display_name FROM users WHERE id = $1`, [request.user.sub])
      return {
        request: {
          id: row.id,
          listingId: row.listing_id,
          requesterId: row.requester_id,
          requesterName: u.rows[0]?.display_name ?? 'Nutzer',
          requestKind: row.request_kind,
          message: row.message,
          status: row.status,
          createdAt: row.created_at,
        },
      }
    } catch (e) {
      const err = e as { code?: string }
      if (err.code === '23505') {
        return reply.status(409).send({ error: 'Du hast bereits eine offene Anfrage zu diesem Angebot.' })
      }
      throw e
    }
  })

  app.get('/api/ride-listings/:id/requests', { preHandler: authenticate }, async (request, reply) => {
    const listingId = (request.params as { id: string }).id
    const own = await pool.query(`SELECT user_id FROM ride_listings WHERE id = $1`, [listingId])
    if (!own.rows[0]) return reply.status(404).send({ error: 'Angebot nicht gefunden' })
    if (own.rows[0].user_id !== request.user.sub) {
      return reply.status(403).send({ error: 'Nur der Anbieter sieht die Anfragen.' })
    }

    const r = await pool.query(
      `SELECT r.id, r.requester_id, u.display_name AS requester_name, r.request_kind, r.message, r.status, r.created_at
       FROM ride_requests r
       JOIN users u ON u.id = r.requester_id
       WHERE r.listing_id = $1
       ORDER BY r.created_at DESC`,
      [listingId],
    )
    return {
      requests: r.rows.map((row) => ({
        id: row.id,
        requesterId: row.requester_id,
        requesterName: row.requester_name,
        requestKind: row.request_kind,
        message: row.message,
        status: row.status,
        createdAt: row.created_at,
      })),
    }
  })

  app.patch('/api/ride-requests/:id', { preHandler: authenticate }, async (request, reply) => {
    const requestId = (request.params as { id: string }).id
    const parsed = patchRequestSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() })

    const r = await pool.query<{
      id: string
      listing_id: string
      requester_id: string
      status: string
      listing_owner: string
    }>(
      `SELECT r.id, r.listing_id, r.requester_id, r.status, l.user_id AS listing_owner
       FROM ride_requests r
       JOIN ride_listings l ON l.id = r.listing_id
       WHERE r.id = $1`,
      [requestId],
    )
    const row = r.rows[0]
    if (!row) return reply.status(404).send({ error: 'Anfrage nicht gefunden' })
    if (row.status !== 'pending') {
      return reply.status(400).send({ error: 'Anfrage ist bereits bearbeitet.' })
    }

    const next = parsed.data.status
    if (next === 'withdrawn') {
      if (row.requester_id !== request.user.sub) {
        return reply.status(403).send({ error: 'Nur die anfragende Person kann zurückziehen.' })
      }
    } else {
      if (row.listing_owner !== request.user.sub) {
        return reply.status(403).send({ error: 'Nur der Anbieter kann annehmen oder ablehnen.' })
      }
    }

    await pool.query(`UPDATE ride_requests SET status = $1 WHERE id = $2`, [next, requestId])
    return { ok: true, status: next }
  })
}
