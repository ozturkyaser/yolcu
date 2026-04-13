import { useCallback, useRef, useState } from 'react'

function pickMime(): string {
  if (typeof MediaRecorder === 'undefined') return ''
  const c = 'audio/webm;codecs=opus'
  if (MediaRecorder.isTypeSupported(c)) return c
  if (MediaRecorder.isTypeSupported('audio/webm')) return 'audio/webm'
  return ''
}

export function useWebmVoiceRecord() {
  const [isRecording, setIsRecording] = useState(false)
  const recRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const startedRef = useRef(0)

  const start = useCallback(async () => {
    const mime = pickMime()
    if (!mime) throw new Error('Aufnahme wird von diesem Browser nicht unterstützt.')
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    const mr = new MediaRecorder(stream, { mimeType: mime })
    chunksRef.current = []
    startedRef.current = Date.now()
    mr.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data)
    }
    mr.start(200)
    recRef.current = mr
    setIsRecording(true)
  }, [])

  const stop = useCallback(async (): Promise<{ blob: Blob; durationMs: number } | null> => {
    const mr = recRef.current
    if (!mr) return null
    const mime = mr.mimeType || 'audio/webm'
    return new Promise((resolve) => {
      mr.onstop = () => {
        mr.stream.getTracks().forEach((t) => t.stop())
        recRef.current = null
        setIsRecording(false)
        const durationMs = Math.max(1, Date.now() - startedRef.current)
        const blob = new Blob(chunksRef.current, { type: mime })
        chunksRef.current = []
        resolve(blob.size >= 80 ? { blob, durationMs } : null)
      }
      mr.stop()
    })
  }, [])

  return { isRecording, start, stop }
}
