import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useWebmVoiceRecord } from '../hooks/useWebmVoiceRecord'
import { postGroupMessage, postGroupVoiceMessage, type GroupSummary } from '../lib/api'

const VOICE_LONG_PRESS_MS = 650
/** Ab diesem Versatz (px) zählt die Geste als Verschieben statt Tippen/Halten. */
const FAB_DRAG_SLOP_PX = 18

const LS_FAB_POS = 'yol_map_walkie_fab_pos'

type FabPos = { left: number; top: number }

/** Karten-Overlay: genug Platz für Funk + Kurztext-Palette (Clamp). */
function clampFabPos(left: number, top: number, vw: number, vh: number): FabPos {
  const pad = 6
  const panelW = Math.min(300, vw - pad * 2)
  const panelH = Math.min(440, vh - pad - 96)
  const topMin = 56
  const bottomReserved = 108
  const l = Math.min(Math.max(pad, left), vw - panelW - pad)
  const t = Math.min(Math.max(topMin, top), vh - panelH - bottomReserved - pad)
  return { left: l, top: t }
}

function readFabPos(vw: number, vh: number): FabPos {
  try {
    const raw = localStorage.getItem(LS_FAB_POS)
    if (raw) {
      const j = JSON.parse(raw) as FabPos
      if (typeof j.left === 'number' && typeof j.top === 'number') return clampFabPos(j.left, j.top, vw, vh)
    }
  } catch {
    /* ignore */
  }
  /* Start rechts: eine FAB-Spalte + Rand (Clamp korrigiert bei schmalen Screens). */
  return clampFabPos(vw - 64, vh * 0.32, vw, vh)
}

type Props = {
  token: string | null
  user: { id: string } | null
  groups: GroupSummary[]
  /** Karten-Filter: bei „alle“ wird die erste Gruppe genutzt */
  mapGroupFilter: 'all' | string
  /** `map`: Overlay auf der Karte (Standard). `bottom-nav`: zentrale Funk-Taste in der Tab-Leiste + Sheet. */
  dock?: 'map' | 'bottom-nav'
}

