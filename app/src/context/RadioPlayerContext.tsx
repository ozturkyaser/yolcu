import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'

/** Musik leiser während Sprachnachrichten / entferntem PTT. */
const DUCK_RATIO = 0.14

export type RadioPlayerContextValue = {
  baseVolume: number
  setBaseVolume: (v: number) => void
  playingIntent: boolean
  setPlayingIntent: (v: boolean) => void
  selectedChannelId: string | null
  setSelectedChannelId: (id: string | null) => void
  streamUrl: string | null
  setStreamUrl: (u: string | null) => void
  /** Eingehende Sprachnachricht / Remote-PTT: Musik leiser. */
  beginVoiceMessagePlayback: () => void
  endVoiceMessagePlayback: () => void
  /** Eigene Aufnahme / Live-Sprech: Musik komplett aus. */
  beginUserCapture: () => void
  endUserCapture: () => void
}

const RadioPlayerContext = createContext<RadioPlayerContextValue | null>(null)

export function RadioPlayerProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [baseVolume, setBaseVolumeState] = useState(0.85)
  const [playingIntent, setPlayingIntent] = useState(false)
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null)
  const [streamUrl, setStreamUrl] = useState<string | null>(null)

  const voiceDepthRef = useRef(0)
  const captureDepthRef = useRef(0)

  const applyVolume = useCallback(() => {
    const el = audioRef.current
    if (!el) return
    let v = baseVolume
    if (captureDepthRef.current > 0) v = 0
    else if (voiceDepthRef.current > 0) v = baseVolume * DUCK_RATIO
    el.volume = Math.min(1, Math.max(0, v))
  }, [baseVolume])

  useEffect(() => {
    applyVolume()
  }, [applyVolume])

  const setBaseVolume = useCallback((v: number) => {
    setBaseVolumeState(Math.min(1, Math.max(0, v)))
  }, [])

  const beginVoiceMessagePlayback = useCallback(() => {
    voiceDepthRef.current += 1
    applyVolume()
  }, [applyVolume])

  const endVoiceMessagePlayback = useCallback(() => {
    voiceDepthRef.current = Math.max(0, voiceDepthRef.current - 1)
    applyVolume()
  }, [applyVolume])

  const beginUserCapture = useCallback(() => {
    captureDepthRef.current += 1
    applyVolume()
  }, [applyVolume])

  const endUserCapture = useCallback(() => {
    captureDepthRef.current = Math.max(0, captureDepthRef.current - 1)
    applyVolume()
  }, [applyVolume])

  useEffect(() => {
    const el = audioRef.current
    if (!el) return
    if (!streamUrl || !playingIntent) {
      el.pause()
      return
    }
    const prev = el.dataset.radioStream ?? ''
    if (prev !== streamUrl) {
      el.dataset.radioStream = streamUrl
      el.src = streamUrl
      el.load()
    }
    void el.play().catch(() => {
      /* Autoplay / Nutzerinteraktion */
    })
  }, [streamUrl, playingIntent])

  const value = useMemo(
    () => ({
      baseVolume,
      setBaseVolume,
      playingIntent,
      setPlayingIntent,
      selectedChannelId,
      setSelectedChannelId,
      streamUrl,
      setStreamUrl,
      beginVoiceMessagePlayback,
      endVoiceMessagePlayback,
      beginUserCapture,
      endUserCapture,
    }),
    [
      baseVolume,
      setBaseVolume,
      playingIntent,
      beginVoiceMessagePlayback,
      endVoiceMessagePlayback,
      beginUserCapture,
      endUserCapture,
      selectedChannelId,
      streamUrl,
    ],
  )

  return (
    <RadioPlayerContext.Provider value={value}>
      {children}
      <audio ref={audioRef} playsInline preload="none" className="pointer-events-none fixed h-px w-px opacity-0" aria-hidden />
    </RadioPlayerContext.Provider>
  )
}

export function useRadioPlayer(): RadioPlayerContextValue {
  const ctx = useContext(RadioPlayerContext)
  if (!ctx) {
    throw new Error('useRadioPlayer nur innerhalb von RadioPlayerProvider')
  }
  return ctx
}

export function useRadioPlayerOptional(): RadioPlayerContextValue | null {
  return useContext(RadioPlayerContext)
}
