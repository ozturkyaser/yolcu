import { reverseNominatimCountryCode } from './geocoding.js'

export type TollVehicleClass = 'car' | 'motorcycle' | 'heavy' | 'other'

export type TollAdviceProduct = {
  id: string
  countryCode: string
  title: string
  description: string
  type: 'vignette' | 'toll' | 'info'
  /** Für welche Fahrzeugklassen relevant (leer = alle) */
  vehicleClasses: TollVehicleClass[]
  purchaseUrl: string
}

export type RouteCountryHit = {
  countryCode: string
  lat: number
  lng: number
}

const COUNTRY_NAMES: Record<string, string> = {
  DE: 'Deutschland',
  AT: 'Österreich',
  CH: 'Schweiz',
  FR: 'Frankreich',
  IT: 'Italien',
  SI: 'Slowenien',
  HR: 'Kroatien',
  HU: 'Ungarn',
  SK: 'Slowakei',
  CZ: 'Tschechien',
  PL: 'Polen',
  RO: 'Rumänien',
  BG: 'Bulgarien',
  RS: 'Serbien',
  BA: 'Bosnien und Herzegowina',
  ME: 'Montenegro',
  MK: 'Nordmazedonien',
  TR: 'Türkiye',
  NL: 'Niederlande',
  BE: 'Belgien',
  LU: 'Luxemburg',
}