export function GroupQuickWalkie({ token, user, groups, mapGroupFilter, dock = 'map' }: Props) {
  const navigate = useNavigate()
  const { isRecording, start: startRec, stop: stopRec } = useWebmVoiceRecord()
  const [voiceBusy, setVoiceBusy] = useState(false)
  const [textBusy, setTextBusy] = useState(false)
  const [textOpen, setTextOpen] = useState(false)
  const [quickText, setQuickText] = useState('')
  const [hint, setHint] = useState<string | null>(null)
  const [recordLatchedUi, setRecordLatchedUi] = useState(false)
  const pointerActiveRef = useRef(false)
  const recordLatchedRef = useRef(false)
  const recordDownAtRef = useRef(0)
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const suppressClickAfterFabDragRef = useRef(false)
  const [dockSheetOpen, setDockSheetOpen] = useState(false)

  const fabDragRef = useRef<{
    pointerId: number
    sx: number
    sy: number
    ol: number
    ot: number
    dragging: boolean
  } | null>(null)

  const targetGroup = useMemo(() => {
    if (groups.length === 0) return null
    if (mapGroupFilter !== 'all') {
      const g = groups.find((x) => x.id === mapGroupFilter)
      if (g) return g
    }
    return groups[0] ?? null
  }, [groups, mapGroupFilter])

  const showHint = useCallback((msg: string) => {
    setHint(msg)
    window.setTimeout(() => setHint(null), 3200)
  }, [])

  const clearLongPressTimer = useCallback(() => {
    if (longPressTimerRef.current != null) {
      clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }
  }, [])

  const [fabPos, setFabPos] = useState<FabPos>(() =>
    typeof window !== 'undefined'
      ? readFabPos(window.innerWidth, window.innerHeight)
      : { left: 16, top: 120 },
  )

  useEffect(() => {
    const onResize = () => {
      setFabPos((p) => clampFabPos(p.left, p.top, window.innerWidth, window.innerHeight))
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const persistFabPos = useCallback((p: FabPos) => {
    try {
      localStorage.setItem(LS_FAB_POS, JSON.stringify(p))
    } catch {
      /* ignore */
    }
  }, [])

  const fabDragPointerDown = useCallback(
    (e: ReactPointerEvent<Element>) => {
      if (dock === 'bottom-nav') return
      if (e.button !== 0) return
      fabDragRef.current = {
        pointerId: e.pointerId,
        sx: e.clientX,
        sy: e.clientY,
        ol: fabPos.left,
        ot: fabPos.top,
        dragging: false,
      }
      e.currentTarget.setPointerCapture(e.pointerId)
    },
    [dock, fabPos.left, fabPos.top],
  )

  const fabDragPointerMove = useCallback((e: ReactPointerEvent<Element>) => {
    if (dock === 'bottom-nav') return
    const s = fabDragRef.current
    if (!s || e.pointerId !== s.pointerId) return
    const dx = e.clientX - s.sx
    const dy = e.clientY - s.sy
    if (!s.dragging) {
      if (dx * dx + dy * dy < FAB_DRAG_SLOP_PX * FAB_DRAG_SLOP_PX) return
      s.dragging = true
    }
    e.preventDefault()
    const vw = window.innerWidth
    const vh = window.innerHeight
    setFabPos(clampFabPos(s.ol + dx, s.ot + dy, vw, vh))
  }, [dock])

  /** @returns true wenn die Geste ein Verschieben war (kein Tippen auf denselben Punkt). */
  const fabDragPointerUpOrCancel = useCallback(
    (e: ReactPointerEvent<Element>): boolean => {
      if (dock === 'bottom-nav') return false
      const s = fabDragRef.current
      if (!s || e.pointerId !== s.pointerId) return false
      const wasDragging = s.dragging
      fabDragRef.current = null
      try {
        e.currentTarget.releasePointerCapture(e.pointerId)
      } catch {
        /* ignore */
      }
      if (wasDragging) {
        suppressClickAfterFabDragRef.current = true
        setFabPos((p) => {
          persistFabPos(p)
          return p
        })
      }
      return wasDragging
    },
    [dock, persistFabPos],
  )

  const finishVoiceRecording = useCallback(
    async (mode: 'send' | 'discard') => {
      if (!pointerActiveRef.current && !recordLatchedRef.current) return
      pointerActiveRef.current = false
      recordLatchedRef.current = false
      setRecordLatchedUi(false)
      clearLongPressTimer()
      if (mode === 'discard') {
        await stopRec()
        return
      }
      if (!token || !targetGroup) {
        await stopRec()
        return
      }
      setVoiceBusy(true)
      try {
        const pack = await stopRec()
        if (!pack) {
          showHint('Zu kurz – nochmal halten und sprechen.')
          return
        }
        await postGroupVoiceMessage(token, targetGroup.id, pack.blob, pack.durationMs)
        showHint(`Sprachnachricht an „${targetGroup.name}“ gesendet.`)
      } catch (e) {
        showHint(e instanceof Error ? e.message : 'Senden fehlgeschlagen.')
      } finally {
        setVoiceBusy(false)
      }
    },
    [token, targetGroup, stopRec, showHint, clearLongPressTimer],
  )

  const onWalkiePointerMove = useCallback(
    (e: ReactPointerEvent<HTMLButtonElement>) => {
      if (dock === 'bottom-nav') return
      const s = fabDragRef.current
      if (!s || e.pointerId !== s.pointerId) return
      const dx = e.clientX - s.sx
      const dy = e.clientY - s.sy
      if (!s.dragging) {
        if (dx * dx + dy * dy < FAB_DRAG_SLOP_PX * FAB_DRAG_SLOP_PX) return
        s.dragging = true
        pointerActiveRef.current = false
        recordLatchedRef.current = false
        setRecordLatchedUi(false)
        clearLongPressTimer()
        void stopRec()
      }
      e.preventDefault()
      const vw = window.innerWidth
      const vh = window.innerHeight
      setFabPos(clampFabPos(s.ol + dx, s.ot + dy, vw, vh))
    },
    [dock, clearLongPressTimer, stopRec],
  )

  const onPointerDown = useCallback(
    async (e: ReactPointerEvent<HTMLButtonElement>) => {
      if (e.button !== 0) return
      if (recordLatchedUi) {
        fabDragPointerDown(e)
        e.preventDefault()
        return
      }
      fabDragPointerDown(e)
      if (!token || !targetGroup || voiceBusy || textBusy) {
        e.preventDefault()
        return
      }
      e.preventDefault()
      pointerActiveRef.current = true
      try {
        await startRec()
        recordDownAtRef.current = Date.now()
        clearLongPressTimer()
        longPressTimerRef.current = window.setTimeout(() => {
          longPressTimerRef.current = null
          if (pointerActiveRef.current) {
            recordLatchedRef.current = true
            setRecordLatchedUi(true)
          }
        }, VOICE_LONG_PRESS_MS)
        if (Date.now() - recordDownAtRef.current >= VOICE_LONG_PRESS_MS && pointerActiveRef.current) {
          recordLatchedRef.current = true
          setRecordLatchedUi(true)
        }
      } catch (err) {
        pointerActiveRef.current = false
        clearLongPressTimer()
        try {
          e.currentTarget.releasePointerCapture(e.pointerId)
        } catch {
          /* ignore */
        }
        showHint(err instanceof Error ? err.message : 'Mikrofon nicht verfügbar.')
      }
    },
    [token, targetGroup, voiceBusy, textBusy, startRec, showHint, clearLongPressTimer, fabDragPointerDown, recordLatchedUi],
  )

  const onPointerEnd = useCallback(
    (e: ReactPointerEvent<HTMLButtonElement>) => {
      if (fabDragPointerUpOrCancel(e)) return
      clearLongPressTimer()
      try {
        e.currentTarget.releasePointerCapture(e.pointerId)
      } catch {
        /* ignore */
      }
      if (recordLatchedRef.current) return
      void finishVoiceRecording('send')
    },
    [finishVoiceRecording, clearLongPressTimer, fabDragPointerUpOrCancel],
  )

  const onPointerCancel = useCallback(
    (e: ReactPointerEvent<HTMLButtonElement>) => {
      if (fabDragPointerUpOrCancel(e)) return
      try {
        e.currentTarget.releasePointerCapture(e.pointerId)
      } catch {
        /* ignore */
      }
      void finishVoiceRecording('discard')
    },
    [finishVoiceRecording, fabDragPointerUpOrCancel],
  )

  async function sendQuickText() {
    const t = quickText.trim()
    if (!token || !targetGroup || t.length < 1) return
    setTextBusy(true)
    try {
      await postGroupMessage(token, targetGroup.id, t)
      setQuickText('')
      setTextOpen(false)
      showHint(`Nachricht an „${targetGroup.name}“ gesendet.`)
    } catch (e) {
      showHint(e instanceof Error ? e.message : 'Senden fehlgeschlagen.')
    } finally {
      setTextBusy(false)
    }
  }

  const mapWalkieShell = useCallback(
    (content: ReactNode) => (
      <div
        className="pointer-events-none fixed z-[12] flex flex-col items-end gap-1"
        style={{ left: fabPos.left, top: fabPos.top }}
      >
        <div className="pointer-events-auto flex flex-col items-end gap-1.5">{content}</div>
      </div>
    ),
    [fabPos.left, fabPos.top],
  )

  const wrapShell = useCallback(
    (content: ReactNode) => {
      if (dock === 'bottom-nav') {
        return (
          <>
            <div className="relative z-[56] flex w-full flex-col items-center">
              <button
                type="button"
                onClick={() => setDockSheetOpen(true)}
                className="relative -mt-[3.25rem] flex h-[3.75rem] w-[3.75rem] shrink-0 items-center justify-center rounded-2xl border-[3px] border-surface-container-lowest bg-gradient-to-br from-secondary via-secondary to-secondary-container text-on-secondary shadow-[0_10px_32px_rgba(26,28,28,0.35)] ring-2 ring-secondary/35 transition-transform active:scale-[0.96] sm:h-16 sm:w-16"
                aria-label="Gruppen-Funk öffnen"
                aria-expanded={dockSheetOpen}
                title="Funk"
              >
                <span
                  className="material-symbols-outlined text-[2rem] sm:text-[2.25rem]"
                  style={{ fontVariationSettings: "'FILL' 1" }}
                  aria-hidden
                >
                  radio
                </span>
              </button>
            </div>
            {dockSheetOpen ? (
              <div
                className="fixed inset-0 z-[200] flex flex-col justify-end bg-black/50"
                role="dialog"
                aria-modal
                aria-label="Gruppen-Funk"
              >
                <button
                  type="button"
                  className="min-h-0 flex-1 cursor-default"
                  aria-label="Schließen"
                  onClick={() => setDockSheetOpen(false)}
                />
                <div className="max-h-[min(82dvh,560px)] overflow-y-auto rounded-t-[1.75rem] border border-outline-variant/50 bg-surface-container-lowest px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-[0_-12px_40px_rgba(0,0,0,0.2)]">
                  <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-outline-variant/60" aria-hidden />
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <p className="text-base font-black text-on-surface">Gruppen-Funk</p>
                    <button
                      type="button"
                      onClick={() => setDockSheetOpen(false)}
                      className="rounded-full p-2 text-on-surface-variant hover:bg-surface-container-high"
                      aria-label="Schließen"
                    >
                      <span className="material-symbols-outlined text-xl">close</span>
                    </button>
                  </div>
                  <div className="pointer-events-auto flex flex-col items-stretch gap-2">{content}</div>
                </div>
              </div>
            ) : null}
          </>
        )
      }
      return mapWalkieShell(content)
    },
    [dock, dockSheetOpen, mapWalkieShell],
  )

  if (!user) {
    return wrapShell(
      <button
        type="button"
        onPointerDown={dock === 'map' ? fabDragPointerDown : undefined}
        onPointerMove={dock === 'map' ? fabDragPointerMove : undefined}
        onPointerUp={dock === 'map' ? (e) => void fabDragPointerUpOrCancel(e) : undefined}
        onPointerCancel={dock === 'map' ? (e) => void fabDragPointerUpOrCancel(e) : undefined}
        onClick={() => {
          if (dock === 'map' && suppressClickAfterFabDragRef.current) {
            suppressClickAfterFabDragRef.current = false
            return
          }
          setDockSheetOpen(false)
          navigate('/login')
        }}
        className={
          dock === 'map'
            ? 'flex h-10 w-10 cursor-grab touch-none items-center justify-center rounded-full border border-outline-variant/35 bg-surface-container-lowest text-on-surface-variant shadow-lg backdrop-blur-sm ring-2 ring-primary/20 active:scale-95 active:cursor-grabbing'
            : 'mx-auto flex w-full max-w-md touch-none items-center justify-center gap-2 rounded-2xl border border-outline-variant/40 bg-primary/10 py-3.5 text-sm font-black text-primary shadow-sm active:scale-[0.99]'
        }
        aria-label="Anmelden für Gruppen-Sprachnachricht"
        title="Login"
      >
        <span className="material-symbols-outlined text-xl text-primary" style={{ fontVariationSettings: "'FILL' 1" }}>
          perm_identity
        </span>
        {dock === 'bottom-nav' ? <span>Anmelden für Funk</span> : null}
      </button>,
    )
  }

  if (groups.length === 0) {
    return wrapShell(
      <Link
        to="/groups"
        onPointerDown={dock === 'map' ? fabDragPointerDown : undefined}
        onPointerMove={dock === 'map' ? fabDragPointerMove : undefined}
        onPointerUp={dock === 'map' ? (e) => void fabDragPointerUpOrCancel(e) : undefined}
        onPointerCancel={dock === 'map' ? (e) => void fabDragPointerUpOrCancel(e) : undefined}
        onClick={(e) => {
          if (dock === 'map' && suppressClickAfterFabDragRef.current) {
            e.preventDefault()
            suppressClickAfterFabDragRef.current = false
            return
          }
          setDockSheetOpen(false)
        }}
        className={
          dock === 'map'
            ? 'flex h-10 w-10 cursor-grab touch-none items-center justify-center rounded-full border border-dashed border-outline-variant/60 bg-surface-container-lowest text-on-surface-variant shadow-md backdrop-blur-sm active:scale-95 active:cursor-grabbing'
            : 'mx-auto flex w-full max-w-md items-center justify-center gap-2 rounded-2xl border border-dashed border-primary/40 bg-surface-container-high py-3.5 text-sm font-black text-primary active:scale-[0.99]'
        }
        aria-label="Gruppe erstellen oder beitreten"
        title="Gruppe für Funk"
      >
        <span className="material-symbols-outlined text-xl">groups</span>
        {dock === 'bottom-nav' ? <span>Gruppe beitreten / anlegen</span> : null}
      </Link>,
    )
  }

  const disabled = voiceBusy || textBusy || !targetGroup
  const recording = isRecording

  return wrapShell(
    <>
      <div className={`flex flex-col gap-1 ${dock === 'map' ? 'items-end' : 'items-stretch'}`}>
        <button
          type="button"
          disabled={disabled}
          onPointerDown={onPointerDown}
          onPointerMove={
            dock === 'bottom-nav' ? undefined : recordLatchedUi ? fabDragPointerMove : onWalkiePointerMove
          }
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerCancel}
          style={{ touchAction: 'none' }}
          className={`relative flex touch-none items-center justify-center rounded-full shadow-lg transition-transform active:scale-95 ${
            dock === 'map'
              ? 'h-10 w-10 cursor-grab active:cursor-grabbing'
              : 'mx-auto h-14 w-14 cursor-pointer sm:h-16 sm:w-16'
          } ${
            recordLatchedUi
              ? 'bg-tertiary text-on-tertiary ring-2 ring-tertiary/45'
              : recording
                ? 'bg-error text-on-error ring-2 ring-error/35'
                : 'bg-secondary text-on-secondary ring-2 ring-secondary/25'
          } disabled:opacity-45`}
          aria-label={`Walkie-Talkie: halten und sprechen. Gruppe ${targetGroup?.name ?? ''}`}
          title={
            dock === 'map'
              ? 'Halten = sprechen · wegziehen = verschieben · lange halten = weiter sprechen'
              : 'Halten = sprechen · lange halten = weiter sprechen'
          }
        >
          {recording ? (
            <span
              className={`material-symbols-outlined ${dock === 'map' ? 'text-xl' : 'text-3xl sm:text-[2.25rem]'}`}
              style={{ fontVariationSettings: "'FILL' 1" }}
              aria-hidden
            >
              graphic_eq
            </span>
          ) : (
            <span
              className={`material-symbols-outlined ${dock === 'map' ? 'text-xl' : 'text-3xl sm:text-[2.25rem]'}`}
              style={{ fontVariationSettings: "'FILL' 1" }}
              aria-hidden
            >
              radio
            </span>
          )}
        </button>
        {recordLatchedUi ? (
          <div className="flex gap-2 rounded-xl border border-outline-variant/60 bg-surface-container-lowest/98 px-2 py-1.5 shadow-lg backdrop-blur-md">
            <button
              type="button"
              disabled={voiceBusy}
              onClick={() => void finishVoiceRecording('send')}
              className="rounded-lg bg-primary px-3 py-1.5 text-[11px] font-bold text-on-primary disabled:opacity-40"
            >
              {voiceBusy ? '…' : 'Senden'}
            </button>
            <button
              type="button"
              disabled={voiceBusy}
              onClick={() => void finishVoiceRecording('discard')}
              className="rounded-lg border border-outline-variant px-3 py-1.5 text-[11px] font-bold text-on-surface disabled:opacity-40"
            >
              Verwerfen
            </button>
          </div>
        ) : null}
        <p
          className={`text-center text-[10px] font-semibold leading-tight text-on-surface shadow-sm ${
            dock === 'map' ? 'max-w-[14rem]' : 'max-w-md self-center'
          }`}
        >
          <span className="rounded-md bg-surface-container-lowest/90 px-1.5 py-0.5 backdrop-blur-sm">
            Halten · {targetGroup ? `→ ${targetGroup.name}` : 'Gruppe wählen'}
            {mapGroupFilter === 'all' && groups.length > 1 ? ' (erste Gruppe)' : ''}
          </span>
        </p>
        <button
          type="button"
          disabled={disabled}
          onClick={() => setTextOpen((o) => !o)}
          className="rounded-full border border-outline-variant/50 bg-surface-container-lowest/95 px-3 py-1 text-[10px] font-bold text-primary shadow-md backdrop-blur-sm active:scale-95"
        >
          {textOpen ? 'Schließen' : 'Kurztext'}
        </button>
      </div>

      {textOpen ? (
        <div
          className={`flex flex-col gap-1.5 rounded-2xl border border-outline-variant/40 bg-surface-container-lowest/98 p-2 shadow-xl backdrop-blur-md ${
            dock === 'map' ? 'w-[min(18rem,calc(100vw-2rem))]' : 'w-full max-w-md self-center'
          }`}
        >
          <input
            type="text"
            value={quickText}
            onChange={(e) => setQuickText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void sendQuickText()
            }}
            placeholder="Schnelle Nachricht…"
            maxLength={400}
            className="w-full rounded-xl border border-outline-variant/50 bg-surface-container-low px-3 py-2 text-sm text-on-surface"
            autoComplete="off"
          />
          <div className="flex justify-end gap-2">
            <Link
              to={targetGroup ? `/groups/${targetGroup.id}` : '/groups'}
              onClick={() => setDockSheetOpen(false)}
              className="rounded-lg px-2 py-1 text-xs font-bold text-primary underline"
            >
              Zum Chat
            </Link>
            <button
              type="button"
              disabled={textBusy || quickText.trim().length < 1}
              onClick={() => void sendQuickText()}
              className="rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-on-primary disabled:opacity-40"
            >
              {textBusy ? '…' : 'Senden'}
            </button>
          </div>
        </div>
      ) : (
        <Link
          to={targetGroup ? `/groups/${targetGroup.id}` : '/groups'}
          onClick={() => setDockSheetOpen(false)}
          className="text-center text-[10px] font-bold text-primary underline drop-shadow-sm"
        >
          Gruppenchat öffnen
        </Link>
      )}

      {hint ? (
        <p className="pointer-events-none max-w-[16rem] rounded-lg bg-inverse-surface px-2 py-1 text-center text-[10px] font-medium text-inverse-on-surface shadow-lg">
          {hint}
        </p>
      ) : null}
    </>,
  )
}
