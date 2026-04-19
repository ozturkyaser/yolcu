import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { CreatePostModal } from '../components/CreatePostModal'
import { PostCommentsSection } from '../components/PostCommentsSection'
import { apiFetch, postMediaSrc, reportPost, type PostDto } from '../lib/api'
import { normalizeMapIconId } from '../lib/mapIcons'
import { useAuth } from '../context/AuthContext'
import { useI18n } from '../i18n/I18nContext'
import type { Lang } from '../i18n/strings'

type FilterKey = 'all' | 'traffic' | 'border' | 'help'

const BOTTOM_NAV = 'var(--bottom-nav-height, 5.75rem)'

const FILTER_DEF: { key: FilterKey; labelKey: string; icon: string; api?: string }[] = [
  { key: 'all', labelKey: 'community_filter_all', icon: 'grid_view' },
  { key: 'traffic', labelKey: 'community_filter_traffic', api: 'traffic', icon: 'traffic' },
  { key: 'border', labelKey: 'community_filter_border', api: 'border', icon: 'flag' },
  { key: 'help', labelKey: 'community_filter_help', api: 'help', icon: 'volunteer_activism' },
]

function formatCommunityTime(iso: string, lang: Lang) {
  const d = new Date(iso)
  const diff = (Date.now() - d.getTime()) / 60000
  if (diff < 1) {
    if (lang === 'tr') return 'şimdi'
    if (lang === 'en') return 'now'
    return 'gerade'
  }
  if (diff < 60) {
    const n = Math.floor(diff)
    if (lang === 'tr') return `${n} dk`
    if (lang === 'en') return `${n}m`
    return `${n} Min.`
  }
  if (diff < 1440) {
    const h = Math.floor(diff / 60)
    if (lang === 'tr') return `${h} sa`
    if (lang === 'en') return `${h}h`
    return `${h} Std.`
  }
  const loc = lang === 'tr' ? 'tr-TR' : lang === 'en' ? 'en-GB' : 'de-DE'
  return d.toLocaleDateString(loc, { day: 'numeric', month: 'short' })
}

function categoryBadge(c: string): { labelKey: string; className: string } {
  switch (c) {
    case 'traffic':
      return { labelKey: 'community_cat_traffic', className: 'bg-secondary-container text-on-secondary-container' }
    case 'border':
      return { labelKey: 'community_cat_border', className: 'bg-primary/15 text-primary' }
    case 'help':
      return { labelKey: 'community_cat_help', className: 'bg-error/15 text-error' }
    default:
      return { labelKey: 'community_cat_general', className: 'bg-surface-container-high text-on-surface-variant' }
  }
}

function FeedSkeleton() {
  return (
    <div className="divide-y divide-outline-variant/15">
      {[0, 1, 2].map((i) => (
        <div key={i} className="animate-pulse">
          <div className="flex items-center gap-3 px-4 py-3">
            <div className="h-10 w-10 shrink-0 rounded-full bg-surface-container-high" />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="h-3.5 w-28 rounded-full bg-surface-container-high" />
              <div className="h-3 w-20 rounded-full bg-surface-container-high/80" />
            </div>
          </div>
          <div className="aspect-[4/5] w-full bg-surface-container-high/90" />
          <div className="space-y-2 px-4 py-3">
            <div className="h-3 w-24 rounded-full bg-surface-container-high" />
            <div className="h-3 w-full max-w-[85%] rounded-full bg-surface-container-high/70" />
          </div>
        </div>
      ))}
    </div>
  )
}

