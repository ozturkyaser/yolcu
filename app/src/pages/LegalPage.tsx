import { Link, useParams } from 'react-router-dom'

export function LegalPage() {
  const { doc } = useParams<{ doc: string }>()

  if (doc === 'privacy') {
    return (
      <div className="min-h-dvh bg-surface px-6 py-10 font-sans text-on-surface">
        <Link to="/" className="mb-6 inline-block font-bold text-primary">
          ← Start
        </Link>
        <h1 className="mb-4 text-2xl font-bold text-primary">Datenschutz (Entwurf)</h1>
        <div className="prose prose-sm max-w-2xl space-y-4 text-on-surface-variant">
          <p>
            Diese Seite ist ein Platzhalter. Vor Produktivstart: Verantwortliche, Zwecke, Rechtsgrundlagen,
            Speicherdauer, Betroffenenrechte, Drittlandtransfers und Kontakt mit einer Fachperson abstimmen.
          </p>
          <p>
            Standortdaten werden nur mit Einwilligung verarbeitet (Hilfefunktion, Karte). Community-Inhalte
            sind sichtbar für andere Nutzer gemäß App-Logik.
          </p>
        </div>
      </div>
    )
  }

  if (doc === 'terms') {
    return (
      <div className="min-h-dvh bg-surface px-6 py-10 font-sans text-on-surface">
        <Link to="/" className="mb-6 inline-block font-bold text-primary">
          ← Start
        </Link>
        <h1 className="mb-4 text-2xl font-bold text-primary">Nutzungsbedingungen (Entwurf)</h1>
        <div className="max-w-2xl space-y-4 text-on-surface-variant">
          <p>
            Die App ist kein offizieller Notruf und ersetzt keine Verkehrszeichen oder Behördeninformationen.
            Nutzer-Inhalte können fehlerhaft sein; es gilt eine Moderations- und Meldepolitik (noch zu
            finalisieren).
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="p-8">
      <Link to="/" className="text-primary">
        Zurück
      </Link>
    </div>
  )
}
