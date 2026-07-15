// BTW-periode helpers — zie BoekhoudingPage voor het gebruik.
// Een periodeKey is altijd 'YYYY-Qn' (kwartaal) of 'YYYY-Mnn' (maand).

import type { InkoopFactuur } from '../types'

export type BtwPeriodeType = 'kwartaal' | 'maand'

// Bepaal de periodeKey waarin een factuurdatum valt.
export function datumToPeriodeKey(datum: string, periode: BtwPeriodeType = 'kwartaal'): string {
  if (!datum || datum.length < 7) return ''
  const y = datum.slice(0, 4)
  const m = datum.slice(5, 7)
  if (periode === 'maand') return `${y}-M${m}`
  const q = Math.floor((parseInt(m, 10) - 1) / 3) + 1
  return `${y}-Q${q}`
}

// Mens-leesbaar label, bv. '2026-Q2' → 'Q2 2026', '2026-M04' → '04/2026'.
export function periodeKeyLabel(periodeKey: string): string {
  if (!periodeKey) return ''
  const y = periodeKey.slice(0, 4)
  const rest = periodeKey.slice(5)
  if (rest.startsWith('Q')) return `${rest} ${y}`
  if (rest.startsWith('M')) return `${rest.slice(1)}/${y}`
  return periodeKey
}

// PeriodeKey die de huidige datum bevat (gebruikt als rollover-bestemming).
export function huidigePeriodeKey(periode: BtwPeriodeType = 'kwartaal', today: Date = new Date()): string {
  const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  return datumToPeriodeKey(iso, periode)
}

// Een periode heet "gesloten" zodra de aangifte ingediend is óf de betaling
// is gekoppeld. In beide gevallen mag een nieuw geboekte factuur de periode
// niet meer wijzigen — de BTW rolt door naar de huidige openstaande periode.
export function isPeriodeGesloten(
  periodeKey: string,
  ingediendeKeys: Set<string>,
  betaaldeKeys: Set<string>,
): boolean {
  if (!periodeKey) return false
  return ingediendeKeys.has(periodeKey) || betaaldeKeys.has(periodeKey)
}

// Geeft de effectieve periodeKey waarin de BTW van een factuur thuishoort:
// expliciete `btw_periode` als die gezet is, anders afgeleid uit de datum.
export function effectievePeriodeKey(
  factuur: Pick<InkoopFactuur, 'datum' | 'btw_periode'>,
  periode: BtwPeriodeType = 'kwartaal',
): string {
  return factuur.btw_periode || datumToPeriodeKey(factuur.datum || '', periode)
}

// Bouw de sets van ingediende en betaalde periodeKeys uit de ruwe stores,
// zodat elke pagina (Boekhouding, Bestellingen, …) dezelfde periode-lock
// kan afleiden zonder eigen memo-logica te dupliceren.
export function geslotenPeriodeSets(
  btwAangiftes: any[],
  bankKoppelingen: Record<string, any>,
): { ingediend: Set<string>; betaald: Set<string> } {
  const ingediend = new Set<string>()
  ;(btwAangiftes || []).forEach((a: any) => { if (a?.periodeKey) ingediend.add(a.periodeKey) })
  const betaald = new Set<string>()
  Object.values(bankKoppelingen || {}).forEach((k: any) => {
    if (k?.soort === 'btw' && k.periodeKey) betaald.add(k.periodeKey)
  })
  return { ingediend, betaald }
}

// Harde periode-lock (ERP-plan 0.4): mag deze factuur nog inhoudelijk
// gewijzigd of verwijderd worden? Nee zodra de BTW-periode waarin de factuur
// meetelt (effectievePeriodeKey, dus incl. rollover) is ingediend of betaald.
// Correcties horen daarna via een nieuwe boeking/creditnota in de huidige
// periode te lopen — nooit door de ingediende cijfers te veranderen.
export function magFactuurMuteren(
  factuur: Pick<InkoopFactuur, 'datum' | 'btw_periode'>,
  periode: BtwPeriodeType,
  ingediendeKeys: Set<string>,
  betaaldeKeys: Set<string>,
): boolean {
  return !isPeriodeGesloten(effectievePeriodeKey(factuur, periode), ingediendeKeys, betaaldeKeys)
}

// Bepaalt of een factuur met deze datum naar de huidige periode moet rollen,
// en zo ja: naar welke periodeKey. Geeft `null` terug wanneer geen rollover
// nodig is (datum valt in een open of toekomstige periode).
export function bepaalRollover(
  datum: string,
  periode: BtwPeriodeType,
  ingediendeKeys: Set<string>,
  betaaldeKeys: Set<string>,
  today: Date = new Date(),
): { rolloverNaar: string; vanafPeriode: string } | null {
  if (!datum) return null
  const datumKey = datumToPeriodeKey(datum, periode)
  if (!isPeriodeGesloten(datumKey, ingediendeKeys, betaaldeKeys)) return null
  const huidig = huidigePeriodeKey(periode, today)
  // Als de huidige periode toevallig zélf ook al gesloten is, geen rollover —
  // anders zouden we de factuur in een óók afgesloten periode plaatsen.
  if (isPeriodeGesloten(huidig, ingediendeKeys, betaaldeKeys)) return null
  if (huidig === datumKey) return null
  return { rolloverNaar: huidig, vanafPeriode: datumKey }
}
