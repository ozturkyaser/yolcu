import type { DrivingRouteStepDto } from './api'
import type { RouteLineString } from '../components/MapLibreMap'

export type NavTarget = { lat: number; lng: number; label: string }

export type NavRecentSearch = NavTarget & { savedAt: number }

export type NavSessionState = {
  target: NavTarget | null
  routeGeometry: RouteLineString | null
  routeMeta: { distanceM: number; durationS: number } | null
  routeSteps: DrivingRouteStepDto[]
  manualRouteStart: { lat: number; lng: number } | null
  manualStartLabel: string | null
  panelOpen: boolean
}

const LS_NAV_SESSION = 'yol_nav_session_v1'
const LS_NAV_RECENTS = 'yol_nav_recent_destinations_v1'

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

function isValidTarget(v: unknown): v is NavTarget {
  if (!v || typeof v !== 'object') return false
  const t = v as Partial<NavTarget>
  return isFiniteNumber(t.lat) && isFiniteNumber(t.lng) && typeof t.label === 'string'
}

function isValidRouteGeometry(v: unknown): v is RouteLineString {
  if (!v || typeof v !== 'object') return false
  const g = v as { type?: unknown; coordinates?: unknown }
  if (g.type !== 'LineString' || !Array.isArray(g.coordinates)) return false
  return g.coordinates.every(
    (c) => Array.isArray(c) && c.length >= 2 && isFiniteNumber(c[0]) && isFiniteNumber(c[1]),
  )
}

export function readNavSession(): NavSessionState | null {
  try {
    const raw = localStorage.getItem(LS_NAV_SESSION)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<NavSessionState>
    return {
      target: isValidTarget(parsed.target) ? parsed.target : null,
      routeGeometry: isValidRouteGeometry(parsed.routeGeometry) ? parsed.routeGeometry : null,
      routeMeta:
        parsed.routeMeta &&
        isFiniteNumber(parsed.routeMeta.distanceM) &&
        isFiniteNumber(parsed.routeMeta.durationS)
          ? parsed.routeMeta
          : null,
      routeSteps: Array.isArray(parsed.routeSteps) ? parsed.routeSteps : [],
      manualRouteStart:
        parsed.manualRouteStart &&
        isFiniteNumber(parsed.manualRouteStart.lat) &&
        isFiniteNumber(parsed.manualRouteStart.lng)
          ? parsed.manualRouteStart
          : null,
      manualStartLabel: typeof parsed.manualStartLabel === 'string' ? parsed.manualStartLabel : null,
      panelOpen: Boolean(parsed.panelOpen),
    }
  } catch {
    return null
  }
}

export function writeNavSession(state: NavSessionState) {
  try {
    localStorage.setItem(LS_NAV_SESSION, JSON.stringify(state))
  } catch {
    /* ignore */
  }
}

export function clearNavSession() {
  try {
    localStorage.removeItem(LS_NAV_SESSION)
  } catch {
    /* ignore */
  }
}

export function hasActiveNavSession(): boolean {
  const session = readNavSession()
  return Boolean(session?.target || session?.routeGeometry?.coordinates?.length)
}

export function readNavRecents(): NavRecentSearch[] {
  try {
    const raw = localStorage.getItem(LS_NAV_RECENTS)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((v) => isValidTarget(v))
      .map((v) => {
        const target = v as NavTarget
        const savedAtRaw = (v as Record<string, unknown>).savedAt
        const savedAt = isFiniteNumber(savedAtRaw) ? savedAtRaw : Date.now()
        return { ...target, savedAt }
      })
      .slice(0, 8)
  } catch {
    return []
  }
}

export function saveRecentDestination(target: NavTarget) {
  try {
    const prev = readNavRecents()
    const key = `${target.label}_${target.lat.toFixed(5)}_${target.lng.toFixed(5)}`
    const next = [
      { ...target, savedAt: Date.now() },
      ...prev.filter((r) => `${r.label}_${r.lat.toFixed(5)}_${r.lng.toFixed(5)}` !== key),
    ].slice(0, 8)
    localStorage.setItem(LS_NAV_RECENTS, JSON.stringify(next))
  } catch {
    /* ignore */
  }
}
