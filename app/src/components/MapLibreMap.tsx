import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { CuratedPlaceDto, MapPoiDto } from '../lib/api'
import { normalizeMapIconId } from '../lib/mapIcons'

/** OpenFreeMap Vector-Style (OSM-Daten, kein API-Key). Später: eigener Tileserver. */
const STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty'

/** Mittelpunkt EU–Balkan–TR-Korridor für erste Ansicht */
export const MAP_INITIAL_CENTER: [number, number] = [19.5, 46.2]
export const MAP_INITIAL_ZOOM = 4.2

export type MapParticipantMarker = {
  userId: string
  displayName: string
  /** Material-Symbol-Name (server-whitelist) */
  mapIcon?: string
  lat: number
  lng: number
  /** Gleiche Gruppe + in Funk-Nähe (z. B. unter 15 km) – nur wenn Filter „Gruppe“ aktiv. */
  inGroupRange?: boolean
}

/** GeoJSON LineString, Koordinaten [lng, lat] (OSRM / MapLibre). */
export type RouteLineString = {
  type: 'LineString'
  coordinates: [number, number][]
}

const ROUTE_SOURCE_ID = 'yol-nav-route'
const ROUTE_LAYER_ID = 'yol-nav-route-line'

type MapLibreMapProps = {
  className?: string
  pois?: MapPoiDto[]
  /** Andere Nutzer, die ihre Position teilen (Live). */
  participants?: MapParticipantMarker[]
  /** Aktueller Nutzer – Marker mit anderem Stil. */
  selfUserId?: string | null
  /** Zoom +/- und Kompass (Navigation). */
  showNavigationControls?: boolean
  /** Berechnete Fahrtroute (Straßennetz). */
  routeGeometry?: RouteLineString | null
  /** Navigationsziel (Pin auf der Karte). */
  highlightDestination?: { lat: number; lng: number } | null
  /** Manueller Routenstart (Pin, z. B. wenn kein GPS). */
  highlightStart?: { lat: number; lng: number } | null
  /** Klick auf die Karte setzt Start (‚from‘) oder Ziel (‚to‘). */
  mapPickTarget?: 'from' | 'to' | null
  onPickMapPoint?: (target: 'from' | 'to', pos: { lat: number; lng: number }) => void
  /** Klick auf einen POI-Marker (stoppt Kartenklick). */
  onPoiMarkerClick?: (poi: MapPoiDto) => void
  /** Admin-redaktionelle Tipps (Unterkunft, Restaurant, Rasthof). */
  curatedPlaces?: CuratedPlaceDto[]
  onCuratedPlaceClick?: (place: CuratedPlaceDto) => void
  /** Klick auf einen Teilnehmer-Marker. */
  onParticipantMarkerClick?: (p: MapParticipantMarker) => void
  onMoveEnd?: (center: { lat: number; lng: number }) => void
  onMapReady?: (map: maplibregl.Map) => void
  /** Nutzer bewegt/zoomt die Karte manuell → Navigation kann pausieren. */
  onUserDirectMapInteraction?: () => void
}

function curatedPinStyle(category: string): { bg: string; icon: string } {
  switch (category) {
    case 'accommodation':
      return { bg: '#6a1b9a', icon: 'hotel' }
    case 'restaurant':
      return { bg: '#e65100', icon: 'restaurant' }
    case 'rest_area':
      return { bg: '#2e7d32', icon: 'local_gas_station' }
    default:
      return { bg: '#546e7a', icon: 'place' }
  }
}

function categoryColor(cat: string): string {
  switch (cat) {
    case 'parking':
      return '#6750a4'
    case 'border':
      return '#b3261e'
    case 'fuel':
      return '#7d5260'
    case 'rest':
      return '#386a20'
    case 'hotel':
      return '#1565c0'
    case 'restaurant':
      return '#e65100'
    case 'mosque':
      return '#006a6b'
    case 'help':
      return '#ba1a1a'
    default:
      return '#625b71'
  }
}

