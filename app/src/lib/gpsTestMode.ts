/** Berlin Mitte (ca. Alexanderplatz) – Fallback im GPS-Testmodus */
export const BERLIN_CENTER_DEG = { lat: 52.52, lng: 13.405 }

/** Simulierte GPS-Daten + Berlin-Fallback bei fehlendem GPS (nur wenn aktiv). */
export function isGpsTestModeEnabled(): boolean {
  if (import.meta.env.VITE_GPS_TEST_MODE === 'true') return true
  return Boolean(import.meta.env.DEV)
}