export function CommunityFeedPage() {
  const { token, user } = useAuth()
  const { t, lang } = useI18n()
  const navigate = useNavigate()
  const [filter, setFilter] = useState<FilterKey>('all')
  const [posts, setPosts] = useState<PostDto[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [modal, setModal] = useState(false)
  const [commentsOpenFor, setCommentsOpenFor] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setErr(null)
    try {
      const api = FILTER_DEF.find((f) => f.key === filter)?.api
      const q = api ? `?category=${encodeURIComponent(api)}` : ''
      const data = await apiFetch<{ posts: PostDto[] }>(`/posts${q}`)
      setPosts(data.posts)
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('community_loading'))
    } finally {
      setLoading(false)
    }
  }, [filter, t])

  useEffect(() => {
    void load()
  }, [load])

  async function sharePost(p: PostDto) {
    const base = p.body?.trim() || ''
    const mediaAbs = postMediaSrc(p.mediaUrl ?? null)
    const text = mediaAbs ? `${base}\n${mediaAbs}\n— ${p.author.displayName} · ${t('appTitle')}` : `${base}\n— ${p.author.displayName} · ${t('appTitle')}`
    try {
      if (navigator.share) {
        await navigator.share({ title: t('appTitle'), text })
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text)
      }
    } catch {
      /* Abbruch oder nicht unterstützt */
    }
  }

  async function onReportPost(postId: string) {
    if (!token) {
      navigate('/login')
      return
    }
    const reason = window.prompt(t('community_report_prompt'))
    if (!reason || reason.trim().length < 3) return
    try {
      await reportPost(token, postId, reason.trim())
      window.alert(t('community_report_thanks'))
    } catch (e) {
      window.alert(e instanceof Error ? e.message : t('community_report_fail'))
    }
  }

  async function onHelpful(postId: string) {
    if (!token) {
      navigate('/login')
      return
    }
    try {
      const data = await apiFetch<{ helpfulCount: number }>(`/posts/${postId}/helpful`, {
        method: 'POST',
        token,
      })
      setPosts((prev) =>
        prev.map((p) => (p.id === postId ? { ...p, helpfulCount: data.helpfulCount } : p)),
      )
    } catch {
      /* ignore */
    }
  }

  function openCreateModal() {
    if (!user) navigate('/login')
    else setModal(true)
  }

  return (
    <>
      <main
        className="mx-auto min-h-[50vh] max-w-lg bg-surface"
        style={{ paddingBottom: `calc(${BOTTOM_NAV} + 0.75rem)` }}
      >
        <header className="sticky top-0 z-30 border-b border-black/[0.06] bg-surface/90 backdrop-blur-xl dark:border-white/[0.08]">
          <div className="px-4 pb-2 pt-3">
            <h1 className="text-[1.35rem] font-semibold leading-tight tracking-tight text-on-surface">
              {t('navCommunity')}
            </h1>
            <p className="mt-1 text-[13px] leading-snug text-on-surface-variant">{t('community_feed_tagline')}</p>
          </div>
          <div className="flex gap-2 overflow-x-auto px-3 pb-3 pt-0.5 hide-scrollbar">
            {FILTER_DEF.map((f) => {
              const active = filter === f.key
              return (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => setFilter(f.key)}
                  className={
                    active
                      ? 'flex shrink-0 items-center gap-1.5 rounded-full bg-on-surface px-3.5 py-2 text-[13px] font-semibold text-surface shadow-sm'
                      : 'flex shrink-0 items-center gap-1.5 rounded-full border border-outline-variant/40 bg-surface-container-low px-3.5 py-2 text-[13px] font-medium text-on-surface-variant'
                  }
                >
                  <span className="material-symbols-outlined text-[18px] leading-none">{f.icon}</span>
                  {t(f.labelKey)}
                </button>
              )
            })}
          </div>
        </header>

        {err ? (
          <div className="mx-4 mt-3 rounded-2xl bg-error-container p-3 text-sm text-on-error-container">{err}</div>
        ) : null}

        {loading ? <FeedSkeleton /> : null}

        {!loading && posts.length === 0 ? (
          <div className="flex flex-col items-center px-8 pb-8 pt-14 text-center">
            <div className="mb-5 flex h-[4.5rem] w-[4.5rem] items-center justify-center rounded-full bg-gradient-to-br from-surface-container-high to-surface-container-low ring-1 ring-outline-variant/35">
              <span className="material-symbols-outlined text-[2.75rem] text-on-surface-variant/80">photo_camera</span>
            </div>
            <h2 className="text-lg font-semibold tracking-tight text-on-surface">{t('community_empty_title')}</h2>
            <p className="mt-2 max-w-[20rem] text-sm leading-relaxed text-on-surface-variant">{t('community_empty_hint')}</p>
            <button
              type="button"
              onClick={() => openCreateModal()}
              className="mt-7 rounded-full bg-on-surface px-7 py-2.5 text-sm font-semibold text-surface shadow-md transition active:scale-[0.98]"
            >
              {t('community_cta_first')}
            </button>
          </div>
        ) : null}

        <div className="divide-y divide-black/[0.06] dark:divide-white/[0.08]">
          {!loading &&
            posts.map((p) => {
              const b = categoryBadge(p.category)
              const iconId = normalizeMapIconId(p.author.mapIcon)
              const mediaSrc = postMediaSrc(p.mediaUrl ?? null)
              return (
                <article key={p.id} className="bg-surface">
                  <div className="flex items-center gap-3 px-4 py-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-container-high ring-1 ring-black/[0.06] dark:ring-white/10">
                      <span
                        className="material-symbols-outlined text-[1.4rem] text-primary"
                        style={{ fontVariationSettings: "'FILL' 1" }}
                      >
                        {iconId}
                      </span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[15px] font-semibold leading-tight text-on-surface">{p.author.displayName}</p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[12px] text-on-surface-variant">
                        <span>{formatCommunityTime(p.createdAt, lang)}</span>
                        <span aria-hidden>·</span>
                        <span className={`rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${b.className}`}>
                          {t(b.labelKey)}
                        </span>
                      </p>
                    </div>
                  </div>

                  {mediaSrc && p.mediaKind === 'image' ? (
                    <div className="aspect-[4/5] w-full bg-black">
                      <img src={mediaSrc} alt="" className="h-full w-full object-cover" loading="lazy" />
                    </div>
                  ) : null}
                  {mediaSrc && p.mediaKind === 'video' ? (
                    <div className="aspect-[4/5] w-full bg-black">
                      <video src={mediaSrc} className="h-full w-full object-cover" controls playsInline muted />
                    </div>
                  ) : null}

                  <div className="flex items-center gap-0.5 px-2 pt-1">
                    <button
                      type="button"
                      onClick={() => void onHelpful(p.id)}
                      className="rounded-full p-2.5 text-on-surface transition hover:bg-black/[0.04] active:scale-95 dark:hover:bg-white/[0.06]"
                      aria-label={t('community_like')}
                    >
                      <span className="material-symbols-outlined text-[26px]" style={{ fontVariationSettings: "'FILL' 0" }}>
                        favorite
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setCommentsOpenFor((cur) => (cur === p.id ? null : p.id))}
                      className="rounded-full p-2.5 text-on-surface transition hover:bg-black/[0.04] active:scale-95 dark:hover:bg-white/[0.06]"
                      aria-label={t('community_comment')}
                    >
                      <span className="material-symbols-outlined text-[26px]" style={{ fontVariationSettings: "'FILL' 0" }}>
                        chat_bubble_outline
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => void sharePost(p)}
                      className="rounded-full p-2.5 text-on-surface transition hover:bg-black/[0.04] active:scale-95 dark:hover:bg-white/[0.06]"
                      aria-label={t('community_share_btn')}
                    >
                      <span className="material-symbols-outlined text-[26px]">send</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => void onReportPost(p.id)}
                      className="ml-auto rounded-full p-2.5 text-on-surface-variant transition hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
                      aria-label={t('community_report')}
                    >
                      <span className="material-symbols-outlined text-[22px]">more_horiz</span>
                    </button>
                  </div>

                  <div className="px-4 pb-1 pt-0.5">
                    {p.helpfulCount > 0 ? (
                      <p className="text-[14px] font-semibold text-on-surface">
                        {p.helpfulCount} {t('community_likes_short')}
                      </p>
                    ) : null}
                    {p.body?.trim() ? (
                      <p className="mt-1 text-[14px] leading-snug text-on-surface">
                        <span className="font-semibold">{p.author.displayName}</span>{' '}
                        <span className="font-normal">{p.body}</span>
                      </p>
                    ) : null}
                  </div>

                  {p.category === 'border' && (p.borderWaitMinutes != null || p.borderSlug) ? (
                    <div className="mx-4 mb-2 flex flex-wrap gap-2 text-xs">
                      {p.borderWaitMinutes != null ? (
                        <span className="rounded-lg bg-primary/10 px-2.5 py-1 font-semibold text-primary">
                          ~{p.borderWaitMinutes} Min.
                        </span>
                      ) : null}
                      {p.borderSlug ? (
                        <Link
                          to={`/border/${encodeURIComponent(p.borderSlug)}`}
                          className="rounded-lg border border-outline-variant/50 px-2.5 py-1 font-semibold text-primary underline-offset-2 hover:underline"
                        >
                          {p.borderSlug}
                        </Link>
                      ) : null}
                    </div>
                  ) : null}

                  {p.locationLabel ? (
                    <div className="mx-4 mb-2 flex w-fit max-w-full items-center gap-1 rounded-xl bg-surface-container-low px-2.5 py-1.5">
                      <span className="material-symbols-outlined text-base text-primary">location_on</span>
                      <span className="truncate text-xs font-semibold text-primary">{p.locationLabel}</span>
                    </div>
                  ) : null}

                  <div className="border-t border-black/[0.05] px-3 pb-3 pt-1 dark:border-white/[0.07]">
                    <PostCommentsSection
                      postId={p.id}
                      expanded={commentsOpenFor === p.id}
                      onToggle={() => setCommentsOpenFor((cur) => (cur === p.id ? null : p.id))}
                    />
                  </div>
                </article>
              )
            })}
        </div>
      </main>

      <button
        type="button"
        onClick={() => openCreateModal()}
        className="fixed z-40 flex h-[3.35rem] w-[3.35rem] items-center justify-center rounded-full bg-gradient-to-br from-primary via-primary to-primary-container text-on-primary shadow-[0_8px_28px_rgba(0,0,0,0.18)] ring-2 ring-white/25 transition active:scale-95 dark:ring-black/20"
        style={{
          bottom: `calc(${BOTTOM_NAV} + 0.65rem)`,
          right: 'max(1rem, env(safe-area-inset-right))',
        }}
        aria-label={t('community_fab')}
      >
        <span className="material-symbols-outlined text-[1.85rem]">add</span>
      </button>

      <CreatePostModal
        open={modal}
        onClose={() => setModal(false)}
        onCreated={(post) => setPosts((prev) => [post, ...prev])}
        defaultCategory={
          filter === 'traffic'
            ? 'traffic'
            : filter === 'border'
              ? 'border'
              : filter === 'help'
                ? 'help'
                : 'general'
        }
      />
    </>
  )
}