/** Hinweise + offizielle/typische Kaufseiten (Informationsstand 2026; Preise dort prüfen). */
const PRODUCTS_BY_COUNTRY: Record<string, TollAdviceProduct[]> = {
  AT: [
    {
      id: 'at-vignette',
      countryCode: 'AT',
      title: 'Digitale Vignette / Streckenmaut (PKW)',
      description:
        'Für Pkw und Motorräder gilt auf Autobahnen und Schnellstraßen in der Regel eine digitale Vignette bzw. streckenbezogene Maut (Details auf der ASFINAG-Seite).',
      type: 'vignette',
      vehicleClasses: ['car', 'motorcycle', 'other'],
      purchaseUrl: 'https://www.asfinag.at/en/toll/vignette/',
    },
    {
      id: 'at-go',
      countryCode: 'AT',
      title: 'GO-Box (Lkw / schwer)',
      description: 'Für schwere Nutzfahrzeuge: GO-Box-Maut statt PKW-Vignette.',
      type: 'toll',
      vehicleClasses: ['heavy'],
      purchaseUrl: 'https://www.go-maut.at/',
    },
  ],
  HU: [
    {
      id: 'hu-ematrica',
      countryCode: 'HU',
      title: 'Ungarn: e-Matrica (Vignette)',
      description:
        'Digitale Vignette für ausgewählte Straßenklassen – Fahrzeugklasse beim Kauf wählen (Pkw / Motorrad / Nutzfahrzeug).',
      type: 'vignette',
      vehicleClasses: ['car', 'motorcycle', 'heavy', 'other'],
      purchaseUrl: 'https://nemzetiutdij.hu/',
    },
  ],
  SI: [
    {
      id: 'si-evinjeta',
      countryCode: 'SI',
      title: 'Slowenien: e-Vinjeta',
      description: 'Digitale Vignette für Autobahnen; Fahrzeugkategorie beim Kauf auswählen.',
      type: 'vignette',
      vehicleClasses: ['car', 'motorcycle', 'heavy', 'other'],
      purchaseUrl: 'https://evinjeta.dars.si/',
    },
  ],
  SK: [
    {
      id: 'sk-eznamka',
      countryCode: 'SK',
      title: 'Slowakei: elektronische Vignette (eznamka)',
      description: 'E-Vignette je nach Fahrzeugklasse wählen.',
      type: 'vignette',
      vehicleClasses: ['car', 'motorcycle', 'heavy', 'other'],
      purchaseUrl: 'https://eznamka.sk/selfcare/',
    },
  ],
  CZ: [
    {
      id: 'cz-edalnice',
      countryCode: 'CZ',
      title: 'Tschechien: elektronische Vignette',
      description: 'E-Vignette für markierte Strecken; Fahrzeugtyp beim Kauf angeben.',
      type: 'vignette',
      vehicleClasses: ['car', 'motorcycle', 'heavy', 'other'],
      purchaseUrl: 'https://edalnice.cz/',
    },
  ],
  CH: [
    {
      id: 'ch-vignette',
      countryCode: 'CH',
      title: 'Schweiz: Autobahnvignette (Pickette)',
      description: 'Pflicht-Vignette für die Benutzung des Nationalstrassennetzes (Pkw/Anhänger; Motorrad ausgenommen).',
      type: 'vignette',
      vehicleClasses: ['car', 'heavy', 'other'],
      purchaseUrl: 'https://www.postshop.ch/de/p/autobahnvignette',
    },
    {
      id: 'ch-mc',
      countryCode: 'CH',
      title: 'Schweiz: Motorrad',
      description: 'Motorräder benötigen keine Autobahnvignette – trotzdem Maut-/Sonderregeln auf Passstraßen beachten.',
      type: 'info',
      vehicleClasses: ['motorcycle'],
      purchaseUrl: 'https://www.astra.admin.ch/astra/de/home/strassen/nationalstrassen/maut-vignette.html',
    },
  ],
  BG: [
    {
      id: 'bg-bgtoll',
      countryCode: 'BG',
      title: 'Bulgarien: e-Vignette (BGTOLL)',
      description: 'Digitale Vignette für bestimmte Straßenabschnitte.',
      type: 'vignette',
      vehicleClasses: ['car', 'motorcycle', 'heavy', 'other'],
      purchaseUrl: 'https://web.bgtoll.bg/',
    },
  ],
  RO: [
    {
      id: 'ro-roviniete',
      countryCode: 'RO',
      title: 'Rumänien: Rovinietă',
      description: 'Elektronische Strecken-/Netzmaut je nach Fahrzeugklasse.',
      type: 'vignette',
      vehicleClasses: ['car', 'motorcycle', 'heavy', 'other'],
      purchaseUrl: 'https://www.e-rovinieta.ro/',
    },
  ],
  RS: [
    {
      id: 'rs-evinjeta',
      countryCode: 'RS',
      title: 'Serbien: E-Vignette (Motorways)',
      description: 'Digitale Vignette für Autobahnen; Kategorie beim Kauf wählen.',
      type: 'vignette',
      vehicleClasses: ['car', 'motorcycle', 'heavy', 'other'],
      purchaseUrl: 'https://www.evinjeta.rs/en',
    },
  ],
  HR: [
    {
      id: 'hr-toll',
      countryCode: 'HR',
      title: 'Kroatien: Autobahnen',
      description: 'Kroatien nutzt überwiegend Mautstellen auf Autobahnen (keine klassische Jahresvignette wie in AT/HU).',
      type: 'toll',
      vehicleClasses: ['car', 'motorcycle', 'heavy', 'other'],
      purchaseUrl: 'https://hac.hr/en',
    },
  ],
  DE: [
    {
      id: 'de-info',
      countryCode: 'DE',
      title: 'Deutschland: keine Pkw-Vignette',
      description:
        'Für Pkw/Motorrad keine Vignette; Lkw-Maut (Toll Collect / Toll Pass) nur für gewerbliche Nutzfahrzeuge relevant.',
      type: 'info',
      vehicleClasses: ['car', 'motorcycle', 'other'],
      purchaseUrl: 'https://www.bmvi.de/DE/Themen/MobilitVerkehr/Straßenverkehr/Maut/maut_node.html',
    },
    {
      id: 'de-lkw',
      countryCode: 'DE',
      title: 'Deutschland: Lkw-Maut',
      type: 'toll',
      description: 'Schwere Nutzfahrzeuge: Mautsystem beachten.',
      vehicleClasses: ['heavy'],
      purchaseUrl: 'https://www.toll-collect.de/',
    },
  ],
  TR: [
    {
      id: 'tr-hgs',
      countryCode: 'TR',
      title: 'Türkiye: HGS / OGS (Maut)',
      description: 'Auf mautpflichtigen Brücken/Schnellstraßen HGS/OGS oder App-basierte Zahlung nutzen.',
      type: 'toll',
      vehicleClasses: ['car', 'motorcycle', 'heavy', 'other'],
      purchaseUrl: 'https://www.kgm.gov.tr/',
    },
  ],
  IT: [
    {
      id: 'it-autostrade',
      countryCode: 'IT',
      title: 'Italien: Autobahn (Péage)',
      description: 'Mautstellen auf Autobahnen; Telepass / Kartenzahlung je nach Anbieter.',
      type: 'toll',
      vehicleClasses: ['car', 'motorcycle', 'heavy', 'other'],
      purchaseUrl: 'https://www.autostrade.it/',
    },
  ],
  FR: [
    {
      id: 'fr-sanef',
      countryCode: 'FR',
      title: 'Frankreich: Autobahnen (Péage)',
      description: 'Gebührenpflichtige Abschnitte überwiegend an Mautstellen.',
      type: 'toll',
      vehicleClasses: ['car', 'motorcycle', 'heavy', 'other'],
      purchaseUrl: 'https://www.autoroutes.fr/',
    },
  ],
}

