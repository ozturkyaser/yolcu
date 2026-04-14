import { useCallback, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useWebmVoiceRecord } from '../hooks/useWebmVoiceRecord'
import { postGroupMessage, postGroupVoiceMessage, type GroupSummary } from '../lib/api'

const VOICE_LONG_PRESS_MS = 650

type Props = {
  token: string | null
  user: { id: string } | null
  groups: GroupSummary[]
  /** Karten-Filter: bei „alle“ wird die erste Gruppe genutzt */
  mapGroupFilter: 'all' | string
}

export function GroupQuickWalkie({ token, user, groups, mapGroupFilter }: Props) {
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

  const onPointerDown = useCallback(
    async (e: ReactPointerEvent<HTMLButtonElement>) => {
      if (e.button !== 0) return
      if (!user) {
        navigate('/login')
        return
      }
      if (!token || groups.length === 0) return
      if (!targetGroup || voiceBusy || textBusy) return
      e.preventDefault()
      e.currentTarget.setPointerCapture(e.pointerId)
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
    [user, token, groups.length, targetGroup, voiceBusy, textBusy, startRec, navigate, showHint, clearLongPressTimer],
  )

  const onPointerEnd = useCallback(
    (e: ReactPointerEvent<HTMLButtonElement>) => {
      clearLongPressTimer()
      try {
        e.currentTarget.releasePointerCapture(e.pointerId)
      } catch {
        /* ignore */
      }
      if (recordLatchedRef.current) return
      void finishVoiceRecording('send')
    },
    [finishVoiceRecording, clearLongPressTimer],
  )

  const onPointerCancel = useCallback(
    (e: ReactPointerEvent<HTMLButtonElement>) => {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId)
      } catch {
        /* ignore */
      }
      void finishVoiceRecording('discard')
    },
    [finishVoiceRecording],
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

  if (!user) {
    return (
      <div className="pointer-events-none absolute top-1/2 left-1/2 z-[12] flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1">
        <button
          type="button"
          onClick={() => navigate('/login')}
          className="pointer-events-auto flex h-[4.5rem] w-[4.5rem] flex-col items-center justify-center rounded-full border-2 border-outline-variant/60 bg-surface-container-lowest/95 text-on-surface shadow-xl backdrop-blur-sm active:scale-95 sm:h-[5.25rem] sm:w-[5.25rem]"
          aria-label="Anmelden für Gruppen-Sprachnachricht"
        >
          <span className="material-symbols-outlined text-3xl text-primary" style={{ fontVariationSettings: "'FILL' 1" }}>
            perm_identity
          </span>
          <span className="mt-0.5 max-w-[5.5rem] text-center text-[9px] font-bold leading-tight">Login für Funk</span>
        </button>
      </div>
    )
  }

  if (groups.length === 0) {
    return (
      <div className="pointer-events-none absolute top-1/2 left-1/2 z-[12] flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1">
        <Link
          to="/groups"
          className="pointer-events-auto flex h-[4.5rem] w-[4.5rem] flex-col items-center justify-center rounded-full border-2 border-dashed border-outline-variant/70 bg-surface-container-lowest/90 text-on-surface-variant shadow-lg backdrop-blur-sm active:scale-95 sm:h-[5.25rem] sm:w-[5.25rem]"
          aria-label="Gruppe erstellen oder beitreten"
        >
          <span className="material-symbols-outlined text-2xl">groups</span>
          <span className="mt-0.5 max-w-[5.5rem] text-center text-[9px] font-bold leading-tight">Gruppe nötig</span>
        </Link>
      </div>
    )
  }

  const disabled = voiceBusy || textBusy || !targetGroup || recordLatchedUi
  const recording = isRecording

  return (
    <div className="pointer-events-none absolute top-1/2 left-1/2 z-[12] flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1.5">
      <div className="pointer-events-auto flex flex-col items-center gap-1">
        <button
          type="button"
          disabled={disabled}
          onPointerDown={onPointerDown}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerCancel}
          style={{ touchAction: 'none' }}
          className={`relative flex h-[4.75rem] w-[4.75rem] items-center justify-center rounded-full shadow-2xl transition-transform active:scale-[0.97] sm:h-[5.5rem] sm:w-[5.5rem] ${
            recordLatchedUi
              ? 'bg-tertiary text-on-tertiary ring-4 ring-tertiary/50'
              : recording
                ? 'bg-error text-on-error ring-4 ring-error/40'
                : 'bg-secondary text-on-secondary ring-4 ring-secondary/30'
          } disabled:opacity-45`}
          aria-label={`Walkie-Talkie: halten und sprechen. Gruppe ${targetGroup?.name ?? ''}`}
          title="Halten und loslassen = senden · lange halten = weiter sprechen, dann Senden oder Verwerfen"
        >
          {recording ? (
            <span className="material-symbols-outlined text-4xl sm:text-[2.75rem]" style={{ fontVariationSettings: "'FILL' 1" }}>
              graphic_eq
            </span>
          ) : (
            <span className="material-symbols-outlined text-4xl sm:text-[2.75rem]" style={{ fontVariationSettings: "'FILL' 1" }}>
              walkie_talkie
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
        <p className="max-w-[14rem] text-center text-[10px] font-semibold leading-tight text-on-surface shadow-sm">
          <span className="rounded-md bg-surface-container-lowest/90 px-1.5 py-0.5 backdrop-blur-sm">
            Halten · {targetGroup ? `→ ${targetGroup.name}` : 'Gruppe wählen'}
            {mapGroupFilter === 'all' && groups.length > 1 ? ' (erste Gruppe)' : ''}
          </span>
        </p>
        <button
          type="button"
          disabled={disabled}
          onClick={() => setTextOpen((o) => !o)}
          className="pointer-events-auto rounded-full border border-outline-variant/50 bg-surface-container-lowest/95 px-3 py-1 text-[10px] font-bold text-primary shadow-md backdrop-blur-sm active:scale-95"
        >
          {textOpen ? 'Schließen' : 'Kurztext'}
        </button>
      </div>

      {textOpen ? (
        <div className="pointer-events-auto flex w-[min(18rem,calc(100vw-2rem))] flex-col gap-1.5 rounded-2xl border border-outline-variant/40 bg-surface-container-lowest/98 p-2 shadow-xl backdrop-blur-md">
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
          className="pointer-events-auto text-[10px] font-bold text-primary underline drop-shadow-sm"
        >
          Gruppenchat öffnen
        </Link>
      )}

      {hint ? (
        <p className="pointer-events-none max-w-[16rem] rounded-lg bg-inverse-surface px-2 py-1 text-center text-[10px] font-medium text-inverse-on-surface shadow-lg">
          {hint}
        </p>
      ) : null}
    </div>
  )
}
