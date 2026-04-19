/**
 * Strategische Sıla-Route (Europa → Istanbul, Kapıkule).
 * Redaktioneller Backbone für Filter & Copy; POIs kommen aus `curated_places` + Admin.
 */

export type SilaRouteCode = 'A_NORTH' | 'B_WEST' | 'C_SOUTH' | 'COMMON'

export const SILA_ROUTE_CORRIDOR = 'berlin_turkey' as const

export const SILA_ROUTE_VARIANTS: {
  code: SilaRouteCode
  labelDe: string
  shortDe: string
  via: string
}[] = [
  {
    code: 'A_NORTH',
    labelDe: 'Route A · Nord (Hamburg/Berlin)',
    shortDe: 'Nord',
    via: 'CZ · SK · AT · HU → RS · BG → TR',
  },
  {
    code: 'B_WEST',
    labelDe: 'Route B · West (NRW/Frankfurt)',
    shortDe: 'West',
    via: 'A3 Passau · AT · HU → (ab Budapest wie Nord)',
  },
  {
    code: 'C_SOUTH',
    labelDe: 'Route C · Süd (München/Stuttgart)',
    shortDe: 'Süd',
    via: 'AT · SI · HR → RS (Batrovci) → BG → TR',
  },
  {
    code: 'COMMON',
    labelDe: 'Gemeinsamer Balkan-Kern',
    shortDe: 'Balkan',
    via: 'Ab Belgrad: Niš · Sofia · Kapıkule · Edirne',
  },
]

/** Schlüsselstopps (Koordinaten grob, für Orientierung & zukünftige Umkreissuche). */
export const SILA_STRATEGIC_WAYPOINTS: {
  id: string
  name: string
  country: string
  lat: number
  lng: number
  noteDe: string
}[] = [
  { id: 'vie', name: 'Wien', country: 'AT', lat: 48.2082, lng: 16.3738, noteDe: 'Großer Stopp, starke TR-Community (Favoriten).' },
  { id: 'bud', name: 'Budapest', country: 'HU', lat: 47.4979, lng: 19.0402, noteDe: 'Letzter EU-Großstadt-Stopp vor dem Balkan.' },
  { id: 'beg', name: 'Belgrad', country: 'RS', lat: 44.8176, lng: 20.4569, noteDe: 'Treffpunkt aller Varianten, Korridor X.' },
  { id: 'nis', name: 'Niš', country: 'RS', lat: 43.3209, lng: 21.8958, noteDe: 'Letzter großer RS-Stopp vor BG.' },
  { id: 'sof', name: 'Sofia', country: 'BG', lat: 42.6977, lng: 23.3219, noteDe: 'BG-Umfahrung / Tanken vor weiter Richtung TR.' },
  { id: 'edi', name: 'Edirne', country: 'TR', lat: 41.6771, lng: 26.5557, noteDe: 'Erster TR-Stopp nach Kapıkule.' },
]

export function silaRouteFilterLabel(code: SilaRouteCode | 'ALL'): string {
  if (code === 'ALL') return 'Alle Routen'
  const v = SILA_ROUTE_VARIANTS.find((x) => x.code === code)
  return v?.shortDe ?? code
}