export function countryName(code: string): string {
  return COUNTRY_NAMES[code] ?? code
}

function totalLengthM(coords: [number, number][]): number {
  let s = 0
  for (let i = 0; i < coords.length - 1; i++) {
    const [lng0, lat0] = coords[i]
    const [lng1, lat1] = coords[i + 1]
    s += haversineM(lat0, lng0, lat1, lng1)
  }
  return s
}

function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000
  const p1 = (lat1 * Math.PI) / 180
  const p2 = (lat2 * Math.PI) / 180
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(p1) * Math.cos(p2) * Math.sin(dLng / 2) * Math.sin(dLng / 2)
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function pointAtAlongM(coords: [number, number][], alongM: number): { lng: number; lat: number } {
  if (coords.length === 0) return { lng: 0, lat: 0 }
  if (coords.length === 1) {
    const [lng, lat] = coords[0]
    return { lng, lat }
  }
  let remaining = Math.max(0, alongM)
  for (let i = 0; i < coords.length - 1; i++) {
    const [lng0, lat0] = coords[i]
    const [lng1, lat1] = coords[i + 1]
    const segM = haversineM(lat0, lng0, lat1, lng1)
    if (remaining <= segM || i === coords.length - 2) {
      const t = segM > 1e-6 ? Math.min(1, remaining / segM) : 1
      return {
        lng: lng0 + t * (lng1 - lng0),
        lat: lat0 + t * (lat1 - lat0),
      }
    }
    remaining -= segM
  }
  const last = coords[coords.length - 1]
  return { lng: last[0], lat: last[1] }
}

/** Stützpunkte entlang der Linie (max. `maxPoints`, inkl. Start/Ziel wenn möglich). */
export function sampleRoutePoints(coords: [number, number][], maxPoints: number): { lng: number; lat: number }[] {
  if (coords.length === 0) return []
  if (coords.length === 1) {
    const [lng, lat] = coords[0]
    return [{ lng, lat }]
  }
  const total = totalLengthM(coords)
  const n = Math.min(maxPoints, Math.max(2, Math.ceil(total / 45_000) + 1))
  const out: { lng: number; lat: number }[] = []
  for (let i = 0; i < n; i++) {
    const along = n === 1 ? 0 : (total * i) / (n - 1)
    out.push(pointAtAlongM(coords, along))
  }
  return out
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

export async function collectCountriesAlongRoute(
  coords: [number, number][],
  userAgent: string,
  opts?: { maxReverseCalls?: number; delayMs?: number },
): Promise<RouteCountryHit[]> {
  const maxCalls = opts?.maxReverseCalls ?? 10
  const delayMs = opts?.delayMs ?? 1050
  const samples = sampleRoutePoints(coords, maxCalls)
  const seen = new Set<string>()
  const ordered: RouteCountryHit[] = []

  for (let i = 0; i < samples.length; i++) {
    const p = samples[i]!
    const code = await reverseNominatimCountryCode(p.lat, p.lng, userAgent)
    if (code && !seen.has(code)) {
      seen.add(code)
      ordered.push({ countryCode: code, lat: p.lat, lng: p.lng })
    }
    if (i < samples.length - 1) await sleep(delayMs)
  }
  return ordered
}

export function productsForCountries(countryCodes: string[], vehicleClass: TollVehicleClass): TollAdviceProduct[] {
  const out: TollAdviceProduct[] = []
  for (const cc of countryCodes) {
    const list = PRODUCTS_BY_COUNTRY[cc]
    if (!list) continue
    for (const p of list) {
      if (p.vehicleClasses.length > 0 && !p.vehicleClasses.includes(vehicleClass)) continue
      out.push(p)
    }
  }
  return out
}
