import type { DrivingRouteStepDto } from './api'

/** Ab dieser Entfernung zur Linie: Hinweis „von Route weg“ */
export const NAV_OFF_ROUTE_WARN_M = 72
/** Ab hier: deutlicher Reroute-Hinweis */
export const NAV_OFF_ROUTE_SEVERE_M = 125

/** Entfernung zweier Punkte in Metern (WGS84). */
export function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
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

/** Nächstliegender Punkt auf der Polylinie: Weglänge vom Start (m) + Abstand GPS–Linie (m). */
export function closestAlongPolyline(
  coords: [number, number][],
  lng: number,
  lat: number,
): { alongM: number; distToRouteM: number } {
  if (coords.length < 2) return { alongM: 0, distToRouteM: 0 }
  let bestDist = Infinity
  let alongBest = 0
  let acc = 0
  for (let i = 0; i < coords.length - 1; i++) {
    const [lng0, lat0] = coords[i]
    const [lng1, lat1] = coords[i + 1]
    const segM = haversineM(lat0, lng0, lat1, lng1)
    const midLat = (lat0 + lat1) / 2
    const cos = Math.cos((midLat * Math.PI) / 180)
    const x0 = lng0 * cos
    const x1 = lng1 * cos
    const xp = lng * cos
    const abx = x1 - x0
    const aby = lat1 - lat0
    const apx = xp - x0
    const apy = lat - lat0
    const ab2 = abx * abx + aby * aby
    let t = ab2 > 1e-18 ? (apx * abx + apy * aby) / ab2 : 0
    t = Math.max(0, Math.min(1, t))
    const latI = lat0 + t * (lat1 - lat0)
    const lngI = lng0 + t * (lng1 - lng0)
    const d = haversineM(lat, lng, latI, lngI)
    if (d < bestDist) {
      bestDist = d
      alongBest = acc + t * segM
    }
    acc += segM
  }
  return { alongM: alongBest, distToRouteM: bestDist }
}

export function totalPolylineLengthM(coords: [number, number][]): number {
  let s = 0
  for (let i = 0; i < coords.length - 1; i++) {
    const [lng0, lat0] = coords[i]
    const [lng1, lat1] = coords[i + 1]
    s += haversineM(lat0, lng0, lat1, lng1)
  }
  return s
}

/** Punkt auf der Linie `alongM` Meter vom Start. */
export function pointAtAlongM(coords: [number, number][], alongM: number): { lng: number; lat: number } {
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

/**
 * Für Kamera/Bearing: nahe der Route auf die Linie projizieren (weniger Zittern).
 * `alongM` bleibt konsistent mit dem Projektionspunkt.
 */
export function snapPositionForNavigation(
  coords: [number, number][],
  lng: number,
  lat: number,
  maxSnapM: number,
): { useLng: number; useLat: number; alongM: number; distToRouteM: number; didSnap: boolean } {
  const { alongM, distToRouteM } = closestAlongPolyline(coords, lng, lat)
  if (distToRouteM > maxSnapM) {
    return { useLng: lng, useLat: lat, alongM, distToRouteM, didSnap: false }
  }
  const p = pointAtAlongM(coords, alongM)
  return { useLng: p.lng, useLat: p.lat, alongM, distToRouteM, didSnap: true }
}

export function pointAheadOnRoute(
  coords: [number, number][],
  lng: number,
  lat: number,
  aheadM: number,
): { lng: number; lat: number } {
  const { alongM } = closestAlongPolyline(coords, lng, lat)
  const total = totalPolylineLengthM(coords)
  return pointAtAlongM(coords, Math.min(total, alongM + aheadM))
}

/** Kurs in Grad (0 = Norden). */
export function bearingDeg(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const φ1 = (lat1 * Math.PI) / 180
  const φ2 = (lat2 * Math.PI) / 180
  const Δλ = ((lng2 - lng1) * Math.PI) / 180
  const y = Math.sin(Δλ) * Math.cos(φ2)
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ)
  const θ = Math.atan2(y, x)
  return ((θ * 180) / Math.PI + 360) % 360
}

/** Exponentieller Tiefpass für Kompass (vermeidet Ruckeln). */
export function smoothBearingDeg(prev: number | null, target: number, alpha: number): number {
  if (prev == null || !Number.isFinite(prev)) return target
  const delta = ((target - prev + 540) % 360) - 180
  let next = prev + alpha * delta
  next = ((next % 360) + 360) % 360
  return next
}

/** Kumulierte OSRM-Schrittlängen: boundaries[i] = Start von Schritt i, boundaries[^1] = Gesamtlänge laut Steps. */
export function buildStepBoundariesM(steps: DrivingRouteStepDto[]): number[] {
  const b: number[] = [0]
  let s = 0
  for (const st of steps) {
    s += st.distanceM
    b.push(s)
  }
  return b
}

/** Index der aktuellen OSRM-Zeile (gröbste Zuordnung entlang Summe der Schritte). */
export function stepIndexForDistanceAlong(steps: DrivingRouteStepDto[], alongM: number): number {
  if (steps.length === 0) return 0
  const b = buildStepBoundariesM(steps)
  let i = 0
  while (i < steps.length - 1 && alongM >= b[i + 1] - 1e-3) i++
  return i
}

export type ManeuverDisplay = {
  primaryIndex: number
  /** Bis zum Ende des aktuellen Schritts (für „in 240 m“) */
  metersUntilStepEnd: number
  secondaryText: string | null
  /** 0–1 entlang Polylinie (für Fortschrittsbalken) */
  routeProgress: number
}

/**
 * Sinnvolle Hauptanzeige: „Lossfahren“ früh durch nächstes Manöver ergänzen;
 * Entfernung bezieht sich auf Ende des aktuellen OSRM-Segments.
 */
export function maneuverDisplay(
  steps: DrivingRouteStepDto[],
  alongPolylineM: number,
  totalPolylineM: number,
): ManeuverDisplay {
  if (steps.length === 0) {
    return {
      primaryIndex: 0,
      metersUntilStepEnd: 0,
      secondaryText: null,
      routeProgress: totalPolylineM > 0 ? Math.min(1, alongPolylineM / totalPolylineM) : 0,
    }
  }
  const b = buildStepBoundariesM(steps)
  let i = 0
  while (i < steps.length - 1 && alongPolylineM >= b[i + 1] - 1e-3) i++

  let primary = i
  const first = steps[0]
  const isDepart =
    /lossfahren/i.test(first.text) || /start/i.test(first.text) || /depart/i.test(first.text)
  if (primary === 0 && isDepart && steps.length > 1 && alongPolylineM > first.distanceM * 0.55) {
    primary = 1
  }

  const stepEnd = b[primary + 1] ?? b[b.length - 1]
  const metersUntilStepEnd = Math.max(0, stepEnd - alongPolylineM)
  const next = steps[primary + 1]

  const routeProgress =
    totalPolylineM > 1e-3 ? Math.max(0, Math.min(1, alongPolylineM / totalPolylineM)) : 0

  return {
    primaryIndex: primary,
    metersUntilStepEnd,
    secondaryText: next?.text ?? null,
    routeProgress,
  }
}
