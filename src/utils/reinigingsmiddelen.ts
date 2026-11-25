// Reinigen en desinfecteren (1.13.56): de middelen van de brouwerij en de
// controle bij elke reiniging.
//
// - De middelen staan als gegevens in de app (`reinigingsmiddelen`): soort,
//   dosering, contacttijd, of er nagespoeld moet worden, en voor een
//   desinfectiemiddel het Ctgb-toelatingsnummer met de einddatum. Alleen een
//   middel met een geldige toelating mag als desinfectiemiddel; een toelating
//   die afloopt is een aandachtspunt.
// - Bij een reiniging kies je het middel; de dosering staat er dan al. De app
//   toetst de concentratie aan het gebruiksvoorschrift en de pH van het
//   naspoelwater aan die van het leidingwater (± 0,5).
// - Thermisch desinfecteren (heet water): uit de geschiedenis van een
//   retoursensor in Home Assistant leest de app hoe lang het retourwater
//   aaneengesloten boven de grens bleef — het bewijs van temperatuur en tijd.
//
// Geen merken of producten in de code: de lijst vult de brouwerij zelf.
// Puur en zonder React.

import type { HaRetourSensor, ReinigingsMiddel, ReinigingStap } from '../types'

export const MIDDEL_SOORTEN = ['alkalisch', 'zuur', 'desinfectie', 'thermisch', 'overig'] as const
export type MiddelSoort = typeof MIDDEL_SOORTEN[number]

/** Zoveel dagen vóór het aflopen van een toelating wordt het een aandachtspunt. */
export const CTGB_WAARSCHUW_DAGEN = 90
/** pH van het naspoelwater mag zoveel van die van het leidingwater afwijken. */
export const NASPOEL_PH_MARGE = 0.5

const getal = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'))
  return Number.isFinite(n) ? n : null
}
const datum = (v: unknown): string | null => {
  const s = typeof v === 'string' ? v.slice(0, 10) : ''
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null
}
const dagenTussen = (van: string, tot: string): number =>
  Math.round((Date.parse(`${tot}T12:00:00Z`) - Date.parse(`${van}T12:00:00Z`)) / 86_400_000)

// ── De toelating ────────────────────────────────────────────────────────────

export type CtgbStand = 'niet_nodig' | 'ontbreekt' | 'verlopen' | 'verloopt' | 'geldig'

export interface CtgbOordeel {
  stand: CtgbStand
  /** Dagen tot het aflopen (negatief = verlopen); null zonder datum. */
  dagen: number | null
}

/** Moet dit middel een Ctgb-toelating hebben, en is die er en geldig? Alleen
 *  een desinfectiemiddel heeft er een nodig (biocide, productsoort 4). Een
 *  toelating zonder einddatum geldt als geldig. */
export const ctgbOordeel = (m: Pick<ReinigingsMiddel, 'soort' | 'ctgb_nummer' | 'ctgb_geldig_tot'>, vandaag: string): CtgbOordeel => {
  if (m.soort !== 'desinfectie') return { stand: 'niet_nodig', dagen: null }
  if (!String(m.ctgb_nummer || '').trim()) return { stand: 'ontbreekt', dagen: null }
  const tot = datum(m.ctgb_geldig_tot)
  if (!tot) return { stand: 'geldig', dagen: null }
  const dagen = dagenTussen(vandaag, tot)
  if (dagen < 0) return { stand: 'verlopen', dagen }
  return { stand: dagen <= CTGB_WAARSCHUW_DAGEN ? 'verloopt' : 'geldig', dagen }
}

/** Mag dit middel nu gebruikt worden? Een desinfectiemiddel zonder (geldige)
 *  toelating niet; de rest wel. */
export const middelBruikbaar = (m: Pick<ReinigingsMiddel, 'soort' | 'ctgb_nummer' | 'ctgb_geldig_tot'>, vandaag: string): boolean => {
  const s = ctgbOordeel(m, vandaag).stand
  return s !== 'ontbreekt' && s !== 'verlopen'
}

/** De middelen die om aandacht vragen: een desinfectiemiddel zonder
 *  toelating, of een toelating die verlopen is of binnenkort afloopt. */
