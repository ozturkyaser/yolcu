import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pool } from './pool.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

/** RFC4122-kompatible UUID aus stabilem Seed (idempotent bei gleichem OSM-Key). */
function uuidFromSeed(seed: string): string {
  const hash = createHash('sha1').update('yol:tuerkei_csv_poi:v1:' + seed).digest()
  const b = Buffer.from(hash.subarray(0, 16))
  b[6] = (b[6]! & 0x0f) | 0x50
  b[8] = (b[8]! & 0x3f) | 0x80
  const h = b.toString('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`
}

function parseCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
      continue
    }
    if (!inQuotes && c === ',') {
      out.push(cur)
      cur = ''
      continue
    }
    cur += c
  }
  out.push(cur)
  return out
}

function clampStr(s: string, max: number): string {
  const t = s.trim()
  return t.length <= max ? t : t.slice(0, max)
}

type RouteCode = 'A_NORTH' | 'B_WEST' | 'C_SOUTH' | 'COMMON'

function mapPoiType(raw: string): 'accommodation' | 'restaurant' | 'rest_area' | 'workshop' | null {
  switch (raw.trim().toLowerCase()) {
    case 'restaurant':
      return 'restaurant'
    case 'hotel':
      return 'accommodation'
    case 'gas_station':
      return 'rest_area'
    case 'workshop':
      return 'workshop'
    default:
      return null
  }
}

function parseRouteCode(raw: string): RouteCode | null {
  const u = raw.trim().toUpperCase()
  if (u === 'A_NORTH' || u === 'B_WEST' || u === 'C_SOUTH' || u === 'COMMON') return u as RouteCode
  return null
}

/**
 * Liest `api/data/tuerkei_pois_demo.csv` und upsert in `curated_places`.
 * Deterministische IDs aus OSM-ID → bei API-Neustart idempotent.
 */
export async function seedTurkeyRouteCsvCuratedPlaces(): Promise<void> {
  const t = await pool.query<{ ok: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'curated_places'
     ) AS ok`,
  )
  if (!t.rows[0]?.ok) return

  /** Dev: `src/../data`; Docker: `dist/../data` → `/app/data` (siehe Dockerfile `COPY data`). */
  const csvPath = join(__dirname, '..', 'data', 'tuerkei_pois_demo.csv')
  if (!existsSync(csvPath)) return

  const raw = readFileSync(csvPath, 'utf8')
  const lines = raw.split(/\r?\n/).filter((l) => l.length > 0)
  if (lines.length < 2) return

  const header = parseCsvLine(lines[0]!)
  const idx = (name: string) => header.indexOf(name)
  const ir = idx('route_code')
  const icc = idx('country_code')
  const icity = idx('city')
  const iname = idx('poi_name')
  const itype = idx('poi_type')
  const ilat = idx('latitude')
  const ilng = idx('longitude')
  const iphone = idx('phone')
  const iweb = idx('website')
  const iaddr = idx('address')
  const ioh = idx('opening_hours')
  const iosm = idx('osm_id')
  const isrc = idx('source')
  const ikm = idx('km_from_start')
  const inotes = idx('notes')
  if (
    [ir, icc, icity, iname, itype, ilat, ilng, iphone, iweb, iaddr, ioh, iosm, isrc, ikm, inotes].some(
      (i) => i < 0,
    )
  ) {
    return
  }

  for (let li = 1; li < lines.length; li++) {
    const cells = parseCsvLine(lines[li]!)
    if (cells.length < header.length) continue

    const routeCode = parseRouteCode(cells[ir] ?? '')
    if (!routeCode) continue

    const category = mapPoiType(cells[itype] ?? '')
    if (!category) continue

    const lat = Number.parseFloat((cells[ilat] ?? '').trim())
    const lng = Number.parseFloat((cells[ilng] ?? '').trim())
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      continue
    }

    const osmId = clampStr(cells[iosm] ?? '', 120)
    if (!osmId) continue

    const id = uuidFromSeed(osmId)
    const name = clampStr(cells[iname] ?? '', 200)
    if (!name) continue

    const city = clampStr(cells[icity] ?? '', 160)
    const cc = clampStr(cells[icc] ?? '', 8)
    const region = clampStr(`${city}${city && cc ? ', ' : ''}${cc}`, 160)

    const kmRaw = Number.parseInt((cells[ikm] ?? '').trim(), 10)
    const km = Number.isFinite(kmRaw) ? kmRaw : 0
    const sortOrder = Math.max(1, Math.min(320, 320 - Math.min(300, Math.floor(km / 8))))

    const parts: string[] = [
      `Demo-Import Route-Korridor (${cc}).`,
      city ? `Ort: ${city}.` : '',
      km ? `Referenz: ca. ${km} km entlang der Strecke (CSV).` : '',
      cells[isrc] ? `Quelle: ${clampStr(cells[isrc] ?? '', 40)}.` : '',
      `OpenStreetMap: ${osmId}.`,
      cells[iaddr] ? `Adresse: ${clampStr(cells[iaddr] ?? '', 500)}` : '',
      cells[ioh] ? `Öffnungszeiten: ${clampStr(cells[ioh] ?? '', 400)}` : '',
      cells[inotes] ? clampStr(cells[inotes] ?? '', 300) : '',
    ]
    const description = clampStr(parts.filter(Boolean).join(' '), 4000)

    const address = clampStr(cells[iaddr] ?? '', 400)
    const phone = clampStr(cells[iphone] ?? '', 80)
    const website = clampStr(cells[iweb] ?? '', 500)

    await pool.query(
      `INSERT INTO curated_places (
         id, category, name, description, lat, lng, address, region, phone, website, image_url,
         is_published, sort_order, route_code
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,true,$12,$13)
       ON CONFLICT (id) DO UPDATE SET
         category = EXCLUDED.category,
         name = EXCLUDED.name,
         description = EXCLUDED.description,
         lat = EXCLUDED.lat,
         lng = EXCLUDED.lng,
         address = EXCLUDED.address,
         region = EXCLUDED.region,
         phone = EXCLUDED.phone,
         website = EXCLUDED.website,
         image_url = EXCLUDED.image_url,
         is_published = EXCLUDED.is_published,
         sort_order = EXCLUDED.sort_order,
         route_code = EXCLUDED.route_code,
         updated_at = now()`,
      [
        id,
        category,
        name,
        description,
        lat,
        lng,
        address,
        region,
        phone,
        website,
        '',
        sortOrder,
        routeCode,
      ],
    )
  }
}
