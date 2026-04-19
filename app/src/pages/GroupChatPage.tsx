import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { VoiceAuthAudio } from '../components/VoiceAuthAudio'
import { usePttPlayback, startPttStream, type PttStreamHandle } from '../hooks/useVoicePtt'
import { useWebmVoiceRecord } from '../hooks/useWebmVoiceRecord'
import {
  askRouteAssistant,
  fetchGroupDetail,
  fetchGroupMessages,
  patchGroupConvoy,
  postGroupMessage,
  postGroupVoiceMessage,
  websocketUrl,
  type AssistantAskDto,
  type ConvoyStatus,
  type GroupMessageDto,
} from '../lib/api'
import { resolveTollVehicleClass } from '../lib/tollVehicle'
import { useAuth } from '../context/AuthContext'
import { useRadioPlayer } from '../context/RadioPlayerContext'

type WsPayload =
  | {
      type: 'message'
      messageType?: string
      id: string
      groupId: string
      userId: string
      authorName: string
      body: string
      createdAt: string
      voiceUrl?: string
      voiceDurationMs?: number
    }
  | {
      type: 'voice_ptt'
      groupId: string
      userId: string
      authorName: string
      phase: string
      sampleRate?: number
      pcmBase64?: string
    }
  | { type: 'joined'; groupId: string }
  | { type: 'error'; error: string }

function formatTime(iso: string) {
  const d = new Date(iso)
  return d.toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })
}

const LS_PTT_NEARBY = 'yol_ptt_nearby_only'
const LS_WALKIE_ARMED = 'yol_walkie_armed'
const PTT_LONG_PRESS_MS = 650

/** Gleiche Logik wie Karte: Höhe unter Header abzüglich gemessener Bottom-Navigation. */
const BOTTOM_NAV_CSS = 'var(--bottom-nav-height, 6rem)'

const CONVOY_STATUS_LABEL: Record<ConvoyStatus, string> = {
  driving: 'Unterwegs',
  pause: 'Pause',
  fuel: 'Tanken',
  border: 'An der Grenze',
  arrived: 'Angekommen',
}

function mapWsToDto(data: Extract<WsPayload, { type: 'message' }>): GroupMessageDto {
  const mt = (data.messageType as GroupMessageDto['messageType']) || 'text'
  return {
    id: data.id,
    body: data.body,
    createdAt: data.createdAt,
    userId: data.userId,
    authorName: data.authorName,
    messageType: mt,
    voiceUrl: data.voiceUrl,
    voiceDurationMs: data.voiceDurationMs,
  }
}

