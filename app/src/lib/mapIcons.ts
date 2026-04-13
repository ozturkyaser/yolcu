/** Muss mit api/src/mapIcons.ts MAP_ICON_IDS übereinstimmen. */
export const MAP_MAP_ICON_OPTIONS = [
  { id: 'person', label: 'Person' },
  { id: 'directions_car', label: 'Auto' },
  { id: 'local_shipping', label: 'LKW' },
  { id: 'airport_shuttle', label: 'Bus' },
  { id: 'two_wheeler', label: 'Motorrad' },
  { id: 'rv_hookup', label: 'Wohnmobil' },
  { id: 'train', label: 'Zug' },
  { id: 'sailing', label: 'Schiff' },
  { id: 'pedal_bike', label: 'Fahrrad' },
  { id: 'hiking', label: 'Zu Fuß' },
  { id: 'family_restroom', label: 'Familie' },
  { id: 'pets', label: 'Tier' },
  { id: 'badge', label: 'Helfer' },
  { id: 'flag', label: 'Flagge' },
  { id: 'local_taxi', label: 'Taxi' },
  { id: 'warehouse', label: 'Lager / Terminals' },
] as const

export type MapMapIconId = (typeof MAP_MAP_ICON_OPTIONS)[number]['id']

export function normalizeMapIconId(id: string | null | undefined): MapMapIconId {
  if (id && MAP_MAP_ICON_OPTIONS.some((o) => o.id === id)) return id as MapMapIconId
  return 'person'
}
