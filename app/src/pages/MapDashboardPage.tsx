import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import maplibregl from 'maplibre-gl'
import { Link, useNavigate } from 'react-router-dom'
import { CreatePoiModal } from '../components/CreatePoiModal'
import { HelpModal } from '../components/HelpModal'
import { ParticipantActionModal, type ParticipantSheetUser } from '../components/ParticipantActionModal'
import {
  MapLibreMap,
  MAP_INITIAL_CENTER,
  type MapParticipantMarker,
  type RouteLineString,
} from '../components/MapLibreMap'
import {
  clearMyPresence,
  askRouteAssistant,
  fetchDrivingRoute,
  fetchRouteBriefing,
  fetchRouteTollAdvice,
  fetchGeocodeSearch,
  fetchGroups,
  fetchPoisNear,
  fetchPresenceNearby,
  postMyPresence,
  type DrivingRouteStepDto,
  type AssistantAskDto,
  type RouteBriefingDto,
  type RouteTollAdviceDto,
  type GeocodeResultDto,
  type GroupSummary,
  type MapPoiDto,
  type MapParticipantDto,
  fetchCuratedPlaces,
  type CuratedPlaceDto,
  type CuratedPlaceCategory,
  createVignetteOrderRequest,
  fetchVignetteServiceProducts,
  type VignetteServiceProductDto,
} from '../lib/api'
import { haversineKm } from '../lib/geo'
import { BERLIN_CENTER_DEG, isGpsTestModeEnabled } from '../lib/gpsTestMode'
import { normalizeMapIconId } from '../lib/mapIcons'
import {
  metersSpokenGerman,
  requestScreenWakeLock,
  speakNavigationGerman,
  stopNavigationVoice,
  type ScreenWakeSentinel,
} from '../lib/navigationVoice'
import {
  bearingDeg,
  closestAlongPolyline,
  maneuverDisplay,
  NAV_OFF_ROUTE_SEVERE_M,
  NAV_OFF_ROUTE_WARN_M,
  pointAheadOnRoute,
  smoothBearingDeg,
  snapPositionForNavigation,
  totalPolylineLengthM,
} from '../lib/routeNavigation'
import {
  clearNavSession,
  readNavRecents,
  readNavSession,
  saveRecentDestination,
  writeNavSession,
  type NavRecentSearch,
  type NavTarget,
} from '../lib/navSession'
import { resolveTollVehicleClass } from '../lib/tollVehicle'
import { useAuth } from '../context/AuthContext'

const gpsTestMode = isGpsTestModeEnabled()

const PRESENCE_POST_MS = 22_000
const PARTICIPANTS_POLL_MS = 18_000
/** Sanfte Kamera: min. Abstand zwischen GPS-Ausrichtungen */
const NAV_CAMERA_GPS_MIN_MS = 2600
/** Wenn GPS stockt: Karte trotzdem periodisch ausrichten */
const NAV_CAMERA_HEARTBEAT_MS = 14_000
/** Wie weit voraus auf der Linie die „Blickrichtung“ liegt */
const NAV_LOOK_AHEAD_M = 520
/** GPS auf Route projizieren bis zu diesem Abstand (weniger Ruckeln) */
const NAV_SNAP_MAX_M = 88
/** Abstand für „in Gruppen-Nähe“ auf der Karte / Nah-Funk-Hinweis (km) */
const GROUP_PEER_NEARBY_KM = 15

/** Fallback bis `BottomNav` `--bottom-nav-height` setzt (≈ ShellLayout `h-24`). */
const BOTTOM_NAV_CSS = 'var(--bottom-nav-height, 6rem)'

/** Straßennaher Punkt Grenzübergang Horgoš/Röszke (SRB/HU) für OSRM-Routing */
const NAV_HORGOS: { lat: number; lng: number } = { lat: 45.9172, lng: 19.6718 }

const NAV_HORGOS_LABEL = 'Grenze Horgoš / Röszke (SRB/HU)'

function formatRouteDuration(sec: number) {
  const h = Math.floor(sec / 3600)
  const m = Math.round((sec % 3600) / 60)
  if (h <= 0) return `${Math.max(1, m)} Min.`
  return `${h} Std. ${m} Min.`
}

function formatRouteDist(m: number) {
  if (m >= 1000) return `${(m / 1000).toFixed(1)} km`
  return `${Math.round(m)} m`
}

function poiChipPrefix(category: string): string {
  if (category === 'hotel') return 'Hotel · '
  if (category === 'restaurant') return 'Restaurant · '
  return ''
}

const LS_NAV_TTS = 'yol_nav_tts'
const LS_NAV_WAKE = 'yol_nav_wake'
const LS_NAV_AUTOREROUTE = 'yol_nav_autoreroute'
const LS_SHOW_SELF_MARKER = 'yol_map_show_self_marker_v1'

function readShowSelfMarker(): boolean {
  try {
    const v = localStorage.getItem(LS_SHOW_SELF_MARKER)
    if (v === '0') return false
    return true
  } catch {
    return true
  }
}

function writeShowSelfMarker(on: boolean) {
  try {
    localStorage.setItem(LS_SHOW_SELF_MARKER, on ? '1' : '0')
  } catch {
    /* ignore */
  }
}

function readNavPref(key: string, defaultOn: boolean): boolean {
  try {
    const v = localStorage.getItem(key)
    if (v === null) return defaultOn
    return v === '1' || v === 'true'
  } catch {
    return defaultOn
  }
}

function writeNavPref(key: string, on: boolean) {
  try {
    localStorage.setItem(key, on ? '1' : '0')
  } catch {
    /* ignore */
  }
}

/** Ab dieser Entfernung zur Linie (dauerhaft): automatisch neu routen */
const OFF_ROUTE_AUTO_REROUTE_M = 105
/** So lange muss die Abweichung anhalten */
const OFF_ROUTE_STABLE_MS = 6000
/** Mindestabstand zwischen Auto-Reroutes */
const AUTO_REROUTE_COOLDOWN_MS = 52_000

