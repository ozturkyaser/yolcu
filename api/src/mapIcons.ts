import { z } from 'zod'

/** Erlaubte Material-Symbol-Namen für die Karte (Whitelist). */
export const MAP_ICON_IDS = [
  'person',
  'directions_car',
  'local_shipping',
  'airport_shuttle',
  'two_wheeler',
  'rv_hookup',
  'train',
  'sailing',
  'pedal_bike',
  'hiking',
  'family_restroom',
  'pets',
  'badge',
  'flag',
  'local_taxi',
  'warehouse',
] as const

export type MapIconId = (typeof MAP_ICON_IDS)[number]

export function isMapIconId(s: string): s is MapIconId {
  return (MAP_ICON_IDS as readonly string[]).includes(s)
}

export const mapIconSchema = z.string().refine(isMapIconId, { message: 'Ungültiges Karten-Icon' })
