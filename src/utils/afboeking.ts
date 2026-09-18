// Accijnsgevolgen van een afboeking op de biervoorraad.
//
// Tot nu toe berekende een afboeking alleen een voorcalculatie (bevroren
// bedrag per eenheid, gebruikt in de kostprijs) maar werd er nooit een
// accijnsboeking gemaakt. Voor `vermis` is dat onjuist: het bier is de AGP uit
// zonder uitlevering of verplaatsing, oftewel een onttrekking aan de
// schorsingsregeling — daarover is accijns verschuldigd.
//
// `vernietiging` loopt via de eigen douaneflow (aangevraagd → toegestaan →
// uitgevoerd); met toestemming vervalt de accijnsschuld juist, dus daar wordt
// niet geboekt. `overig` dekt onder andere het inventarisatie-overschot (een
// negatief aantal, dus een bijboeking) en levert evenmin een boeking op.

import type { AccijnsInst, AccijnsRecord, Afboeking } from '../types'
import { accijnsCalc, tariefVoorDatum } from './calculations'

/**
 * Alleen een echte vermissing (positief aantal) uit de AGP is accijnsplichtig.
 *
 * De heffing ontstaat op het moment dat het bier de schorsingsregeling
 * verlaat. Lag het al buiten de AGP — uitgeslagen naar een eigen locatie of
 * naar een klant — dan is de accijns daar al geboekt; hem bij de afboeking
 * nóg eens boeken belast dezelfde flesjes twee keer.
 *
 * `agpLocatieId` weglaten (of een afboeking zonder `bron_locatie_id`) betekent
 * "onbekend, dus AGP": dat is hoe de app het vóór v1.12.52 altijd deed, en zo
 * blijven bestaande records exact hetzelfde gewaardeerd.
 */
export const afboekingAccijnsplichtig = (
  afboeking: Pick<Afboeking, 'reden' | 'aantal' | 'bron_locatie_id'> | null | undefined,
  agpLocatieId?: number | null
): boolean => {
  if (afboeking?.reden !== 'vermis') return false
  if (!(Number(afboeking?.aantal || 0) > 0)) return false
  const bron = afboeking?.bron_locatie_id
  if (bron == null || agpLocatieId == null) return true
  return Number(bron) === Number(agpLocatieId)
}

export interface AfboekingAfvulling {
  inhoud_per_eenheid?: number
  verpakking_naam?: string
  verpakking_type?: string
}

export interface AfboekingBatch {
  naam?: string
  batch_nummer?: string
  ABV?: number
  platogehalte?: number
  datum?: string
}

/**
 * Bouwt het AccijnsRecord dat bij een afboeking hoort, of `null` als de
 * afboeking niet accijnsplichtig is (of er geen liters mee gemoeid zijn).
 *
 * Het tarief hoort — net als bij een AGP-verplaatsing — bij de datum van het
 * belastbare feit: de onttrekking zelf (`afboeking.datum`), niet de brouwdatum.
 * De accijns wordt immers pas verschuldigd op het moment dat het bier de
 * schorsingsregeling verlaat.
 */
export const bouwAfboekingAccijnsRecord = (
  afboeking: Pick<Afboeking, 'id' | 'batch_id' | 'datum' | 'aantal' | 'reden' | 'bron_locatie_id'>,
  afvulling: AfboekingAfvulling | null | undefined,
  batch: AfboekingBatch | null | undefined,
  accijnsInst: AccijnsInst | null | undefined,
  nieuwId: number,
  agpLocatieId?: number | null
): AccijnsRecord | null => {
  if (!afboekingAccijnsplichtig(afboeking, agpLocatieId)) return null
  const aantal = Number(afboeking.aantal || 0)
  const inhoud = Number(afvulling?.inhoud_per_eenheid || 0)
  const liter = aantal * inhoud
  if (!(liter > 0)) return null

  const abv = Number(batch?.ABV || 0)
  const plato = Number(batch?.platogehalte || 0)
  // Tarief van het belastbare feit: de onttrekking aan de schorsingsregeling
  // (de afboekdatum), niet de brouwdatum.
  const tarief = tariefVoorDatum(accijnsInst || null, afboeking?.datum)
  const eff: AccijnsInst = { ...(accijnsInst || {}), tarief_per_hl_plato: tarief.r3 }
  const bedrag = accijnsCalc(liter, abv, tarief.r1, tarief.r2, eff, plato)

  return {
    id: nieuwId,
    batch_id: afboeking.batch_id,
    batch_naam: batch?.naam || '',
    batch_nummer: batch?.batch_nummer,
    verpakking_naam: afvulling?.verpakking_naam || '',
    verpakking_type: afvulling?.verpakking_type || '',
    aantal,
    liter,
    abv,
    accijns: bedrag,
    totaal_accijns: bedrag,
    datum: afboeking.datum,
    betaald: false,
    bron: 'afboeking',
    afboeking_id: afboeking.id,
  }
}

// ── Maandindeling accijnspagina ─────────────────────────────────────────────

/** Maandsleutel `YYYY-MM` van een datum-string of Date. */
export const accijnsMaandKey = (datum: string | Date | null | undefined): string => {
  if (datum instanceof Date) {
    return `${datum.getFullYear()}-${String(datum.getMonth() + 1).padStart(2, '0')}`
  }
  const s = String(datum || '')
  // ISO-datums (YYYY-MM-DD) direct afsnijden: `new Date('2026-08-01')` wordt
  // als UTC geparsed en zou in een westelijke tijdzone een maand terugvallen.
  // Dit sluit ook aan op accijnsMaandGesloten(), dat dezelfde slice gebruikt.
  if (/^\d{4}-\d{2}/.test(s)) return s.slice(0, 7)
  const d = new Date(s)
  if (isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export interface AccijnsMaanden<T> {
  /** Records per maandsleutel; de lopende maand bestaat altijd (evt. leeg). */
  byMonth: Record<string, T[]>
  /** Maandsleutels, nieuwste eerst. */
  maanden: string[]
}

/**
 * Groepeert accijnsrecords per maand. De lopende maand komt er altijd bij —
 * ook zonder records — zodat een nieuwe maand meteen zichtbaar is en er een
 * nulaangifte gedaan kan worden. Zonder dit verscheen een maand pas bij de
 * eerste uitlevering en leek de maandreeks te blijven hangen.
 */
export const groepeerAccijnsPerMaand = <T extends { datum?: string }>(
  acc: T[] | null | undefined,
  lopendeMaand: string
): AccijnsMaanden<T> => {
  const byMonth: Record<string, T[]> = {}
  ;(acc || []).forEach(a => {
    const k = accijnsMaandKey(a?.datum)
    if (!k) return
    if (!byMonth[k]) byMonth[k] = []
    byMonth[k].push(a)
  })
  if (lopendeMaand && !byMonth[lopendeMaand]) byMonth[lopendeMaand] = []
  return {
    byMonth,
    maanden: Object.keys(byMonth).sort((a, b) => b.localeCompare(a)),
  }
}
