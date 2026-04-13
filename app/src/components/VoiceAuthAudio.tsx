import { useEffect, useState } from 'react'

type Props = {
  /** z. B. /api/groups/…/voice */
  voicePath: string
  token: string | null
  className?: string
}

/** Lädt geschütztes Audio mit Bearer-Token und spielt es ab. */
export function VoiceAuthAudio({ voicePath, token, className }: Props) {
  const [url, setUrl] = useState<string | null>(null)
  const [err, setErr] = useState(false)

  useEffect(() => {
    if (!token || !voicePath) {
      setUrl(null)
      return
    }
    let objectUrl: string | null = null
    let cancelled = false
    setErr(false)
    fetch(voicePath.startsWith('http') ? voicePath : voicePath, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => {
        if (!r.ok) throw new Error('load')
        return r.blob()
      })
      .then((blob) => {
        if (cancelled) return
        objectUrl = URL.createObjectURL(blob)
        setUrl(objectUrl)
      })
      .catch(() => {
        if (!cancelled) setErr(true)
      })
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [voicePath, token])

  if (!token) return <span className="text-xs text-on-surface-variant">Anmeldung nötig</span>
  if (err) return <span className="text-xs text-error">Audio nicht ladbar</span>
  if (!url) return <span className="text-xs text-on-surface-variant">Audio…</span>

  return <audio src={url} controls preload="none" className={className ?? 'mt-1 h-9 w-full max-w-xs'} />
}