export function GroupChatPage() {
  const { id } = useParams<{ id: string }>()
  const { token, user } = useAuth()
  const navigate = useNavigate()
  const [title, setTitle] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [messages, setMessages] = useState<GroupMessageDto[]>([])
  const [input, setInput] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [voiceBusy, setVoiceBusy] = useState(false)
  const [pttNearbyOnly, setPttNearbyOnly] = useState(() => {
    try {
      return localStorage.getItem(LS_PTT_NEARBY) === '1'
    } catch {
      return false
    }
  })
  const [convoyDestination, setConvoyDestination] = useState('')
  const [convoyDepartureNote, setConvoyDepartureNote] = useState('')
  const [convoyStatus, setConvoyStatus] = useState<ConvoyStatus | ''>('')
  const [isGroupAdmin, setIsGroupAdmin] = useState(false)
  const [convoyEditOpen, setConvoyEditOpen] = useState(false)
  const [convoySaving, setConvoySaving] = useState(false)
  const [aiQuestion, setAiQuestion] = useState('')
  const [aiAnswer, setAiAnswer] = useState<AssistantAskDto | null>(null)
  const [aiLoading, setAiLoading] = useState(false)
  const [aiSaveMemory, setAiSaveMemory] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const pttHandleRef = useRef<PttStreamHandle | null>(null)
  const pttOpeningRef = useRef(false)
  const pttPointerDownRef = useRef(false)
  const pttDownAtRef = useRef(0)
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pttLatchedRef = useRef(false)
  const [pttLatchedUi, setPttLatchedUi] = useState(false)
  const [pttLiveUi, setPttLiveUi] = useState(false)
  const [walkieArmed, setWalkieArmed] = useState(true)
  const handlePttPlaybackRef = useRef<(d: {
    userId: string
    phase: string
    sampleRate?: number
    pcmBase64?: string
  }) => void>(() => {})

  const radio = useRadioPlayer()
  const { handlePttPayload } = usePttPlayback(user?.id, {
    onRemotePttStart: () => radio.beginVoiceMessagePlayback(),
    onRemotePttEnd: () => radio.endVoiceMessagePlayback(),
  })
  handlePttPlaybackRef.current = handlePttPayload

  const { isRecording, start: startVoiceRec, stop: stopVoiceRec } = useWebmVoiceRecord()

  useEffect(() => {
    if (isRecording || pttLiveUi) {
      radio.beginUserCapture()
      return () => radio.endUserCapture()
    }
  }, [isRecording, pttLiveUi, radio])

  const scrollDown = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  useEffect(() => {
    scrollDown()
  }, [messages, scrollDown])

  useEffect(() => {
    if (!user || !token || !id) {
      if (!user) navigate('/login')
      return
    }

    let cancelled = false
    ;(async () => {
      setLoading(true)
      setErr(null)
      try {
        const detail = await fetchGroupDetail(token, id)
        if (cancelled) return
        setTitle(detail.group.name)
        setInviteCode(detail.group.inviteCode)
        setConvoyDestination(detail.group.convoyDestination ?? '')
        setConvoyDepartureNote(detail.group.convoyDepartureNote ?? '')
        setConvoyStatus(detail.group.convoyStatus ?? '')
        const me = detail.members.find((m) => m.id === user?.id)
        setIsGroupAdmin(me?.role === 'admin')
        const hist = await fetchGroupMessages(token, id, 100)
        if (cancelled) return
        setMessages(hist.messages)
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : 'Laden fehlgeschlagen')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [user, token, id, navigate])

  useEffect(() => {
    try {
      localStorage.setItem(LS_PTT_NEARBY, pttNearbyOnly ? '1' : '0')
    } catch {
      /* ignore */
    }
  }, [pttNearbyOnly])

  useEffect(() => {
    if (!id) return
    try {
      setWalkieArmed(sessionStorage.getItem(`${LS_WALKIE_ARMED}_${id}`) !== '0')
    } catch {
      setWalkieArmed(true)
    }
  }, [id])

  useEffect(() => {
    if (!id) return
    try {
      sessionStorage.setItem(`${LS_WALKIE_ARMED}_${id}`, walkieArmed ? '1' : '0')
    } catch {
      /* ignore */
    }
  }, [id, walkieArmed])

  useEffect(() => {
    if (!walkieArmed) {
      if (longPressTimerRef.current != null) {
        clearTimeout(longPressTimerRef.current)
        longPressTimerRef.current = null
      }
      pttPointerDownRef.current = false
      pttLatchedRef.current = false
      setPttLatchedUi(false)
      pttHandleRef.current?.stop()
      pttHandleRef.current = null
      setPttLiveUi(false)
    }
  }, [walkieArmed])

  useEffect(() => {
    if (!token || !id || !user) return

    const ws = new WebSocket(websocketUrl(token))
    wsRef.current = ws

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'join', groupId: id }))
    }

    ws.onmessage = (ev) => {
      try {
        const data = JSON.parse(String(ev.data)) as WsPayload
        if (data.type === 'message' && data.groupId === id) {
          setMessages((prev) => {
            if (prev.some((m) => m.id === data.id)) return prev
            return [...prev, mapWsToDto(data)]
          })
        }
        if (data.type === 'voice_ptt' && data.groupId === id) {
          handlePttPlaybackRef.current({
            userId: data.userId,
            phase: data.phase,
            sampleRate: data.sampleRate,
            pcmBase64: data.pcmBase64,
          })
        }
        if (data.type === 'error') setErr(data.error)
      } catch {
        /* ignore */
      }
    }

    ws.onerror = () => setErr('Verbindungsfehler')

    return () => {
      if (longPressTimerRef.current != null) {
        clearTimeout(longPressTimerRef.current)
        longPressTimerRef.current = null
      }
      pttPointerDownRef.current = false
      pttLatchedRef.current = false
      pttOpeningRef.current = false
      pttHandleRef.current?.stop()
      pttHandleRef.current = null
      setPttLatchedUi(false)
      setPttLiveUi(false)
      ws.close()
      wsRef.current = null
    }
  }, [token, id, user])

  async function send() {
    const text = input.trim()
    if (!text || !token || !id) return
    setInput('')
    setErr(null)
    const ws = wsRef.current
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'chat', groupId: id, body: text }))
      return
    }
    try {
      const { message } = await postGroupMessage(token, id, text)
      const m: GroupMessageDto = {
        id: message.id,
        body: message.body,
        createdAt: message.createdAt,
        userId: message.userId,
        authorName: message.authorName,
        messageType: message.messageType ?? 'text',
        voiceUrl: message.voiceUrl,
        voiceDurationMs: message.voiceDurationMs,
      }
      setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]))
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Senden fehlgeschlagen')
      setInput(text)
    }
  }

  function clearPttLongPressTimer() {
    if (longPressTimerRef.current != null) {
      clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }
  }

  function releasePttAll() {
    clearPttLongPressTimer()
    pttPointerDownRef.current = false
    pttLatchedRef.current = false
    setPttLatchedUi(false)
    pttHandleRef.current?.stop()
    pttHandleRef.current = null
    setPttLiveUi(false)
  }

  async function startLivePtt() {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN || !id) return
    if (pttHandleRef.current || pttOpeningRef.current) return
    setErr(null)
    pttOpeningRef.current = true
    try {
      const handle = await startPttStream(ws, id, {
        nearbyOnly: pttNearbyOnly,
        nearbyKm: 25,
      })
      if (!pttPointerDownRef.current && !pttLatchedRef.current) {
        handle.stop()
        return
      }
      pttHandleRef.current = handle
      setPttLiveUi(true)
      if (pttPointerDownRef.current && Date.now() - pttDownAtRef.current >= PTT_LONG_PRESS_MS) {
        pttLatchedRef.current = true
        setPttLatchedUi(true)
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Mikrofon nicht verfügbar')
    } finally {
      pttOpeningRef.current = false
    }
  }

  async function handlePttButtonDown(e: ReactPointerEvent<HTMLButtonElement>) {
    if (e.button !== 0) return
    if (!walkieArmed) return
    e.preventDefault()
    if (pttLatchedRef.current) {
      releasePttAll()
      return
    }
    if (pttHandleRef.current || pttOpeningRef.current) return
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
    pttPointerDownRef.current = true
    pttDownAtRef.current = Date.now()
    clearPttLongPressTimer()
    longPressTimerRef.current = window.setTimeout(() => {
      longPressTimerRef.current = null
      if (pttPointerDownRef.current && pttHandleRef.current) {
        pttLatchedRef.current = true
        setPttLatchedUi(true)
      }
    }, PTT_LONG_PRESS_MS)
    await startLivePtt()
  }

  function handlePttButtonUp(e: ReactPointerEvent<HTMLButtonElement>) {
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
    clearPttLongPressTimer()
    pttPointerDownRef.current = false
    if (pttLatchedRef.current) return
    pttHandleRef.current?.stop()
    pttHandleRef.current = null
    setPttLiveUi(false)
  }

  function handlePttButtonCancel(e: ReactPointerEvent<HTMLButtonElement>) {
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
    releasePttAll()
  }

  async function saveConvoy() {
    if (!token || !id || !isGroupAdmin) return
    setConvoySaving(true)
    setErr(null)
    try {
      const { convoy } = await patchGroupConvoy(token, id, {
        convoyDestination: convoyDestination.trim() || null,
        convoyDepartureNote: convoyDepartureNote.trim() || null,
        convoyStatus: convoyStatus || null,
      })
      setConvoyDestination(convoy.convoyDestination ?? '')
      setConvoyDepartureNote(convoy.convoyDepartureNote ?? '')
      setConvoyStatus((convoy.convoyStatus as ConvoyStatus | null) ?? '')
      setConvoyEditOpen(false)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Speichern fehlgeschlagen')
    } finally {
      setConvoySaving(false)
    }
  }

  async function runGroupAi() {
    if (!user || !token || !id) return
    const q = aiQuestion.trim()
    if (q.length < 3) {
      setErr('KI: Bitte mindestens 3 Zeichen eingeben.')
      return
    }
    setAiLoading(true)
    setErr(null)
    try {
      const vc = resolveTollVehicleClass(user.tollVehicleClass, user.mapIcon)
      const r = await askRouteAssistant(
        {
          question: q,
          vehicleClass: vc,
          corridor: 'berlin_turkey',
          groupId: id,
          saveMemory: aiSaveMemory,
        },
        { token },
      )
      setAiAnswer(r)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'KI-Anfrage fehlgeschlagen')
    } finally {
      setAiLoading(false)
    }
  }

  async function toggleVoiceNote() {
    if (!token || !id) return
    setErr(null)
    if (!isRecording) {
      try {
        await startVoiceRec()
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Mikrofon nicht verfügbar')
      }
      return
    }
    setVoiceBusy(true)
    try {
      const pack = await stopVoiceRec()
      if (!pack) {
        setVoiceBusy(false)
        return
      }
      const { message } = await postGroupVoiceMessage(token, id, pack.blob, pack.durationMs)
      const m: GroupMessageDto = {
        id: message.id,
        body: message.body,
        createdAt: message.createdAt,
        userId: message.userId,
        authorName: message.authorName,
        messageType: message.messageType ?? 'voice',
        voiceUrl: message.voiceUrl,
        voiceDurationMs: message.voiceDurationMs,
      }
      setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]))
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Sprachnachricht fehlgeschlagen')
    } finally {
      setVoiceBusy(false)
    }
  }

  if (!user || !id) return null

  const mainHeightStyle = useMemo(
    (): CSSProperties => ({ height: `calc(100dvh - 72px - ${BOTTOM_NAV_CSS})` }),
    [],
  )

  return (
    <>
      <div className="fixed top-[72px] left-0 z-40 h-1 w-full bg-gradient-to-r from-primary via-tertiary to-primary opacity-80" />
      <main className="flex min-h-0 flex-col" style={mainHeightStyle}>
        <header className="shrink-0 border-b border-outline-variant/30 px-4 py-3">
          <div className="mx-auto flex max-w-2xl items-center gap-3">
            <Link
              to="/groups"
              className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface-container-low text-on-surface"
              aria-label="Zurück"
            >
              <span className="material-symbols-outlined">arrow_back</span>
            </Link>
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-lg font-bold text-on-surface">{title || '…'}</h1>
              {inviteCode ? (
                <p className="truncate text-xs text-on-surface-variant">
                  Einladung: <span className="font-mono font-semibold">{inviteCode}</span>
                </p>
              ) : null}
            </div>
          </div>
        </header>

        {(convoyDestination || convoyDepartureNote || convoyStatus || isGroupAdmin) && (
          <div className="shrink-0 border-b border-outline-variant/25 bg-tertiary-container/30 px-4 py-2">
            <div className="mx-auto max-w-2xl text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-bold text-on-tertiary-container">Konvoi</p>
                {isGroupAdmin ? (
                  <button
                    type="button"
                    onClick={() => setConvoyEditOpen((o) => !o)}
                    className="text-xs font-bold text-primary underline"
                  >
                    {convoyEditOpen ? 'Schließen' : 'Bearbeiten'}
                  </button>
                ) : null}
              </div>
              {!convoyEditOpen ? (
                <div className="mt-1 space-y-0.5 text-on-surface-variant">
                  {convoyStatus ? (
                    <p>
                      Status:{' '}
                      <span className="font-semibold text-on-surface">
                        {CONVOY_STATUS_LABEL[convoyStatus as ConvoyStatus] ?? convoyStatus}
                      </span>
                    </p>
                  ) : null}
                  {convoyDestination ? (
                    <p>
                      Ziel: <span className="font-medium text-on-surface">{convoyDestination}</span>
                    </p>
                  ) : null}
                  {convoyDepartureNote ? <p className="text-xs">{convoyDepartureNote}</p> : null}
                  {!convoyStatus && !convoyDestination && !convoyDepartureNote && !isGroupAdmin ? (
                    <p className="text-xs">Keine Konvoi-Infos.</p>
                  ) : null}
                </div>
              ) : (
                <div className="mt-2 space-y-2">
                  <label className="block text-[10px] font-bold uppercase text-on-surface-variant">Status</label>
                  <select
                    value={convoyStatus}
                    onChange={(e) => setConvoyStatus(e.target.value as ConvoyStatus | '')}
                    className="w-full rounded-lg border border-outline-variant bg-surface px-2 py-2 text-sm"
                  >
                    <option value="">—</option>
                    {(Object.keys(CONVOY_STATUS_LABEL) as ConvoyStatus[]).map((k) => (
                      <option key={k} value={k}>
                        {CONVOY_STATUS_LABEL[k]}
                      </option>
                    ))}
                  </select>
                  <label className="block text-[10px] font-bold uppercase text-on-surface-variant">Ziel (Text)</label>
                  <input
                    value={convoyDestination}
                    onChange={(e) => setConvoyDestination(e.target.value)}
                    maxLength={200}
                    className="w-full rounded-lg border border-outline-variant bg-surface px-2 py-2 text-sm"
                    placeholder="z. B. Istanbul"
                  />
                  <label className="block text-[10px] font-bold uppercase text-on-surface-variant">
                    Abfahrt / Treffpunkt
                  </label>
                  <input
                    value={convoyDepartureNote}
                    onChange={(e) => setConvoyDepartureNote(e.target.value)}
                    maxLength={300}
                    className="w-full rounded-lg border border-outline-variant bg-surface px-2 py-2 text-sm"
                    placeholder="z. B. Mo 06:00 Grenze XY"
                  />
                  <button
                    type="button"
                    disabled={convoySaving}
                    onClick={() => void saveConvoy()}
                    className="rounded-lg bg-primary px-3 py-2 text-xs font-bold text-on-primary disabled:opacity-50"
                  >
                    {convoySaving ? '…' : 'Speichern'}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        <div className="shrink-0 border-b border-outline-variant/25 bg-primary/5 px-4 py-3">
          <div className="mx-auto max-w-2xl">
            <p className="text-[0.65rem] font-bold uppercase tracking-wide text-primary">Reise-KI (Gruppe)</p>
            <p className="mt-0.5 text-[11px] leading-snug text-on-surface-variant">
              Nutzt eure Textnachrichten, frühere KI-Notizen (wenn gespeichert) und die Reise-Wissensbasis. Modell und
              API-Schlüssel legt der Betrieb zentral unter Admin → KI / OpenRouter fest (OpenRouter; oder OPENAI_API_KEY /
              AI_API_KEY auf dem Server). Einen persönlichen Zusatz-Prompt kannst du unter{' '}
              <Link to="/profile" className="font-semibold text-primary underline">
                Profil
              </Link>{' '}
              eintragen.
            </p>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row">
              <input
                type="text"
                value={aiQuestion}
                onChange={(e) => setAiQuestion(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    void runGroupAi()
                  }
                }}
                placeholder="z. B. Was sollten wir an der Grenze beachten?"
                className="min-w-0 flex-1 rounded-lg border border-outline-variant/50 bg-surface-container-lowest px-2.5 py-2 text-sm"
              />
              <button
                type="button"
                disabled={aiLoading}
                onClick={() => void runGroupAi()}
                className="shrink-0 rounded-lg bg-primary px-4 py-2 text-xs font-bold text-on-primary disabled:opacity-50"
              >
                {aiLoading ? '…' : 'Fragen'}
              </button>
            </div>
            <label className="mt-2 flex cursor-pointer items-center gap-2 text-[11px] font-medium text-on-surface">
              <input
                type="checkbox"
                checked={aiSaveMemory}
                onChange={(e) => setAiSaveMemory(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-outline-variant accent-primary"
              />
              Antwort für spätere KI-Fragen in dieser Gruppe merken
            </label>
            {aiAnswer ? (
              <div className="mt-2 max-h-40 overflow-y-auto rounded-lg border border-outline-variant/30 bg-surface-container-low px-3 py-2">
                <p className="whitespace-pre-wrap text-xs leading-relaxed text-on-surface">{aiAnswer.answer}</p>
                <p className="mt-1 text-[10px] text-on-surface-variant">
                  Modell: {aiAnswer.usedModel}
                  {aiAnswer.countries?.length ? ` · Länder: ${aiAnswer.countries.map((c) => c.name).join(', ')}` : ''}
                </p>
              </div>
            ) : null}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          <div className="mx-auto max-w-2xl space-y-3">
            {loading ? <p className="text-on-surface-variant">Laden…</p> : null}
            {err ? <p className="rounded-xl bg-error-container px-3 py-2 text-sm text-on-error-container">{err}</p> : null}
            {messages.map((m) => (
              <div
                key={m.id}
                className="rounded-2xl bg-surface-container-low px-4 py-3 shadow-sm"
              >
                <div className="mb-1 flex items-baseline justify-between gap-2">
                  <span className="font-bold text-on-surface">{m.authorName}</span>
                  <span className="shrink-0 text-xs text-on-surface-variant">{formatTime(m.createdAt)}</span>
                </div>
                {m.messageType === 'voice' && m.voiceUrl ? (
                  <div className="space-y-1">
                    {m.body?.trim() ? (
                      <p className="whitespace-pre-wrap text-sm text-on-surface-variant">{m.body}</p>
                    ) : null}
                    <VoiceAuthAudio
                      voicePath={m.voiceUrl}
                      token={token}
                      className="mt-1 h-10 min-h-10 w-full min-w-0 max-w-full"
                    />
                    {m.voiceDurationMs != null ? (
                      <p className="text-[10px] text-on-surface-variant">
                        {(m.voiceDurationMs / 1000).toFixed(1)} s
                      </p>
                    ) : null}
                  </div>
                ) : (
                  <p className="whitespace-pre-wrap text-on-surface-variant">{m.body}</p>
                )}
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
        </div>

        <footer className="shrink-0 border-t border-outline-variant/30 bg-surface-container-lowest p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <div className="mx-auto mb-2 flex max-w-2xl flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            <label className="flex cursor-pointer items-center gap-2 text-[11px] font-semibold text-on-surface-variant">
              <input
                type="checkbox"
                checked={pttNearbyOnly}
                onChange={(e) => setPttNearbyOnly(e.target.checked)}
                className="h-4 w-4 rounded border-outline-variant accent-primary"
              />
              Walkie nur an Gruppenmitglieder in der Nähe (~25 km, geteilte Kartenposition nötig)
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-[11px] font-semibold text-on-surface-variant">
              <input
                type="checkbox"
                checked={walkieArmed}
                onChange={(e) => setWalkieArmed(e.target.checked)}
                className="h-4 w-4 rounded border-outline-variant accent-primary"
              />
              Walkie-Talkie bereit (aus = kein Live-Mikrofon)
            </label>
          </div>
          <p className="mx-auto mb-2 max-w-2xl text-[10px] font-bold uppercase tracking-wide text-on-surface-variant">
            Live-Funk: Taste halten und sprechen; lange halten (~0,7 s) sperrt offenes Mikrofon bis Beenden oder erneuter
            Funk-Tipp. Sprachnachricht: Aufnahme antippen, erneut zum Senden.
          </p>
          <div className="mx-auto flex max-w-2xl flex-col gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  void send()
                }
              }}
              placeholder="Nachricht…"
              className="min-h-[3rem] w-full min-w-0 rounded-2xl border border-outline-variant bg-surface px-4 py-3 text-on-surface"
              maxLength={4000}
            />
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={!walkieArmed}
                onPointerDown={(e) => void handlePttButtonDown(e)}
                onPointerUp={handlePttButtonUp}
                onPointerCancel={handlePttButtonCancel}
                style={{ touchAction: 'none' }}
                className={`flex h-12 w-12 shrink-0 touch-none items-center justify-center rounded-2xl text-white active:scale-95 disabled:opacity-40 ${
                  pttLatchedUi
                    ? 'bg-error ring-2 ring-error/50'
                    : pttLiveUi
                      ? 'bg-tertiary ring-2 ring-white/40'
                      : 'bg-tertiary'
                }`}
                aria-label={
                  pttLatchedUi
                    ? 'Walkie-Talkie: angetippt zum Beenden des Dauerfunks'
                    : 'Walkie-Talkie: halten und sprechen, lange halten zum Sperren'
                }
                title={
                  walkieArmed
                    ? 'Halten = sprechen · lange halten = Mikro offen bis Beenden · antippen beendet Dauerfunk'
                    : 'Walkie zuerst aktivieren (Checkbox oben)'
                }
              >
                <span
                  className="material-symbols-outlined text-2xl"
                  style={{ fontVariationSettings: pttLiveUi || pttLatchedUi ? "'FILL' 1" : "'FILL' 0" }}
                  aria-hidden
                >
                  {pttLiveUi || pttLatchedUi ? 'mic' : 'radio'}
                </span>
              </button>
              {pttLiveUi || pttLatchedUi ? (
                <button
                  type="button"
                  onClick={() => releasePttAll()}
                  className="min-h-12 shrink-0 rounded-2xl border-2 border-error bg-surface px-3 py-2 text-sm font-bold text-error sm:px-4"
                >
                  Funk beenden
                </button>
              ) : null}
              <button
                type="button"
                disabled={voiceBusy}
                onClick={() => void toggleVoiceNote()}
                className={
                  isRecording
                    ? 'flex min-h-12 shrink-0 items-center gap-1 rounded-2xl bg-error px-3 py-2 text-sm font-bold text-on-error'
                    : 'flex min-h-12 shrink-0 items-center gap-1 rounded-2xl border border-outline-variant bg-surface-container-high px-3 py-2 text-sm font-bold text-on-surface'
                }
              >
                <span className="material-symbols-outlined text-xl">
                  {isRecording ? 'stop_circle' : 'fiber_manual_record'}
                </span>
                {isRecording ? 'Senden' : 'Sprache'}
              </button>
              <button
                type="button"
                onClick={() => void send()}
                className="ml-auto min-h-12 shrink-0 rounded-2xl bg-primary px-5 py-3 font-bold text-on-primary"
              >
                Senden
              </button>
            </div>
          </div>
        </footer>
      </main>
    </>
  )
}
