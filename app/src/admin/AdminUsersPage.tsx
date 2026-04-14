import { useCallback, useEffect, useState } from 'react'
import { fetchAdminUsers, patchAdminUser, type AdminUserRow } from '../lib/api'
import { useAuth } from '../context/AuthContext'

export function AdminUsersPage() {
  const { token, user, refreshMe } = useAuth()
  const [users, setUsers] = useState<AdminUserRow[]>([])
  const [q, setQ] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!token) return
    setErr(null)
    try {
      const { users: rows } = await fetchAdminUsers(token, { q: q.trim() || undefined, limit: 100 })
      setUsers(rows)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Laden fehlgeschlagen')
    }
  }, [token, q])

  useEffect(() => {
    const t = window.setTimeout(() => void load(), 300)
    return () => clearTimeout(t)
  }, [load])

  async function setRole(u: AdminUserRow, role: 'user' | 'admin') {
    if (!token) return
    setBusyId(u.id)
    setErr(null)
    try {
      await patchAdminUser(token, u.id, { role })
      await load()
      if (user?.id === u.id && role === 'user') await refreshMe()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Speichern fehlgeschlagen')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <h1 className="text-2xl font-black text-on-surface">Nutzer</h1>
      <p className="text-xs text-on-surface-variant">
        Admins können andere Konten zur Rolle <strong>admin</strong> hochstufen oder wieder auf <strong>user</strong>
        setzen. Der letzte verbleibende Admin kann nicht zurückgestuft werden.
      </p>
      <div className="flex flex-wrap gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Suche E-Mail oder Name…"
          className="min-w-[12rem] flex-1 rounded-xl border border-outline-variant bg-surface px-3 py-2 text-sm"
        />
        <button
          type="button"
          onClick={() => void load()}
          className="rounded-xl bg-primary px-4 py-2 text-sm font-bold text-on-primary"
        >
          Aktualisieren
        </button>
      </div>
      {err ? <p className="rounded-xl bg-error-container px-3 py-2 text-sm text-on-error-container">{err}</p> : null}
      <div className="overflow-x-auto rounded-2xl border border-outline-variant/50">
        <table className="w-full min-w-[36rem] text-left text-sm">
          <thead className="border-b border-outline-variant/50 bg-surface-container-low text-xs uppercase text-on-surface-variant">
            <tr>
              <th className="px-3 py-2">E-Mail</th>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Rolle</th>
              <th className="px-3 py-2">Aktion</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b border-outline-variant/30">
                <td className="px-3 py-2 font-mono text-xs">{u.email}</td>
                <td className="px-3 py-2">{u.displayName}</td>
                <td className="px-3 py-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
                      u.role === 'admin' ? 'bg-tertiary-container text-on-tertiary-container' : 'bg-surface-dim text-on-surface-variant'
                    }`}
                  >
                    {u.role}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <div className="flex flex-col gap-1">
                    {user?.id === u.id ? (
                      <span className="text-[10px] font-bold text-on-surface-variant">Dein Konto</span>
                    ) : null}
                    <div className="flex flex-wrap gap-1">
                      {u.role !== 'admin' ? (
                        <button
                          type="button"
                          disabled={busyId === u.id}
                          onClick={() => void setRole(u, 'admin')}
                          className="rounded-lg bg-primary px-2 py-1 text-[11px] font-bold text-on-primary disabled:opacity-40"
                        >
                          Zu Admin hochstufen
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={busyId === u.id}
                          onClick={() => void setRole(u, 'user')}
                          className="rounded-lg border border-outline-variant px-2 py-1 text-[11px] font-bold disabled:opacity-40"
                        >
                          Admin entziehen
                        </button>
                      )}
                    </div>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
