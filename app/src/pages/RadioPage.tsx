import { useCallback, useEffect, useState } from 'react'
import { fetchRadioChannels, type RadioChannelDto } from '../lib/api'
import { useRadioPlayer } from '../context/RadioPlayerContext'
import { useI18n } from '../i18n/I18nContext'

export function RadioPage() {
  const { t } = useI18n()
  const radio = useRadioPlayer()
  const [channels, setChannels] = useState<RadioChannelDto[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setErr(null)
    try {
      const { channels: rows } = await fetchRadioChannels()
      setChannels(rows)
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('radio_load_err'))
      setChannels([])
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    void load()
  }, [load])

  function selectChannel(c: RadioChannelDto) {
    radio.setSelectedChannelId(c.id)
    radio.setStreamUrl(c.streamUrl)
    radio.setPlayingIntent(true)
  }

  function stop() {
    radio.setPlayingIntent(false)
  }

  return (
    <main className="mx-auto max-w-lg space-y-4 px-3 pb-28 pt-2">
      <header>
        <h1 className="text-2xl font-black text-on-surface">{t('radio_title')}</h1>
        <p className="mt-1 text-sm text-on-surface-variant">{t('radio_intro')}</p>
      </header>

      {err ? (
        <p className="rounded-xl bg-error-container px-3 py-2 text-sm text-on-error-container">{err}</p>
      ) : null}

      <section className="rounded-2xl border border-outline-variant/40 bg-surface-container-low p-4">
        <p className="text-xs text-on-surface-variant">{t('radio_hint_priority')}</p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <label className="flex min-w-[12rem] flex-1 flex-col gap-1 text-sm font-semibold text-on-surface">
            {t('radio_volume')}
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(radio.baseVolume * 100)}
              onChange={(e) => radio.setBaseVolume(Number(e.target.value) / 100)}
              className="w-full accent-primary"
            />
          </label>
          {radio.playingIntent ? (
            <button
              type="button"
              onClick={stop}
              className="rounded-xl bg-error px-4 py-2 text-sm font-bold text-on-error"
            >
              {t('radio_stop')}
            </button>
          ) : null}
        </div>
      </section>

      {loading ? (
        <p className="text-sm text-on-surface-variant">{t('radio_loading')}</p>
      ) : channels.length === 0 ? (
        <p className="text-sm text-on-surface-variant">{t('radio_empty')}</p>
      ) : (
        <ul className="space-y-2">
          {channels.map((c) => {
            const active = radio.selectedChannelId === c.id && radio.playingIntent
            return (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => (active ? stop() : selectChannel(c))}
                  className={[
                    'flex w-full items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-left transition',
                    active
                      ? 'border-primary bg-primary-container/40 font-bold text-on-surface'
                      : 'border-outline-variant/50 bg-surface-container-lowest hover:border-primary/40',
                  ].join(' ')}
                >
                  <span className="material-symbols-outlined text-primary">
                    {active ? 'stop_circle' : 'play_circle'}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-semibold">{c.name}</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </main>
  )
}
