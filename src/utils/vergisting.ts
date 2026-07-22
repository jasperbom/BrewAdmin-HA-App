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
import { sumVergistingDagen } from './calculations'

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

// ── Verwachte verpakdatum ───────────────────────────────────────────────────
// Wanneer is het bier naar verwachting gereed voor verpakking? Tijdpad vanaf de
// giststart (of, voor een geplande batch, de brouwdatum): eerst het hele
// vergistingsschema (som van de stap-dagen), daarna de conditioneringstijd.
// Consistent met berekenTanktijd(profiel, conditionerenDagen) in calculations.ts.
// Een handmatig gezette `tank_dagen` (totale tankbezetting) wint als die er is,
// zodat de planning-gantt en deze projectie hetzelfde tonen.
export interface VerpakProjectie {
  startMs: number | null        // giststart of geplande brouwdatum
  fermentDagen: number          // som van de vergistingsstappen (dagen)
  fermentEindMs: number | null  // startMs + fermentDagen
  condDagen: number             // conditioneringstijd (dagen)
  totaalDagen: number           // totale tankbezetting (gisten + conditioneren)
  verpakkenMs: number | null    // verwachte datum gereed voor verpakking
  geschat: boolean              // true = totaal berekend (geen expliciete tank_dagen)
}

export function verpakProjectie(
  batch: VergistBatch & { tank_dagen?: number | string | null },
  conditionerenDagen: number,
): VerpakProjectie {
  const startMs = vergistStartMs(batch)
  const profiel = Array.isArray(batch.vergistingsprofiel) ? batch.vergistingsprofiel : []
  const fermentDagen = sumVergistingDagen(profiel)
  const condDagen = Math.max(0, Number(conditionerenDagen) || 0)
  const berekend = Math.ceil(fermentDagen + condDagen)
  const tankDagen = Number(batch.tank_dagen)
  const heeftTankDagen = !isNaN(tankDagen) && tankDagen > 0
  const totaalDagen = heeftTankDagen ? tankDagen : berekend
  const fermentEindMs = startMs != null && fermentDagen > 0 ? startMs + fermentDagen * DAG_MS : null
  const verpakkenMs = startMs != null && totaalDagen > 0 ? startMs + totaalDagen * DAG_MS : null
  return { startMs, fermentDagen, fermentEindMs, condDagen, totaalDagen, verpakkenMs, geschat: !heeftTankDagen }
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

// ── Batch-levensloop-tijdlijn (Gereed) ──────────────────────────────────────
// Chronologische tijdlijn van een afgeronde batch voor de Gereed-weergave:
// brouwdag → vergisten (met de temperatuurstappen uit het profiel) →
// conditioneren → verpakt. De fase-datums komen zoveel mogelijk uit wat
// werkelijk is uitgevoerd: eerst de gedateerde statusovergangen (log-regels
// `type:'status'`, referentie `Oud → Nieuw`), anders de tank_historie, anders
// `cold_crash_datum` of de batchdatum; de verpakdatum uit de vroegste afvulling.
// De werkelijke duur per stap wordt nergens apart bewaard, dus de stapdagen
// komen uit het (gevolgde) vergistingsprofiel — de fase-totalen zijn wél de
// werkelijk verstreken dagen tussen de fase-datums.

export interface TijdlijnStap {
  temp: number | string | null
  type?: string
  dagen: number | null            // geplande dagen uit het profiel
  ramp?: number | string | null   // ramp-uren uit het profiel
}

export interface BatchTijdlijn {
  brouwdatum: string | null
  vergistStart: string | null
  conditioneerStart: string | null
  verpaktDatum: string | null
  vergistDagen: number | null      // werkelijk: vergistStart → conditioneerStart|verpakt
  conditioneerDagen: number | null // werkelijk: conditioneerStart → verpakt
  totaalDagen: number | null       // werkelijk: brouwdatum → verpakt
  stappen: TijdlijnStap[]
}

export interface StatusLogRegel {
  datum?: string | null
  referentie?: string | null
  batch_id?: number | string | null
  type?: string | null
}

// Hele dagen tussen twee dag-precieze datums (YYYY-MM-DD), op lokale
// middernacht geijkt zodat de tijdzone wegvalt. Null als een datum ontbreekt.
function _dagVerschil(van: string | null, tot: string | null): number | null {
  if (!van || !tot) return null
  const a = new Date(`${van}T00:00`).getTime()
  const b = new Date(`${tot}T00:00`).getTime()
  if (isNaN(a) || isNaN(b)) return null
  return Math.max(0, Math.round((b - a) / DAG_MS))
}

export function bouwBatchTijdlijn(
  batch: VergistBatch | null | undefined,
  afvullingen: Array<{ datum?: string | null }> | null | undefined,
  statusLog: StatusLogRegel[] | null | undefined,
): BatchTijdlijn {
  const leeg: BatchTijdlijn = {
    brouwdatum: null, vergistStart: null, conditioneerStart: null, verpaktDatum: null,
    vergistDagen: null, conditioneerDagen: null, totaalDagen: null, stappen: [],
  }
  if (!batch) return leeg

  // Vroegste gedateerde statusovergang náár `naar` (referentie 'Oud → Nieuw').
  const overgangNaar = (naar: string): string | null => {
    const datums = (statusLog || [])
      .filter(e => {
        const na = String(e?.referentie || '').split('→')[1]
        return !!e?.datum && na !== undefined && na.trim() === naar
      })
      .map(e => String(e.datum))
      .sort()
    return datums.length ? datums[0] : null
  }

  const hist = Array.isArray(batch.tank_historie) ? batch.tank_historie : []
  const histFrom = (status: string): string | null =>
    hist.find(h => h?.status === status)?.from || null

  const brouwdatum = batch.datum || null
  const vergistStart = overgangNaar('Vergisten') || histFrom('Vergisten') || batch.datum || null
  const conditioneerStart = overgangNaar('Conditioneren') || histFrom('Conditioneren')
    || (batch.cold_crash_datum ? String(batch.cold_crash_datum).slice(0, 10) : null)
  const avDatums = (afvullingen || [])
    .map(a => a?.datum)
    .filter((d): d is string => !!d)
    .sort()
  const verpaktDatum = (avDatums.length ? avDatums[0] : null)
    || overgangNaar('Afgevuld') || overgangNaar('Verpakt') || null

  const vergistDagen = _dagVerschil(vergistStart, conditioneerStart || verpaktDatum)
  const conditioneerDagen = _dagVerschil(conditioneerStart, verpaktDatum)
  const totaalDagen = _dagVerschil(brouwdatum, verpaktDatum)

  const profiel = Array.isArray(batch.vergistingsprofiel) ? batch.vergistingsprofiel : []
  const stappen: TijdlijnStap[] = profiel.map(s => ({
    temp: s?.temp ?? null,
    type: s?.type,
    dagen: stapDoelDagen(s),
    ramp: s?.ramp ?? null,
  }))

  return { brouwdatum, vergistStart, conditioneerStart, verpaktDatum, vergistDagen, conditioneerDagen, totaalDagen, stappen }
}