export function MapLibreMap({
  className,
  pois = [],
  curatedPlaces = [],
  participants = [],
  selfUserId,
  showNavigationControls = true,
  routeGeometry = null,
  highlightDestination = null,
  highlightStart = null,
  mapPickTarget = null,
  onPickMapPoint,
  onPoiMarkerClick,
  onCuratedPlaceClick,
  onParticipantMarkerClick,
  onMoveEnd,
  onMapReady,
  onUserDirectMapInteraction,
}: MapLibreMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const poiMarkersRef = useRef<maplibregl.Marker[]>([])
  const curatedMarkersRef = useRef<maplibregl.Marker[]>([])
  const participantMarkersRef = useRef<maplibregl.Marker[]>([])
  const destMarkerRef = useRef<maplibregl.Marker | null>(null)
  const startMarkerRef = useRef<maplibregl.Marker | null>(null)
  const onMapReadyRef = useRef(onMapReady)
  const onPickMapPointRef = useRef(onPickMapPoint)
  const mapPickTargetRef = useRef(mapPickTarget)
  const onPoiMarkerClickRef = useRef(onPoiMarkerClick)
  const onCuratedPlaceClickRef = useRef(onCuratedPlaceClick)
  const onParticipantMarkerClickRef = useRef(onParticipantMarkerClick)
  const routeGeometryRef = useRef(routeGeometry)
  const onUserDirectMapInteractionRef = useRef(onUserDirectMapInteraction)
  onMapReadyRef.current = onMapReady
  onUserDirectMapInteractionRef.current = onUserDirectMapInteraction
  onPickMapPointRef.current = onPickMapPoint
  mapPickTargetRef.current = mapPickTarget
  onPoiMarkerClickRef.current = onPoiMarkerClick
  onCuratedPlaceClickRef.current = onCuratedPlaceClick
  onParticipantMarkerClickRef.current = onParticipantMarkerClick
  routeGeometryRef.current = routeGeometry

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const map = new maplibregl.Map({
      container: el,
      style: STYLE_URL,
      center: MAP_INITIAL_CENTER,
      zoom: MAP_INITIAL_ZOOM,
      attributionControl: { compact: true },
    })

    mapRef.current = map

    const emitCenter = () => {
      const c = map.getCenter()
      onMoveEnd?.({ lat: c.lat, lng: c.lng })
    }

    map.on('moveend', emitCenter)

    let navControl: maplibregl.NavigationControl | null = null
    map.once('load', () => {
      if (showNavigationControls) {
        navControl = new maplibregl.NavigationControl({ visualizePitch: true })
        map.addControl(navControl, 'top-left')
      }
      const userPan = () => onUserDirectMapInteractionRef.current?.()
      map.on('dragstart', userPan)
      map.on('zoomstart', userPan)
      map.on('rotatestart', userPan)
      map.on('pitchstart', userPan)
      emitCenter()
      applyRouteLayer(map, routeGeometryRef.current)
      onMapReadyRef.current?.(map)
    })

    return () => {
      map.off('moveend', emitCenter)
      if (navControl) {
        try {
          map.removeControl(navControl)
        } catch {
          /* ignore */
        }
      }
      map.remove()
      mapRef.current = null
    }
  }, [onMoveEnd, showNavigationControls])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    for (const m of poiMarkersRef.current) m.remove()
    poiMarkersRef.current = []

    for (const p of pois) {
      const dot = document.createElement('div')
      dot.className =
        'flex h-4 w-4 cursor-pointer items-center justify-center rounded-full border-2 border-white shadow-md ring-1 ring-black/10'
      dot.style.backgroundColor = categoryColor(p.category)
      dot.title =
        p.category === 'hotel' || p.category === 'restaurant'
          ? `${p.name} (${p.category === 'hotel' ? 'Hotel' : 'Restaurant'}) – antippen`
          : `${p.name} (Ziel antippen)`
      dot.addEventListener('click', (ev) => {
        ev.stopPropagation()
        onPoiMarkerClickRef.current?.(p)
      })

      const marker = new maplibregl.Marker({ element: dot }).setLngLat([p.lng, p.lat]).addTo(map)
      poiMarkersRef.current.push(marker)
    }
  }, [pois])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    for (const m of curatedMarkersRef.current) m.remove()
    curatedMarkersRef.current = []

    for (const p of curatedPlaces) {
      const { bg, icon } = curatedPinStyle(p.category)
      const wrap = document.createElement('div')
      wrap.className =
        'flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border-[3px] border-white shadow-lg ring-1 ring-black/15'
      wrap.style.backgroundColor = bg
      wrap.title = p.name
      const sym = document.createElement('span')
      sym.className = 'material-symbols-outlined text-[22px] leading-none text-white'
      sym.style.fontVariationSettings = "'FILL' 1"
      sym.textContent = icon
      wrap.appendChild(sym)
      wrap.addEventListener('click', (ev) => {
        ev.stopPropagation()
        onCuratedPlaceClickRef.current?.(p)
      })
      const marker = new maplibregl.Marker({ element: wrap, anchor: 'bottom' })
        .setLngLat([p.lng, p.lat])
        .addTo(map)
      curatedMarkersRef.current.push(marker)
    }
  }, [curatedPlaces])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    for (const m of participantMarkersRef.current) m.remove()
    participantMarkersRef.current = []

    for (const p of participants) {
      const isSelf = selfUserId != null && p.userId === selfUserId
      const nearPeer = Boolean(p.inGroupRange) && !isSelf
      const wrap = document.createElement('div')
      wrap.className = 'relative flex flex-col items-center'
      const avatar = document.createElement('div')
      avatar.className = [
        'flex h-10 w-10 items-center justify-center rounded-full border-[3px] border-white text-white shadow-lg',
        isSelf
          ? 'bg-tertiary ring-2 ring-amber-400'
          : nearPeer
            ? 'bg-primary ring-[3px] ring-green-400 ring-offset-1'
            : 'bg-primary ring-1 ring-black/15',
      ].join(' ')
      const iconId = normalizeMapIconId(p.mapIcon)
      const sym = document.createElement('span')
      sym.className = 'material-symbols-outlined text-[22px] leading-none text-white'
      sym.style.fontVariationSettings = "'FILL' 1"
      sym.textContent = iconId
      avatar.appendChild(sym)
      avatar.title = isSelf
        ? `${p.displayName} (du)`
        : nearPeer
          ? `${p.displayName} – in Gruppen-Nähe (Funk)`
          : p.displayName
      wrap.appendChild(avatar)
      const label = document.createElement('div')
      label.className =
        'mt-0.5 max-w-[5.5rem] truncate rounded-md bg-inverse-surface/90 px-1.5 py-0.5 text-center text-[9px] font-bold text-inverse-on-surface shadow'
      label.textContent = isSelf ? 'Du' : p.displayName.split(' ')[0] ?? p.displayName
      wrap.appendChild(label)

      wrap.style.cursor = 'pointer'
      wrap.addEventListener('click', (ev) => {
        ev.stopPropagation()
        onParticipantMarkerClickRef.current?.(p)
      })

      const marker = new maplibregl.Marker({ element: wrap, anchor: 'bottom' })
        .setLngLat([p.lng, p.lat])
        .addTo(map)
      participantMarkersRef.current.push(marker)
    }
  }, [participants, selfUserId])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapPickTarget || !onPickMapPoint) return

    const handler = (e: maplibregl.MapMouseEvent) => {
      const t = mapPickTargetRef.current
      if (t !== 'from' && t !== 'to') return
      onPickMapPointRef.current?.(t, { lat: e.lngLat.lat, lng: e.lngLat.lng })
    }
    map.on('click', handler)
    const canvas = map.getCanvas()
    canvas.style.cursor = 'crosshair'
    return () => {
      map.off('click', handler)
      canvas.style.cursor = ''
    }
  }, [mapPickTarget, onPickMapPoint])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    destMarkerRef.current?.remove()
    destMarkerRef.current = null

    if (!highlightDestination) return

    const pin = document.createElement('div')
    pin.className =
      'flex h-9 w-9 items-center justify-center rounded-full border-[3px] border-white bg-error text-on-error shadow-xl'
    pin.innerHTML =
      '<span class="material-symbols-outlined text-[22px] leading-none" style="font-variation-settings:\'FILL\' 1">flag</span>'
    pin.title = 'Navigationsziel'

    destMarkerRef.current = new maplibregl.Marker({ element: pin, anchor: 'bottom' })
      .setLngLat([highlightDestination.lng, highlightDestination.lat])
      .addTo(map)
  }, [highlightDestination])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    startMarkerRef.current?.remove()
    startMarkerRef.current = null

    if (!highlightStart) return

    const pin = document.createElement('div')
    pin.className =
      'flex h-9 w-9 items-center justify-center rounded-full border-[3px] border-white bg-primary text-on-primary shadow-xl'
    pin.innerHTML =
      '<span class="material-symbols-outlined text-[22px] leading-none" style="font-variation-settings:\'FILL\' 1">trip_origin</span>'
    pin.title = 'Routenstart (gewählter Ort)'

    startMarkerRef.current = new maplibregl.Marker({ element: pin, anchor: 'bottom' })
      .setLngLat([highlightStart.lng, highlightStart.lat])
      .addTo(map)
  }, [highlightStart])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const run = () => applyRouteLayer(map, routeGeometry)
    if (map.isStyleLoaded()) run()
    else map.once('load', run)
  }, [routeGeometry])

  return <div ref={containerRef} className={className} role="application" aria-label="Karte" />
}