export const middelenMetAandacht = (lijst: readonly ReinigingsMiddel[] | null | undefined, vandaag: string): Array<{ middel: ReinigingsMiddel; oordeel: CtgbOordeel }> =>
  (lijst || [])
    .filter(m => m && !m.gearchiveerd)
    .map(middel => ({ middel, oordeel: ctgbOordeel(middel, vandaag) }))
    .filter(x => x.oordeel.stand === 'ontbreekt' || x.oordeel.stand === 'verlopen' || x.oordeel.stand === 'verloopt')

// ── De dosering ─────────────────────────────────────────────────────────────

const fmt = (n: number, taal?: string): string =>
  new Intl.NumberFormat(taal || 'nl', { maximumFractionDigits: 2 }).format(n)

/** "1–1,5 % · 20 °C · 5 min" (onverdund = "onverdund"); leeg zonder gegevens. */
export const doseringTekst = (
  m: Pick<ReinigingsMiddel, 'soort' | 'onverdund' | 'dosering_min_pct' | 'dosering_max_pct' | 'temp_min_c' | 'temp_max_c' | 'contacttijd_min'>,
  t: (k: string) => string,
  taal?: string,
): string => {
  const delen: string[] = []
  const lo = getal(m.dosering_min_pct)
  const hi = getal(m.dosering_max_pct)
  if (m.onverdund) delen.push(t('middel_onverdund'))
  else if (lo !== null && hi !== null && hi !== lo) delen.push(`${fmt(lo, taal)}–${fmt(hi, taal)} %`)
  else if (lo !== null || hi !== null) delen.push(`${fmt((lo ?? hi) as number, taal)} %`)
  const tlo = getal(m.temp_min_c)
  const thi = getal(m.temp_max_c)
  if (tlo !== null && thi !== null && thi !== tlo) delen.push(`${fmt(tlo, taal)}–${fmt(thi, taal)} °C`)
  else if (tlo !== null) delen.push(m.soort === 'thermisch' ? `≥ ${fmt(tlo, taal)} °C` : `${fmt(tlo, taal)} °C`)
  else if (thi !== null) delen.push(`≤ ${fmt(thi, taal)} °C`)
  const tijd = getal(m.contacttijd_min)
  if (tijd !== null) delen.push(`${fmt(tijd, taal)} min`)
  return delen.join(' · ')
}

export type ConcentratieOordeel = 'binnen' | 'te_laag' | 'te_hoog' | 'onbekend'

/** Ligt de gemeten of gedoseerde concentratie binnen het voorschrift? */
export const beoordeelConcentratie = (
  m: Pick<ReinigingsMiddel, 'onverdund' | 'dosering_min_pct' | 'dosering_max_pct'>,
  pct: unknown,
): ConcentratieOordeel => {
  const v = getal(pct)
  if (m.onverdund || v === null) return 'onbekend'
  const lo = getal(m.dosering_min_pct)
  const hi = getal(m.dosering_max_pct) ?? lo
  if (lo === null && hi === null) return 'onbekend'
  if (lo !== null && v < lo - 1e-9) return 'te_laag'
  if (hi !== null && v > hi + 1e-9) return 'te_hoog'
  return 'binnen'
}

export type NaspoelOordeel = 'ok' | 'te_hoog' | 'te_laag' | 'onbekend'

/** Naspoelen tot de pH gelijk is aan die van leidingwater (± 0,5). Zonder
 *  pH van het leidingwater geldt 7,0 niet als vervanger: dan onbekend. */
export const beoordeelNaspoelPh = (phNaspoel: unknown, phLeiding: unknown, marge = NASPOEL_PH_MARGE): NaspoelOordeel => {
  const n = getal(phNaspoel)
  const l = getal(phLeiding)
  if (n === null || l === null) return 'onbekend'
  if (n > l + marge + 1e-9) return 'te_hoog'
  if (n < l - marge - 1e-9) return 'te_laag'
  return 'ok'
}

// ── De retoursensor ─────────────────────────────────────────────────────────

