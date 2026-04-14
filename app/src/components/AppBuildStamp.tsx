/** Build-Stempel: Anzeige-Nummer = Commit-Anzahl zum Build-Zeitpunkt (siehe `vite.config.ts` / Docker-ARG). */
export function AppBuildStamp() {
  const raw = typeof __YOL_BUILD_NUMBER__ !== 'undefined' ? __YOL_BUILD_NUMBER__ : '0'
  const n = Number.parseInt(raw, 10)
  const num = Number.isFinite(n) && n >= 0 ? n : 0
  const label = `v.${String(num).padStart(2, '0')}`
  const pkgVer = typeof __YOL_APP_VERSION__ !== 'undefined' ? __YOL_APP_VERSION__ : '0.0.0'

  return (
    <div
      className="pointer-events-none fixed right-2 z-[60] select-none font-mono text-[10px] leading-none text-on-surface-variant/55 dark:text-surface-dim/70"
      style={{
        bottom: 'max(0.5rem, calc(var(--bottom-nav-height, 0px) + 0.25rem))',
      }}
      title={`Build ${label} · Paket ${pkgVer}`}
      aria-hidden
    >
      {label}
    </div>
  )
}
