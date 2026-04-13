import { Component, type ErrorInfo, type ReactNode } from 'react'

type Props = { children: ReactNode }
type State = { err: Error | null; info: ErrorInfo | null }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { err: null, info: null }

  static getDerivedStateFromError(err: Error): Partial<State> {
    return { err }
  }

  componentDidCatch(err: Error, info: ErrorInfo) {
    console.error('[App-Fehler]', err, info.componentStack)
    this.setState({ info })
  }

  render() {
    if (this.state.err) {
      return (
        <div className="min-h-dvh bg-surface px-6 py-12 font-sans text-on-surface">
          <h1 className="mb-4 text-2xl font-bold text-error">Etwas ist schiefgelaufen</h1>
          <p className="mb-4 text-on-surface-variant">
            Die Oberfläche ist abgestürzt. Details siehst du unten und in der Browser-Konsole (F12).
          </p>
          <pre className="mb-6 max-h-48 overflow-auto rounded-xl bg-surface-container-high p-4 text-xs text-on-surface">
            {this.state.err.message}
            {this.state.info?.componentStack ?? ''}
          </pre>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-xl bg-primary px-6 py-3 font-bold text-on-primary"
          >
            Seite neu laden
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
