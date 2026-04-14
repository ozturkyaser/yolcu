/** API erlaubt max. 25k Koordinaten; OSRM kann deutlich mehr liefern — vor POST verdichten. */
export const ROUTE_GEOMETRY_API_MAX_COORDS = 24_000

export type LineStringGeometry = { type: 'LineString'; coordinates: [number, number][] }

export function downsampleLineStringForApi(geometry: LineStringGeometry, maxPoints = ROUTE_GEOMETRY_API_MAX_COORDS): LineStringGeometry {
  const c = geometry.coordinates
  if (c.length <= maxPoints) return geometry
  const last = c.length - 1
  const out: [number, number][] = []
  for (let i = 0; i < maxPoints; i++) {
    const idx = Math.round((i * last) / (maxPoints - 1))
    const p = c[idx]!
    out.push([p[0], p[1]])
  }
  const dedup: [number, number][] = []
  for (const p of out) {
    const q = dedup[dedup.length - 1]
    if (!q || q[0] !== p[0] || q[1] !== p[1]) dedup.push(p)
  }
  if (dedup.length < 2) return { type: 'LineString', coordinates: [c[0]!, c[last]!] }
  return { type: 'LineString', coordinates: dedup }
}
