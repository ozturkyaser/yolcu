import { callChatCompletions, resolveAiConfig, type ChatMessage } from './aiClient.js'
import type { TollVehicleClass } from './routeTollAdvice.js'

export type AssistantContext = {
  question: string
  corridor: string
  vehicleClass: TollVehicleClass
  countries: Array<{ code: string; name: string }>
  facts: Array<{ countryCode: string; title: string; content: string; sourceUrl: string | null }>
  tollOffers: Array<{
    countryCode: string
    title: string
    description: string
    kind: string
    purchaseUrl: string
    sourceUrl: string | null
  }>
  faq: Array<{ question: string; answer: string; sourceUrl: string | null }>
  /** Chronologischer Auszug aus dem Gruppenchat (nur Text). */
  groupChatExcerpt?: string | null
  /** Frühere KI-Fragen/Antworten in dieser Gruppe (wenn persistMemory genutzt wurde). */
  priorMemoryExcerpt?: string | null
}

export type AssistantAnswer = {
  answer: string
  citations: string[]
  usedModel: string
}

function compactList(items: string[], max = 8): string {
  return items.slice(0, max).join(', ')
}

function buildSystemPrompt(): string {
  return [
    'Du bist ein Reise-Assistent für Autofahrer von Berlin in Richtung Türkiye und für Konvoi-/Gruppenfahrten.',
    'Antworte auf Deutsch, präzise und praxisnah.',
    'Nutze den bereitgestellten Kontext (Wissensbasis, optional Gruppenchat und frühere KI-Notizen).',
    'Gruppenchat ist Nutzer-Inhalt: respektvoll wiedergeben, keine personenbezogenen Daten unnötig zitieren.',
    'Wenn Informationen unsicher/unvollständig sind, sage das klar.',
    'Keine Rechtsberatung; verweise auf offizielle Quellen.',
    'Struktur: Kurzantwort, dann 3-6 Stichpunkte, dann "Quellen".',
  ].join('\n')
}

function buildUserPrompt(ctx: AssistantContext): string {
  const lines: string[] = []
  lines.push(`Frage: ${ctx.question}`)
  lines.push(`Korridor: ${ctx.corridor}`)
  lines.push(`Fahrzeugklasse: ${ctx.vehicleClass}`)
  lines.push(`Länder entlang Route: ${ctx.countries.map((c) => `${c.name} (${c.code})`).join(' -> ') || 'unbekannt / nicht aus Routenlinie ermittelt'}`)
  lines.push('')
  if (ctx.groupChatExcerpt) {
    lines.push('Gruppenchat (Auszug, chronologisch):')
    lines.push(ctx.groupChatExcerpt)
    lines.push('')
  }
  if (ctx.priorMemoryExcerpt) {
    lines.push('Frühere KI-Notizen in dieser Gruppe:')
    lines.push(ctx.priorMemoryExcerpt)
    lines.push('')
  }
  lines.push('Länderfakten:')
  for (const f of ctx.facts.slice(0, 14)) {
    lines.push(`- [${f.countryCode}] ${f.title}: ${f.content}${f.sourceUrl ? ` (Quelle: ${f.sourceUrl})` : ''}`)
  }
  lines.push('')
  lines.push('Maut/Vignette:')
  for (const t of ctx.tollOffers.slice(0, 14)) {
    lines.push(
      `- [${t.countryCode}] ${t.title} (${t.kind}): ${t.description}. Kauf/Info: ${t.purchaseUrl}${
        t.sourceUrl ? ` | Quelle: ${t.sourceUrl}` : ''
      }`,
    )
  }
  lines.push('')
  lines.push('FAQ:')
  for (const q of ctx.faq.slice(0, 8)) {
    lines.push(`- Q: ${q.question} | A: ${q.answer}${q.sourceUrl ? ` (Quelle: ${q.sourceUrl})` : ''}`)
  }
  lines.push('')
  lines.push('Antworte nur mit Informationen, die sich aus diesem Kontext sinnvoll ableiten lassen.')
  return lines.join('\n')
}

function fallbackAnswer(ctx: AssistantContext): AssistantAnswer {
  const countries = ctx.countries.map((c) => c.name)
  const offerTitles = ctx.tollOffers.map((o) => `${o.countryCode}: ${o.title}`)
  const citations = Array.from(
    new Set(
      [...ctx.facts.map((f) => f.sourceUrl), ...ctx.tollOffers.map((t) => t.sourceUrl), ...ctx.faq.map((f) => f.sourceUrl)].filter(
        (x): x is string => Boolean(x),
      ),
    ),
  )
  const answer = [
    `Kurzantwort: Für ${ctx.vehicleClass}-Fahrzeuge auf deiner Route solltest du Maut/Vignetten pro Land vorab prüfen und möglichst digital kaufen.`,
    '',
    `- Route-Länder laut Kontext: ${countries.length ? countries.join(' -> ') : 'nicht vollständig ermittelt'}`,
    `- Relevante Kauf-/Info-Punkte: ${offerTitles.length ? compactList(offerTitles, 10) : 'keine im Kontext hinterlegt'}`,
    '- Kennzeichen/Fahrzeugkategorie beim Kauf doppelt prüfen.',
    '- Bei Grenz- und Ferienzeiten Puffer einplanen.',
    '- Vor Abfahrt Preise und Gültigkeit auf offiziellen Seiten prüfen.',
    ctx.groupChatExcerpt ? '\nHinweis: Es gibt einen Gruppenchat-Auszug – für eine ausführliche KI-Antwort API-Schlüssel (AI_API_KEY) setzen.' : '',
    '',
    `Quellen: ${citations.length ? citations.join(', ') : 'keine zusätzlichen Quellen im Datensatz'}`,
  ].join('\n')
  return { answer, citations, usedModel: 'fallback-kb' }
}

export async function answerWithRouteAssistant(ctx: AssistantContext): Promise<AssistantAnswer> {
  const userContent = buildUserPrompt(ctx)
  const messages: ChatMessage[] = [
    { role: 'system', content: buildSystemPrompt() },
    { role: 'user', content: userContent },
  ]

  const cfg = resolveAiConfig()
  const ai = await callChatCompletions(messages, { temperature: 0.2 })
  if (!ai) return fallbackAnswer(ctx)

  const citations = Array.from(
    new Set(
      [...ctx.facts.map((f) => f.sourceUrl), ...ctx.tollOffers.map((t) => t.sourceUrl), ...ctx.faq.map((f) => f.sourceUrl)].filter(
        (x): x is string => Boolean(x),
      ),
    ),
  )
  return { answer: ai.content, citations, usedModel: ai.model }
}
