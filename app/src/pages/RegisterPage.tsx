import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export function RegisterPage() {
  const { register } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      await register(email, password, displayName)
      navigate('/', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registrierung fehlgeschlagen')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-dvh flex-col bg-surface px-6 py-12 font-sans text-on-surface">
      <Link to="/" className="mb-8 font-bold text-primary">
        ← Zurück
      </Link>
      <h1 className="mb-2 text-3xl font-bold text-primary">Konto erstellen</h1>
      <p className="mb-8 text-on-surface-variant">Mindestens 8 Zeichen Passwort</p>

      <form onSubmit={onSubmit} className="mx-auto w-full max-w-md space-y-4">
        {error ? (
          <div className="rounded-xl bg-error-container px-4 py-3 text-sm text-on-error-container">{error}</div>
        ) : null}
        <div>
          <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-on-surface-variant">
            Anzeigename
          </label>
          <input
            type="text"
            required
            minLength={1}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="w-full rounded-xl border border-outline-variant/30 bg-surface-container-lowest px-4 py-3 outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-on-surface-variant">
            E-Mail
          </label>
          <input
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-xl border border-outline-variant/30 bg-surface-container-lowest px-4 py-3 outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-on-surface-variant">
            Passwort
          </label>
          <input
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-xl border border-outline-variant/30 bg-surface-container-lowest px-4 py-3 outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-xl bg-gradient-to-br from-primary to-primary-container py-4 font-bold text-on-primary disabled:opacity-50"
        >
          {busy ? '…' : 'Registrieren'}
        </button>
      </form>

      <p className="mx-auto mt-8 max-w-md text-center text-sm text-on-surface-variant">
        Bereits registriert?{' '}
        <Link to="/login" className="font-bold text-primary">
          Anmelden
        </Link>
      </p>
    </div>
  )
}
