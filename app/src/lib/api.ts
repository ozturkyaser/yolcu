/**
 * Relativer Pfad `/api` (Dev-Proxy, Web hinter Reverse-Proxy) oder absolute Basis
 * wenn `VITE_API_BASE_URL` gesetzt (z. B. Android-APK / Capacitor).
 */
function apiBasePrefix(): string {
  const raw = import.meta.env.VITE_API_BASE_URL as string | undefined
  if (raw && typeof raw === 'string' && raw.trim().length > 0) {
    return `${raw.trim().replace(/\/$/, '')}/api`
  }
  return '/api'
}

const GENERIC_SERVER_ERR = 'Internal Server Error'

async function parseError(res: Response): Promise<string> {
  try {
    const j = (await res.json()) as { error?: unknown; message?: unknown }
    const msg = typeof j?.message === 'string' ? j.message.trim() : ''
    const err = typeof j?.error === 'string' ? j.error.trim() : ''
    // Fastify: oft message = Detail, error = generisch
    if (msg && msg !== GENERIC_SERVER_ERR) return msg
    if (err && err !== GENERIC_SERVER_ERR) return err
    if (msg) return msg
    if (err) return err
    if (j?.error && typeof j.error === 'object') return JSON.stringify(j.error)
  } catch {
    /* ignore */
  }
  if (res.status === 502 || res.status === 504) {
    return 'API nicht erreichbar (läuft der Server auf Port 4000? Vite-Proxy prüfen).'
  }
  if (res.status >= 500) {
    return 'Serverfehler – API-Logs prüfen (DATABASE_URL, Postgres, JWT_SECRET).'
  }
  return res.statusText || `HTTP ${res.status}`
}