function applyRouteLayer(map: maplibregl.Map, geometry: RouteLineString | null | undefined) {
  const hasLine = geometry?.coordinates && geometry.coordinates.length >= 2

  if (!hasLine) {
    if (map.getLayer(ROUTE_LAYER_ID)) map.removeLayer(ROUTE_LAYER_ID)
    if (map.getSource(ROUTE_SOURCE_ID)) map.removeSource(ROUTE_SOURCE_ID)
    return
  }

  const collection = {
    type: 'FeatureCollection' as const,
    features: [
      {
        type: 'Feature' as const,
        properties: {},
        geometry: { type: 'LineString' as const, coordinates: geometry!.coordinates },
      },
    ],
  }

  const src = map.getSource(ROUTE_SOURCE_ID) as maplibregl.GeoJSONSource | undefined
  if (src) {
    src.setData(collection as unknown as GeoJSON.GeoJSON)
  } else {
    map.addSource(ROUTE_SOURCE_ID, {
      type: 'geojson',
      data: collection as unknown as GeoJSON.GeoJSON,
    })
    map.addLayer({
      id: ROUTE_LAYER_ID,
      type: 'line',
      source: ROUTE_SOURCE_ID,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#0d47a1',
        'line-width': 5,
        'line-opacity': 0.9,
      },
    })
  }
}
