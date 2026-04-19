import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import { ErrorBoundary } from './components/ErrorBoundary'
import { AuthProvider } from './context/AuthContext'
import { RadioPlayerProvider } from './context/RadioPlayerContext'
import './index.css'
import App from './App.tsx'

const rootEl = document.getElementById('root')
if (!rootEl) {
  document.body.innerHTML =
    '<p style="font-family:sans-serif;padding:2rem">Kein #root-Element in index.html.</p>'
} else {
  createRoot(rootEl).render(
    <StrictMode>
      <ErrorBoundary>
        <AuthProvider>
          <RadioPlayerProvider>
            <App />
          </RadioPlayerProvider>
        </AuthProvider>
      </ErrorBoundary>
    </StrictMode>,
  )
}

/** PWA erst nach dem ersten React-Render (weniger Main-Thread-Konflikte, klarere Fehler). */
function scheduleServiceWorkerRegistration() {
  const run = () => {
    try {
      /** Ohne Reload bleiben Nutzer oft auf altem JS/CSS (lokal = Vite ohne SW → immer frisch). */
      const updateSW = registerSW({
        immediate: true,
        onNeedRefresh() {
          if (
            typeof window !== 'undefined' &&
            window.confirm(
              'Es gibt eine neuere Version der App. Jetzt neu laden? (Empfohlen nach einem Update.)',
            )
          ) {
            void updateSW(true)
          }
        },
        onRegisterError(err) {
          console.warn('[PWA] Service Worker konnte nicht registriert werden.', err)
        },
      })
    } catch (e) {
      console.warn('[PWA] registerSW:', e)
    }
  }
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(run, { timeout: 5000 })
  } else {
    window.setTimeout(run, 0)
  }
}
scheduleServiceWorkerRegistration()
