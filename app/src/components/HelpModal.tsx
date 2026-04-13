import { useState } from 'react'
import { apiFetch } from '../lib/api'
import { useAuth } from '../context/AuthContext'

type Props = {
  open: boolean
  onClose: () => void
}

const categories = [
  { id: 'breakdown', label: 'Panne' },
  { id: 'medical', label: 'Medizinisch' },
  { id: 'unsafe', label: 'Unsicher' },
  { id: 'other', label: 'Sonstiges' },
] as const

export function HelpModal({ open, onClose }: Props) {
  const { token, user } = useAuth()
  const [category, setCategory] = useState<(typeof categories)[number]['id']>('breakdown')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (!open) return null

  async function submit() {
    setError(null)
    setDone(null)
    if (!token || !user) {
      setError('Bitte anmelden, um Hilfe anzufragen.')
      return
    }
    setBusy(true)
    try {
      let lat: number | undefined
      let lng: number | undefined
      if (navigator.geolocation) {
        const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 8000 })
        }).catch(() => null)
        if (pos) {
          lat = pos.coords.latitude
          lng = pos.coords.longitude
        }
      }
      const res = await apiFetch<{ hint?: string }>('/distress', {
        method: 'POST',
        token,
        body: JSON.stringify({ category, message: message || undefined, lat, lng }),
      })
      setDone(res.hint ?? 'Hilfeanfrage wurde gespeichert.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Fehler')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center bg-black/50 p-4 sm:items-center"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-title"
        className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-3xl bg-surface-container-lowest p-6 shadow-2xl"
      >
        <h2 id="help-title" className="mb-2 text-2xl font-black text-primary">
          Hilfe anfragen
        </h2>
        <p className="mb-4 text-sm text-on-surface-variant">
          Diese App ist <strong>kein offizieller Notruf</strong>. In Notfällen wähle{' '}
          <a href="tel:112" className="font-bold text-error underline">
            112
          </a>
          .
        </p>

        <a
          href="tel:112"
          className="mb-6 flex items-center justify-center gap-2 rounded-2xl bg-error py-4 font-black text-on-error"
        >
          <span className="material-symbols-outlined fill">call</span>
          Notruf 112
        </a>

        {!user ? (
          <p className="rounded-xl bg-secondary-container/30 p-4 text-sm text-on-secondary-container">
            Melde dich an, damit wir deine Anfrage speichern und später Helfer in der Nähe benachrichtigen können.
          </p>
        ) : null}

        {done ? (
          <p className="mb-4 rounded-xl bg-primary-fixed/30 p-4 text-sm font-medium text-on-surface">{done}</p>
        ) : null}
        {error ? (
          <p className="mb-4 rounded-xl bg-error-container p-4 text-sm text-on-error-container">{error}</p>
        ) : null}

        <p className="mb-2 text-xs font-bold uppercase tracking-wide text-on-surface-variant">Kategorie</p>
        <div className="mb-4 flex flex-wrap gap-2">
          {categories.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setCategory(c.id)}
              className={`rounded-full px-4 py-2 text-sm font-bold ${
                category === c.id
                  ? 'bg-primary text-on-primary'
                  : 'bg-surface-container-low text-on-surface-variant'
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>

        <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-on-surface-variant">
          Nachricht (optional)
        </label>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          maxLength={500}
          rows={3}
          className="mb-6 w-full rounded-xl border border-outline-variant/30 bg-surface px-3 py-2 text-on-surface"
        />

        <div className="flex gap-3">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-xl bg-surface-container-high py-3 font-bold text-on-surface"
          >
            Schließen
          </button>
          <button
            type="button"
            disabled={busy || !user}
            onClick={() => void submit()}
            className="flex-1 rounded-xl bg-gradient-to-br from-primary to-primary-container py-3 font-bold text-on-primary disabled:opacity-50"
          >
            {busy ? '…' : 'In App senden'}
          </button>
        </div>
      </div>
    </div>
  )
}
