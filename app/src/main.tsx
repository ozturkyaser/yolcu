import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import { ErrorBoundary } from './components/ErrorBoundary'
import { AuthProvider } from './context/AuthContext'
import './index.css'
import App from './App.tsx'

/** Nach erstem Paint registrieren; Fehler dürfen die App nicht blockieren (weiße Seite). */
queueMicrotask(() => {
  try {
    registerSW({ immediate: true })
  } catch (e) {
    console.warn('[PWA] Service Worker konnte nicht registriert werden.', e)
  }
})

const rootEl = document.getElementById('root')
if (!rootEl) {
  document.body.innerHTML =
    '<p style="font-family:sans-serif;padding:2rem">Kein #root-Element in index.html.</p>'
} else {
  createRoot(rootEl).render(
    <StrictMode>
      <ErrorBoundary>
        <AuthProvider>
          <App />
        </AuthProvider>
      </ErrorBoundary>
    </StrictMode>,
  )
}