export interface SensorPunt {
  /** ISO-tijdstip van de meting. */
  ts: string
  waarde: number
}

export interface RetourOordeel {
  /** De grens en de vereiste tijd. */
  drempel: number
  minuten: number
  /** Langste aaneengesloten periode boven (of op) de grens. */
  minutenBoven: number
  /** Begin en eind van die periode (ISO); null als hij er niet is. */
  van: string | null
  tot: string | null
  /** Hoogste gemeten temperatuur in het venster. */
  max: number | null
  gehaald: boolean
  /** Aantal metingen in het venster. */
  punten: number
}

/**
 * Hoe lang bleef het retourwater aaneengesloten op of boven `drempel`? De
 * sensor meldt alleen veranderingen: een waarde geldt tot de volgende meting
 * (en de laatste tot `eind`). Een gat in de reeks dat langer is dan
 * `maxGatMin` breekt de periode — dan is er niet gemeten.
 */
export const retourOordeel = (
  punten: readonly SensorPunt[],
  opties: { drempel: number; minuten: number; eind?: string; maxGatMin?: number },
): RetourOordeel => {
  const maxGat = (opties.maxGatMin ?? 10) * 60_000
  const reeks = punten
    .map(p => ({ t: Date.parse(p.ts), v: getal(p.waarde) }))
    .filter((p): p is { t: number; v: number } => Number.isFinite(p.t) && p.v !== null)
    .sort((a, b) => a.t - b.t)
  const eindMs = opties.eind ? Date.parse(opties.eind) : (reeks.length ? reeks[reeks.length - 1].t : NaN)
  let beste = { start: NaN, eind: NaN, duur: 0 }
  let start = NaN
  for (let i = 0; i < reeks.length; i++) {
    const p = reeks[i]
    const volgende = i + 1 < reeks.length ? reeks[i + 1].t : (Number.isFinite(eindMs) ? Math.max(eindMs, p.t) : p.t)
    const geldigTot = Math.min(volgende, p.t + maxGat)
    if (p.v >= opties.drempel - 1e-9) {
      if (!Number.isFinite(start)) start = p.t
      const duur = geldigTot - start
      if (duur > beste.duur) beste = { start, eind: geldigTot, duur }
      // Een gat breekt de periode.
      if (geldigTot < volgende) start = NaN
    } else {
      start = NaN
    }
  }
  const minutenBoven = Math.floor(beste.duur / 60_000)
  const max = reeks.length ? Math.max(...reeks.map(p => p.v)) : null
  return {
    drempel: opties.drempel,
    minuten: opties.minuten,
    minutenBoven,
    van: beste.duur > 0 ? new Date(beste.start).toISOString() : null,
    tot: beste.duur > 0 ? new Date(beste.eind).toISOString() : null,
    max,
    gehaald: minutenBoven >= opties.minuten,
    punten: reeks.length,
  }
}

// ── Opslaan ─────────────────────────────────────────────────────────────────

/** Een middel zoals het opgeslagen wordt: getallen als getal, lege velden weg. */
export const normaliseerMiddel = (m: Partial<ReinigingsMiddel> & { id: number }): ReinigingsMiddel => {
  const soort = (MIDDEL_SOORTEN as readonly string[]).includes(String(m.soort)) ? m.soort as MiddelSoort : 'overig'
  const uit: ReinigingsMiddel = {
    id: m.id,
    naam: String(m.naam || '').trim(),
    soort,
    naspoelen: m.naspoelen !== false && soort !== 'thermisch',
  }
  const tekstVeld = (k: 'ctgb_nummer' | 'waarvoor') => { const v = String(m[k] || '').trim(); if (v) uit[k] = v }
  tekstVeld('ctgb_nummer')
  tekstVeld('waarvoor')
  const tot = datum(m.ctgb_geldig_tot)
  if (tot) uit.ctgb_geldig_tot = tot
  for (const k of ['dosering_min_pct', 'dosering_max_pct', 'temp_min_c', 'temp_max_c', 'contacttijd_min'] as const) {
    const v = getal(m[k])
    if (v !== null) uit[k] = v
  }
  if (m.onverdund) uit.onverdund = true
  if (m.gearchiveerd) uit.gearchiveerd = true
  if (soort === 'thermisch') delete uit.ctgb_nummer
  return uit
}

