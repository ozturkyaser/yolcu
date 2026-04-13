import { useCallback, useRef } from 'react'

function pcmToBase64(pcm: Int16Array): string {
  const u8 = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength)
  let binary = ''
  const step = 8192
  for (let i = 0; i < u8.length; i += step) {
    binary += String.fromCharCode(...u8.subarray(i, Math.min(i + step, u8.length)))
  }
  return btoa(binary)
}

export type PttStreamHandle = { stop: () => void }

/**
 * Push-to-Talk: PCM-Chunks über WebSocket (kein Server-Speicher).
 * Empfänger nutzt schedulePcmPlayback.
 */
export type PttStreamOptions = {
  /** Nur Gruppenmitglieder in ca. `nearbyKm` Entfernung (Server prüft letzte Kartenposition). */
  nearbyOnly?: boolean
  nearbyKm?: number
}

export async function startPttStream(
  ws: WebSocket,
  groupId: string,
  opts?: PttStreamOptions,
): Promise<PttStreamHandle> {
  const ctx = new AudioContext()
  const sampleRate = ctx.sampleRate
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  const source = ctx.createMediaStreamSource(stream)
  const processor = ctx.createScriptProcessor(4096, 1, 1)
  const mute = ctx.createGain()
  mute.gain.value = 0
  source.connect(processor)
  processor.connect(mute)
  mute.connect(ctx.destination)

  ws.send(
    JSON.stringify({
      type: 'voice_ptt',
      groupId,
      phase: 'start',
      sampleRate,
      nearbyOnly: opts?.nearbyOnly === true,
      nearbyKm: opts?.nearbyKm ?? 25,
    }),
  )

  processor.onaudioprocess = (ev) => {
    if (ws.readyState !== WebSocket.OPEN) return
    const input = ev.inputBuffer.getChannelData(0)
    const pcm = new Int16Array(input.length)
    for (let i = 0; i < input.length; i++) {
      const s = Math.max(-1, Math.min(1, input[i]))
      pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff
    }
    const pcmBase64 = pcmToBase64(pcm)
    ws.send(
      JSON.stringify({
        type: 'voice_ptt',
        groupId,
        phase: 'chunk',
        pcmBase64,
      }),
    )
  }

  return {
    stop: () => {
      try {
        processor.disconnect()
        mute.disconnect()
        source.disconnect()
        stream.getTracks().forEach((t) => t.stop())
        void ctx.close()
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'voice_ptt', groupId, phase: 'end' }))
        }
      } catch {
        /* ignore */
      }
    },
  }
}

export function usePttPlayback(userIdSelf: string | undefined) {
  const ctxRef = useRef<AudioContext | null>(null)
  const nextPlayRef = useRef(0)
  const rateBySpeakerRef = useRef<Map<string, number>>(new Map())

  const ensureCtx = useCallback(() => {
    if (!ctxRef.current || ctxRef.current.state === 'closed') {
      ctxRef.current = new AudioContext()
      nextPlayRef.current = ctxRef.current.currentTime
    }
    return ctxRef.current
  }, [])

  const handlePttPayload = useCallback(
    (data: {
      userId: string
      phase: string
      sampleRate?: number
      pcmBase64?: string
    }) => {
      if (data.userId === userIdSelf) return
      const ctx = ensureCtx()
      if (data.phase === 'start') {
        const r = data.sampleRate && data.sampleRate > 8000 ? data.sampleRate : 48000
        rateBySpeakerRef.current.set(data.userId, r)
        nextPlayRef.current = Math.max(nextPlayRef.current, ctx.currentTime)
        return
      }
      if (data.phase === 'end') {
        return
      }
      if (data.phase !== 'chunk' || !data.pcmBase64) return
      const sampleRate = rateBySpeakerRef.current.get(data.userId) ?? 48000
      try {
        const bin = atob(data.pcmBase64)
        const u8 = new Uint8Array(bin.length)
        for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i)
        const pcm = new Int16Array(u8.buffer, u8.byteOffset, u8.byteLength / 2)
        const f32 = new Float32Array(pcm.length)
        for (let i = 0; i < pcm.length; i++) f32[i] = pcm[i] / 32768
        const buf = ctx.createBuffer(1, f32.length, sampleRate)
        buf.copyToChannel(f32, 0)
        const src = ctx.createBufferSource()
        src.buffer = buf
        src.connect(ctx.destination)
        const startAt = Math.max(nextPlayRef.current, ctx.currentTime)
        src.start(startAt)
        nextPlayRef.current = startAt + buf.duration
      } catch {
        /* ignore corrupt chunk */
      }
    },
    [ensureCtx, userIdSelf],
  )

  return { handlePttPayload }
}
