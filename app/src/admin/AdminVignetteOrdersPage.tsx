import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  fetchAdminVignetteOrderRequests,
  fetchAdminVignetteProducts,
  patchAdminVignetteOrderRequest,
  type VignetteOrderRequestAdminDto,
  type VignetteServiceProductDto,
} from '../lib/api'
import { useAuth } from '../context/AuthContext'

const statusOptions = ['pending', 'in_review', 'quoted', 'paid', 'fulfilled', 'cancelled'] as const

const statusLabelDe: Record<string, string> = {
  pending: 'Neu',
  in_review: 'In Prüfung',
  quoted: 'Angebot',
  paid: 'Bezahlt',
  fulfilled: 'Erfüllt',
  cancelled: 'Storniert',
}

function formatCountries(raw: unknown): string {
  if (!Array.isArray(raw)) return '—'
  const parts = raw
    .map((c) => {
      if (c && typeof c === 'object' && 'name' in c) return String((c as { name: string }).name)
      return null
    })
    .filter(Boolean)
  return parts.length ? parts.join(' → ') : '—'
}

export function AdminVignetteOrdersPage() {
  const { token } = useAuth()
  const [requests, setRequests] = useState<VignetteOrderRequestAdminDto[]>([])
  const [catalog, setCatalog] = useState<VignetteServiceProductDto[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [draft, setDraft] = useState<{
    status: (typeof statusOptions)[number]
    adminNote: string
    quotedTotalEur: string
  }>({ status: 'pending', adminNote: '', quotedTotalEur: '' })

  const titleById = useMemo(() => {
    const m = new Map<string, string>()
    for (const p of catalog) m.set(p.id, p.title)
    return m
  }, [catalog])

  const catalogSumByRequest = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of requests) {
      let sum = 0
      for (const id of r.productIds) {
        const p = catalog.find((x) => x.id === id)
        if (p) {
          sum += p.serviceFeeEur
          if (p.retailHintEur != null) sum += p.retailHintEur
        }
      }
      m.set(r.id, sum)
    }
    return m
  }, [requests, catalog])

  const load = useCallback(async () => {
    if (!token) return
    setErr(null)
    try {
      const [{ requests: rows }, { products }] = await Promise.all([
        fetchAdminVignetteOrderRequests(token),
        fetchAdminVignetteProducts(token),
      ])
      setRequests(rows)
      setCatalog(products)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Laden fehlgeschlagen')
    }
  }, [token])

  useEffect(() => {
    void load()
  }, [load])

  function openRow(r: VignetteOrderRequestAdminDto) {
    if (expanded === r.id) {
      setExpanded(null)
      return
    }
    setExpanded(r.id)
    setDraft({
      status: (statusOptions.includes(r.status as (typeof statusOptions)[number])
        ? r.status
        : 'pending') as (typeof statusOptions)[number],
      adminNote: r.adminNote ?? '',
      quotedTotalEur: r.quotedTotalEur != null ? String(r.quotedTotalEur) : '',
    })
  }

  async function saveRow(id: string) {
    if (!token) return
    const q = draft.quotedTotalEur.trim() === '' ? null : Number.parseFloat(draft.quotedTotalEur.replace(',', '.'))
    if (draft.quotedTotalEur.trim() !== '' && !Number.isFinite(q)) {
      setErr('Gesamtangebot als Zahl oder leer.')
      return
    }
    setBusyId(id)
    setErr(null)
    try {
      await patchAdminVignetteOrderRequest(token, id, {
        status: draft.status,
        adminNote: draft.adminNote.trim(),
        quotedTotalEur: q,
      })
      setExpanded(null)
      await load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Speichern fehlgeschlagen')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-black text-on-surface">Vignetten-Anfragen</h1>
        <button
          type="button"
          onClick={() => void load()}
          className="rounded-xl border border-outline-variant px-4 py-2 text-sm font-bold"
        >
          Aktualisieren
        </button>
      </div>
      <p className="text-xs text-on-surface-variant">
        Kunden senden aus der Navigation eine Auswahl. Produkte und Preise (Servicepauschale, Richtpreis-Hinweis)
        pflegt ihr unter <strong className="text-on-surface">Vignetten → Katalog</strong>. Beim Angebot legt ihr die
        <strong className="text-on-surface"> kumulierte Gesamtsumme</strong> fest; der Kunde zahlt genau diesen einen
        Betrag (Stripe/PayPal).
      </p>
      {err ? <p className="rounded-xl bg-error-container px-3 py-2 text-sm text-on-error-container">{err}</p> : null}
      <ul className="space-y-2">
        {requests.map((r) => (
          <li key={r.id} className="rounded-2xl border border-outline-variant/50 bg-surface-container-low p-3">
            <button
              type="button"
              onClick={() => openRow(r)}
              className="flex w-full flex-col gap-1 text-left sm:flex-row sm:items-start sm:justify-between"
            >
              <div>
                <p className="font-bold text-on-surface">{r.routeLabel || 'Route'}</p>
                <p className="text-[11px] text-on-surface-variant">
                  {r.userDisplayName} · {r.userEmail}
                </p>
                <p className="mt-1 text-xs text-on-surface-variant">{formatCountries(r.countries)}</p>
                <p className="text-[11px] uppercase text-primary">
                  {statusLabelDe[r.status] ?? r.status}
                  {r.paidAt ? ` · bezahlt ${new Date(r.paidAt).toLocaleString('de-DE')}` : ''}
                </p>
              </div>
              <p className="shrink-0 text-[11px] text-on-surface-variant">
                {new Date(r.createdAt).toLocaleString('de-DE')}
              </p>
            </button>
            {r.customerNote ? (
              <p className="mt-2 rounded-lg bg-surface-container-high/60 px-2 py-1.5 text-xs text-on-surface">
                Kunde: {r.customerNote}
              </p>
            ) : null}
            <p className="mt-2 text-[11px] text-on-surface-variant">
              Produkte:{' '}
              {r.productIds
                .map((id) => titleById.get(id) ?? id)
                .slice(0, 6)
                .join(', ')}
              {r.productIds.length > 6 ? ' …' : ''}
            </p>
            {expanded === r.id ? (
              <div className="mt-3 grid gap-2 border-t border-outline-variant/40 pt-3">
                <label className="text-[11px] font-bold text-on-surface-variant">Status</label>
                <select
                  value={draft.status}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, status: e.target.value as (typeof statusOptions)[number] }))
                  }
                  className="rounded-xl border border-outline-variant bg-surface px-3 py-2 text-sm"
                >
                  {statusOptions.map((s) => (
                    <option key={s} value={s}>
                      {statusLabelDe[s] ?? s}
                    </option>
                  ))}
                </select>
                <label className="text-[11px] font-bold text-on-surface-variant">Admin-Notiz</label>
                <textarea
                  value={draft.adminNote}
                  onChange={(e) => setDraft((d) => ({ ...d, adminNote: e.target.value }))}
                  className="min-h-[4rem] rounded-xl border border-outline-variant bg-surface px-3 py-2 text-sm"
                  maxLength={2000}
                />
                <label className="text-[11px] font-bold text-on-surface-variant">Angebotssumme EUR (kumulativ)</label>
                <p className="text-[11px] text-on-surface-variant">
                  Indikativ aus Katalog (Summe Service + Richtpreis-Hinweise):{' '}
                  <span className="font-bold text-on-surface">
                    {(catalogSumByRequest.get(r.id) ?? 0).toFixed(2)} €
                  </span>
                </p>
                <input
                  value={draft.quotedTotalEur}
                  onChange={(e) => setDraft((d) => ({ ...d, quotedTotalEur: e.target.value }))}
                  className="rounded-xl border border-outline-variant bg-surface px-3 py-2 text-sm"
                  placeholder="z. B. 49,90 — ein Betrag für die ganze Anfrage"
                />
                <button
                  type="button"
                  className="rounded-lg border border-outline-variant px-3 py-1.5 text-[11px] font-bold text-primary"
                  onClick={() => {
                    const v = catalogSumByRequest.get(r.id) ?? 0
                    setDraft((d) => ({ ...d, quotedTotalEur: v > 0 ? v.toFixed(2) : '' }))
                  }}
                >
                  Katalog-Summe ins Feld übernehmen
                </button>
                <button
                  type="button"
                  disabled={busyId === r.id}
                  onClick={() => void saveRow(r.id)}
                  className="mt-1 rounded-xl bg-primary py-2.5 text-sm font-bold text-on-primary disabled:opacity-40"
                >
                  {busyId === r.id ? '…' : 'Speichern'}
                </button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      {requests.length === 0 ? <p className="text-sm text-on-surface-variant">Noch keine Anfragen.</p> : null}
    </div>
  )
}
