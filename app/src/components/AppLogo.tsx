import { useId } from 'react'

/**
 * Markenzeichen „Yol“: Weg/Korridor mit Horizont – skalierbar via className (z. B. h-9 w-9).
 * Nutzt currentColor für Light/Dark (text-primary).
 */
export function AppLogoMark({ className }: { className?: string }) {
  const gradId = useId().replace(/:/g, '')
  return (
    <svg
      viewBox="0 0 48 48"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-hidden
    >
      <defs>
        <linearGradient id={gradId} x1="6" y1="10" x2="42" y2="38" gradientUnits="userSpaceOnUse">
          <stop stopColor="currentColor" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0.72" />
        </linearGradient>
      </defs>
      <rect width="48" height="48" rx="14" fill={`url(#${gradId})`} />
      {/* Horizont / Sonne */}
      <circle cx="36" cy="14" r="5" fill="white" fillOpacity="0.35" />
      {/* Straße */}
      <path
        d="M8 34c8-18 24-18 32 0"
        fill="none"
        stroke="white"
        strokeWidth="3.25"
        strokeLinecap="round"
        strokeOpacity="0.95"
      />
      <path
        d="M24 20v12"
        fill="none"
        stroke="#fbbf24"
        strokeWidth="1.5"
        strokeDasharray="2 3"
        strokeLinecap="round"
        opacity="0.95"
      />
      {/* Zwei Punkte = Gemeinschaft */}
      <circle cx="17" cy="30" r="2.2" fill="white" />
      <circle cx="31" cy="30" r="2.2" fill="white" />
    </svg>
  )
}

/** Logo + kurzer Name „Yol“ für Marketing-Flächen (Login …). */
export function AppLogoWithWordmark({ className }: { className?: string }) {
  return (
    <div className={`flex items-center gap-3 ${className ?? ''}`}>
      <AppLogoMark className="h-11 w-11 shrink-0 text-primary" />
      <span className="font-sans text-2xl font-black tracking-tight text-primary dark:text-white">Yol</span>
    </div>
  )
}
