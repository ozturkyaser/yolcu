/** Deutsche Sprachansagen für die Web-Navigation (Web Speech API). */

export function metersSpokenGerman(m: number): string {
  if (!Number.isFinite(m) || m < 0) return '0 Metern'
  if (m >= 1000) {
    const km = m / 1000
    const rounded = km >= 10 ? Math.round(km) : Math.round(km * 10) / 10
    return `${String(rounded).replace('.', ',')} Kilometern`
  }
  return `${Math.round(m)} Metern`
}

export function speakNavigationGerman(text: string): void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return
  const synth = window.speechSynthesis
  synth.cancel()
  const u = new SpeechSynthesisUtterance(text.trim())
  u.lang = 'de-DE'
  u.rate = 0.98
  u.pitch = 1
  synth.speak(u)
}

export function stopNavigationVoice(): void {
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    window.speechSynthesis.cancel()
  }
}

export type ScreenWakeSentinel = { release: () => Promise<void> }

/** Screen Wake Lock (Chrome/Edge/Android); bei Fehler null. */
export async function requestScreenWakeLock(): Promise<ScreenWakeSentinel | null> {
  if (typeof navigator === 'undefined') return null
  const w = navigator as Navigator & {
    wakeLock?: { request: (type: 'screen') => Promise<ScreenWakeSentinel> }
  }
  if (!w.wakeLock?.request) return null
  try {
    return (await w.wakeLock.request('screen')) as ScreenWakeSentinel
  } catch {
    return null
  }
}
