// Vergistingsschema: afgeleide tijdlijn en 'stap gereed'-logica.
//
// De pure rekenkern achter de vergistingsschema-weergave op de batch-flow-
// pagina en de 'stap gereed'-melding. Een vergistingsprofiel is een reeks
// stappen met elk een doeltemperatuur en een geplande duur (`tijd`, in dagen).
// Zolang niemand handmatig navigeert loopt een batch die stappen chronologisch
// af vanaf het moment dat het bier de gisttank in ging.
//
// Alles hier is pure functie-logica (geen React, geen I/O) zodat de UI én de
// server-tick (server.py spiegelt deze regels in Python) dezelfde verwachting
// tonen, en de strict-ratchet + Vitest-suite dit dekken. Tijden komen als
// milliseconden binnen (Date.now()) zodat de functies testbaar zijn zonder klok.

import type { VergistingsStap } from '../types'

export const DAG_MS = 86_400_000

// Minimale batch-vorm die deze module nodig heeft. Bewust losjes getypt: de
// echte Batch heeft veel meer velden, maar hier tellen alleen deze mee.
export interface VergistBatch {
  status?: string
  datum?: string | null
  cold_crash_datum?: string | null
  tank_historie?: Array<{ status?: string; from?: string | null }> | null
  vergisting_stap_start?: string | null
  vergisting_stap_idx?: number | null
  vergistingsprofiel?: VergistingsStap[] | null
}

// ── Startmoment van de vergisting ───────────────────────────────────────────
// Het ijkpunt voor de éérste stap: wanneer het bier de gisttank in ging. Eerste
// keuze is de tank_historie-entry met status 'Vergisten' (`from`), anders de
// batchdatum. Die datums zijn dag-precies (YYYY-MM-DD); we ijken op middernacht.
export function vergistStartMs(batch: VergistBatch): number | null {
  const hist = Array.isArray(batch.tank_historie) ? batch.tank_historie : []
  const entry = hist.find(h => h?.status === 'Vergisten')
  const iso = entry?.from || batch.datum
  if (!iso) return null
  const ms = new Date(`${iso}T00:00`).getTime()
  return isNaN(ms) ? null : ms
}

// Startmoment van de huidige stap: het expliciete `vergisting_stap_start` (een
// volledige ISO-timestamp, gezet bij het doorschakelen), anders — voor stap 1
// die nog nooit is doorgeschakeld — de start van de vergisting.
export function huidigeStapStartMs(batch: VergistBatch): number | null {
  if (batch.vergisting_stap_start) {
    const ms = new Date(batch.vergisting_stap_start).getTime()
    if (!isNaN(ms)) return ms
  }
  return vergistStartMs(batch)
}

// Huidige stap-index, geklemd binnen het profiel (default 0).
export function huidigeStapIdx(batch: VergistBatch): number {
  const profiel = Array.isArray(batch.vergistingsprofiel) ? batch.vergistingsprofiel : []
  if (!profiel.length) return 0
  const raw = Number(batch.vergisting_stap_idx ?? 0)
  return Math.max(0, Math.min(profiel.length - 1, isNaN(raw) ? 0 : raw))
}

// Geplande duur van een stap in dagen, of null wanneer die niet (zinvol) is
// ingevuld. Zonder duur kunnen we geen verwachting berekenen.
export function stapDoelDagen(stap: VergistingsStap | undefined | null): number | null {
  if (!stap) return null
  const n = Number(stap.tijd)
  return n > 0 ? n : null
}

// Aantal (fractionele) dagen dat de huidige stap al loopt.
export function dagenInStap(stapStartMs: number | null, nowMs: number): number | null {
  if (stapStartMs == null) return null
  return Math.max(0, (nowMs - stapStartMs) / DAG_MS)
}

// Is de stap 'gereed' — heeft hij zijn geplande aantal dagen bereikt? Zonder
// startmoment of geplande duur kan dat niet vastgesteld worden (→ false).
export function stapIsGereed(
  stapStartMs: number | null,
  doelDagen: number | null,
  nowMs: number,
): boolean {
  if (stapStartMs == null || doelDagen == null || doelDagen <= 0) return false
  return nowMs - stapStartMs >= doelDagen * DAG_MS
}

// ── Geprojecteerde tijdlijn ─────────────────────────────────────────────────
// Vanaf de huidige stap vooruit: geprojecteerd start- en eindmoment per stap
// (elke volgende stap start waar de vorige eindigt). Al doorlopen stappen
// (index < huidige) krijgen geen projectie. Stopt zodra een stap geen duur
// heeft — daarna is de datum onbekend.
export interface StapProjectie {
  doelDagen: number | null
  startMs: number | null
  eindMs: number | null
}

export interface VergistProjectie {
  stappen: StapProjectie[]
  verwachtKlaarMs: number | null
}

export function vergistProjectie(
  profiel: VergistingsStap[] | null | undefined,
  stapIdx: number,
  stapStartMs: number | null,
): VergistProjectie {
  const lijst = Array.isArray(profiel) ? profiel : []
  const stappen: StapProjectie[] = []
  let cursor = stapStartMs
  for (let i = 0; i < lijst.length; i++) {
    const dagen = stapDoelDagen(lijst[i])
    if (i < stapIdx) {
      stappen.push({ doelDagen: dagen, startMs: null, eindMs: null })
      continue
    }
    const startMs = cursor
    const eindMs = startMs != null && dagen != null ? startMs + dagen * DAG_MS : null
    stappen.push({ doelDagen: dagen, startMs, eindMs })
    // Volgende stap start waar deze eindigt; zonder bekende einddatum schuift de
    // cursor naar null zodat verdere stappen ook geen projectie krijgen.
    cursor = eindMs
  }
  const verwachtKlaarMs = stappen.length ? stappen[stappen.length - 1].eindMs : null
  return { stappen, verwachtKlaarMs }
}

// Enige waarheidsbron voor 'de huidige stap van deze batch is gereed'. De
// server-tick (Python) én de scherm-melding (App.tsx) gebruiken exact deze
// voorwaarden, zodat push en banner nooit uiteenlopen: alleen batches die écht
// aan het gisten zijn, niet in een cold-crash zitten, een profiel met een
// stap-met-duur hebben, en waarvan die stap zijn dagen heeft bereikt.
export function batchStapGereed(batch: VergistBatch, nowMs: number): boolean {
  if (batch.status !== 'Vergisten') return false
  if (batch.cold_crash_datum) return false
  const profiel = Array.isArray(batch.vergistingsprofiel) ? batch.vergistingsprofiel : []
  if (!profiel.length) return false
  const idx = huidigeStapIdx(batch)
  const doel = stapDoelDagen(profiel[idx])
  const start = huidigeStapStartMs(batch)
  return stapIsGereed(start, doel, nowMs)
}
