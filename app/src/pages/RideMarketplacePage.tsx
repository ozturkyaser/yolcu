import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import {
  createRideListing,
  createRideRequest,
  fetchRideListing,
  fetchRideListingRequests,
  fetchRideListings,
  patchRideListing,
  patchRideRequest,
  type RideListingDto,
  type RideOfferKind,
  type RideRequestDto,
} from '../lib/api'
import { useI18n } from '../i18n/I18nContext'

function offerKindLabel(k: RideOfferKind): string {
  if (k === 'passenger') return 'Mitfahrplätze'
  if (k === 'cargo') return 'Ware / Transport'
  return 'Mitfahrt & Ware'
}

function formatWhen(iso: string) {
  try {
    return new Date(iso).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })
  } catch {
    return iso
  }
}

export function RideMarketplacePage() {
  const { token, user } = useAuth()
  const navigate = useNavigate()
  const { t } = useI18n()
  const [listings, setListings] = useState<RideListingDto[]>([])
  const [mine, setMine] = useState(false)
  const [filterKind, setFilterKind] = useState<RideOfferKind | ''>('')
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [selected, setSelected] = useState<RideListingDto | null>(null)
  const [incoming, setIncoming] = useState<RideRequestDto[]>([])
  const [incomingLoading, setIncomingLoading] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setErr(null)
    try {
      const fk = filterKind || undefined
      const { listings: rows } = await fetchRideListings({
        mine: mine && !!token,
        token,
        offerKind: fk,
      })
      setListings(rows)
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('rides_load_err'))
    } finally {
      setLoading(false)
    }
  }, [mine, token, filterKind, t])

  useEffect(() => {
    void load()
  }, [load])

  const openDetail = async (id: string) => {
    setErr(null)
    try {
      const { listing } = await fetchRideListing(id)
      setSelected(listing)
      if (token && user && listing.userId === user.id) {
        setIncomingLoading(true)
        try {
          const { requests } = await fetchRideListingRequests(token, id)
          setIncoming(requests)
        } catch {
          setIncoming([])
        } finally {
          setIncomingLoading(false)
        }
      } else {
        setIncoming([])
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('rides_load_err'))
    }
  }

  const closeDetail = () => {
    setSelected(null)
    setIncoming([])
  }

  const [reqKind, setReqKind] = useState<'passenger' | 'cargo'>('passenger')
  const [reqMsg, setReqMsg] = useState('')

  useEffect(() => {
    if (!selected) return
    if (selected.offerKind === 'passenger') setReqKind('passenger')
    else if (selected.offerKind === 'cargo') setReqKind('cargo')
    else setReqKind('passenger')
  }, [selected])

  async function submitRequest() {
    if (!token || !selected) return
    setBusy(true)
    setErr(null)
    try {
      await createRideRequest(token, selected.id, { requestKind: reqKind, message: reqMsg.trim() })
      setReqMsg('')
      await load()
      await openDetail(selected.id)
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('rides_req_err'))
    } finally {
      setBusy(false)
    }
  }

  const [cOffer, setCOffer] = useState<RideOfferKind>('both')
  const [cFrom, setCFrom] = useState('')
  const [cTo, setCTo] = useState('')
  const [cWhen, setCWhen] = useState('')
  const [cSeats, setCSeats] = useState('2')
  const [cCargo, setCCargo] = useState('')
  const [cDetails, setCDetails] = useState('')

  async function submitCreate() {
    if (!token) return
    setBusy(true)
    setErr(null)
    try {
      const seats =
        cOffer === 'cargo' ? null : Math.min(12, Math.max(0, parseInt(cSeats, 10) || 0))
      await createRideListing(token, {
        offerKind: cOffer,
        routeFrom: cFrom.trim(),
        routeTo: cTo.trim(),
        departureNote: cWhen.trim(),
        freeSeats: seats,
        cargoSpaceNote: cCargo.trim(),
        details: cDetails.trim(),
      })
      setCreateOpen(false)
      setCFrom('')
      setCTo('')
      setCWhen('')
      setCSeats('2')
      setCCargo('')
      setCDetails('')
      setMine(true)
      await load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('rides_create_err'))
    } finally {
      setBusy(false)
    }
  }

  async function toggleListingClosed(listing: RideListingDto) {
    if (!token) return
    setBusy(true)
    setErr(null)
    try {
      await patchRideListing(token, listing.id, {
        status: listing.status === 'open' ? 'closed' : 'open',
      })
      await load()
      if (selected?.id === listing.id) await openDetail(listing.id)
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('rides_patch_err'))
    } finally {
      setBusy(false)
    }
  }

  async function handleRequestPatch(req: RideRequestDto, status: 'accepted' | 'declined') {
    if (!token) return
    setBusy(true)
    setErr(null)
    try {
      await patchRideRequest(token, req.id, { status })
      if (selected) {
        const { requests } = await fetchRideListingRequests(token, selected.id)
        setIncoming(requests)
      }
      await load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('rides_patch_err'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="mx-auto flex min-h-0 max-w-2xl flex-1 flex-col gap-4 overflow-y-auto px-4 py-4 pb-28">
      <header className="space-y-1">
        <h1 className="text-2xl font-black text-on-surface">{t('rides_title')}</h1>
        <p className="text-sm leading-relaxed text-on-surface-variant">{t('rides_intro')}</p>
        <p className="rounded-xl border border-outline-variant/40 bg-surface-container-low px-3 py-2 text-[11px] text-on-surface-variant">
          {t('rides_disclaimer')}
        </p>
      </header>

      {err ? (
        <p className="rounded-xl bg-error-container px-3 py-2 text-sm text-on-error-container">{err}</p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={!token}
          onClick={() => setMine(false)}
          className={`rounded-full px-4 py-2 text-xs font-bold ${
            !mine ? 'bg-primary text-on-primary' : 'border border-outline-variant bg-surface text-on-surface'
          }`}
        >
          {t('rides_tab_market')}
        </button>
        <button
          type="button"
          disabled={!token}
          onClick={() => {
            if (!token) navigate('/login')
            else setMine(true)
          }}
          className={`rounded-full px-4 py-2 text-xs font-bold ${
            mine ? 'bg-primary text-on-primary' : 'border border-outline-variant bg-surface text-on-surface'
          } disabled:opacity-40`}
        >
          {t('rides_tab_mine')}
        </button>
        <button
          type="button"
          disabled={!token || busy}
          onClick={() => {
            if (!token) navigate('/login')
            else setCreateOpen(true)
          }}
          className="ml-auto rounded-full bg-secondary px-4 py-2 text-xs font-bold text-on-secondary disabled:opacity-40"
        >
          {t('rides_new_offer')}
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        {(['', 'passenger', 'cargo'] as const).map((fk) => (
          <button
            key={fk || 'all'}
            type="button"
            onClick={() => setFilterKind(fk)}
            className={`rounded-lg px-3 py-1.5 text-[11px] font-bold ${
              filterKind === fk
                ? 'bg-tertiary text-on-tertiary'
                : 'border border-outline-variant/60 bg-surface-container-low text-on-surface-variant'
            }`}
          >
            {fk === '' ? t('rides_filter_all') : fk === 'passenger' ? t('rides_filter_pass') : t('rides_filter_cargo')}
          </button>
        ))}
      </div>

      {loading ? <p className="text-on-surface-variant">{t('rides_loading')}</p> : null}

      <ul className="space-y-3">
        {listings.map((l) => (
          <li key={l.id}>
            <button
              type="button"
              onClick={() => void openDetail(l.id)}
              className="w-full rounded-2xl border border-outline-variant/50 bg-surface-container-low px-4 py-3 text-left shadow-sm transition hover:border-primary/40"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-bold text-on-surface">
                    {l.routeFrom} → {l.routeTo}
                  </p>
                  <p className="mt-0.5 text-xs text-on-surface-variant">{offerKindLabel(l.offerKind)}</p>
                </div>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                    l.status === 'open' ? 'bg-secondary-container text-on-secondary-container' : 'bg-surface-dim text-on-surface-variant'
                  }`}
                >
                  {l.status === 'open' ? t('rides_status_open') : t('rides_status_closed')}
                </span>
              </div>
              {l.departureNote ? (
                <p className="mt-2 line-clamp-2 text-xs text-on-surface-variant">{l.departureNote}</p>
              ) : null}
              <div className="mt-2 flex flex-wrap gap-2 text-[10px] text-on-surface-variant">
                {l.freeSeats != null && l.freeSeats > 0 ? (
                  <span className="rounded-md bg-surface-container-high px-2 py-0.5">
                    {l.freeSeats} {t('rides_seats')}
                  </span>
                ) : null}
                {l.cargoSpaceNote ? (
                  <span className="rounded-md bg-surface-container-high px-2 py-0.5 line-clamp-1">{l.cargoSpaceNote}</span>
                ) : null}
                <span>{l.authorName}</span>
                <span>{formatWhen(l.createdAt)}</span>
                {user?.id === l.userId && (l.pendingRequestCount ?? 0) > 0 ? (
                  <span className="font-bold text-primary">
                    {l.pendingRequestCount} {t('rides_pending')}
                  </span>
                ) : null}
              </div>
            </button>
          </li>
        ))}
      </ul>

      {!loading && listings.length === 0 ? (
        <p className="text-center text-sm text-on-surface-variant">{t('rides_empty')}</p>
      ) : null}

      {createOpen ? (
        <div
          className="fixed inset-0 z-[60] flex items-end justify-center bg-black/45 p-4 sm:items-center"
          role="dialog"
          aria-modal
          aria-labelledby="rides-create-title"
        >
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-outline-variant bg-surface-container-lowest p-4 shadow-xl">
            <h2 id="rides-create-title" className="text-lg font-black text-on-surface">
              {t('rides_create_title')}
            </h2>
            <div className="mt-3 space-y-3">
              <label className="block text-xs font-bold text-on-surface-variant">{t('rides_field_kind')}</label>
              <select
                value={cOffer}
                onChange={(e) => setCOffer(e.target.value as RideOfferKind)}
                className="w-full rounded-xl border border-outline-variant bg-surface px-3 py-2 text-sm text-on-surface"
              >
                <option value="passenger">{t('rides_kind_pass')}</option>
                <option value="cargo">{t('rides_kind_cargo')}</option>
                <option value="both">{t('rides_kind_both')}</option>
              </select>
              <label className="block text-xs font-bold text-on-surface-variant">{t('rides_field_from')}</label>
              <input
                value={cFrom}
                onChange={(e) => setCFrom(e.target.value)}
                className="w-full rounded-xl border border-outline-variant bg-surface px-3 py-2 text-sm text-on-surface"
                maxLength={200}
              />
              <label className="block text-xs font-bold text-on-surface-variant">{t('rides_field_to')}</label>
              <input
                value={cTo}
                onChange={(e) => setCTo(e.target.value)}
                className="w-full rounded-xl border border-outline-variant bg-surface px-3 py-2 text-sm text-on-surface"
                maxLength={200}
              />
              <label className="block text-xs font-bold text-on-surface-variant">{t('rides_field_when')}</label>
              <input
                value={cWhen}
                onChange={(e) => setCWhen(e.target.value)}
                placeholder={t('rides_field_when_ph')}
                className="w-full rounded-xl border border-outline-variant bg-surface px-3 py-2 text-sm text-on-surface"
                maxLength={500}
              />
              {cOffer !== 'cargo' ? (
                <>
                  <label className="block text-xs font-bold text-on-surface-variant">{t('rides_field_seats')}</label>
                  <input
                    type="number"
                    min={0}
                    max={12}
                    value={cSeats}
                    onChange={(e) => setCSeats(e.target.value)}
                    className="w-full rounded-xl border border-outline-variant bg-surface px-3 py-2 text-sm text-on-surface"
                  />
                </>
              ) : null}
              {cOffer !== 'passenger' ? (
                <>
                  <label className="block text-xs font-bold text-on-surface-variant">{t('rides_field_cargo')}</label>
                  <textarea
                    value={cCargo}
                    onChange={(e) => setCCargo(e.target.value)}
                    className="min-h-[4rem] w-full rounded-xl border border-outline-variant bg-surface px-3 py-2 text-sm text-on-surface"
                    maxLength={500}
                  />
                </>
              ) : null}
              <label className="block text-xs font-bold text-on-surface-variant">{t('rides_field_details')}</label>
              <textarea
                value={cDetails}
                onChange={(e) => setCDetails(e.target.value)}
                className="min-h-[6rem] w-full rounded-xl border border-outline-variant bg-surface px-3 py-2 text-sm text-on-surface"
                maxLength={2000}
              />
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setCreateOpen(false)}
                className="rounded-xl border border-outline-variant px-4 py-2 text-sm font-bold text-on-surface"
              >
                {t('rides_cancel')}
              </button>
              <button
                type="button"
                disabled={busy || cFrom.trim().length < 1 || cTo.trim().length < 1 || cDetails.trim().length < 1}
                onClick={() => void submitCreate()}
                className="rounded-xl bg-primary px-4 py-2 text-sm font-bold text-on-primary disabled:opacity-40"
              >
                {busy ? '…' : t('rides_publish')}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {selected ? (
        <div
          className="fixed inset-0 z-[60] flex items-end justify-center bg-black/45 p-4 sm:items-center"
          role="dialog"
          aria-modal
          aria-labelledby="rides-detail-title"
        >
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-outline-variant bg-surface-container-lowest p-4 shadow-xl">
            <h2 id="rides-detail-title" className="text-lg font-black text-on-surface">
              {selected.routeFrom} → {selected.routeTo}
            </h2>
            <p className="mt-1 text-xs text-on-surface-variant">
              {offerKindLabel(selected.offerKind)} · {selected.authorName} · {formatWhen(selected.createdAt)}
            </p>
            {selected.departureNote ? (
              <p className="mt-2 text-sm text-on-surface">{selected.departureNote}</p>
            ) : null}
            <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-on-surface-variant">{selected.details}</p>
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              {selected.freeSeats != null && selected.freeSeats > 0 ? (
                <span className="rounded-lg bg-surface-container-high px-2 py-1 font-semibold">
                  {selected.freeSeats} {t('rides_seats')}
                </span>
              ) : null}
              {selected.cargoSpaceNote ? (
                <span className="rounded-lg bg-surface-container-high px-2 py-1 font-semibold">{selected.cargoSpaceNote}</span>
              ) : null}
            </div>

            {user?.id === selected.userId ? (
              <div className="mt-4 space-y-3 border-t border-outline-variant/40 pt-4">
                <p className="text-xs font-bold uppercase tracking-wide text-on-surface-variant">{t('rides_incoming')}</p>
                {incomingLoading ? <p className="text-xs text-on-surface-variant">…</p> : null}
                <ul className="space-y-2">
                  {incoming.map((r) => (
                    <li
                      key={r.id}
                      className="rounded-xl border border-outline-variant/50 bg-surface-container-low px-3 py-2 text-sm"
                    >
                      <p className="font-bold text-on-surface">
                        {r.requesterName}{' '}
                        <span className="text-xs font-normal text-on-surface-variant">
                          ({r.requestKind === 'passenger' ? t('rides_req_pass') : t('rides_req_cargo')})
                        </span>
                      </p>
                      {r.message ? <p className="mt-1 text-xs text-on-surface-variant">{r.message}</p> : null}
                      <p className="mt-1 text-[10px] uppercase text-on-surface-variant">{r.status}</p>
                      {r.status === 'pending' ? (
                        <div className="mt-2 flex gap-2">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void handleRequestPatch(r, 'accepted')}
                            className="rounded-lg bg-primary px-2 py-1 text-[11px] font-bold text-on-primary"
                          >
                            {t('rides_accept')}
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void handleRequestPatch(r, 'declined')}
                            className="rounded-lg border border-outline-variant px-2 py-1 text-[11px] font-bold"
                          >
                            {t('rides_decline')}
                          </button>
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
                {incoming.length === 0 && !incomingLoading ? (
                  <p className="text-xs text-on-surface-variant">{t('rides_no_requests')}</p>
                ) : null}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void toggleListingClosed(selected)}
                  className="w-full rounded-xl border border-outline-variant py-2 text-sm font-bold text-on-surface"
                >
                  {selected.status === 'open' ? t('rides_close_listing') : t('rides_reopen_listing')}
                </button>
              </div>
            ) : token && user ? (
              <div className="mt-4 space-y-3 border-t border-outline-variant/40 pt-4">
                <p className="text-xs font-bold uppercase tracking-wide text-on-surface-variant">{t('rides_your_request')}</p>
                {selected.status !== 'open' ? (
                  <p className="text-sm text-on-surface-variant">{t('rides_closed_hint')}</p>
                ) : (
                  <>
                    {selected.offerKind === 'both' ? (
                      <div className="flex gap-2">
                        <label className="flex items-center gap-2 text-sm">
                          <input
                            type="radio"
                            name="rk"
                            checked={reqKind === 'passenger'}
                            onChange={() => setReqKind('passenger')}
                          />
                          {t('rides_req_pass')}
                        </label>
                        <label className="flex items-center gap-2 text-sm">
                          <input type="radio" name="rk" checked={reqKind === 'cargo'} onChange={() => setReqKind('cargo')} />
                          {t('rides_req_cargo')}
                        </label>
                      </div>
                    ) : null}
                    <textarea
                      value={reqMsg}
                      onChange={(e) => setReqMsg(e.target.value)}
                      placeholder={t('rides_req_msg_ph')}
                      className="min-h-[4rem] w-full rounded-xl border border-outline-variant bg-surface px-3 py-2 text-sm text-on-surface"
                      maxLength={800}
                    />
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void submitRequest()}
                      className="w-full rounded-xl bg-primary py-3 font-bold text-on-primary disabled:opacity-40"
                    >
                      {busy ? '…' : t('rides_send_request')}
                    </button>
                  </>
                )}
              </div>
            ) : (
              <p className="mt-4 text-sm text-on-surface-variant">
                <Link to="/login" className="font-bold text-primary underline">
                  {t('login')}
                </Link>{' '}
                {t('rides_login_hint')}
              </p>
            )}

            <button
              type="button"
              onClick={closeDetail}
              className="mt-4 w-full rounded-xl border border-outline-variant py-2 text-sm font-bold text-on-surface"
            >
              {t('rides_close')}
            </button>
          </div>
        </div>
      ) : null}
    </main>
  )
}