// ── De middelen bij een reiniging (stappen) ────────────────────────────────

/** Wat de gebruiker per middel invult (tekst, zoals in de invoervelden). */
export interface StapConcept {
  middel_id: number
  concentratie: string
  ph_naspoel: string
  ph_leiding: string
  /** Thermisch zonder sensor: hoogste retourtemperatuur en minuten op temperatuur. */
  retour_max: string
  retour_minuten: string
  /** Thermisch met sensor: wat de sensor liet zien. */
  retour_sensor?: RetourOordeel & { entity: string }
}

// Voor een getalveld (`type="number"`): altijd met een punt, anders blijft het leeg.
const getalTekst = (n: number | undefined | null): string =>
  n === undefined || n === null ? '' : String(n)

/** De standaardconcentratie: de ondergrens van het voorschrift. */
export const standaardConcentratie = (m: Pick<ReinigingsMiddel, 'onverdund' | 'dosering_min_pct' | 'dosering_max_pct'> | null | undefined): number | null =>
  !m || m.onverdund ? null : (getal(m.dosering_min_pct) ?? getal(m.dosering_max_pct))

/** Een nieuwe regel voor dit middel: de dosering staat er al. */
export const stapVoorMiddel = (m: ReinigingsMiddel, phLeiding?: number | null): StapConcept => ({
  middel_id: m.id,
  concentratie: getalTekst(standaardConcentratie(m)),
  ph_naspoel: '',
  ph_leiding: getalTekst(phLeiding ?? null),
  retour_max: '',
  retour_minuten: '',
})

interface LogMetStappen { id?: number; datum?: string; stappen?: ReinigingStap[] }
const nieuwsteEerst = <T extends LogMetStappen>(logs: readonly T[]): T[] =>
  [...logs].sort((a, b) => String(b.datum || '').localeCompare(String(a.datum || '')) || Number(b.id || 0) - Number(a.id || 0))

/** De pH van het leidingwater zoals die het laatst is opgegeven (uit alle
 *  registraties), zodat hij niet elke keer opnieuw ingetypt hoeft. */
export const laatstePhLeiding = (...lijsten: Array<readonly LogMetStappen[] | null | undefined>): number | null => {
  for (const log of nieuwsteEerst(lijsten.flatMap(l => (l || []) as LogMetStappen[]))) {
    for (const st of log.stappen || []) {
      const v = getal(st?.ph_leiding)
      if (v !== null) return v
    }
  }
  return null
}

/** De middelen van de vorige registratie die bij dit filter past (dezelfde
 *  tank of taak) — de volgorde van de vorige keer, met de dosering van nu.
 *  Alleen middelen die er nog zijn en nu gebruikt mogen worden. */
export const vorigeStappen = <T extends LogMetStappen>(
  logs: readonly T[] | null | undefined,
  past: (log: T) => boolean,
  middelen: readonly ReinigingsMiddel[] | null | undefined,
  vandaag: string,
  phLeiding?: number | null,
): StapConcept[] => {
  const vorige = nieuwsteEerst((logs || []).filter(l => l && past(l) && (l.stappen || []).length))[0]
  if (!vorige) return []
  return (vorige.stappen || [])
    .map(st => (middelen || []).find(m => m && !m.gearchiveerd && m.id === st.middel_id))
    .filter((m): m is ReinigingsMiddel => !!m && middelBruikbaar(m, vandaag))
    .map(m => stapVoorMiddel(m, phLeiding))
}

/** Van invoer naar wat er opgeslagen wordt, met de oordelen erbij. Een
 *  middel dat niet (meer) bestaat geeft null. */
