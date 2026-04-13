import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { AppHeader } from '../components/AppHeader'
import { apiFetch, type BorderDto } from '../lib/api'

type RuleBlock = {
  key?: string
  title?: string
  items?: { label: string; value: string }[]
  text?: string
}

export function BorderDetailPage() {
  const { slug } = useParams<{ slug: string }>()
  const [border, setBorder] = useState<BorderDto | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (!slug) return
    void (async () => {
      try {
        const data = await apiFetch<{ border: BorderDto }>(`/borders/${encodeURIComponent(slug)}`)
        setBorder(data.border)
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Nicht gefunden')
      }
    })()
  }, [slug])

  if (err || (!border && slug)) {
    return (
      <div className="min-h-dvh bg-surface font-sans">
        <AppHeader title="Sınır" showBack />
        <div className="h-[72px]" aria-hidden />
        <p className="p-8 text-center text-on-surface-variant">{err ?? 'Laden…'}</p>
      </div>
    )
  }

  if (!border) {
    return (
      <div className="min-h-dvh bg-surface">
        <AppHeader title="…" showBack />
        <div className="h-[72px]" aria-hidden />
        <p className="p-8 text-center">Laden…</p>
      </div>
    )
  }

  const rules = Array.isArray(border.rules) ? (border.rules as RuleBlock[]) : []
  const hero = border.heroImageUrl ?? ''

  return (
    <div className="min-h-dvh bg-surface font-sans text-on-surface">
      <AppHeader title={border.title} showBack />
      <div className="h-[72px]" aria-hidden />
      <main className="mx-auto max-w-7xl space-y-8 px-4 pb-12 md:px-8">
        <section className="relative h-[240px] overflow-hidden rounded-3xl shadow-2xl md:h-[300px]">
          {hero ? <img alt="" className="h-full w-full object-cover" src={hero} /> : null}
          <div className="absolute inset-0 bg-gradient-to-t from-on-surface/60 to-transparent" />
          <div className="absolute bottom-6 left-6">
            <p className="font-sans text-[0.75rem] font-medium uppercase tracking-wide text-white/80">
              Sınır Bölgesi
            </p>
            <h2 className="text-3xl font-bold text-white">
              {border.countryA} <span className="mx-2 opacity-50">/</span> {border.countryB}
            </h2>
          </div>
          <div className="absolute top-6 right-6">
            <div className="flex items-center gap-2 rounded-full bg-secondary-container px-4 py-2 font-bold text-on-secondary-container shadow-lg">
              <span className="material-symbols-outlined text-[18px]">warning</span>
              <span>Yoğunluk möglich</span>
            </div>
          </div>
        </section>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-12">
          <div className="relative overflow-hidden rounded-3xl bg-surface-container-lowest p-8 shadow-[0_8px_32px_rgba(26,28,28,0.08)] md:col-span-5">
            <div className="relative z-10">
              <h3 className="mb-1 font-sans text-xl font-bold text-on-surface">Bekleme Süresi</h3>
              <p className="mb-8 text-sm text-on-surface-variant">Tahmini (Community / Admin)</p>
              <div className="flex items-baseline gap-2">
                <span className="text-7xl font-black tracking-tighter text-primary">{border.waitMinutes}</span>
                <span className="text-2xl font-bold text-primary/60">DK</span>
              </div>
              <div className="mt-8 flex items-center gap-3 rounded-xl bg-surface-container p-4">
                <span className="material-symbols-outlined fill text-secondary">group</span>
                <p className="text-sm font-medium">
                  <span className="font-bold text-secondary">
                    {border.activeUsersReporting} aktif kullanıcı
                  </span>{' '}
                  bildiriyor (Beispiel)
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-6 rounded-3xl bg-surface-container-low p-8 md:col-span-7">
            <div className="flex items-center justify-between">
              <h3 className="font-sans text-xl font-bold text-on-surface">Kurallar ve Giriş Bilgileri</h3>
              <span className="material-symbols-outlined text-outline">info</span>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {rules.map((r) => (
                <div key={r.key ?? r.title} className="space-y-3 rounded-2xl bg-surface-container-lowest p-5">
                  <div className="flex items-center gap-2 text-primary">
                    <span className="material-symbols-outlined text-lg">article</span>
                    <span className="text-sm font-bold tracking-wide uppercase">{r.title}</span>
                  </div>
                  {r.items ? (
                    <ul className="space-y-2 text-sm text-on-surface-variant">
                      {r.items.map((it) => (
                        <li key={it.label} className="flex justify-between gap-2">
                          <span>{it.label}</span>
                          <span className="font-bold text-on-surface">{it.value}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {r.text ? <p className="text-sm text-on-surface-variant">{r.text}</p> : null}
                </div>
              ))}
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
