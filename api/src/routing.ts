type OsrmManeuver = { type: string; modifier?: string }
type OsrmStep = {
  distance: number
  duration: number
  name: string
  maneuver: OsrmManeuver
}

export type RouteStepDto = { text: string; distanceM: number; durationS: number }

export type DrivingRouteResult = {
  distanceM: number
  durationS: number
  geometry: { type: 'LineString'; coordinates: [number, number][] }
  steps: RouteStepDto[]
}

function formatStepGerman(step: OsrmStep): string {
  const maneuver = step.maneuver ?? { type: 'continue' }
  const { type, modifier } = maneuver
  const road = step.name?.trim() ? ` – ${step.name}` : ''

  if (type === 'depart') return `Lossfahren${road}`
  if (type === 'arrive') return `Ziel erreichen${road}`

  const modMap: Record<string, string> = {
    uturn: 'Wenden',
    'sharp right': 'Scharf rechts abbiegen',
    right: 'Rechts abbiegen',
    'slight right': 'Leicht rechts halten',
    straight: 'Geradeaus',
    'slight left': 'Leicht links halten',
    left: 'Links abbiegen',
    'sharp left': 'Scharf links abbiegen',
  }

  if (type === 'turn' && modifier) {
    return `${modMap[modifier] ?? 'Abbiegen'}${road}`
  }
  if (type === 'new name' && step.name?.trim()) return `Weiter auf ${step.name}`
  if (type === 'merge') return `Einordnen${road}`
  if (type === 'on ramp') return `Auffahrt${road}`
  if (type === 'off ramp') return `Ausfahrt${road}`
  if (type === 'fork') return `Richtung wählen${road}`
  if (type === 'end of road') return `Am Ende der Straße abbiegen${road}`
  if (type === 'continue') return `Geradeaus${road}`
  if (type === 'roundabout' || type === 'rotary') return `In den Kreisverkehr${road}`
  if (type === 'exit roundabout' || type === 'exit rotary') return `Kreisverkehr verlassen${road}`

  if (step.name?.trim()) return `Weiter: ${step.name}`
  return `Weiterfahren${road}`
}

type OsrmFail = { error: string; status: number }

export async function fetchDrivingRouteOsrm(
  baseUrl: string,
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number,
): Promise<DrivingRouteResult | OsrmFail> {
  const base = baseUrl.replace(/\/$/, '')
  const coordPath = `${fromLng},${fromLat};${toLng},${toLat}`
  const url = `${base}/route/v1/driving/${coordPath}?overview=full&geometries=geojson&steps=true`

  let res: Response
  try {
    res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(25_000),
    })
  } catch {
    return { error: 'Routing-Dienst nicht erreichbar (Netzwerk/Timeout).', status: 502 }
  }

  if (!res.ok) {
    return { error: 'Routing-Server hat geantwortet, aber ohne gültige Route.', status: 502 }
  }

  const data = (await res.json()) as {
    code: string
    message?: string
    routes?: Array<{
      distance: number
      duration: number
      geometry: { type: string; coordinates: [number, number][] }
      legs: Array<{ steps: OsrmStep[] }>
    }>
  }

  if (data.code !== 'Ok' || !data.routes?.[0]) {
    const msg =
      data.code === 'NoRoute'
        ? 'Keine Straßenroute gefunden (Punkte zu weit von der Straße oder nicht verbindbar).'
        : data.message ?? 'Keine Route berechenbar.'
    return { error: msg, status: 404 }
  }

  const r = data.routes[0]
  const coords = r.geometry?.coordinates
  if (!Array.isArray(coords) || coords.length === 0) {
    return { error: 'Routing-Antwort ohne gültige Geometrie.', status: 502 }
  }

  const legs = Array.isArray(r.legs) ? r.legs : []
  const steps: RouteStepDto[] = legs.flatMap((leg) => {
    const rawSteps = Array.isArray(leg?.steps) ? leg.steps : []
    return rawSteps.map((s) => ({
      text: formatStepGerman(s),
      distanceM: typeof s.distance === 'number' ? s.distance : 0,
      durationS: typeof s.duration === 'number' ? s.duration : 0,
    }))
  })

  return {
    distanceM: typeof r.distance === 'number' ? r.distance : 0,
    durationS: typeof r.duration === 'number' ? r.duration : 0,
    geometry: { type: 'LineString', coordinates: coords as [number, number][] },
    steps,
  }
}