export const bouwStap = (c: StapConcept, middelen: readonly ReinigingsMiddel[] | null | undefined): ReinigingStap | null => {
  const m = (middelen || []).find(x => x && x.id === c.middel_id)
  if (!m) return null
  const st: ReinigingStap = { middel_id: m.id, middel: m.naam, soort: m.soort }
  if (m.ctgb_nummer && m.soort === 'desinfectie') st.ctgb_nummer = m.ctgb_nummer
  const pct = getal(c.concentratie)
  if (pct !== null && !m.onverdund && m.soort !== 'thermisch') {
    st.concentratie_pct = pct
    st.concentratie_oordeel = beoordeelConcentratie(m, pct)
  }
  if (m.naspoelen) {
    const n = getal(c.ph_naspoel)
    const l = getal(c.ph_leiding)
    if (n !== null) st.ph_naspoel = n
    if (l !== null) st.ph_leiding = l
    if (n !== null) st.naspoel_oordeel = beoordeelNaspoelPh(n, l)
  }
  if (m.soort === 'thermisch') {
    const drempel = getal(m.temp_min_c) ?? 82
    const minuten = getal(m.contacttijd_min) ?? 15
    if (c.retour_sensor) {
      const r = c.retour_sensor
      st.retour = { bron: 'sensor', entity: r.entity, drempel, minuten, minuten_boven: r.minutenBoven,
        max: r.max, van: r.van, tot: r.tot, gehaald: r.minutenBoven >= minuten }
    } else {
      const max = getal(c.retour_max)
      const min = getal(c.retour_minuten)
      if (max !== null || min !== null) {
        st.retour = { bron: 'handmatig', drempel, minuten, minuten_boven: min ?? 0, max,
          gehaald: max !== null && max >= drempel - 1e-9 && (min ?? 0) >= minuten }
      }
    }
  }
  return st
}

/** Wat er bij een stap niet klopt (i18n-sleutels): concentratie buiten het
 *  voorschrift, naspoelwater nog niet op pH, retour te kort of te koud. */
export const stapAfwijkingen = (st: ReinigingStap): string[] => {
  const uit: string[] = []
  if (st.concentratie_oordeel === 'te_laag') uit.push('reiniging_afw_conc_laag')
  if (st.concentratie_oordeel === 'te_hoog') uit.push('reiniging_afw_conc_hoog')
  if (st.naspoel_oordeel === 'te_hoog' || st.naspoel_oordeel === 'te_laag') uit.push('reiniging_afw_naspoel')
  if (st.retour && !st.retour.gehaald) uit.push('reiniging_afw_retour')
  return uit
}

/** Is er bewijs van desinfectie? Een desinfectiemiddel met toelating, of heet
 *  water dat de temperatuur lang genoeg haalde (of waarvan het niet gemeten
 *  is — dan zegt `onbewezen` het). */
export const desinfectieBewijs = (stappen: readonly ReinigingStap[]): 'ja' | 'onbewezen' | 'nee' => {
  if (stappen.some(s => s.soort === 'desinfectie' && s.ctgb_nummer)) return 'ja'
  const heet = stappen.filter(s => s.soort === 'thermisch')
  if (heet.some(s => s.retour?.gehaald)) return 'ja'
  if (heet.length) return 'onbewezen'
  return 'nee'
}

/** De middelen in één regel voor het logboek: "Loog A 1,2 % · Heet water". */
export const stappenTekst = (stappen: readonly ReinigingStap[], taal?: string): string =>
  stappen.map(s => s.concentratie_pct !== undefined
    ? `${s.middel} ${new Intl.NumberFormat(taal || 'nl', { maximumFractionDigits: 2 }).format(s.concentratie_pct)} %`
    : s.middel).join(' · ')

/** De retoursensor voor deze tank: een eigen sensor gaat voor, anders die
 *  voor alle tanks. Alleen als Home Assistant aan staat. */
export const retourSensorVoorTank = (
  haInst: { enabled?: boolean; retour_sensors?: HaRetourSensor[] } | null | undefined,
  tankId: string | number | null | undefined,
): string | undefined => {
  if (!haInst?.enabled) return undefined
  const lijst = (haInst.retour_sensors || []).filter(s => s && String(s.entity || '').trim())
  const eigen = tankId != null && tankId !== '' ? lijst.find(s => String(s.tank) === String(tankId)) : undefined
  return (eigen || lijst.find(s => !String(s.tank || '').trim()))?.entity
}
