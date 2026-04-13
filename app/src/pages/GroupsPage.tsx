import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { createGroup, fetchGroups, joinGroupByCode, type GroupSummary } from '../lib/api'
import { useAuth } from '../context/AuthContext'

export function GroupsPage() {
  const { token, user } = useAuth()
  const navigate = useNavigate()
  const [groups, setGroups] = useState<GroupSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [kind, setKind] = useState<'trip' | 'permanent'>('trip')
  const [inviteInput, setInviteInput] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    if (!token) return
    setLoading(true)
    setErr(null)
    try {
      const data = await fetchGroups(token)
      setGroups(data.groups)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Laden fehlgeschlagen')
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    if (!user) {
      navigate('/login')
      return
    }
    void load()
  }, [user, navigate, load])

  async function onCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!token || !name.trim()) return
    setBusy(true)
    setErr(null)
    try {
      const { group } = await createGroup(token, { name: name.trim(), kind })
      setName('')
      setGroups((prev) => [group, ...prev])
      navigate(`/groups/${group.id}`)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Erstellen fehlgeschlagen')
    } finally {
      setBusy(false)
    }
  }

  async function onJoin(e: React.FormEvent) {
    e.preventDefault()
    if (!token || !inviteInput.trim()) return
    setBusy(true)
    setErr(null)
    try {
      const { group } = await joinGroupByCode(token, inviteInput.trim())
      setInviteInput('')
      await load()
      navigate(`/groups/${group.id}`)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Beitritt fehlgeschlagen')
    } finally {
      setBusy(false)
    }
  }

  if (!user) return null

  return (
    <>
      <div className="fixed top-[72px] left-0 z-40 h-1 w-full bg-gradient-to-r from-secondary via-primary to-secondary opacity-80" />
      <main className="mx-auto max-w-2xl px-4 pt-6 pb-28">
        <h1 className="mb-2 text-2xl font-bold text-on-surface">Gruplar</h1>
        <p className="mb-6 text-sm text-on-surface-variant">
          Fahrt- oder Stammtisch-Gruppen mit echtem Chat und Einladungscode.
        </p>

        {err ? (
          <div className="mb-4 rounded-2xl bg-error-container p-4 text-sm text-on-error-container">{err}</div>
        ) : null}

        <section className="mb-8 rounded-[2rem] bg-surface-container-lowest p-6 shadow-sm">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-on-surface-variant">
            Neue Gruppe
          </h2>
          <form onSubmit={(e) => void onCreate(e)} className="space-y-3">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Gruppenname"
              className="w-full rounded-2xl border border-outline-variant bg-surface px-4 py-3 text-on-surface"
              maxLength={120}
            />
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as 'trip' | 'permanent')}
              className="w-full rounded-2xl border border-outline-variant bg-surface px-4 py-3 text-on-surface"
            >
              <option value="trip">Fahrt / Trip</option>
              <option value="permanent">Dauerhaft</option>
            </select>
            <button
              type="submit"
              disabled={busy || !name.trim()}
              className="w-full rounded-2xl bg-primary py-3 font-bold text-on-primary disabled:opacity-50"
            >
              Gruppe erstellen
            </button>
          </form>
        </section>

        <section className="mb-8 rounded-[2rem] bg-surface-container-lowest p-6 shadow-sm">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-on-surface-variant">
            Per Code beitreten
          </h2>
          <form onSubmit={(e) => void onJoin(e)} className="flex gap-2">
            <input
              value={inviteInput}
              onChange={(e) => setInviteInput(e.target.value.toUpperCase())}
              placeholder="Einladungscode"
              className="min-w-0 flex-1 rounded-2xl border border-outline-variant bg-surface px-4 py-3 font-mono text-on-surface uppercase"
              maxLength={12}
            />
            <button
              type="submit"
              disabled={busy || inviteInput.length < 6}
              className="shrink-0 rounded-2xl bg-secondary-container px-5 py-3 font-bold text-on-secondary-container disabled:opacity-50"
            >
              Join
            </button>
          </form>
        </section>

        <h2 className="mb-4 text-lg font-bold text-on-surface">Meine Gruppen</h2>
        {loading ? <p className="text-on-surface-variant">Laden…</p> : null}
        {!loading && groups.length === 0 ? (
          <p className="text-on-surface-variant">Du bist noch in keiner Gruppe.</p>
        ) : null}
        <ul className="space-y-3">
          {groups.map((g) => (
            <li key={g.id}>
              <Link
                to={`/groups/${g.id}`}
                className="flex items-center justify-between rounded-2xl bg-surface-container-low p-4 shadow-sm transition hover:bg-surface-container-high"
              >
                <div>
                  <p className="font-bold text-on-surface">{g.name}</p>
                  <p className="text-xs text-on-surface-variant">
                    {g.kind === 'trip' ? 'Trip' : 'Dauerhaft'} · {g.memberCount} Mitglieder · Code{' '}
                    <span className="font-mono">{g.inviteCode}</span>
                  </p>
                </div>
                <span className="material-symbols-outlined text-primary">chat</span>
              </Link>
            </li>
          ))}
        </ul>
      </main>
    </>
  )
}