export function MapDashboardPage() {
  const { user, token } = useAuth()
  const navigate = useNavigate()
  const [helpOpen, setHelpOpen] = useState(false)
  const [pois, setPois] = useState<MapPoiDto[]>([])
  const [curatedPlaces, setCuratedPlaces] = useState<CuratedPlaceDto[]>([])
  const [curatedCategoryFilter, setCuratedCategoryFilter] = useState<CuratedPlaceCategory | ''>('')
  const [curatedSheet, setCuratedSheet] = useState<CuratedPlaceDto | null>(null)
  const [vignetteModalOpen, setVignetteModalOpen] = useState(false)
  /** Snapshot für das Modal (bleibt erhalten, wenn die Route nach „Navigation beenden“ gelöscht wird). */
  const [vignetteAdviceForModal, setVignetteAdviceForModal] = useState<RouteTollAdviceDto | null>(null)
  const [vignetteRouteLabelForModal, setVignetteRouteLabelForModal] = useState<string | null>(null)
  const [vignetteCatalog, setVignetteCatalog] = useState<VignetteServiceProductDto[]>([])
  const [vignetteSelected, setVignetteSelected] = useState<string[]>([])
  const [vignetteNote, setVignetteNote] = useState('')
  const [vignetteBusy, setVignetteBusy] = useState(false)
  const [vignetteMsg, setVignetteMsg] = useState<string | null>(null)
  /** Verhindert mehrfaches Auto-Öffnen für dieselbe Route + Länder-Kombination. */
  const vignetteAutoOpenedRouteKeyRef = useRef<string | null>(null)
  const [participants, setParticipants] = useState<MapParticipantDto[]>([])
  const [center, setCenter] = useState<{ lat: number; lng: number }>({
    lat: MAP_INITIAL_CENTER[1],
    lng: MAP_INITIAL_CENTER[0],
  })
  const [poiModal, setPoiModal] = useState(false)
  const [shareOnMap, setShareOnMap] = useState(true)
  const [geoHint, setGeoHint] = useState<string | null>(null)
  const [myPos, setMyPos] = useState<{ lat: number; lng: number } | null>(null)
  const [routeGeometry, setRouteGeometry] = useState<RouteLineString | null>(null)
  const [routeMeta, setRouteMeta] = useState<{ distanceM: number; durationS: number } | null>(null)
  const [routeSteps, setRouteSteps] = useState<DrivingRouteStepDto[]>([])
  const [routeLoading, setRouteLoading] = useState(false)
  const [routeErr, setRouteErr] = useState<string | null>(null)
  const [tollAdvice, setTollAdvice] = useState<RouteTollAdviceDto | null>(null)
  const [tollAdviceLoading, setTollAdviceLoading] = useState(false)
  const [tollAdviceErr, setTollAdviceErr] = useState<string | null>(null)
  const [routeBriefing, setRouteBriefing] = useState<RouteBriefingDto | null>(null)
  const [routeBriefingLoading, setRouteBriefingLoading] = useState(false)
  const [routeBriefingErr, setRouteBriefingErr] = useState<string | null>(null)
  /** Kompakte HUD-Leiste statt großem Navigationspanel (Display frei halten). */
  const [navHudExpanded, setNavHudExpanded] = useState(false)
  /** Linkes „Gemeinsam auf der Karte“: nur Icon bis zur Ausklapp-Ansicht. */
  const [mapLeftInfoExpanded, setMapLeftInfoExpanded] = useState(false)
  /** Rechte Karten-Aktionen: kompakte Icons vs. größere Darstellung inkl. SOS-Text. */
  const [mapRightFabExpanded, setMapRightFabExpanded] = useState(false)
  /** Admin-Tipps-Filter: geschlossen nur Stern-Button, geöffnet Kategorien. */
  const [tippsFilterOpen, setTippsFilterOpen] = useState(false)
  const [assistantQuestion, setAssistantQuestion] = useState('')
  const [assistantAnswer, setAssistantAnswer] = useState<AssistantAskDto | null>(null)
  const [assistantLoading, setAssistantLoading] = useState(false)
  const [assistantErr, setAssistantErr] = useState<string | null>(null)
  /** Ziel der Route – erst nach Suche/Karte/POI gesetzt (kein willkürlicher Standardpunkt). */
  const [navTarget, setNavTarget] = useState<NavTarget | null>(null)
  /** Karte antippen: Start oder Ziel setzen (wechselseitig ausschließlich). */
  const [mapPickTarget, setMapPickTarget] = useState<'from' | 'to' | null>(null)
  /** Panel zu – Karte wie bei Maps zuerst; auf „Route“ tippen zum Planen. */
  const [navPanelOpen, setNavPanelOpen] = useState(false)
  /** Wenn gesetzt: Route von diesen Koordinaten statt GPS / myPos (aus Ortssuche). */
  const [manualRouteStart, setManualRouteStart] = useState<{ lat: number; lng: number } | null>(null)
  const [manualStartLabel, setManualStartLabel] = useState<string | null>(null)
  const [startSearchQuery, setStartSearchQuery] = useState('')
  const [startSearchResults, setStartSearchResults] = useState<GeocodeResultDto[]>([])
  const [startSearchLoading, setStartSearchLoading] = useState(false)
  const [manualStartErr, setManualStartErr] = useState<string | null>(null)
  const [startSectionOpen, setStartSectionOpen] = useState(false)
  const [destSearchQuery, setDestSearchQuery] = useState('')
  const [destSearchResults, setDestSearchResults] = useState<GeocodeResultDto[]>([])
  const [destSearchLoading, setDestSearchLoading] = useState(false)
  const [destSearchErr, setDestSearchErr] = useState<string | null>(null)
  const [recentDestinations, setRecentDestinations] = useState<NavRecentSearch[]>([])
  const [testGpsPosition, setTestGpsPosition] = useState<{ lat: number; lng: number } | null>(null)
  const [testGpsLatInput, setTestGpsLatInput] = useState('')
  const [testGpsLngInput, setTestGpsLngInput] = useState('')
  const [testGpsErr, setTestGpsErr] = useState<string | null>(null)
  const [myGroups, setMyGroups] = useState<GroupSummary[]>([])
  /** 'all' oder Gruppen-ID: nur Mitglieder dieser Gruppe auf der Karte */
  const [mapGroupFilter, setMapGroupFilter] = useState<'all' | string>('all')
  /** Eigene Position als Marker (ohne dass andere dich sehen – nur lokal / Karte). */
  const [showSelfMarker, setShowSelfMarker] = useState(() => readShowSelfMarker())
  const [participantSheet, setParticipantSheet] = useState<ParticipantSheetUser | null>(null)
  const [mapEpoch, setMapEpoch] = useState(0)
  /** Automatische Kartenführung entlang der Route */
  const [navFollowActive, setNavFollowActive] = useState(true)
  /** Nach manuellem Zoomen/Schwenken: bis wann die Auto-Führung pausiert bleibt (ms seit Epoch). */
  const [navPauseUntil, setNavPauseUntil] = useState(0)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const myPosRef = useRef(myPos)
  const routeGeometryRef = useRef(routeGeometry)
  const navFollowActiveRef = useRef(navFollowActive)
  const navPauseUntilRef = useRef(0)
  const smoothedBearingRef = useRef<number | null>(null)
  const lastNavCameraAtRef = useRef(0)
  const routeOverviewKeyRef = useRef<string | null>(null)
  const lastPresencePost = useRef(0)
  const watchIdRef = useRef<number | null>(null)
  const offRouteSinceRef = useRef<number | null>(null)
  const lastAutoRerouteAtRef = useRef(0)
  const ttsPrevManeuverIdxRef = useRef(-1)
  const ttsPrevDistRef = useRef<number | null>(null)
  const wakeLockSentinelRef = useRef<ScreenWakeSentinel | null>(null)

  const [navTtsEnabled, setNavTtsEnabled] = useState(() => readNavPref(LS_NAV_TTS, true))
  const [navWakeLockEnabled, setNavWakeLockEnabled] = useState(() => readNavPref(LS_NAV_WAKE, false))
  const [navAutoRerouteEnabled, setNavAutoRerouteEnabled] = useState(() =>
    readNavPref(LS_NAV_AUTOREROUTE, true),
  )

  useEffect(() => {
    setRecentDestinations(readNavRecents())
  }, [])

  useEffect(() => {
    writeShowSelfMarker(showSelfMarker)
  }, [showSelfMarker])

  useEffect(() => {
    const session = readNavSession()
    if (!session) return
    if (session.target) setNavTarget(session.target)
    if (session.routeGeometry) setRouteGeometry(session.routeGeometry)
    if (session.routeMeta) setRouteMeta(session.routeMeta)
    if (session.routeSteps.length > 0) setRouteSteps(session.routeSteps)
    if (session.manualRouteStart) setManualRouteStart(session.manualRouteStart)
    if (session.manualStartLabel) setManualStartLabel(session.manualStartLabel)
    if (session.panelOpen) setNavPanelOpen(true)
  }, [])

  useEffect(() => {
    const hasAny = Boolean(navTarget || routeGeometry?.coordinates?.length || manualRouteStart)
    if (!hasAny) {
      clearNavSession()
      return
    }
    writeNavSession({
      target: navTarget,
      routeGeometry,
      routeMeta,
      routeSteps,
      manualRouteStart,
      manualStartLabel,
      panelOpen: navPanelOpen,
    })
  }, [navTarget, routeGeometry, routeMeta, routeSteps, manualRouteStart, manualStartLabel, navPanelOpen])

  const setNavTtsEnabledPersist = useCallback((on: boolean) => {
    setNavTtsEnabled(on)
    writeNavPref(LS_NAV_TTS, on)
    if (!on) stopNavigationVoice()
  }, [])

  const setNavWakeLockEnabledPersist = useCallback((on: boolean) => {
    setNavWakeLockEnabled(on)
    writeNavPref(LS_NAV_WAKE, on)
  }, [])

  const setNavAutoRerouteEnabledPersist = useCallback((on: boolean) => {
    setNavAutoRerouteEnabled(on)
    writeNavPref(LS_NAV_AUTOREROUTE, on)
  }, [])

  myPosRef.current = myPos
  routeGeometryRef.current = routeGeometry
  navFollowActiveRef.current = navFollowActive
  navPauseUntilRef.current = navPauseUntil

  const bumpNavPause = useCallback((ms: number) => {
    const t = Date.now() + ms
    navPauseUntilRef.current = t
    setNavPauseUntil(t)
  }, [])

  const resumeNavigationGuidance = useCallback(() => {
    navPauseUntilRef.current = 0
    setNavPauseUntil(0)
    smoothedBearingRef.current = null
  }, [])

  /** Solange die Kartenführung pausiert ist: regelmäßig neu rendern (Countdown / „Zurück“). */
  const [, setNavPauseTick] = useState(0)
  useEffect(() => {
    if (navPauseUntil <= Date.now()) return
    const id = window.setInterval(() => setNavPauseTick((x) => x + 1), 1000)
    return () => clearInterval(id)
  }, [navPauseUntil])

  const navUserPausedMap = Date.now() < navPauseUntil

  const runNavigationCameraRef = useRef<(reason: 'gps' | 'heartbeat') => void>(() => {})
  runNavigationCameraRef.current = (reason: 'gps' | 'heartbeat') => {
    const map = mapRef.current
    if (!map?.isStyleLoaded()) return
    if (!navFollowActiveRef.current) return
    if (Date.now() < navPauseUntilRef.current) return

    const pos = myPosRef.current
    const geom = routeGeometryRef.current
    if (!pos || !geom?.coordinates?.length) return

    const now = Date.now()
    if (reason === 'gps' && now - lastNavCameraAtRef.current < NAV_CAMERA_GPS_MIN_MS) return
    lastNavCameraAtRef.current = now

    const coords = geom.coordinates
    const snap = snapPositionForNavigation(coords, pos.lng, pos.lat, NAV_SNAP_MAX_M)
    const ahead = pointAheadOnRoute(coords, snap.useLng, snap.useLat, NAV_LOOK_AHEAD_M)
    const rawBrg = bearingDeg(snap.useLat, snap.useLng, ahead.lat, ahead.lng)
    const alpha = reason === 'gps' ? 0.22 : 0.38
    smoothedBearingRef.current = smoothBearingDeg(smoothedBearingRef.current, rawBrg, alpha)
    const brg = smoothedBearingRef.current

    const b = new maplibregl.LngLatBounds()
    b.extend([snap.useLng, snap.useLat] as maplibregl.LngLatLike)
    b.extend([ahead.lng, ahead.lat] as maplibregl.LngLatLike)
    const moveDur = reason === 'gps' ? 1600 : 2100

    const afterFit = () => {
      map.off('moveend', afterFit)
      if (mapRef.current !== map) return
      map.easeTo({
        bearing: brg,
        pitch: 44,
        duration: reason === 'gps' ? 950 : 1200,
        essential: true,
      })
    }
    map.once('moveend', afterFit)
    map.fitBounds(b, {
      padding: { top: 86, bottom: 236, left: 44, right: 44 },
      maxZoom: 16.35,
      duration: moveDur,
      essential: true,
    })
  }

  const loadPois = useCallback(async (lat: number, lng: number) => {
    try {
      const data = await fetchPoisNear(lat, lng, 120)
      setPois(data.pois)
    } catch {
      setPois([])
    }
  }, [])

  useEffect(() => {
    const ac = new AbortController()
    ;(async () => {
      try {
        const cat = curatedCategoryFilter || undefined
        const { places } = await fetchCuratedPlaces(cat)
        if (!ac.signal.aborted) setCuratedPlaces(places)
      } catch {
        if (!ac.signal.aborted) setCuratedPlaces([])
      }
    })()
    return () => ac.abort()
  }, [curatedCategoryFilter])

  const loadParticipants = useCallback(
    async (lat: number, lng: number) => {
      try {
        const groupId = mapGroupFilter !== 'all' ? mapGroupFilter : undefined
        const data = await fetchPresenceNearby(lat, lng, 150, 12, {
          groupId,
          token: groupId ? token : undefined,
        })
        setParticipants(data.participants)
      } catch {
        setParticipants([])
      }
    },
    [mapGroupFilter, token],
  )

  const onMoveEnd = useCallback(
    (c: { lat: number; lng: number }) => {
      setCenter(c)
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => {
        void loadPois(c.lat, c.lng)
        void loadParticipants(c.lat, c.lng)
      }, 450)
    },
    [loadPois, loadParticipants],
  )

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  useEffect(() => {
    const t = window.setInterval(() => {
      void loadParticipants(center.lat, center.lng)
    }, PARTICIPANTS_POLL_MS)
    return () => clearInterval(t)
  }, [center.lat, center.lng, loadParticipants])

  useEffect(() => {
    void loadParticipants(center.lat, center.lng)
  }, [mapGroupFilter, token, center.lat, center.lng, loadParticipants])

  useEffect(() => {
    if (!user || !token) {
      setMyGroups([])
      setMapGroupFilter('all')
      return
    }
    let cancelled = false
    void fetchGroups(token)
      .then((d) => {
        if (!cancelled) setMyGroups(d.groups)
      })
      .catch(() => {
        if (!cancelled) setMyGroups([])
      })
    return () => {
      cancelled = true
    }
  }, [user, token])

  /** Einmalige Gesamtübersicht pro neuer Route (nicht bei jedem Map-Remount wiederholen). */
  useEffect(() => {
    if (!routeGeometry?.coordinates?.length) {
      routeOverviewKeyRef.current = null
      return
    }
    const c = routeGeometry.coordinates
    const key = `${c.length}_${c[0][0].toFixed(4)}_${c[0][1].toFixed(4)}_${c[c.length - 1][0].toFixed(4)}`
    const map = mapRef.current
    if (!map?.isStyleLoaded()) return
    if (routeOverviewKeyRef.current === key) return
    routeOverviewKeyRef.current = key
    const b = new maplibregl.LngLatBounds()
    for (const coord of c) b.extend(coord as maplibregl.LngLatLike)
    map.fitBounds(b, {
      padding: { top: 200, bottom: 160, left: 40, right: 40 },
      maxZoom: 11,
      duration: 1600,
    })
  }, [routeGeometry, mapEpoch])

  /** GPS: für „auf Karte teilen“ und/oder aktive Navigations-Follow (Route sichtbar). */
  useEffect(() => {
    if (watchIdRef.current != null) {
      navigator.geolocation.clearWatch(watchIdRef.current)
      watchIdRef.current = null
    }

    const shareTrack = Boolean(user && token && shareOnMap)
    const navTrack = Boolean(routeGeometry?.coordinates?.length && navFollowActive)
    const needPosForNavLine = Boolean(user && token && routeGeometry?.coordinates?.length)
    const needPosForSelfMarker = Boolean(user && token && showSelfMarker)
    const shouldWatch = shareTrack || navTrack || needPosForNavLine || needPosForSelfMarker

    if (user && token && !shareOnMap && !navTrack) {
      void clearMyPresence(token).catch(() => {})
    }

    if (!shouldWatch) {
      if (!shareTrack && !navTrack && !('geolocation' in navigator)) {
        /* nur Hinweis, wenn gar kein Tracking */
      }
      return
    }

    if (!('geolocation' in navigator)) {
      if (shareTrack) setGeoHint('Standort wird von diesem Gerät nicht unterstützt.')
      return
    }

    if (shareTrack) setGeoHint(null)

    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const lat = pos.coords.latitude
        const lng = pos.coords.longitude
        setMyPos({ lat, lng })
        if (!user || !token || !shareOnMap) return
        const now = Date.now()
        if (now - lastPresencePost.current < PRESENCE_POST_MS) return
        lastPresencePost.current = now
        void postMyPresence(token, lat, lng).catch(() => {})
      },
      (err) => {
        if (err.code === 1 && shareTrack) {
          setGeoHint('Standortfreigabe nötig, damit andere dich auf der Karte sehen.')
        }
      },
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 25000 },
    )

    return () => {
      if (watchIdRef.current != null) {
        navigator.geolocation.clearWatch(watchIdRef.current)
        watchIdRef.current = null
      }
    }
  }, [user, token, shareOnMap, routeGeometry, navFollowActive, showSelfMarker])

  /** Bei neuer Route: Kompass-Glättung zurücksetzen. */
  useEffect(() => {
    if (routeGeometry?.coordinates?.length) smoothedBearingRef.current = null
  }, [routeGeometry])

  /** Heartbeat-Kamera, falls GPS lange gleich bleibt. */
  useEffect(() => {
    if (!routeGeometry?.coordinates?.length || !navFollowActive) return
    const id = window.setInterval(() => runNavigationCameraRef.current('heartbeat'), NAV_CAMERA_HEARTBEAT_MS)
    return () => clearInterval(id)
  }, [routeGeometry, navFollowActive, mapEpoch])

  /** Bei GPS-Update: Karte nachziehen (gedrosselt). */
  useEffect(() => {
    if (!routeGeometry?.coordinates?.length || !navFollowActive || !myPos) return
    const t = window.setTimeout(() => runNavigationCameraRef.current('gps'), 70)
    return () => clearTimeout(t)
  }, [myPos, routeGeometry, navFollowActive])

  async function onToggleShare(next: boolean) {
    setShareOnMap(next)
    if (!next && token) {
      try {
        await clearMyPresence(token)
      } catch {
        /* ignore */
      }
    }
  }

  function goToMyLocation() {
    bumpNavPause(26_000)
    const map = mapRef.current
    const fly = (lat: number, lng: number) => {
      if (!map) return
      map.flyTo({
        center: [lng, lat],
        zoom: Math.max(map.getZoom(), 11),
        pitch: 0,
        bearing: 0,
        essential: true,
      })
    }

    if (myPos) {
      fly(myPos.lat, myPos.lng)
      return
    }

    if (!('geolocation' in navigator)) {
      setGeoHint('Kein Standort verfügbar.')
      return
    }

    navigator.geolocation.getCurrentPosition(
      (p) => {
        const lat = p.coords.latitude
        const lng = p.coords.longitude
        setMyPos({ lat, lng })
        fly(lat, lng)
      },
      () => setGeoHint('Standort konnte nicht geladen werden.'),
      { enableHighAccuracy: true, timeout: 15000 },
    )
  }

  function openAddPoi() {
    if (!user) {
      navigate('/login')
      return
    }
    setPoiModal(true)
  }

  function clearRoute() {
    stopNavigationVoice()
    offRouteSinceRef.current = null
    ttsPrevManeuverIdxRef.current = -1
    ttsPrevDistRef.current = null
    setRouteGeometry(null)
    setRouteMeta(null)
    setRouteSteps([])
    setRouteErr(null)
    routeOverviewKeyRef.current = null
    smoothedBearingRef.current = null
    resumeNavigationGuidance()
    const m = mapRef.current
    if (m?.isStyleLoaded()) {
      m.easeTo({ bearing: 0, pitch: 0, duration: 700, essential: true })
    }
  }

  /** Route, Ziel und Session vollständig beenden (nicht nur Linie ausblenden). */
  function endNavigation() {
    const snapTollAdvice = tollAdvice
    const snapRouteLabel = navTarget?.label ?? null
    stopNavigationVoice()
    offRouteSinceRef.current = null
    ttsPrevManeuverIdxRef.current = -1
    ttsPrevDistRef.current = null
    setRouteGeometry(null)
    setRouteMeta(null)
    setRouteSteps([])
    setRouteErr(null)
    setTollAdvice(null)
    setTollAdviceErr(null)
    setRouteBriefing(null)
    setRouteBriefingErr(null)
    setAssistantAnswer(null)
    setAssistantErr(null)
    setNavTarget(null)
    setManualRouteStart(null)
    setManualStartLabel(null)
    setStartSectionOpen(false)
    setMapPickTarget(null)
    setDestSearchQuery('')
    setDestSearchResults([])
    setDestSearchErr(null)
    setNavPanelOpen(false)
    setNavHudExpanded(false)
    routeOverviewKeyRef.current = null
    smoothedBearingRef.current = null
    resumeNavigationGuidance()
    clearNavSession()
    const m = mapRef.current
    if (m?.isStyleLoaded()) {
      m.easeTo({ bearing: 0, pitch: 0, duration: 700, essential: true })
    }
    if (token && snapTollAdvice?.countries?.length) {
      void openVignetteServiceModal({ advice: snapTollAdvice, routeLabel: snapRouteLabel })
    }
  }

  function fitWholeRouteOnMap() {
    bumpNavPause(26_000)
    const map = mapRef.current
    const geom = routeGeometryRef.current
    if (!map?.isStyleLoaded() || !geom?.coordinates?.length) return
    const b = new maplibregl.LngLatBounds()
    for (const c of geom.coordinates) b.extend(c as maplibregl.LngLatLike)
    map.fitBounds(b, {
      padding: { top: 200, bottom: 200, left: 40, right: 40 },
      maxZoom: 11,
      duration: 1400,
      essential: true,
    })
    map.easeTo({ bearing: 0, pitch: 0, duration: 600, essential: true })
  }

  function closeNavPanel() {
    setNavPanelOpen(false)
    setMapPickTarget(null)
  }

  const applyNavTarget = useCallback((next: NavTarget) => {
    setNavTarget(next)
    setMapPickTarget(null)
    setDestSearchResults([])
    setDestSearchErr(null)
    setRouteGeometry(null)
    setRouteMeta(null)
    setRouteSteps([])
    setRouteErr(null)
  }, [])

  const resolveRouteFrom = useCallback(async (): Promise<{ lat: number; lng: number }> => {
    if (manualRouteStart) return manualRouteStart
    if (gpsTestMode && testGpsPosition) return testGpsPosition
    if (myPos) return myPos
    if (!('geolocation' in navigator)) {
      if (gpsTestMode) return BERLIN_CENTER_DEG
      throw new Error('Standort wird auf diesem Gerät nicht unterstützt.')
    }
    return await new Promise<{ lat: number; lng: number }>((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        (p) => {
          const pos = { lat: p.coords.latitude, lng: p.coords.longitude }
          setMyPos(pos)
          resolve(pos)
        },
        () => {
          if (gpsTestMode) resolve(BERLIN_CENTER_DEG)
          else reject(new Error('Standortfreigabe nötig – bitte erlauben oder unten einen Startort wählen.'))
        },
        { enableHighAccuracy: true, timeout: 22000 },
      )
    })
  }, [manualRouteStart, myPos, testGpsPosition])

  const computeRouteWithDest = useCallback(
    async (dest: NavTarget, options?: { silent?: boolean }) => {
      setRouteErr(null)
      setRouteLoading(true)
      try {
        const from = await resolveRouteFrom()
        const data = await fetchDrivingRoute(from.lat, from.lng, dest.lat, dest.lng)
        setRouteGeometry(data.geometry as RouteLineString)
        setRouteMeta({ distanceM: data.distanceM, durationS: data.durationS })
        setRouteSteps(data.steps ?? [])
        if (!options?.silent) setNavPanelOpen(true)
      } catch (e) {
        setRouteGeometry(null)
        setRouteMeta(null)
        setRouteSteps([])
        setRouteErr(e instanceof Error ? e.message : 'Route konnte nicht berechnet werden.')
      } finally {
        setRouteLoading(false)
      }
    },
    [resolveRouteFrom],
  )

  const onPickMapPoint = useCallback(
    (target: 'from' | 'to', pos: { lat: number; lng: number }) => {
      setMapPickTarget(null)
      const label = `Karte (${pos.lat.toFixed(4)}°, ${pos.lng.toFixed(4)}°)`
      if (target === 'from') {
        setManualStartErr(null)
        setManualRouteStart({ lat: pos.lat, lng: pos.lng })
        setManualStartLabel(label)
        setStartSectionOpen(true)
        if (navTarget) void computeRouteWithDest(navTarget)
        return
      }
      const dest = { lat: pos.lat, lng: pos.lng, label }
      applyNavTarget(dest)
      void computeRouteWithDest(dest)
    },
    [applyNavTarget, computeRouteWithDest, navTarget],
  )

  function applyTestGpsInputs() {
    setTestGpsErr(null)
    const lat = parseFloat(testGpsLatInput.replace(',', '.'))
    const lng = parseFloat(testGpsLngInput.replace(',', '.'))
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      setTestGpsErr('Breite und Länge als Zahl eingeben (z. B. 52.52 und 13.405).')
      return
    }
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      setTestGpsErr('Werte außerhalb des gültigen Bereichs.')
      return
    }
    setTestGpsPosition({ lat, lng })
  }

  function applyBerlinTestGps() {
    setTestGpsErr(null)
    setTestGpsPosition(BERLIN_CENTER_DEG)
    setTestGpsLatInput(String(BERLIN_CENTER_DEG.lat))
    setTestGpsLngInput(String(BERLIN_CENTER_DEG.lng))
  }

  function clearTestGps() {
    setTestGpsErr(null)
    setTestGpsPosition(null)
    setTestGpsLatInput('')
    setTestGpsLngInput('')
  }

  const onPoiMarkerClick = useCallback(
    (poi: MapPoiDto) => {
      const dest = { lat: poi.lat, lng: poi.lng, label: poi.name }
      saveRecentDestination(dest)
      setRecentDestinations(readNavRecents())
      applyNavTarget(dest)
      void computeRouteWithDest(dest)
    },
    [applyNavTarget, computeRouteWithDest],
  )

  const onCuratedPlaceMarkerClick = useCallback((place: CuratedPlaceDto) => {
    setCuratedSheet(place)
  }, [])

  const navigateToCuratedPlace = useCallback(
    (place: CuratedPlaceDto) => {
      const dest = { lat: place.lat, lng: place.lng, label: place.name }
      saveRecentDestination(dest)
      setRecentDestinations(readNavRecents())
      applyNavTarget(dest)
      setCuratedSheet(null)
      setNavPanelOpen(true)
      void computeRouteWithDest(dest)
    },
    [applyNavTarget, computeRouteWithDest],
  )

  const openParticipantSheet = useCallback(
    (p: MapParticipantMarker | MapParticipantDto) => {
      if (user && p.userId === user.id) return
      setParticipantSheet({
        userId: p.userId,
        displayName: p.displayName,
        lat: p.lat,
        lng: p.lng,
      })
    },
    [user],
  )

  const onParticipantMarkerClick = useCallback(
    (p: MapParticipantMarker) => {
      openParticipantSheet(p)
    },
    [openParticipantSheet],
  )

  const onRouteToParticipantFromSheet = useCallback(
    (p: ParticipantSheetUser) => {
      const dest = { lat: p.lat, lng: p.lng, label: p.displayName }
      saveRecentDestination(dest)
      setRecentDestinations(readNavRecents())
      applyNavTarget(dest)
      setNavPanelOpen(true)
      void computeRouteWithDest(dest)
    },
    [applyNavTarget, computeRouteWithDest],
  )

  async function runStartPlaceSearch() {
    const q = startSearchQuery.trim()
    setManualStartErr(null)
    setStartSearchResults([])
    if (q.length < 2) {
      setManualStartErr('Bitte mindestens zwei Zeichen eingeben.')
      return
    }
    setStartSearchLoading(true)
    try {
      const { results } = await fetchGeocodeSearch(q)
      setStartSearchResults(results)
      if (results.length === 0) {
        setManualStartErr('Keine Treffer – anderen Suchbegriff probieren.')
      }
    } catch (e) {
      setManualStartErr(e instanceof Error ? e.message : 'Suche fehlgeschlagen.')
    } finally {
      setStartSearchLoading(false)
    }
  }

  function selectRouteStart(hit: GeocodeResultDto) {
    setMapPickTarget(null)
    setManualStartErr(null)
    setManualRouteStart({ lat: hit.lat, lng: hit.lng })
    setManualStartLabel(hit.label)
    setStartSearchResults([])
    setStartSearchQuery('')
    const m = mapRef.current
    if (m) {
      m.flyTo({
        center: [hit.lng, hit.lat],
        zoom: Math.max(m.getZoom(), 11),
        essential: true,
      })
    }
    if (navTarget) void computeRouteWithDest(navTarget)
  }

  function clearManualRouteStart() {
    setManualRouteStart(null)
    setManualStartLabel(null)
    setManualStartErr(null)
    setStartSearchResults([])
    setStartSearchQuery('')
  }

  async function runDestPlaceSearch() {
    const q = destSearchQuery.trim()
    setDestSearchErr(null)
    setDestSearchResults([])
    if (q.length < 2) {
      setDestSearchErr('Bitte mindestens zwei Zeichen eingeben.')
      return
    }
    setDestSearchLoading(true)
    try {
      const { results } = await fetchGeocodeSearch(q)
      setDestSearchResults(results)
      if (results.length === 0) {
        setDestSearchErr('Kein Treffer – anderen Begriff probieren.')
      }
    } catch (e) {
      setDestSearchErr(e instanceof Error ? e.message : 'Suche fehlgeschlagen.')
    } finally {
      setDestSearchLoading(false)
    }
  }

  function selectRouteDestination(hit: GeocodeResultDto) {
    setDestSearchErr(null)
    setDestSearchQuery('')
    setDestSearchResults([])
    const dest = { lat: hit.lat, lng: hit.lng, label: hit.label }
    saveRecentDestination(dest)
    setRecentDestinations(readNavRecents())
    applyNavTarget(dest)
    setNavPanelOpen(true)
    void computeRouteWithDest(dest)
  }

  function requestRouteAgain(options?: { silent?: boolean }) {
    if (!navTarget) {
      setRouteErr('Bitte zuerst ein Ziel suchen oder auf der Karte wählen.')
      return
    }
    void computeRouteWithDest(navTarget, options)
  }

  async function runAssistantAsk() {
    const q = assistantQuestion.trim()
    setAssistantErr(null)
    if (q.length < 3) {
      setAssistantErr('Bitte eine konkrete Frage mit mindestens 3 Zeichen eingeben.')
      return
    }
    setAssistantLoading(true)
    try {
      const vc = resolveTollVehicleClass(user?.tollVehicleClass, user?.mapIcon)
      const resp = await askRouteAssistant(
        {
          question: q,
          vehicleClass: vc,
          corridor: 'berlin_turkey',
          geometry: routeGeometry ?? undefined,
        },
        { token },
      )
      setAssistantAnswer(resp)
    } catch (e) {
      setAssistantErr(e instanceof Error ? e.message : 'Assistent konnte nicht antworten.')
    } finally {
      setAssistantLoading(false)
    }
  }

  const participantMarkers: MapParticipantMarker[] = useMemo(() => {
    const groupFilterActive = mapGroupFilter !== 'all'
    const base = participants.map((p) => {
      let inGroupRange: boolean | undefined
      if (groupFilterActive && myPos && user && p.userId !== user.id) {
        inGroupRange = haversineKm(myPos, { lat: p.lat, lng: p.lng }) <= GROUP_PEER_NEARBY_KM
      }
      return {
        userId: p.userId,
        displayName: p.displayName,
        mapIcon:
          user && p.userId === user.id ? normalizeMapIconId(user.mapIcon) : normalizeMapIconId(p.mapIcon),
        lat: p.lat,
        lng: p.lng,
        inGroupRange,
      }
    })
    if (!user || !showSelfMarker) return base
    const selfLatLng =
      myPos ?? (gpsTestMode && testGpsPosition ? testGpsPosition : gpsTestMode ? BERLIN_CENTER_DEG : null)
    if (!selfLatLng) return base
    if (base.some((m) => m.userId === user.id)) return base
    return [
      {
        userId: user.id,
        displayName: user.displayName,
        mapIcon: normalizeMapIconId(user.mapIcon),
        lat: selfLatLng.lat,
        lng: selfLatLng.lng,
        inGroupRange: undefined,
      },
      ...base,
    ]
  }, [participants, mapGroupFilter, myPos, user, showSelfMarker, gpsTestMode, testGpsPosition])

  const tollVehicleResolved = useMemo(
    () => resolveTollVehicleClass(user?.tollVehicleClass, user?.mapIcon),
    [user?.tollVehicleClass, user?.mapIcon],
  )
  const tollVehicleLabel = useMemo(() => {
    if (tollVehicleResolved === 'car') return 'Pkw'
    if (tollVehicleResolved === 'motorcycle') return 'Motorrad'
    if (tollVehicleResolved === 'heavy') return 'Schwer / Nutzfahrzeug'
    return 'Sonstiges'
  }, [tollVehicleResolved])

  const routeTollSnapshotKey = useMemo(() => {
    if (!routeGeometry?.coordinates?.length || !tollAdvice?.countries?.length) return null
    const coords = routeGeometry.coordinates
    const a = coords[0]
    const b = coords[coords.length - 1]
    const codes = tollAdvice.countries.map((c) => c.code).join(',')
    return `${a[0]},${a[1]}|${b[0]},${b[1]}|${codes}`
  }, [routeGeometry, tollAdvice])

  const openVignetteServiceModal = useCallback(
    async (opts?: { advice?: RouteTollAdviceDto | null; routeLabel?: string | null }) => {
      if (!token) {
        navigate('/login')
        return
      }
      const adv = opts?.advice ?? tollAdvice
      if (!adv?.countries?.length) return
      setVignetteAdviceForModal(adv)
      setVignetteRouteLabelForModal(
        opts && 'routeLabel' in opts ? (opts.routeLabel ?? null) : (navTarget?.label ?? null),
      )
      setVignetteMsg(null)
      setVignetteModalOpen(true)
      setVignetteBusy(true)
      try {
        const { products } = await fetchVignetteServiceProducts()
        setVignetteCatalog(products)
        const codes = new Set(adv.countries.map((c) => c.code))
        const vc = adv.vehicleClass
        const el = products.filter(
          (p) => codes.has(p.countryCode) && (p.vehicleClass === 'all' || p.vehicleClass === vc),
        )
        setVignetteSelected(el.map((p) => p.id))
        if (el.length === 0) {
          setVignetteMsg('Für die ermittelten Länder gibt es noch keine buchbaren Service-Produkte (Admin-Pflege).')
        }
      } catch (e) {
        setVignetteMsg(e instanceof Error ? e.message : 'Katalog konnte nicht geladen werden.')
      } finally {
        setVignetteBusy(false)
      }
    },
    [token, navigate, tollAdvice, navTarget?.label],
  )

  useEffect(() => {
    if (!routeGeometry?.coordinates?.length) vignetteAutoOpenedRouteKeyRef.current = null
  }, [routeGeometry?.coordinates?.length])

  /** Mit aktiver Route: Vignetten-Übersicht automatisch im Modal, sobald Länder/Maut-Hinweise da sind (nicht unten in der Route-Leiste verstecken). */
  useEffect(() => {
    if (!routeTollSnapshotKey || !token) return
    if (tollAdviceLoading || tollAdviceErr) return
    if (!tollAdvice?.countries?.length) return
    if (vignetteModalOpen) return
    if (vignetteAutoOpenedRouteKeyRef.current === routeTollSnapshotKey) return
    vignetteAutoOpenedRouteKeyRef.current = routeTollSnapshotKey
    void openVignetteServiceModal()
  }, [
    routeTollSnapshotKey,
    token,
    tollAdviceLoading,
    tollAdviceErr,
    tollAdvice,
    vignetteModalOpen,
    openVignetteServiceModal,
  ])

  async function submitVignetteOrderRequest() {
    if (!token || !vignetteAdviceForModal || vignetteSelected.length < 1) return
    setVignetteBusy(true)
    setVignetteMsg(null)
    try {
      await createVignetteOrderRequest(token, {
        vehicleClass: vignetteAdviceForModal.vehicleClass,
        countries: vignetteAdviceForModal.countries,
        routeLabel: vignetteRouteLabelForModal ? `Route nach ${vignetteRouteLabelForModal}` : 'Geplante Route',
        productIds: vignetteSelected,
        customerNote: vignetteNote.trim(),
      })
      setVignetteMsg(
        'Anfrage gesendet. Du erhältst eine E-Mail-Bestätigung (falls E-Mail konfiguriert ist). Unser Team meldet sich mit dem Gesamtangebot; danach zahlst du kumuliert einen Betrag unter Profil → Vignetten & Maut (Stripe/PayPal).',
      )
      window.setTimeout(() => {
        setVignetteModalOpen(false)
        setVignetteAdviceForModal(null)
        setVignetteRouteLabelForModal(null)
        setVignetteNote('')
      }, 2200)
    } catch (e) {
      setVignetteMsg(e instanceof Error ? e.message : 'Senden fehlgeschlagen.')
    } finally {
      setVignetteBusy(false)
    }
  }

  function toggleVignetteProduct(id: string) {
    setVignetteSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  const vignetteEligibleInModal = useMemo(() => {
    if (!vignetteAdviceForModal?.countries?.length) return []
    const codes = new Set(vignetteAdviceForModal.countries.map((c) => c.code))
    const vc = vignetteAdviceForModal.vehicleClass
    return vignetteCatalog.filter(
      (p) => codes.has(p.countryCode) && (p.vehicleClass === 'all' || p.vehicleClass === vc),
    )
  }, [vignetteAdviceForModal, vignetteCatalog])

  const vignetteQuoteBreakdown = useMemo(() => {
    const items = vignetteEligibleInModal.filter((p) => vignetteSelected.includes(p.id))
    let sumService = 0
    let sumRetailHint = 0
    for (const p of items) {
      sumService += p.serviceFeeEur
      if (p.retailHintEur != null) sumRetailHint += p.retailHintEur
    }
    return {
      items,
      sumService,
      sumRetailHint,
      sumIndicative: sumService + sumRetailHint,
    }
  }, [vignetteEligibleInModal, vignetteSelected])

  const othersCount = user ? participants.filter((p) => p.userId !== user.id).length : participants.length

  const navAlongState = useMemo(() => {
    if (!routeGeometry?.coordinates?.length || !myPos) return null
    const coords = routeGeometry.coordinates
    const raw = closestAlongPolyline(coords, myPos.lng, myPos.lat)
    const snap = snapPositionForNavigation(coords, myPos.lng, myPos.lat, NAV_SNAP_MAX_M + 15)
    const alongForUi = snap.didSnap ? snap.alongM : raw.alongM
    const totalM = totalPolylineLengthM(coords)
    const maneuver = maneuverDisplay(routeSteps, alongForUi, totalM)
    const remainingM = Math.max(0, totalM - raw.alongM)
    return {
      alongM: raw.alongM,
      distToRouteM: raw.distToRouteM,
      totalM,
      remainingM,
      maneuver,
      primaryStep: routeSteps[maneuver.primaryIndex],
    }
  }, [routeGeometry, myPos, routeSteps])

  useEffect(() => {
    if (!navAutoRerouteEnabled || !routeGeometry?.coordinates?.length || !navTarget || routeLoading) return
    const d = navAlongState?.distToRouteM
    if (d == null) {
      offRouteSinceRef.current = null
      return
    }
    const now = Date.now()
    if (d < OFF_ROUTE_AUTO_REROUTE_M) {
      offRouteSinceRef.current = null
      return
    }
    if (offRouteSinceRef.current == null) offRouteSinceRef.current = now
    if (now - offRouteSinceRef.current < OFF_ROUTE_STABLE_MS) return
    if (now - lastAutoRerouteAtRef.current < AUTO_REROUTE_COOLDOWN_MS) return
    lastAutoRerouteAtRef.current = now
    offRouteSinceRef.current = null
    if (navTtsEnabled) speakNavigationGerman('Route wird neu berechnet.')
    void computeRouteWithDest(navTarget, { silent: true })
  }, [
    navAutoRerouteEnabled,
    navAlongState?.distToRouteM,
    routeLoading,
    routeGeometry,
    navTarget,
    computeRouteWithDest,
    navTtsEnabled,
  ])

  useEffect(() => {
    if (!navWakeLockEnabled || !routeGeometry?.coordinates?.length) {
      void wakeLockSentinelRef.current?.release()
      wakeLockSentinelRef.current = null
      return
    }
    let cancelled = false
    const acquire = async () => {
      await wakeLockSentinelRef.current?.release()
      wakeLockSentinelRef.current = null
      if (cancelled) return
      const s = await requestScreenWakeLock()
      if (!cancelled) wakeLockSentinelRef.current = s
    }
    void acquire()
    const onVis = () => {
      if (document.visibilityState === 'visible') void acquire()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVis)
      void wakeLockSentinelRef.current?.release()
      wakeLockSentinelRef.current = null
    }
  }, [navWakeLockEnabled, routeGeometry])

  useEffect(() => {
    if (!navTtsEnabled) return
    if (!navAlongState?.primaryStep || !routeGeometry?.coordinates?.length) {
      if (!routeGeometry?.coordinates?.length) {
        ttsPrevManeuverIdxRef.current = -1
        ttsPrevDistRef.current = null
      }
      return
    }
    const idx = navAlongState.maneuver.primaryIndex
    const dist = navAlongState.maneuver.metersUntilStepEnd
    const text = (navAlongState.primaryStep.text ?? '').trim()
    const prevIdx = ttsPrevManeuverIdxRef.current
    const prevDist = ttsPrevDistRef.current
    if (prevIdx !== idx) {
      ttsPrevManeuverIdxRef.current = idx
      ttsPrevDistRef.current = dist
      if (dist > 15 && text) {
        speakNavigationGerman(`In ${metersSpokenGerman(dist)}, ${text}`)
      }
      return
    }
    if (prevDist != null) {
      for (const threshold of [200, 100, 50] as const) {
        if (prevDist > threshold && dist <= threshold && dist > 12) {
          speakNavigationGerman(`In ${metersSpokenGerman(threshold)}`)
          break
        }
      }
    }
    ttsPrevDistRef.current = dist
  }, [navTtsEnabled, navAlongState, routeGeometry])

  useEffect(() => {
    return () => {
      stopNavigationVoice()
      void wakeLockSentinelRef.current?.release()
      wakeLockSentinelRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!routeGeometry?.coordinates?.length) {
      setTollAdvice(null)
      setTollAdviceErr(null)
      setTollAdviceLoading(false)
      return
    }
    const ac = new AbortController()
    const run = async () => {
      setTollAdviceLoading(true)
      setTollAdviceErr(null)
      try {
        const vc = resolveTollVehicleClass(user?.tollVehicleClass, user?.mapIcon)
        const data = await fetchRouteTollAdvice(routeGeometry, vc, token, { signal: ac.signal })
        if (!ac.signal.aborted) setTollAdvice(data)
      } catch (e) {
        if (!ac.signal.aborted) {
          setTollAdvice(null)
          setTollAdviceErr(e instanceof Error ? e.message : 'Vignetten-Infos konnten nicht geladen werden.')
        }
      } finally {
        if (!ac.signal.aborted) setTollAdviceLoading(false)
      }
    }
    void run()
    return () => ac.abort()
  }, [routeGeometry, user?.tollVehicleClass, user?.mapIcon, token])

  useEffect(() => {
    if (!routeGeometry?.coordinates?.length) {
      setRouteBriefing(null)
      setRouteBriefingErr(null)
      setRouteBriefingLoading(false)
      setAssistantAnswer(null)
      setAssistantErr(null)
      setNavHudExpanded(false)
      return
    }
    const ac = new AbortController()
    const run = async () => {
      setRouteBriefingLoading(true)
      setRouteBriefingErr(null)
      try {
        const vc = resolveTollVehicleClass(user?.tollVehicleClass, user?.mapIcon)
        const data = await fetchRouteBriefing(routeGeometry, vc, token, {
          signal: ac.signal,
          corridor: 'berlin_turkey',
        })
        if (!ac.signal.aborted) setRouteBriefing(data)
      } catch (e) {
        if (!ac.signal.aborted) {
          setRouteBriefing(null)
          setRouteBriefingErr(e instanceof Error ? e.message : 'Route-Briefing konnte nicht geladen werden.')
        }
      } finally {
        if (!ac.signal.aborted) setRouteBriefingLoading(false)
      }
    }
    void run()
    return () => ac.abort()
  }, [routeGeometry, user?.tollVehicleClass, user?.mapIcon, token])

  /** Unterkante bündig mit der Oberkante der festen Bottom-Navigation (`--bottom-nav-height`). */
  const navHudBottomStyle = useMemo((): CSSProperties => ({ bottom: BOTTOM_NAV_CSS }), [])
  /** Rechte FABs + linkes Info-Icon: über Nav-HUD bzw. direkt über der Tab-Leiste. */
  const mapFabColumnBottomStyle = useMemo((): CSSProperties => {
    if (routeGeometry?.coordinates?.length) {
      return {
        bottom: navHudExpanded
          ? `calc(${BOTTOM_NAV_CSS} + min(42vh, 17.5rem))`
          : `calc(${BOTTOM_NAV_CSS} + 3.25rem - 34px)`,
      }
    }
    return { bottom: `calc(${BOTTOM_NAV_CSS} + 0.625rem)` }
  }, [routeGeometry?.coordinates?.length, navHudExpanded])

  const mapLeftSheetBottomStyle = useMemo((): CSSProperties => ({ bottom: `calc(${BOTTOM_NAV_CSS} + 0.75rem)` }), [])

  return (
    <main className="relative h-[calc(100dvh-72px-96px)] w-full overflow-hidden">
      <div className="absolute inset-0 z-0 bg-surface-container">
        <MapLibreMap
          className="h-full w-full [&_.maplibregl-ctrl-top-left]:!mt-2 [&_.maplibregl-ctrl-top-left]:!ml-2 [&_.maplibregl-ctrl-attrib]:!text-[10px] [&_.maplibregl-ctrl-attrib]:!bg-surface-container-lowest/90"
          pois={pois}
          curatedPlaces={curatedPlaces}
          participants={participantMarkers}
          selfUserId={user?.id ?? null}
          showNavigationControls
          routeGeometry={routeGeometry}
          highlightDestination={navTarget ? { lat: navTarget.lat, lng: navTarget.lng } : null}
          highlightStart={manualRouteStart}
          mapPickTarget={mapPickTarget}
          onPickMapPoint={onPickMapPoint}
          onPoiMarkerClick={onPoiMarkerClick}
          onCuratedPlaceClick={onCuratedPlaceMarkerClick}
          onParticipantMarkerClick={onParticipantMarkerClick}
          onMoveEnd={onMoveEnd}
          onUserDirectMapInteraction={() => bumpNavPause(28_000)}
          onMapReady={(m) => {
            mapRef.current = m
            setMapEpoch((e) => e + 1)
          }}
        />
        <div className="pointer-events-none absolute top-0 left-0 z-[1] h-1 w-full bg-gradient-to-r from-tertiary via-secondary to-tertiary opacity-80" />
        {!mapPickTarget ? (
          <div
            className="pointer-events-auto absolute left-2 z-[8] flex flex-col items-start gap-2"
            style={{ bottom: `calc(${BOTTOM_NAV_CSS} + 4.25rem)` }}
          >
            {!tippsFilterOpen ? (
              <button
                type="button"
                onClick={() => setTippsFilterOpen(true)}
                title="Tipps-Filter"
                aria-expanded={false}
                aria-label="Tipps-Filter öffnen"
                className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-outline-variant/50 bg-surface-container-lowest/95 text-amber-600 shadow-lg backdrop-blur-md transition-transform active:scale-95 dark:border-outline-variant/35 dark:text-amber-400"
              >
                <span
                  className="material-symbols-outlined text-[28px]"
                  style={{ fontVariationSettings: curatedCategoryFilter ? "'FILL' 1" : "'FILL' 0" }}
                >
                  star
                </span>
                {curatedCategoryFilter ? (
                  <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-primary ring-2 ring-surface-container-lowest" />
                ) : null}
              </button>
            ) : (
              <div className="w-[min(calc(100vw-4.5rem),18rem)] rounded-2xl border border-outline-variant/50 bg-surface-container-lowest/95 p-2 shadow-lg backdrop-blur-md">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-on-surface-variant">Tipps (Admin)</p>
                  <button
                    type="button"
                    onClick={() => setTippsFilterOpen(false)}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container-high"
                    aria-label="Tipps-Filter schließen"
                  >
                    <span className="material-symbols-outlined text-xl">close</span>
                  </button>
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {(
                    [
                      { k: '' as const, lab: 'Alle' },
                      { k: 'accommodation' as const, lab: 'Unterkunft' },
                      { k: 'restaurant' as const, lab: 'Restaurant' },
                      { k: 'rest_area' as const, lab: 'Rasthof' },
                    ] as const
                  ).map(({ k, lab }) => (
                    <button
                      key={k || 'all'}
                      type="button"
                      onClick={() => setCuratedCategoryFilter(k)}
                      className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${
                        curatedCategoryFilter === k
                          ? 'bg-primary text-on-primary'
                          : 'bg-surface-container-high text-on-surface-variant'
                      }`}
                    >
                      {lab}
                    </button>
                  ))}
                </div>
                <p className="mt-1 text-[9px] text-on-surface-variant">
                  {curatedPlaces.length} Ort{curatedPlaces.length === 1 ? '' : 'e'} · Marker antippen für Infos & Route
                </p>
              </div>
            )}
          </div>
        ) : null}
      </div>

      {routeGeometry?.coordinates?.length ? (
        <div
          className="pointer-events-none absolute left-1/2 z-[15] flex max-w-[calc(100vw-1rem)] -translate-x-1/2 flex-col items-center"
          style={navHudBottomStyle}
        >
          <div className={navHudExpanded ? 'flex w-[min(100%-1rem,26rem)] flex-col items-stretch' : 'flex flex-col items-center'}>
            {!navHudExpanded ? (
              <div className="pointer-events-auto flex flex-col items-center gap-2">
                {navAlongState && navAlongState.distToRouteM >= NAV_OFF_ROUTE_WARN_M ? (
                  <button
                    type="button"
                    onClick={() => setNavHudExpanded(true)}
                    className={
                      navAlongState.distToRouteM >= NAV_OFF_ROUTE_SEVERE_M
                        ? 'max-w-[min(18rem,calc(100vw-2rem))] rounded-xl border border-error/50 bg-error/15 px-3 py-2 text-left text-[11px] font-bold text-on-surface shadow-md backdrop-blur-sm'
                        : 'max-w-[min(18rem,calc(100vw-2rem))] rounded-xl border border-amber-600/45 bg-amber-500/12 px-3 py-2 text-left text-[11px] font-bold text-on-surface shadow-md backdrop-blur-sm dark:border-amber-400/40'
                    }
                  >
                    {navAlongState.distToRouteM >= NAV_OFF_ROUTE_SEVERE_M
                      ? 'Weit von der Route – tippen für Optionen.'
                      : 'Etwas abseits der Route – tippen für Details.'}
                  </button>
                ) : null}
                {navUserPausedMap && navFollowActive ? (
                  <button
                    type="button"
                    onClick={() => setNavHudExpanded(true)}
                    className="max-w-[min(18rem,calc(100vw-2rem))] rounded-xl bg-tertiary-container/95 px-3 py-2 text-left text-[11px] font-bold text-on-tertiary-container shadow-md backdrop-blur-sm"
                  >
                    Führung pausiert – tippen zum Fortsetzen.
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => setNavHudExpanded(true)}
                  title={
                    navAlongState
                      ? `${navAlongState.primaryStep?.text ?? 'Navigation'} · noch ca. ${formatRouteDist(navAlongState.remainingM)}`
                      : 'Navigation anzeigen'
                  }
                  aria-label={
                    navAlongState?.primaryStep?.text
                      ? `Navigation: ${navAlongState.primaryStep.text}. Öffnen für Details.`
                      : 'Navigation öffnen'
                  }
                  className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-2 border-primary/40 bg-surface-container-lowest/98 shadow-2xl ring-2 ring-primary/15 backdrop-blur-md active:scale-95"
                >
                  <span
                    className="material-symbols-outlined text-[26px] text-primary"
                    style={{ fontVariationSettings: "'FILL' 1" }}
                  >
                    navigation
                  </span>
                  {navAlongState && navAlongState.distToRouteM >= NAV_OFF_ROUTE_SEVERE_M ? (
                    <span className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-error shadow ring-2 ring-surface-container-lowest" />
                  ) : navAlongState && navAlongState.distToRouteM >= NAV_OFF_ROUTE_WARN_M ? (
                    <span className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-amber-500 shadow ring-2 ring-surface-container-lowest" />
                  ) : navUserPausedMap && navFollowActive ? (
                    <span className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-tertiary shadow ring-2 ring-surface-container-lowest" />
                  ) : null}
                </button>
              </div>
            ) : (
              <div className="pointer-events-auto w-full rounded-2xl border border-outline-variant/50 bg-surface-container-lowest/98 p-3 shadow-2xl backdrop-blur-md">
                {navAlongState && navAlongState.distToRouteM >= NAV_OFF_ROUTE_WARN_M ? (
                  <div
                    className={
                      navAlongState.distToRouteM >= NAV_OFF_ROUTE_SEVERE_M
                        ? 'mb-3 rounded-xl border border-error/50 bg-error/10 px-3 py-2'
                        : 'mb-3 rounded-xl border border-amber-600/40 bg-amber-500/10 px-3 py-2 dark:border-amber-400/35'
                    }
                  >
                    <p className="text-xs font-bold text-on-surface">
                      {navAlongState.distToRouteM >= NAV_OFF_ROUTE_SEVERE_M
                        ? 'Du bist weit von der Route – bitte neu planen.'
                        : 'Etwas abseits der Route.'}
                    </p>
                    <button
                      type="button"
                      onClick={() => requestRouteAgain()}
                      disabled={routeLoading || !navTarget}
                      className="mt-2 rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-on-primary disabled:opacity-50"
                    >
                      Route neu berechnen
                    </button>
                  </div>
                ) : null}
                {navUserPausedMap && navFollowActive ? (
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-tertiary-container/80 px-3 py-2">
                    <p className="text-xs font-semibold text-on-tertiary-container">Karte manuell verschoben – Führung pausiert.</p>
                    <button
                      type="button"
                      onClick={() => {
                        resumeNavigationGuidance()
                        window.setTimeout(() => runNavigationCameraRef.current('gps'), 120)
                      }}
                      className="shrink-0 rounded-lg bg-tertiary px-3 py-1.5 text-xs font-bold text-on-tertiary"
                    >
                      Zurück zur Führung
                    </button>
                  </div>
                ) : null}
                <div className="flex items-start gap-2">
                  <span className="material-symbols-outlined mt-0.5 shrink-0 text-3xl text-primary" style={{ fontVariationSettings: "'FILL' 1" }}>
                    navigation
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-[0.65rem] font-bold uppercase tracking-wide text-on-surface-variant">Navigation</p>
                      <button
                        type="button"
                        onClick={() => setNavHudExpanded(false)}
                        className="rounded-lg border border-outline-variant/40 px-2 py-0.5 text-[10px] font-bold text-on-surface-variant"
                      >
                        Einklappen
                      </button>
                    </div>
                    {navAlongState ? (
                      <div
                        className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface-container-high"
                        title="Streckenfortschritt"
                      >
                        <div
                          className="h-full rounded-full bg-primary transition-[width] duration-500 ease-out"
                          style={{ width: `${Math.round(navAlongState.maneuver.routeProgress * 100)}%` }}
                        />
                      </div>
                    ) : null}
                    {myPos ? (
                      <>
                        <p className="mt-2 line-clamp-3 text-base font-bold leading-snug text-on-surface">
                          {navAlongState?.primaryStep?.text ?? 'Folge der blauen Linie.'}
                        </p>
                        {navAlongState && navAlongState.maneuver.metersUntilStepEnd > 12 ? (
                          <p className="mt-1 text-lg font-black tabular-nums text-primary">
                            in {formatRouteDist(navAlongState.maneuver.metersUntilStepEnd)}
                          </p>
                        ) : null}
                        {navAlongState?.maneuver.secondaryText ? (
                          <p className="mt-1 line-clamp-2 text-sm text-on-surface-variant">
                            Danach: {navAlongState.maneuver.secondaryText}
                          </p>
                        ) : null}
                        {navAlongState ? (
                          <p className="mt-1 text-xs text-on-surface-variant">
                            Ziel noch ca. {formatRouteDist(navAlongState.remainingM)}
                            {routeMeta ? (
                              <span> · {formatRouteDuration(Math.max(60, (navAlongState.remainingM / Math.max(navAlongState.totalM, 1)) * routeMeta.durationS))}</span>
                            ) : null}
                            {navAlongState.distToRouteM > 35 && navAlongState.distToRouteM < NAV_OFF_ROUTE_WARN_M ? (
                              <span className="text-on-surface-variant"> · {formatRouteDist(navAlongState.distToRouteM)} von der Linie</span>
                            ) : null}
                          </p>
                        ) : null}
                      </>
                    ) : (
                      <p className="mt-0.5 text-sm font-medium text-on-surface-variant">
                        Warte auf GPS… (Standortfreigabe) oder nutze die Routen-Optionen unten.
                      </p>
                    )}
                  </div>
                </div>
                <div className="mt-3 border-t border-outline-variant/25 pt-3">
                  <p className="text-[0.65rem] font-bold uppercase tracking-wide text-on-surface-variant">Reise-KI</p>
                  <p className="mt-0.5 text-[11px] text-on-surface-variant">
                    Frage zu Route, Ländern oder Maut – nutzt dasselbe Modell wie unter „Routen-Optionen“ (
                    <code className="rounded bg-surface-container-high px-0.5 text-[10px]">AI_MODEL</code> / API).
                  </p>
                  <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                    <input
                      type="text"
                      value={assistantQuestion}
                      onChange={(e) => setAssistantQuestion(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          void runAssistantAsk()
                        }
                      }}
                      placeholder="z. B. Wo in Serbien tanken?"
                      className="min-w-0 flex-1 rounded-lg border border-outline-variant/40 bg-surface-container-low px-2.5 py-2 text-xs"
                    />
                    <button
                      type="button"
                      onClick={() => void runAssistantAsk()}
                      disabled={assistantLoading}
                      className="shrink-0 rounded-lg bg-primary px-3 py-2 text-xs font-bold text-on-primary disabled:opacity-50"
                    >
                      {assistantLoading ? '…' : 'KI fragen'}
                    </button>
                  </div>
                  {assistantErr ? <p className="mt-1 text-[11px] font-medium text-error">{assistantErr}</p> : null}
                  {assistantAnswer ? (
                    <div className="mt-2 max-h-36 overflow-y-auto rounded-lg bg-surface-container-high/60 px-2.5 py-2">
                      <p className="whitespace-pre-wrap text-[11px] leading-relaxed text-on-surface">{assistantAnswer.answer}</p>
                      {assistantAnswer.usedModel ? (
                        <p className="mt-1 text-[9px] text-on-surface-variant">Modell: {assistantAnswer.usedModel}</p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                <div className="mt-3 flex flex-wrap gap-2 border-t border-outline-variant/20 pt-2">
                  <label className="flex cursor-pointer items-center gap-2 text-xs font-bold text-on-surface">
                    <input
                      type="checkbox"
                      checked={navFollowActive}
                      onChange={(e) => {
                        const on = e.target.checked
                        setNavFollowActive(on)
                        if (!on) {
                          mapRef.current?.easeTo({ bearing: 0, pitch: 0, duration: 750, essential: true })
                        }
                      }}
                      className="h-4 w-4 rounded border-outline-variant accent-primary"
                    />
                    Auto-Führung (GPS + alle {NAV_CAMERA_HEARTBEAT_MS / 1000}s)
                  </label>
                  <label className="flex cursor-pointer items-center gap-2 text-xs font-bold text-on-surface">
                    <input
                      type="checkbox"
                      checked={navTtsEnabled}
                      onChange={(e) => setNavTtsEnabledPersist(e.target.checked)}
                      className="h-4 w-4 rounded border-outline-variant accent-primary"
                    />
                    Sprachansagen
                  </label>
                  <label className="flex cursor-pointer items-center gap-2 text-xs font-bold text-on-surface">
                    <input
                      type="checkbox"
                      checked={navWakeLockEnabled}
                      onChange={(e) => setNavWakeLockEnabledPersist(e.target.checked)}
                      className="h-4 w-4 rounded border-outline-variant accent-primary"
                    />
                    Bildschirm wachhalten
                  </label>
                  <label className="flex cursor-pointer items-center gap-2 text-xs font-bold text-on-surface">
                    <input
                      type="checkbox"
                      checked={navAutoRerouteEnabled}
                      onChange={(e) => setNavAutoRerouteEnabledPersist(e.target.checked)}
                      className="h-4 w-4 rounded border-outline-variant accent-primary"
                    />
                    Neu planen bei Abweichung
                  </label>
                  <button
                    type="button"
                    onClick={() => fitWholeRouteOnMap()}
                    className="rounded-full border border-outline-variant/60 px-3 py-1 text-xs font-bold text-on-surface"
                  >
                    Gesamte Route
                  </button>
                  <button
                    type="button"
                    onClick={() => setNavPanelOpen(true)}
                    className="rounded-full bg-primary/15 px-3 py-1 text-xs font-bold text-primary"
                  >
                    Routen-Optionen
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm('Navigation wirklich beenden? Route und Ziel werden gelöscht.')) {
                        endNavigation()
                      }
                    }}
                    className="rounded-full border border-error/50 bg-error/10 px-3 py-1 text-xs font-bold text-error"
                  >
                    Navigation beenden
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : null}

      {/* Route wie üblich: Wohin suchen → Start = Standort (anpassbar) → Linie sofort */}
      <div className="pointer-events-none absolute top-3 right-0 left-0 z-10 flex justify-center px-2 pl-14 sm:pl-4">
        {!navPanelOpen ? (
          <button
            type="button"
            onClick={() => setNavPanelOpen(true)}
            className="pointer-events-auto flex w-full max-w-md items-center gap-2 rounded-full border border-outline-variant/50 bg-surface-container-lowest/95 py-2 pr-3 pl-3 shadow-[0_8px_32px_rgba(26,28,28,0.12)] backdrop-blur-xl"
            aria-expanded={false}
            aria-label="Route planen"
          >
            <span className="material-symbols-outlined shrink-0 text-primary text-[22px]">directions</span>
            <div className="min-w-0 flex-1 text-left">
              <span className="block truncate text-sm font-bold text-on-surface">
                {navTarget ? `Nach: ${navTarget.label}` : 'Wohin? Route planen'}
              </span>
              {routeMeta ? (
                <span className="block truncate text-xs font-semibold text-primary">
                  {formatRouteDist(routeMeta.distanceM)} · {formatRouteDuration(routeMeta.durationS)}
                </span>
              ) : null}
            </div>
            <span className="material-symbols-outlined shrink-0 text-on-surface-variant">expand_more</span>
          </button>
        ) : (
          <div className="pointer-events-auto w-full max-w-md">
            <div className="flex max-h-[min(70dvh,28rem)] flex-col overflow-hidden rounded-[1.25rem] bg-surface-container-lowest/95 shadow-[0_8px_32px_rgba(26,28,28,0.12)] backdrop-blur-3xl">
              <div className="flex shrink-0 items-start gap-2 border-b border-outline-variant/30 p-3">
                <span className="material-symbols-outlined mt-0.5 shrink-0 text-primary text-[26px]">directions</span>
                <div className="min-w-0 flex-1">
                  <p className="text-[0.7rem] font-bold uppercase tracking-wide text-on-surface-variant">Route</p>
                  <p className="font-sans text-sm font-bold text-on-surface">
                    {navTarget ? `Nach ${navTarget.label}` : 'Ziel eingeben – Start ist dein Standort'}
                  </p>
                  {routeMeta ? (
                    <p className="mt-1 text-sm font-semibold text-primary">
                      {formatRouteDist(routeMeta.distanceM)} · ca. {formatRouteDuration(routeMeta.durationS)}
                    </p>
                  ) : null}
                  {routeErr ? <p className="mt-1 text-xs font-medium text-error">{routeErr}</p> : null}
                </div>
                <button
                  type="button"
                  onClick={closeNavPanel}
                  className="shrink-0 rounded-xl p-2 text-on-surface-variant hover:bg-surface-container-high"
                  aria-label="Schließen"
                >
                  <span className="material-symbols-outlined text-[22px]">close</span>
                </button>
              </div>

              <div className="min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-y-contain px-3 pt-3 pb-3 [-webkit-overflow-scrolling:touch]">
                <label className="mb-1 block text-[0.65rem] font-bold uppercase text-on-surface-variant">Wohin?</label>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
                  <input
                    type="search"
                    value={destSearchQuery}
                    onChange={(e) => setDestSearchQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        void runDestPlaceSearch()
                      }
                    }}
                    placeholder="Ort oder Adresse suchen…"
                    className="min-w-0 flex-1 rounded-xl border border-outline-variant/50 bg-surface-container-low px-3 py-2.5 text-sm text-on-surface"
                    autoComplete="off"
                    enterKeyHint="search"
                  />
                  <button
                    type="button"
                    disabled={destSearchLoading}
                    onClick={() => void runDestPlaceSearch()}
                    className="shrink-0 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-on-primary disabled:opacity-50"
                  >
                    {destSearchLoading ? '…' : 'Suchen'}
                  </button>
                </div>
                {destSearchErr ? <p className="mt-2 text-xs font-medium text-error">{destSearchErr}</p> : null}
                {destSearchResults.length > 0 ? (
                  <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto rounded-xl border border-outline-variant/40 bg-surface-container-low/80 p-1">
                    {destSearchResults.map((hit, i) => (
                      <li key={`${hit.lat}-${hit.lng}-${i}`}>
                        <button
                          type="button"
                          onClick={() => selectRouteDestination(hit)}
                          className="w-full rounded-lg px-2 py-2 text-left text-sm leading-snug text-on-surface hover:bg-primary/10"
                        >
                          {hit.label}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}

                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setMapPickTarget((t) => (t === 'to' ? null : 'to'))}
                    className={
                      mapPickTarget === 'to'
                        ? 'rounded-full bg-tertiary px-3 py-1.5 text-xs font-bold text-white ring-2 ring-amber-400'
                        : 'rounded-full border border-outline-variant/50 bg-surface-container-high px-3 py-1.5 text-xs font-bold text-on-surface'
                    }
                  >
                    {mapPickTarget === 'to' ? 'Ziel: Karte antippen…' : 'Ziel auf Karte'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setMapPickTarget((t) => (t === 'from' ? null : 'from'))}
                    className={
                      mapPickTarget === 'from'
                        ? 'rounded-full bg-tertiary px-3 py-1.5 text-xs font-bold text-white ring-2 ring-amber-400'
                        : 'rounded-full border border-outline-variant/50 bg-surface-container-high px-3 py-1.5 text-xs font-bold text-on-surface'
                    }
                  >
                    {mapPickTarget === 'from' ? 'Start: Karte antippen…' : 'Start auf Karte'}
                  </button>
                </div>

                <div className="mt-4 rounded-xl border border-outline-variant/30 bg-surface-container-low/50 p-2">
                  <button
                    type="button"
                    onClick={() => setStartSectionOpen((o) => !o)}
                    className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-2 text-left text-sm font-bold text-on-surface"
                  >
                    <span>
                      <span className="font-normal text-on-surface-variant">Von </span>
                      {manualRouteStart && manualStartLabel
                        ? manualStartLabel
                        : gpsTestMode && testGpsPosition
                          ? 'Test-GPS (simuliert)'
                          : 'Mein Standort / GPS'}
                    </span>
                    <span className="material-symbols-outlined text-on-surface-variant">
                      {startSectionOpen ? 'expand_less' : 'expand_more'}
                    </span>
                  </button>
                  {startSectionOpen ? (
                    <div className="border-t border-outline-variant/20 px-1 pt-2 pb-1">
                      <p className="mb-2 text-xs text-on-surface-variant">
                        Nur nötig, wenn du nicht vom aktuellen Standort starten willst.
                      </p>
                      <div className="flex flex-col gap-2 sm:flex-row">
                        <input
                          type="search"
                          value={startSearchQuery}
                          onChange={(e) => setStartSearchQuery(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault()
                              void runStartPlaceSearch()
                            }
                          }}
                          placeholder="Startort suchen…"
                          className="min-w-0 flex-1 rounded-lg border border-outline-variant/50 bg-surface-container-low px-2.5 py-2 text-xs"
                          autoComplete="off"
                        />
                        <button
                          type="button"
                          disabled={startSearchLoading}
                          onClick={() => void runStartPlaceSearch()}
                          className="shrink-0 rounded-lg bg-secondary-container px-3 py-2 text-xs font-bold text-on-secondary-container disabled:opacity-50"
                        >
                          {startSearchLoading ? '…' : 'Suchen'}
                        </button>
                      </div>
                      {startSearchResults.length > 0 ? (
                        <ul className="mt-2 max-h-32 space-y-1 overflow-y-auto rounded-lg border border-outline-variant/40 bg-surface-container-lowest p-1">
                          {startSearchResults.map((hit, i) => (
                            <li key={`st-${hit.lat}-${hit.lng}-${i}`}>
                              <button
                                type="button"
                                onClick={() => selectRouteStart(hit)}
                                className="w-full rounded-md px-2 py-1.5 text-left text-[11px] hover:bg-primary/10"
                              >
                                {hit.label}
                              </button>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                      {manualStartErr ? <p className="mt-1 text-xs text-error">{manualStartErr}</p> : null}
                      {manualRouteStart ? (
                        <button
                          type="button"
                          onClick={clearManualRouteStart}
                          className="mt-2 text-xs font-bold text-primary underline"
                        >
                          Wieder: Mein Standort
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>

                <p className="mt-3 text-[0.65rem] font-bold uppercase text-on-surface-variant">Schnellwahl</p>
                <div className="mt-1 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const dest = { lat: NAV_HORGOS.lat, lng: NAV_HORGOS.lng, label: NAV_HORGOS_LABEL }
                      saveRecentDestination(dest)
                      setRecentDestinations(readNavRecents())
                      applyNavTarget(dest)
                      void computeRouteWithDest(dest)
                    }}
                    className="rounded-full bg-surface-container-high px-3 py-1.5 text-xs font-bold text-on-surface"
                  >
                    Grenze Horgoš
                  </button>
                </div>
                {recentDestinations.length > 0 ? (
                  <div className="mt-3">
                    <p className="text-[0.65rem] font-bold uppercase text-on-surface-variant">Letzte Ziele</p>
                    <div className="mt-1 flex max-h-24 flex-wrap gap-1 overflow-y-auto">
                      {recentDestinations.map((d, i) => (
                        <button
                          key={`${d.lat}-${d.lng}-${i}`}
                          type="button"
                          onClick={() => {
                            const dest = { lat: d.lat, lng: d.lng, label: d.label }
                            saveRecentDestination(dest)
                            setRecentDestinations(readNavRecents())
                            applyNavTarget(dest)
                            setNavPanelOpen(true)
                            void computeRouteWithDest(dest)
                          }}
                          className="max-w-[11rem] truncate rounded-full border border-outline-variant/40 bg-surface-container-low px-2 py-1 text-left text-[11px] font-semibold"
                          title={d.label}
                        >
                          {d.label}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
                {mapPickTarget ? (
                  <p className="mt-2 text-xs font-medium text-amber-800 dark:text-amber-200">
                    {mapPickTarget === 'from'
                      ? 'Einmal auf die Karte tippen: Start (Von).'
                      : 'Einmal auf die Karte tippen: Ziel (Wohin).'}
                  </p>
                ) : null}

                {pois.length > 0 ? (
                  <div className="mt-3">
                    <p className="text-[0.65rem] font-bold uppercase text-on-surface-variant">In der Nähe</p>
                    <div className="mt-1 flex max-h-24 flex-wrap gap-1 overflow-y-auto">
                      {pois.slice(0, 14).map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => {
                            const dest = { lat: p.lat, lng: p.lng, label: p.name }
                            applyNavTarget(dest)
                            void computeRouteWithDest(dest)
                          }}
                          className={
                            p.category === 'hotel' || p.category === 'restaurant'
                              ? 'max-w-[10rem] truncate rounded-full border border-primary/35 bg-primary/10 px-2 py-1 text-left text-[11px] font-semibold text-primary'
                              : 'max-w-[9rem] truncate rounded-full border border-outline-variant/40 bg-surface-container-low px-2 py-1 text-left text-[11px] font-semibold'
                          }
                        >
                          {poiChipPrefix(p.category)}
                          {p.name}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}

                {participants.filter((p) => !user || p.userId !== user.id).length > 0 ? (
                  <div className="mt-3">
                    <p className="text-[0.65rem] font-bold uppercase text-on-surface-variant">Fahrer</p>
                    <div className="mt-1 flex max-h-20 flex-wrap gap-1 overflow-y-auto">
                      {participants
                        .filter((p) => !user || p.userId !== user.id)
                        .slice(0, 8)
                        .map((p) => (
                          <button
                            key={p.userId}
                            type="button"
                            onClick={() => openParticipantSheet(p)}
                            className="max-w-[9rem] truncate rounded-full border border-outline-variant/40 bg-primary/15 px-2 py-1 text-left text-[11px] font-semibold text-primary"
                          >
                            {p.displayName}
                          </button>
                        ))}
                    </div>
                  </div>
                ) : null}

                <div className="mt-4 flex flex-wrap gap-2 border-t border-outline-variant/20 pt-3">
                  <button
                    type="button"
                    disabled={routeLoading || !navTarget}
                    onClick={() => requestRouteAgain()}
                    className="rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-on-primary disabled:opacity-50"
                  >
                    {routeLoading ? 'Rechne…' : routeGeometry ? 'Route aktualisieren' : 'Route berechnen'}
                  </button>
                  {routeGeometry ? (
                    <>
                      <button
                        type="button"
                        onClick={clearRoute}
                        className="rounded-xl border border-outline-variant px-4 py-2.5 text-sm font-bold text-on-surface"
                      >
                        Linie ausblenden
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (window.confirm('Navigation beenden? Ziel, Route und Einstellungen auf der Karte werden zurückgesetzt.')) {
                            endNavigation()
                            closeNavPanel()
                          }
                        }}
                        className="rounded-xl border border-error/45 bg-error/10 px-4 py-2.5 text-sm font-bold text-error"
                      >
                        Navigation beenden
                      </button>
                    </>
                  ) : null}
                </div>

                {routeSteps.length > 0 ? (
                  <ol className="mt-3 max-h-36 list-decimal space-y-1.5 overflow-y-auto border-t border-outline-variant/30 py-2 pl-4 text-xs text-on-surface-variant">
                    {routeSteps.slice(0, 20).map((s, i) => (
                      <li key={i} className="pl-1">
                        <span className="text-on-surface">{s.text}</span>
                        {s.distanceM > 80 ? (
                          <span className="text-on-surface-variant"> · {formatRouteDist(s.distanceM)}</span>
                        ) : null}
                      </li>
                    ))}
                  </ol>
                ) : null}

                {routeGeometry?.coordinates?.length ? (
                  <div className="mt-4 rounded-xl border border-outline-variant/35 bg-surface-container-high/40 p-3">
                    <p className="text-[0.65rem] font-bold uppercase tracking-wide text-on-surface-variant">
                      Vignetten & Maut
                    </p>
                    <p className="mt-1 text-[11px] leading-snug text-on-surface-variant">
                      Übersicht, externe Kauf-Links und Kaufanfrage liegen im{' '}
                      <strong className="text-on-surface">Dialog</strong> – er öffnet mit der Route automatisch, sobald
                      die Länder entlang der Strecke ermittelt sind.
                    </p>
                    <p
                      className="mt-2 border-l-2 border-outline-variant/60 pl-2 text-[10px] leading-snug text-on-surface-variant"
                      role="note"
                    >
                      Fahrzeugklasse: {tollVehicleLabel} (
                      <Link to="/profile" className="font-bold text-primary underline">
                        Profil
                      </Link>
                      ).
                    </p>
                    {tollAdviceLoading ? (
                      <p className="mt-2 text-xs font-medium text-primary">Ermittle Länder entlang der Route…</p>
                    ) : null}
                    {tollAdviceErr ? <p className="mt-2 text-xs font-medium text-error">{tollAdviceErr}</p> : null}
                    {tollAdvice && tollAdvice.countries.length > 0 ? (
                      <p className="mt-2 text-xs font-semibold text-on-surface">
                        {tollAdvice.countries.map((c) => c.name).join(' → ')}
                      </p>
                    ) : null}
                    {tollAdvice && !tollAdviceLoading && tollAdvice.countries.length === 0 ? (
                      <p className="mt-2 text-xs text-on-surface-variant">Keine Länder ermittelt (Ortssuche).</p>
                    ) : null}
                    <button
                      type="button"
                      disabled={tollAdviceLoading || !tollAdvice?.countries?.length}
                      onClick={() => void openVignetteServiceModal()}
                      className="mt-3 w-full rounded-xl bg-secondary py-2.5 text-xs font-black text-on-secondary disabled:opacity-40"
                    >
                      {token ? 'Vignetten & Maut: Dialog öffnen' : 'Anmelden – Dialog mit Übersicht'}
                    </button>
                  </div>
                ) : null}

                <div className="mt-4 rounded-xl border border-outline-variant/35 bg-surface-container-high/40 p-3">
                  <p className="text-[0.65rem] font-bold uppercase tracking-wide text-on-surface-variant">
                    KI-Route-Briefing (Berlin → Türkiye)
                  </p>
                  <p className="mt-1 text-[11px] leading-snug text-on-surface-variant">
                    Kompakte Wissensbasis für Fahrer: Länderfakten, Maut-Hinweise und häufige Fragen.
                  </p>
                  <div className="mt-2 rounded-lg border border-outline-variant/25 bg-surface-container-lowest/70 p-2">
                    <label className="mb-1 block text-[11px] font-semibold text-on-surface-variant">
                      Frage an den Assistenten
                    </label>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <input
                        type="text"
                        value={assistantQuestion}
                        onChange={(e) => setAssistantQuestion(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            void runAssistantAsk()
                          }
                        }}
                        placeholder="z. B. Brauche ich mit Motorrad in Ungarn eine Vignette?"
                        className="min-w-0 flex-1 rounded-lg border border-outline-variant/40 bg-surface-container-low px-2.5 py-2 text-xs"
                      />
                      <button
                        type="button"
                        onClick={() => void runAssistantAsk()}
                        disabled={assistantLoading}
                        className="shrink-0 rounded-lg bg-primary px-3 py-2 text-xs font-bold text-on-primary disabled:opacity-50"
                      >
                        {assistantLoading ? 'Antwortet…' : 'Fragen'}
                      </button>
                    </div>
                    {assistantErr ? <p className="mt-1 text-xs font-medium text-error">{assistantErr}</p> : null}
                    {assistantAnswer ? (
                      <div className="mt-2 rounded-lg bg-surface-container-low px-2.5 py-2">
                        <p className="whitespace-pre-wrap text-xs leading-relaxed text-on-surface">{assistantAnswer.answer}</p>
                        {assistantAnswer.citations.length > 0 ? (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {assistantAnswer.citations.map((c, i) => (
                              <a
                                key={`${c}-${i}`}
                                href={c}
                                target="_blank"
                                rel="noreferrer"
                                className="rounded-full border border-outline-variant/40 bg-surface-container-high px-2 py-0.5 text-[10px] font-semibold text-primary"
                              >
                                Quelle ↗
                              </a>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                  {routeBriefingLoading ? (
                    <p className="mt-2 text-xs font-medium text-primary">Lade Briefing aus Wissensbasis…</p>
                  ) : null}
                  {routeBriefingErr ? (
                    <p className="mt-2 text-xs font-medium text-error">{routeBriefingErr}</p>
                  ) : null}
                  {routeBriefing?.countryFacts?.length ? (
                    <ul className="mt-2 space-y-1.5">
                      {routeBriefing.countryFacts.slice(0, 6).map((f) => (
                        <li key={`${f.countryCode}-${f.key}`} className="rounded-lg bg-surface-container-lowest/70 px-2 py-1.5">
                          <p className="text-xs font-bold text-on-surface">
                            {f.countryCode}: {f.title}
                          </p>
                          <p className="text-[11px] leading-snug text-on-surface-variant">{f.content}</p>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {routeBriefing?.tollOffers?.length ? (
                    <div className="mt-3">
                      <p className="text-[0.6rem] font-bold uppercase text-on-surface-variant">Passende Kauf-Links</p>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {routeBriefing.tollOffers.slice(0, 8).map((x) => (
                          <a
                            key={x.id}
                            href={x.purchaseUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="rounded-full border border-outline-variant/40 bg-surface-container-low px-2 py-1 text-[11px] font-semibold text-primary"
                            title={x.description}
                          >
                            {x.countryCode}: {x.title} ↗
                          </a>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  {routeBriefing?.faq?.length ? (
                    <div className="mt-3 border-t border-outline-variant/25 pt-2">
                      <p className="text-[0.6rem] font-bold uppercase text-on-surface-variant">Häufige Fragen</p>
                      <ul className="mt-1 space-y-1.5">
                        {routeBriefing.faq.slice(0, 4).map((q) => (
                          <li key={q.id} className="rounded-lg bg-surface-container-lowest/70 px-2 py-1.5">
                            <p className="text-xs font-bold text-on-surface">{q.question}</p>
                            <p className="text-[11px] leading-snug text-on-surface-variant">{q.answer}</p>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {routeBriefing?.disclaimer ? (
                    <p className="mt-2 text-[10px] leading-snug text-on-surface-variant">{routeBriefing.disclaimer}</p>
                  ) : null}
                </div>

                {gpsTestMode ? (
                  <div className="mt-4 rounded-xl border border-amber-600/40 bg-amber-500/10 p-3 dark:border-amber-400/40 dark:bg-amber-400/10">
                    <p className="text-[0.65rem] font-bold uppercase tracking-wide text-amber-900 dark:text-amber-100">
                      Testmodus: simulierter GPS-Standort
                    </p>
                    <p className="mt-1 text-xs text-on-surface-variant">
                      Koordinaten für die Route, wenn kein echtes GPS genutzt werden soll. Ohne Eintrag und ohne
                      GPS wird <span className="font-semibold text-on-surface">Berlin Mitte</span> als Start
                      verwendet (nur in diesem Modus).
                    </p>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <input
                        type="text"
                        inputMode="decimal"
                        value={testGpsLatInput}
                        onChange={(e) => setTestGpsLatInput(e.target.value)}
                        placeholder="Breite (lat)"
                        className="rounded-lg border border-outline-variant/50 bg-surface-container-low px-2 py-2 text-xs"
                        autoComplete="off"
                      />
                      <input
                        type="text"
                        inputMode="decimal"
                        value={testGpsLngInput}
                        onChange={(e) => setTestGpsLngInput(e.target.value)}
                        placeholder="Länge (lng)"
                        className="rounded-lg border border-outline-variant/50 bg-surface-container-low px-2 py-2 text-xs"
                        autoComplete="off"
                      />
                    </div>
                    {testGpsErr ? <p className="mt-2 text-xs font-medium text-error">{testGpsErr}</p> : null}
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={applyTestGpsInputs}
                        className="rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-on-primary"
                      >
                        Übernehmen
                      </button>
                      <button
                        type="button"
                        onClick={applyBerlinTestGps}
                        className="rounded-lg bg-secondary-container px-3 py-1.5 text-xs font-bold text-on-secondary-container"
                      >
                        Berlin Mitte
                      </button>
                      <button
                        type="button"
                        disabled={!testGpsPosition}
                        onClick={clearTestGps}
                        className="rounded-lg border border-outline-variant px-3 py-1.5 text-xs font-bold text-on-surface disabled:opacity-40"
                      >
                        Zurücksetzen
                      </button>
                    </div>
                    <p className="mt-3 text-[11px] leading-snug text-amber-950/90 dark:text-amber-50/95">
                      <span className="font-bold">API-Simulation:</span> Mit{' '}
                      <code className="rounded bg-black/10 px-1 py-0.5 text-[10px] dark:bg-white/10">SEED_MAP_SIMULATION=true</code>{' '}
                      starten legt die API fünf Nutzer (E-Mail <code className="text-[10px]">sim-*@yol.local</code>, Passwort{' '}
                      <code className="text-[10px]">sim123456</code>), drei Gruppen (Einladungscodes{' '}
                      <code className="text-[10px]">SIMKON01</code>, <code className="text-[10px]">SIMGRE01</code>,{' '}
                      <code className="text-[10px]">SIMFAM01</code>) und Kartenpositionen um Berlin an. Nach dem Seed mit einem Sim-Account
                      anmelden und Gruppe per Code beitreten.
                    </p>
                  </div>
                ) : null}

                <p className="mt-4 text-[10px] text-on-surface-variant">
                  ©{' '}
                  <a
                    href="https://www.openstreetmap.org/copyright"
                    target="_blank"
                    rel="noreferrer"
                    className="underline"
                  >
                    OpenStreetMap
                  </a>
                  {' · '}
                  <Link to="/border/horgos" className="font-bold text-primary underline">
                    Infos Horgoš
                  </Link>
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="pointer-events-none absolute inset-0 p-4 sm:p-6">
        {mapLeftInfoExpanded ? (
          <button
            type="button"
            aria-label="Infobereich schließen"
            className="pointer-events-auto fixed inset-0 z-[18] bg-black/25 backdrop-blur-[1px]"
            onClick={() => setMapLeftInfoExpanded(false)}
          />
        ) : null}

        {mapLeftInfoExpanded ? (
          <div
            className="pointer-events-auto fixed z-[19] w-[min(17rem,calc(100vw-2rem))] max-h-[min(58vh,calc(100dvh-11rem))] overflow-y-auto rounded-2xl border border-outline-variant/30 bg-inverse-surface/98 p-3 text-inverse-on-surface shadow-2xl backdrop-blur-md sm:left-6"
            style={{ ...mapLeftSheetBottomStyle, left: 'max(1rem, env(safe-area-inset-left))' }}
          >
            <div className="mb-2 flex items-start justify-between gap-2">
              <p className="font-sans text-[0.55rem] font-bold uppercase tracking-[0.08em] text-surface-dim">Gemeinsam auf der Karte</p>
              <button
                type="button"
                onClick={() => setMapLeftInfoExpanded(false)}
                className="rounded-lg border border-surface-variant/40 px-2 py-0.5 text-[10px] font-bold text-surface-dim hover:bg-surface-variant/15"
              >
                Schließen
              </button>
            </div>
            <p className="font-sans text-sm font-bold tabular-nums leading-tight">
              {participants.length} unterwegs
              {user && othersCount > 0 ? (
                <span className="font-medium text-surface-dim"> · {othersCount} andere</span>
              ) : null}
            </p>
            {user && myGroups.length > 0 ? (
              <label className="mt-2 block border-t border-surface-variant/25 pt-2">
                <span className="mb-0.5 block text-[0.55rem] font-bold uppercase tracking-wide text-surface-dim">
                  Wer angezeigt wird
                </span>
                <select
                  value={mapGroupFilter}
                  onChange={(e) => setMapGroupFilter(e.target.value === 'all' ? 'all' : e.target.value)}
                  className="w-full rounded-lg border border-surface-variant/35 bg-surface-container-lowest px-2 py-1 text-[11px] font-semibold text-inverse-on-surface"
                >
                  <option value="all">Alle in der Nähe</option>
                  {myGroups.map((g) => (
                    <option key={g.id} value={g.id}>
                      Nur: {g.name}
                    </option>
                  ))}
                </select>
                {mapGroupFilter !== 'all' && myPos ? (
                  <p className="mt-1 text-[9px] leading-tight text-surface-dim">
                    Grüner Ring: Gruppe in ca. {GROUP_PEER_NEARBY_KM} km – für Nah-Funk im Chat.
                  </p>
                ) : null}
              </label>
            ) : null}
            {user ? (
              <label className="mt-2 flex cursor-pointer items-start gap-1.5 border-t border-surface-variant/25 pt-2 text-[11px] font-medium leading-snug">
                <input
                  type="checkbox"
                  checked={showSelfMarker}
                  onChange={(e) => setShowSelfMarker(e.target.checked)}
                  className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded border-surface-variant accent-primary"
                />
                <span>Mich auf der Karte anzeigen (nur bei dir sichtbar, ohne andere zu informieren)</span>
              </label>
            ) : null}
            {user ? (
              <label className="mt-2 flex cursor-pointer items-start gap-1.5 border-t border-surface-variant/25 pt-2 text-[11px] font-medium leading-snug">
                <input
                  type="checkbox"
                  checked={shareOnMap}
                  onChange={(e) => void onToggleShare(e.target.checked)}
                  className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded border-surface-variant accent-primary"
                />
                <span>Position teilen</span>
              </label>
            ) : (
              <p className="mt-2 border-t border-surface-variant/25 pt-2 text-[10px] leading-snug text-surface-dim">
                <Link to="/login" className="font-bold text-primary-fixed-dim underline">
                  Anmelden
                </Link>{' '}
                zum Mitfahren.
              </p>
            )}
            {geoHint ? <p className="mt-1.5 text-[10px] font-medium leading-snug text-amber-200">{geoHint}</p> : null}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setMapLeftInfoExpanded(true)}
            className="pointer-events-auto absolute left-4 flex h-10 w-10 items-center justify-center rounded-full border border-outline-variant/35 bg-inverse-surface/95 text-inverse-on-surface shadow-lg backdrop-blur-sm active:scale-95 sm:left-6"
            style={mapFabColumnBottomStyle}
            aria-label="Gemeinsam auf der Karte: Details anzeigen"
            title="Teilnehmer und Freigaben"
          >
            <span className="material-symbols-outlined text-[22px]">groups</span>
            {participants.length > 0 ? (
              <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-0.5 text-[9px] font-black text-on-primary tabular-nums ring-2 ring-inverse-surface">
                {participants.length > 8 ? '8+' : participants.length}
              </span>
            ) : null}
          </button>
        )}

        <div className="pointer-events-auto absolute right-4 flex flex-col items-end sm:right-6" style={mapFabColumnBottomStyle}>
          <div className={mapRightFabExpanded ? 'flex flex-col items-end gap-2' : 'flex flex-col items-end gap-1.5'}>
            <button
              type="button"
              onClick={() => goToMyLocation()}
              className={
                mapRightFabExpanded
                  ? 'flex h-12 w-12 items-center justify-center rounded-full bg-primary text-on-primary shadow-xl ring-4 ring-primary/25 active:scale-95'
                  : 'flex h-10 w-10 items-center justify-center rounded-full bg-primary text-on-primary shadow-lg ring-2 ring-primary/20 active:scale-95'
              }
              aria-label="Karte auf meinen Standort zentrieren"
              title="Meine Position"
            >
              <span className={mapRightFabExpanded ? 'material-symbols-outlined text-2xl' : 'material-symbols-outlined text-xl'}>
                my_location
              </span>
            </button>
            <button
              type="button"
              onClick={() => {
                void loadPois(center.lat, center.lng)
                void loadParticipants(center.lat, center.lng)
              }}
              className={
                mapRightFabExpanded
                  ? 'flex h-11 w-11 items-center justify-center rounded-full bg-surface-container-lowest text-on-surface-variant shadow-lg active:scale-95'
                  : 'flex h-9 w-9 items-center justify-center rounded-full bg-surface-container-lowest text-on-surface-variant shadow-md active:scale-95'
              }
              aria-label="Karte aktualisieren"
            >
              <span className={mapRightFabExpanded ? 'material-symbols-outlined text-xl' : 'material-symbols-outlined text-lg'}>refresh</span>
            </button>
            <button
              type="button"
              onClick={openAddPoi}
              className={
                mapRightFabExpanded
                  ? 'flex h-11 w-11 items-center justify-center rounded-full bg-surface-container-lowest text-on-surface-variant shadow-lg active:scale-95'
                  : 'flex h-9 w-9 items-center justify-center rounded-full bg-surface-container-lowest text-on-surface-variant shadow-md active:scale-95'
              }
              aria-label="Ort eintragen"
            >
              <span className={mapRightFabExpanded ? 'material-symbols-outlined text-xl' : 'material-symbols-outlined text-lg'}>
                add_location_alt
              </span>
            </button>
            <Link
              to="/community"
              className={
                mapRightFabExpanded
                  ? 'flex h-11 w-11 items-center justify-center rounded-full bg-surface-container-lowest text-on-surface-variant shadow-lg active:scale-95'
                  : 'flex h-9 w-9 items-center justify-center rounded-full bg-surface-container-lowest text-on-surface-variant shadow-md active:scale-95'
              }
              aria-label="Community"
            >
              <span className={mapRightFabExpanded ? 'material-symbols-outlined text-xl' : 'material-symbols-outlined text-lg'}>forum</span>
            </Link>
            <button
              type="button"
              onClick={() => setHelpOpen(true)}
              className={
                mapRightFabExpanded
                  ? 'flex h-11 items-center gap-1.5 rounded-full bg-gradient-to-br from-error to-error-dark px-3.5 text-on-error shadow-lg active:scale-90'
                  : 'flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-error to-error-dark text-on-error shadow-md active:scale-90'
              }
              aria-label="Hilfe und Notfallkontakte (SOS)"
            >
              <span className="material-symbols-outlined fill text-base">sos</span>
              {mapRightFabExpanded ? (
                <span className="font-sans text-[10px] font-black tracking-widest">YARDIM</span>
              ) : null}
            </button>
            <button
              type="button"
              onClick={() => setMapRightFabExpanded((v) => !v)}
              className="flex h-8 w-8 items-center justify-center rounded-full border border-outline-variant/45 bg-surface-container-lowest/95 text-on-surface-variant shadow-md active:scale-95"
              aria-expanded={mapRightFabExpanded}
              aria-label={mapRightFabExpanded ? 'Kartenaktionen kompakt darstellen' : 'Kartenaktionen vergrößern'}
              title={mapRightFabExpanded ? 'Kompakt' : 'Größer / mehr'}
            >
              <span className="material-symbols-outlined text-lg">{mapRightFabExpanded ? 'unfold_less' : 'unfold_more'}</span>
            </button>
          </div>
        </div>
      </div>

      <HelpModal open={helpOpen} onClose={() => setHelpOpen(false)} />

      <CreatePoiModal
        open={poiModal}
        onClose={() => setPoiModal(false)}
        lat={center.lat}
        lng={center.lng}
        onCreated={(poi) => setPois((prev) => [poi, ...prev])}
      />

      <ParticipantActionModal
        open={participantSheet != null}
        onClose={() => setParticipantSheet(null)}
        participant={participantSheet}
        token={token}
        onRouteToParticipant={onRouteToParticipantFromSheet}
      />

      {curatedSheet ? (
        <div
          className="fixed inset-0 z-[70] flex items-end justify-center bg-black/45 p-4 sm:items-center"
          role="dialog"
          aria-modal
          aria-labelledby="curated-sheet-title"
        >
          <div className="max-h-[88vh] w-full max-w-md overflow-y-auto rounded-2xl border border-outline-variant bg-surface-container-lowest p-4 shadow-2xl">
            <h2 id="curated-sheet-title" className="text-lg font-black text-on-surface">
              {curatedSheet.name}
            </h2>
            <p className="mt-0.5 text-[11px] font-bold uppercase text-primary">
              {curatedSheet.category === 'accommodation'
                ? 'Unterkunft'
                : curatedSheet.category === 'restaurant'
                  ? 'Restaurant'
                  : 'Rasthof / Pause'}
            </p>
            {curatedSheet.imageUrl?.startsWith('http') ? (
              <img
                src={curatedSheet.imageUrl}
                alt=""
                className="mt-3 max-h-40 w-full rounded-xl object-cover"
              />
            ) : null}
            {curatedSheet.description ? (
              <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-on-surface-variant">{curatedSheet.description}</p>
            ) : null}
            <div className="mt-3 space-y-1 text-xs text-on-surface-variant">
              {[curatedSheet.address, curatedSheet.region].filter(Boolean).join(' · ') ? (
                <p>{[curatedSheet.address, curatedSheet.region].filter(Boolean).join(' · ')}</p>
              ) : null}
              {curatedSheet.phone ? <p>Tel.: {curatedSheet.phone}</p> : null}
              {curatedSheet.website?.startsWith('http') ? (
                <a
                  href={curatedSheet.website}
                  target="_blank"
                  rel="noreferrer"
                  className="font-bold text-primary underline"
                >
                  Webseite
                </a>
              ) : null}
            </div>
            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                onClick={() => navigateToCuratedPlace(curatedSheet)}
                disabled={routeLoading}
                className="flex-1 rounded-xl bg-primary py-3 text-sm font-bold text-on-primary disabled:opacity-40"
              >
                Route hierhin
              </button>
              <button
                type="button"
                onClick={() => setCuratedSheet(null)}
                className="flex-1 rounded-xl border border-outline-variant py-3 text-sm font-bold text-on-surface"
              >
                Schließen
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {vignetteModalOpen && vignetteAdviceForModal ? (
        <div
          className="fixed inset-0 z-[75] flex items-end justify-center bg-black/45 p-4 sm:items-center"
          role="dialog"
          aria-modal
          aria-labelledby="vignette-modal-title"
        >
          <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border border-outline-variant bg-surface-container-lowest p-4 shadow-2xl">
            <h2 id="vignette-modal-title" className="text-lg font-black text-on-surface">
              Vignetten-Service
            </h2>
            <p className="mt-1 text-xs text-on-surface-variant">
              Route: {vignetteAdviceForModal.countries.map((c) => c.name).join(' → ')} · Fahrzeug: {tollVehicleLabel}
            </p>

            <div className="mt-4 rounded-xl border border-outline-variant/40 bg-surface-container-high/25 p-3">
              <p className="text-[0.65rem] font-black uppercase tracking-wide text-on-surface-variant">
                Übersicht: Hinweise & direkte Anbieter
              </p>
              {vignetteAdviceForModal.products.length > 0 ? (
                <ul className="mt-2 space-y-2">
                  {vignetteAdviceForModal.products.map((p) => (
                    <li
                      key={p.id}
                      className="rounded-lg border border-outline-variant/30 bg-surface-container-lowest/90 p-2.5"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-bold text-on-surface">{p.title}</p>
                          <p className="mt-0.5 text-[11px] leading-snug text-on-surface-variant">{p.description}</p>
                          <p className="mt-1 text-[10px] uppercase text-on-surface-variant/80">
                            {p.type === 'vignette' ? 'Vignette' : p.type === 'toll' ? 'Maut' : 'Info'}
                          </p>
                        </div>
                        {p.purchaseUrl ? (
                          <a
                            href={p.purchaseUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="shrink-0 rounded-lg bg-primary px-3 py-1.5 text-[11px] font-bold text-on-primary"
                          >
                            Kaufen / Info ↗
                          </a>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-[11px] leading-snug text-on-surface-variant">
                  Für diese Route liegen keine verlinkten Vignetten-/Maut-Vorschläge vor. Du kannst trotzdem eine Anfrage
                  an unser Team stellen (unten).
                </p>
              )}
              {vignetteAdviceForModal.disclaimer ? (
                <p className="mt-2 text-[10px] leading-snug text-on-surface-variant">{vignetteAdviceForModal.disclaimer}</p>
              ) : null}
            </div>

            {vignetteBusy && vignetteEligibleInModal.length === 0 ? (
              <p className="mt-3 text-sm text-on-surface-variant">Katalog wird geladen…</p>
            ) : null}

            <div className="mt-4 rounded-xl border border-outline-variant/40 bg-surface-container-high/25 p-3">
              <p className="text-[0.65rem] font-black uppercase tracking-wide text-on-surface-variant">1. Leistungen wählen</p>
              <p className="mt-1 text-[11px] leading-snug text-on-surface-variant">
                Preise im Katalog (Service + Richtpreis-Hinweis) sind Orientierung. Das verbindliche Gesamtangebot legt
                das Team fest; du zahlst <strong className="text-on-surface">einen kumulierten Betrag</strong> pro
                Anfrage.
              </p>
              <div className="mt-2 space-y-2">
                {vignetteEligibleInModal.map((p) => (
                  <label
                    key={p.id}
                    className="flex cursor-pointer gap-3 rounded-xl border border-outline-variant/50 bg-surface-container-lowest/90 p-3"
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
                      checked={vignetteSelected.includes(p.id)}
                      onChange={() => toggleVignetteProduct(p.id)}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold text-on-surface">{p.title}</p>
                      <p className="text-[11px] text-on-surface-variant">
                        {p.countryCode} · {p.kind === 'vignette' ? 'Vignette' : p.kind === 'toll' ? 'Maut' : 'Info'}
                      </p>
                      {p.description ? (
                        <p className="mt-1 text-[11px] leading-snug text-on-surface-variant">{p.description}</p>
                      ) : null}
                    </div>
                  </label>
                ))}
              </div>
            </div>

            <div className="mt-3 rounded-xl border border-primary/20 bg-primary/5 p-3">
              <p className="text-[0.65rem] font-black uppercase tracking-wide text-primary">Kostenübersicht (Indikativ)</p>
              {vignetteQuoteBreakdown.items.length < 1 ? (
                <p className="mt-2 text-xs text-on-surface-variant">Noch keine Position gewählt.</p>
              ) : (
                <>
                  <table className="mt-2 w-full border-collapse text-left text-[11px]">
                    <thead>
                      <tr className="border-b border-outline-variant/40 text-on-surface-variant">
                        <th className="py-1 pr-2 font-bold">Position</th>
                        <th className="py-1 text-right font-bold">Service</th>
                        <th className="py-1 pl-2 text-right font-bold">Richtpreis</th>
                      </tr>
                    </thead>
                    <tbody>
                      {vignetteQuoteBreakdown.items.map((p) => (
                        <tr key={p.id} className="border-b border-outline-variant/25 text-on-surface">
                          <td className="max-w-[10rem] truncate py-1.5 pr-2" title={p.title}>
                            {p.title}
                          </td>
                          <td className="py-1.5 text-right tabular-nums">{p.serviceFeeEur.toFixed(2)} €</td>
                          <td className="py-1.5 pl-2 text-right tabular-nums text-on-surface-variant">
                            {p.retailHintEur != null ? `${p.retailHintEur.toFixed(2)} €` : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="mt-2 space-y-0.5 border-t border-outline-variant/35 pt-2 text-xs tabular-nums">
                    <div className="flex justify-between text-on-surface-variant">
                      <span>Summe Servicepauschalen</span>
                      <span className="font-semibold text-on-surface">{vignetteQuoteBreakdown.sumService.toFixed(2)} €</span>
                    </div>
                    <div className="flex justify-between text-on-surface-variant">
                      <span>Summe Richtpreis-Hinweise</span>
                      <span className="font-semibold text-on-surface">
                        {vignetteQuoteBreakdown.sumRetailHint > 0
                          ? `${vignetteQuoteBreakdown.sumRetailHint.toFixed(2)} €`
                          : '—'}
                      </span>
                    </div>
                    <div className="flex justify-between border-t border-outline-variant/30 pt-1.5 font-bold text-on-surface">
                      <span>Indikativ gesamt</span>
                      <span>{vignetteQuoteBreakdown.sumIndicative.toFixed(2)} €</span>
                    </div>
                  </div>
                </>
              )}
            </div>

            <div className="mt-3 rounded-xl border border-outline-variant/40 bg-surface-container-high/25 p-3">
              <p className="text-[0.65rem] font-black uppercase tracking-wide text-on-surface-variant">2. Nachricht ans Team</p>
              <label className="sr-only" htmlFor="vignette-customer-note">
                Hinweis an uns
              </label>
              <textarea
                id="vignette-customer-note"
                value={vignetteNote}
                onChange={(e) => setVignetteNote(e.target.value)}
                className="mt-2 min-h-[4rem] w-full rounded-xl border border-outline-variant bg-surface px-3 py-2 text-sm"
                maxLength={2000}
                placeholder="z. B. Gültigkeit 10 Tage, Kennzeichen, Sonderfälle …"
              />
            </div>

            <div className="mt-3 rounded-xl border border-outline-variant/40 bg-surface-container-high/25 p-3">
              <p className="text-[0.65rem] font-black uppercase tracking-wide text-on-surface-variant">3. Anfrage absenden</p>
              <p className="mt-1 text-[11px] text-on-surface-variant">
                Wir benachrichtigen das Team per E-Mail; du bekommst eine Bestätigung an deine Kontaktadresse, wenn der
                Versand eingerichtet ist.
              </p>
            </div>

            {vignetteMsg ? (
              <p
                className={`mt-3 rounded-lg px-2 py-1.5 text-xs font-medium ${
                  vignetteMsg.startsWith('Anfrage gesendet')
                    ? 'bg-primary/15 text-primary'
                    : 'bg-error-container text-on-error-container'
                }`}
              >
                {vignetteMsg}
              </p>
            ) : null}
            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                disabled={vignetteBusy || vignetteSelected.length < 1}
                onClick={() => void submitVignetteOrderRequest()}
                className="flex-1 rounded-xl bg-primary py-3 text-sm font-bold text-on-primary disabled:opacity-40"
              >
                {vignetteBusy ? '…' : 'Anfrage senden'}
              </button>
              <button
                type="button"
                disabled={vignetteBusy}
                onClick={() => {
                  setVignetteModalOpen(false)
                  setVignetteAdviceForModal(null)
                  setVignetteRouteLabelForModal(null)
                  setVignetteMsg(null)
                }}
                className="flex-1 rounded-xl border border-outline-variant py-3 text-sm font-bold text-on-surface"
              >
                Schließen
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  )
}