export async function apiFetch<T>(
  path: string,
  options: RequestInit & { token?: string | null } = {},
): Promise<T> {
  const { token, headers: h, ...rest } = options
  const headers = new Headers(h)
  headers.set('Accept', 'application/json')
  if (token) headers.set('Authorization', `Bearer ${token}`)
  if (
    rest.body &&
    typeof rest.body === 'string' &&
    !headers.has('Content-Type')
  ) {
    headers.set('Content-Type', 'application/json')
  }
  /* FormData: kein Content-Type setzen (Multipart-Boundary) */

  const res = await fetch(`${apiBasePrefix()}${path}`, { ...rest, headers })
  if (!res.ok) {
    const msg = await parseError(res)
    if (import.meta.env.DEV) {
      console.warn(`[api] ${res.status} ${path}`, msg)
    }
    throw new Error(msg)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

export type TollVehicleClass = 'car' | 'motorcycle' | 'heavy' | 'other'

export type User = {
  id: string
  email: string
  displayName: string
  /** Material-Symbol-Name für die Karte */
  mapIcon: string
  /** Für Vignetten-/Maut-Hinweise entlang der Route */
  tollVehicleClass: TollVehicleClass
  statsKm: number
  statsRegions: number
  createdAt: string
  role?: 'user' | 'admin'
}

export type PostDto = {
  id: string
  body: string
  category: string
  locationLabel: string | null
  lat: number | null
  lng: number | null
  helpfulCount: number
  expiresAt: string | null
  createdAt: string
  /** Strukturierte Grenz-Meldung (Kategorie border) */
  borderWaitMinutes: number | null
  borderSlug: string | null
  author: { id: string; displayName: string }
}

export type VehicleDto = {
  id: string
  label: string
  plate: string
  trailer_mode: boolean
  is_primary: boolean
  created_at: string
}

export type BorderDto = {
  slug: string
  title: string
  countryA: string
  countryB: string
  waitMinutes: number
  activeUsersReporting: number
  heroImageUrl: string | null
  rules: unknown
}

export type GroupSummary = {
  id: string
  name: string
  kind: 'trip' | 'permanent'
  inviteCode: string
  role: string
  memberCount: number
  createdAt: string
}

export type GroupMember = {
  id: string
  displayName: string
  role: string
  joinedAt: string
}

export type GroupMessageDto = {
  id: string
  body: string
  createdAt: string
  userId: string
  authorName: string
  messageType?: 'text' | 'voice'
  voiceUrl?: string
  voiceDurationMs?: number
}

export type PostCommentDto = {
  id: string
  body: string
  createdAt: string
  author: { id: string; displayName: string }
  messageType?: 'text' | 'voice'
  voiceUrl?: string
  voiceDurationMs?: number
}

export type MapPoiDto = {
  id: string
  name: string
  category: string
  lat: number
  lng: number
  note: string | null
  createdAt: string
  createdBy: string | null
}

export type MapParticipantDto = {
  userId: string
  displayName: string
  mapIcon: string
  lat: number
  lng: number
  updatedAt: string
}

/** WebSocket-URL (Vite-Proxy, gleicher Host in Web-Prod, oder `VITE_API_BASE_URL`). */
export function websocketUrl(token: string): string {
  const raw = import.meta.env.VITE_API_BASE_URL as string | undefined
  if (raw && typeof raw === 'string' && raw.trim().length > 0) {
    const u = new URL(raw.trim())
    const wsProto = u.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${wsProto}//${u.host}/api/ws?token=${encodeURIComponent(token)}`
  }
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${window.location.host}/api/ws?token=${encodeURIComponent(token)}`
}

export async function fetchGroups(token: string) {
  return apiFetch<{ groups: GroupSummary[] }>('/groups', { token })
}

export async function createGroup(token: string, body: { name: string; kind: 'trip' | 'permanent' }) {
  return apiFetch<{ group: GroupSummary }>('/groups', {
    method: 'POST',
    token,
    body: JSON.stringify(body),
  })
}

export async function joinGroupByCode(token: string, inviteCode: string) {
  return apiFetch<{ group: GroupSummary }>('/groups/join', {
    method: 'POST',
    token,
    body: JSON.stringify({ inviteCode }),
  })
}

export type ConvoyStatus = 'driving' | 'pause' | 'fuel' | 'border' | 'arrived'

export async function fetchGroupDetail(token: string, id: string) {
  return apiFetch<{
    group: {
      id: string
      name: string
      kind: string
      inviteCode: string
      createdAt: string
      convoyDestination: string | null
      convoyDepartureNote: string | null
      convoyStatus: ConvoyStatus | null
    }
    members: GroupMember[]
  }>(`/groups/${id}`, { token })
}

export async function patchGroupConvoy(
  token: string,
  groupId: string,
  body: {
    convoyDestination?: string | null
    convoyDepartureNote?: string | null
    convoyStatus?: ConvoyStatus | null
  },
) {
  return apiFetch<{
    convoy: {
      convoyDestination: string | null
      convoyDepartureNote: string | null
      convoyStatus: string | null
    }
  }>(`/groups/${groupId}/convoy`, { method: 'PATCH', token, body: JSON.stringify(body) })
}

/** Gruppen, in denen du und der andere Nutzer gemeinsam Mitglied seid (Karte → Chat). */
export async function fetchSharedGroupsWithUser(token: string, userId: string) {
  return apiFetch<{ groups: { id: string; name: string }[] }>(`/groups/shared-with/${userId}`, { token })
}

export async function fetchGroupMessages(token: string, id: string, limit?: number) {
  const q = limit ? `?limit=${limit}` : ''
  return apiFetch<{ messages: GroupMessageDto[] }>(`/groups/${id}/messages${q}`, { token })
}

export async function postGroupMessage(token: string, id: string, body: string) {
  return apiFetch<{ message: GroupMessageDto & { type?: string } }>(`/groups/${id}/messages`, {
    method: 'POST',
    token,
    body: JSON.stringify({ body }),
  })
}

/** Sprachnachricht (WebM/Opus vom MediaRecorder), Dauer in ms. */
export async function postGroupVoiceMessage(
  token: string,
  groupId: string,
  audio: Blob,
  durationMs: number,
  caption?: string,
) {
  const fd = new FormData()
  fd.set('durationMs', String(Math.round(durationMs)))
  fd.set('audio', audio, 'voice.webm')
  if (caption?.trim()) fd.set('caption', caption.trim())
  return apiFetch<{ message: GroupMessageDto & { type?: string } }>(`/groups/${groupId}/messages/voice`, {
    method: 'POST',
    token,
    body: fd,
  })
}

export async function fetchPostComments(postId: string) {
  return apiFetch<{ comments: PostCommentDto[] }>(`/posts/${postId}/comments`)
}

export async function postComment(token: string, postId: string, body: string) {
  return apiFetch<{ comment: PostCommentDto }>(`/posts/${postId}/comments`, {
    method: 'POST',
    token,
    body: JSON.stringify({ body }),
  })
}

export async function postCommentVoice(
  token: string,
  postId: string,
  audio: Blob,
  durationMs: number,
  caption?: string,
) {
  const fd = new FormData()
  fd.set('durationMs', String(Math.round(durationMs)))
  fd.set('audio', audio, 'voice.webm')
  if (caption?.trim()) fd.set('caption', caption.trim())
  return apiFetch<{ comment: PostCommentDto }>(`/posts/${postId}/comments/voice`, {
    method: 'POST',
    token,
    body: fd,
  })
}

export async function reportPost(token: string, postId: string, reason: string) {
  return apiFetch<{ ok: boolean }>(`/posts/${postId}/report`, {
    method: 'POST',
    token,
    body: JSON.stringify({ reason }),
  })
}

export async function fetchPoisNear(lat: number, lng: number, radiusKm = 80) {
  const q = new URLSearchParams({
    lat: String(lat),
    lng: String(lng),
    radiusKm: String(radiusKm),
  })
  return apiFetch<{ pois: MapPoiDto[] }>(`/pois?${q}`)
}

export async function createPoi(
  token: string,
  body: {
    name: string
    lat: number
    lng: number
    category?: string
    note?: string
  },
) {
  return apiFetch<{ poi: MapPoiDto }>('/pois', {
    method: 'POST',
    token,
    body: JSON.stringify(body),
  })
}

export async function postMyPresence(token: string, lat: number, lng: number) {
  return apiFetch<{ ok: boolean }>('/presence', {
    method: 'POST',
    token,
    body: JSON.stringify({ lat, lng }),
  })
}

export async function clearMyPresence(token: string) {
  return apiFetch<{ ok: boolean }>('/presence', {
    method: 'DELETE',
    token,
  })
}

export async function fetchPresenceNearby(
  lat: number,
  lng: number,
  radiusKm = 120,
  maxAgeMinutes = 12,
  opts?: { groupId?: string; token?: string | null },
) {
  const q = new URLSearchParams({
    lat: String(lat),
    lng: String(lng),
    radiusKm: String(radiusKm),
    maxAgeMinutes: String(maxAgeMinutes),
  })
  if (opts?.groupId) q.set('groupId', opts.groupId)
  return apiFetch<{ participants: MapParticipantDto[] }>(`/presence/nearby?${q}`, {
    token: opts?.token ?? undefined,
  })
}

export type GeocodeResultDto = {
  lat: number
  lng: number
  label: string
  kind?: string
}

/** Ortssuche über die API (Nominatim / OpenStreetMap). */
export async function fetchGeocodeSearch(query: string) {
  const q = new URLSearchParams({ q: query.trim() })
  return apiFetch<{ results: GeocodeResultDto[] }>(`/geocode/search?${q}`)
}

export type DrivingRouteStepDto = { text: string; distanceM: number; durationS: number }

export type DrivingRouteDto = {
  distanceM: number
  durationS: number
  geometry: { type: 'LineString'; coordinates: [number, number][] }
  steps: DrivingRouteStepDto[]
}

/** Straßenroute (Server → OSRM). Koordinaten WGS84. */
export async function fetchDrivingRoute(
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number,
) {
  const q = new URLSearchParams({
    fromLat: String(fromLat),
    fromLng: String(fromLng),
    toLat: String(toLat),
    toLng: String(toLng),
  })
  return apiFetch<DrivingRouteDto>(`/route/driving?${q}`)
}

export type RouteTollAdviceCountryDto = {
  code: string
  name: string
}

export type RouteTollAdviceProductDto = {
  id: string
  countryCode: string
  title: string
  description: string
  type: 'vignette' | 'toll' | 'info'
  vehicleClasses: TollVehicleClass[]
  purchaseUrl: string
}

export type RouteTollAdviceDto = {
  vehicleClass: TollVehicleClass
  countries: RouteTollAdviceCountryDto[]
  products: RouteTollAdviceProductDto[]
  disclaimer: string
}

/** Länder entlang der Route + Vignetten-/Maut-Hinweise (Nominatim Reverse, dauert einige Sekunden). */
export async function fetchRouteTollAdvice(
  geometry: DrivingRouteDto['geometry'],
  vehicleClass: TollVehicleClass,
  token?: string | null,
  opts?: { signal?: AbortSignal },
) {
  return apiFetch<RouteTollAdviceDto>('/route/toll-advice', {
    method: 'POST',
    token: token ?? undefined,
    body: JSON.stringify({ geometry, vehicleClass }),
    signal: opts?.signal,
  })
}

export type RouteBriefingCountryFactDto = {
  countryCode: string
  key: string
  title: string
  content: string
  sourceUrl: string | null
  verifiedAt: string
}

export type RouteBriefingTollOfferDto = {
  id: string
  countryCode: string
  vehicleClass: string
  kind: string
  title: string
  description: string
  purchaseUrl: string
  sourceUrl: string | null
  verifiedAt: string
}

export type RouteBriefingFaqDto = {
  id: string
  question: string
  answer: string
  tags: string[]
  sourceUrl: string | null
  verifiedAt: string
}

export type RouteBriefingDto = {
  corridor: string
  vehicleClass: TollVehicleClass
  countries: RouteTollAdviceCountryDto[]
  countryFacts: RouteBriefingCountryFactDto[]
  tollOffers: RouteBriefingTollOfferDto[]
  faq: RouteBriefingFaqDto[]
  disclaimer: string
}

export async function fetchRouteBriefing(
  geometry: DrivingRouteDto['geometry'],
  vehicleClass: TollVehicleClass,
  token?: string | null,
  opts?: { signal?: AbortSignal; corridor?: string },
) {
  return apiFetch<RouteBriefingDto>('/route/briefing', {
    method: 'POST',
    token: token ?? undefined,
    body: JSON.stringify({ geometry, vehicleClass, corridor: opts?.corridor ?? 'berlin_turkey' }),
    signal: opts?.signal,
  })
}

export type AssistantAskDto = {
  answer: string
  citations: string[]
  usedModel: string
  countries: RouteTollAdviceCountryDto[]
  disclaimer: string
}

export async function askRouteAssistant(
  body: {
    question: string
    vehicleClass: TollVehicleClass
    corridor?: string
    geometry?: DrivingRouteDto['geometry']
    /** Gruppenkontext (nur mit Token): Chat + frühere KI-Notizen. */
    groupId?: string
    /** Antwort für spätere KI-Anfragen in dieser Gruppe speichern. */
    saveMemory?: boolean
  },
  opts?: { signal?: AbortSignal; token?: string | null },
) {
  return apiFetch<AssistantAskDto>('/assistant/ask', {
    method: 'POST',
    token: opts?.token ?? undefined,
    body: JSON.stringify(body),
    signal: opts?.signal,
  })
}

export type RideOfferKind = 'passenger' | 'cargo' | 'both'

export type RideListingDto = {
  id: string
  userId: string
  authorName: string
  offerKind: RideOfferKind
  routeFrom: string
  routeTo: string
  departureNote: string
  freeSeats: number | null
  cargoSpaceNote: string
  details: string
  status: 'open' | 'closed'
  createdAt: string
  pendingRequestCount?: number
}

export type RideRequestDto = {
  id: string
  requesterId: string
  requesterName: string
  requestKind: 'passenger' | 'cargo'
  message: string
  status: 'pending' | 'withdrawn' | 'accepted' | 'declined'
  createdAt: string
}

export async function fetchRideListings(opts?: {
  token?: string | null
  mine?: boolean
  offerKind?: RideOfferKind
}) {
  const q = new URLSearchParams()
  if (opts?.mine) q.set('mine', '1')
  if (opts?.offerKind) q.set('offerKind', opts.offerKind)
  const qs = q.toString()
  return apiFetch<{ listings: RideListingDto[] }>(`/ride-listings${qs ? `?${qs}` : ''}`, {
    token: opts?.mine ? opts.token ?? undefined : undefined,
  })
}

export async function fetchRideListing(id: string) {
  return apiFetch<{ listing: RideListingDto }>(`/ride-listings/${id}`)
}

export async function createRideListing(
  token: string,
  body: {
    offerKind: RideOfferKind
    routeFrom: string
    routeTo: string
    departureNote?: string
    freeSeats?: number | null
    cargoSpaceNote?: string
    details: string
  },
) {
  return apiFetch<{ listing: RideListingDto }>('/ride-listings', {
    method: 'POST',
    token,
    body: JSON.stringify({
      offerKind: body.offerKind,
      routeFrom: body.routeFrom,
      routeTo: body.routeTo,
      departureNote: body.departureNote ?? '',
      freeSeats: body.freeSeats ?? null,
      cargoSpaceNote: body.cargoSpaceNote ?? '',
      details: body.details,
    }),
  })
}

export async function patchRideListing(token: string, id: string, body: { status: 'open' | 'closed' }) {
  return apiFetch<{ listing: RideListingDto }>(`/ride-listings/${id}`, {
    method: 'PATCH',
    token,
    body: JSON.stringify(body),
  })
}

export async function createRideRequest(
  token: string,
  listingId: string,
  body: { requestKind: 'passenger' | 'cargo'; message?: string },
) {
  return apiFetch<{ request: RideRequestDto & { listingId: string } }>(
    `/ride-listings/${listingId}/requests`,
    { method: 'POST', token, body: JSON.stringify(body) },
  )
}

export async function fetchRideListingRequests(token: string, listingId: string) {
  return apiFetch<{ requests: RideRequestDto[] }>(`/ride-listings/${listingId}/requests`, { token })
}

export async function patchRideRequest(
  token: string,
  requestId: string,
  body: { status: 'withdrawn' | 'accepted' | 'declined' },
) {
  return apiFetch<{ ok: boolean; status: string }>(`/ride-requests/${requestId}`, {
    method: 'PATCH',
    token,
    body: JSON.stringify(body),
  })
}

export type CuratedPlaceCategory = 'accommodation' | 'restaurant' | 'rest_area'

export type CuratedPlaceDto = {
  id: string
  category: CuratedPlaceCategory
  name: string
  description: string
  lat: number
  lng: number
  address: string
  region: string
  phone: string
  website: string
  imageUrl: string
  isPublished: boolean
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export async function fetchCuratedPlaces(category?: CuratedPlaceCategory) {
  const q = category ? `?category=${encodeURIComponent(category)}` : ''
  return apiFetch<{ places: CuratedPlaceDto[] }>(`/curated-places${q}`)
}

export async function fetchAdminStats(token: string) {
  return apiFetch<{
    stats: {
      users: number
      posts: number
      curatedPlaces: number
      rideListings: number
      rideRequests: number
      vignetteProducts?: number
      vignetteOrders?: number
    }
  }>('/admin/stats', { token })
}

export type AdminUserRow = {
  id: string
  email: string
  displayName: string
  role: string
  mapIcon: string
  tollVehicleClass: string
  statsKm: number
  statsRegions: number
  createdAt: string
}

export async function fetchAdminUsers(token: string, opts?: { limit?: number; offset?: number; q?: string }) {
  const p = new URLSearchParams()
  if (opts?.limit != null) p.set('limit', String(opts.limit))
  if (opts?.offset != null) p.set('offset', String(opts.offset))
  if (opts?.q) p.set('q', opts.q)
  const qs = p.toString()
  return apiFetch<{ users: AdminUserRow[] }>(`/admin/users${qs ? `?${qs}` : ''}`, { token })
}

export async function patchAdminUser(
  token: string,
  userId: string,
  body: { role?: 'user' | 'admin'; displayName?: string },
) {
  return apiFetch<{ user: AdminUserRow }>(`/admin/users/${userId}`, {
    method: 'PATCH',
    token,
    body: JSON.stringify(body),
  })
}

export async function fetchAdminCuratedPlaces(token: string) {
  return apiFetch<{ places: CuratedPlaceDto[] }>('/admin/curated-places', { token })
}

export async function createAdminCuratedPlace(
  token: string,
  body: {
    category: CuratedPlaceCategory
    name: string
    description?: string
    lat: number
    lng: number
    address?: string
    region?: string
    phone?: string
    website?: string
    imageUrl?: string
    isPublished?: boolean
    sortOrder?: number
  },
) {
  return apiFetch<{ place: CuratedPlaceDto }>('/admin/curated-places', {
    method: 'POST',
    token,
    body: JSON.stringify({
      category: body.category,
      name: body.name,
      description: body.description ?? '',
      lat: body.lat,
      lng: body.lng,
      address: body.address ?? '',
      region: body.region ?? '',
      phone: body.phone ?? '',
      website: body.website ?? '',
      imageUrl: body.imageUrl ?? '',
      isPublished: body.isPublished ?? true,
      sortOrder: body.sortOrder ?? 0,
    }),
  })
}

export async function patchAdminCuratedPlace(
  token: string,
  id: string,
  body: Partial<{
    category: CuratedPlaceCategory
    name: string
    description: string
    lat: number
    lng: number
    address: string
    region: string
    phone: string
    website: string
    imageUrl: string
    isPublished: boolean
    sortOrder: number
  }>,
) {
  return apiFetch<{ place: CuratedPlaceDto }>(`/admin/curated-places/${id}`, {
    method: 'PATCH',
    token,
    body: JSON.stringify(body),
  })
}

export async function deleteAdminCuratedPlace(token: string, id: string) {
  return apiFetch<{ ok: boolean }>(`/admin/curated-places/${id}`, { method: 'DELETE', token })
}

export type AdminRideListingRow = {
  id: string
  offerKind: string
  routeFrom: string
  routeTo: string
  status: string
  createdAt: string
  ownerEmail: string
  ownerName: string
}

export async function fetchAdminRideListings(token: string) {
  return apiFetch<{ listings: AdminRideListingRow[] }>('/admin/ride-listings', { token })
}

export async function patchAdminRideListing(token: string, id: string, body: { status: 'open' | 'closed' }) {
  return apiFetch<{ ok: boolean; status: string }>(`/admin/ride-listings/${id}`, {
    method: 'PATCH',
    token,
    body: JSON.stringify(body),
  })
}

export type VignetteServiceProductDto = {
  id: string
  countryCode: string
  vehicleClass: string
  kind: string
  title: string
  description: string
  officialUrl: string
  partnerCheckoutUrl: string
  retailHintEur: number | null
  serviceFeeEur: number
  isActive: boolean
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export async function fetchVignetteServiceProducts(countryCode?: string) {
  const q = countryCode ? `?countryCode=${encodeURIComponent(countryCode)}` : ''
  return apiFetch<{ products: VignetteServiceProductDto[] }>(`/vignette-service-products${q}`)
}

export async function createVignetteOrderRequest(
  token: string,
  body: {
    vehicleClass: TollVehicleClass
    countries: { code: string; name: string }[]
    routeLabel?: string
    productIds: string[]
    customerNote?: string
  },
) {
  return apiFetch<{ request: { id: string; status: string; createdAt: string } }>('/vignette-order-requests', {
    method: 'POST',
    token,
    body: JSON.stringify(body),
  })
}

export type MyVignetteOrderDto = {
  id: string
  status: string
  routeLabel: string
  quotedTotalEur: number | null
  createdAt: string
  paidAt: string | null
  canPay: boolean
}

export async function fetchMyVignetteOrderRequests(token: string) {
  return apiFetch<{ requests: MyVignetteOrderDto[] }>('/my/vignette-order-requests', { token })
}

export async function createVignetteStripeCheckoutSession(token: string, orderId: string) {
  return apiFetch<{ url: string }>(`/vignette-order-requests/${orderId}/stripe-checkout`, {
    method: 'POST',
    token,
    body: JSON.stringify({}),
  })
}

export async function confirmVignetteStripeCheckout(token: string, sessionId: string) {
  return apiFetch<{ ok: boolean; status?: string; alreadyConfirmed?: boolean }>(
    '/vignette-order-requests/confirm-checkout',
    {
      method: 'POST',
      token,
      body: JSON.stringify({ sessionId }),
    },
  )
}

export async function fetchAdminVignetteProducts(token: string) {
  return apiFetch<{ products: VignetteServiceProductDto[] }>('/admin/vignette-service-products', { token })
}

export async function createAdminVignetteProduct(
  token: string,
  body: {
    id: string
    countryCode: string
    vehicleClass?: 'car' | 'motorcycle' | 'heavy' | 'other' | 'all'
    kind?: 'vignette' | 'toll' | 'info'
    title: string
    description?: string
    officialUrl?: string
    partnerCheckoutUrl?: string
    retailHintEur?: number | null
    serviceFeeEur?: number
    isActive?: boolean
    sortOrder?: number
  },
) {
  return apiFetch<{ product: VignetteServiceProductDto }>('/admin/vignette-service-products', {
    method: 'POST',
    token,
    body: JSON.stringify(body),
  })
}

export async function patchAdminVignetteProduct(
  token: string,
  id: string,
  body: Partial<{
    countryCode: string
    vehicleClass: 'car' | 'motorcycle' | 'heavy' | 'other' | 'all'
    kind: 'vignette' | 'toll' | 'info'
    title: string
    description: string
    officialUrl: string
    partnerCheckoutUrl: string
    retailHintEur: number | null
    serviceFeeEur: number
    isActive: boolean
    sortOrder: number
  }>,
) {
  return apiFetch<{ product: VignetteServiceProductDto }>(`/admin/vignette-service-products/${id}`, {
    method: 'PATCH',
    token,
    body: JSON.stringify(body),
  })
}

export async function deleteAdminVignetteProduct(token: string, id: string) {
  return apiFetch<{ ok: boolean }>(`/admin/vignette-service-products/${id}`, { method: 'DELETE', token })
}

export type VignetteOrderRequestAdminDto = {
  id: string
  status: string
  vehicleClass: string
  countries: unknown
  routeLabel: string
  productIds: string[]
  customerNote: string
  adminNote: string
  quotedTotalEur: number | null
  paidAt?: string | null
  stripeCheckoutSessionId?: string | null
  createdAt: string
  updatedAt: string
  userEmail: string
  userDisplayName: string
}

export async function fetchAdminVignetteOrderRequests(token: string) {
  return apiFetch<{ requests: VignetteOrderRequestAdminDto[] }>('/admin/vignette-order-requests', { token })
}

export async function patchAdminVignetteOrderRequest(
  token: string,
  id: string,
  body: {
    status?: 'pending' | 'in_review' | 'quoted' | 'paid' | 'fulfilled' | 'cancelled'
    adminNote?: string
    quotedTotalEur?: number | null
  },
) {
  return apiFetch<{ ok: boolean }>(`/admin/vignette-order-requests/${id}`, {
    method: 'PATCH',
    token,
    body: JSON.stringify(body),
  })
}
