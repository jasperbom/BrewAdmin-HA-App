// BTW-periode helpers — zie BoekhoudingPage voor het gebruik.
// Een periodeKey is altijd 'YYYY-Qn' (kwartaal) of 'YYYY-Mnn' (maand).

import type { InkoopFactuur } from '../types'
import { toCent, centNaarEuro } from './centen'

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

// ── Periodeberekening ───────────────────────────────────────────────────────
// Kwartaal- of maandperiodes van een jaar, met datumbereik en periodeKey.
// Voorheen gedupliceerd in BoekhoudingPage en StatiegeldPage (ERP-plan 3.5).
// Met `locale` krijgen maanden een gelokaliseerde naam (bv. "Januari"),
// zonder locale het neutrale '<jaar>-<mm>'.
export interface BtwPeriode {
  label: string
  from: string
  to: string
  key: string
}

export function getPeriodes(year: number, periode: BtwPeriodeType, locale?: string): BtwPeriode[] {
  if (periode === 'maand') {
    return Array.from({length: 12}, (_, i) => {
      const m = String(i + 1).padStart(2, '0')
      const lastDay = new Date(year, i + 1, 0).getDate()
      let label = `${year}-${m}`
      if (locale) {
        const raw = new Date(year, i, 1).toLocaleString(locale, {month: 'long'})
        label = raw.charAt(0).toUpperCase() + raw.slice(1)
      }
      return {label, from: `${year}-${m}-01`, to: `${year}-${m}-${String(lastDay).padStart(2, '0')}`, key: `${year}-M${m}`}
    })
  }
  return [
    {label: 'Q1', from: `${year}-01-01`, to: `${year}-03-31`, key: `${year}-Q1`},
    {label: 'Q2', from: `${year}-04-01`, to: `${year}-06-30`, key: `${year}-Q2`},
    {label: 'Q3', from: `${year}-07-01`, to: `${year}-09-30`, key: `${year}-Q3`},
    {label: 'Q4', from: `${year}-10-01`, to: `${year}-12-31`, key: `${year}-Q4`},
  ]
}

// ── Verschuldigde BTW op grondslag per tarief (ERP-plan 2.2) ────────────────
// De Belastingdienst berekent de verschuldigde BTW in de aangifte over de
// (som van de) grondslag per tarief — niet als optelsom van per regel
// afgeronde BTW-bedragen. Die twee kunnen centen verschillen (drie regels van
// € 1,03 à 21%: 3 × € 0,22 = € 0,66, maar 21% over € 3,09 = € 0,65). Deze
// functie telt daarom eerst de netto-grondslag per exact tarief op (in hele
// centen) en berekent de BTW pas over dat totaal.
//
// Verwacht al op periode/status gefilterde invoer. WooCommerce-orders leveren
// de grondslag via hun tax_lines (rate_percent); orders zonder tax_lines
// vallen terug op hun werkelijke totalen in het hoge tarief (het tarief is
// dan onbekend, dus herberekenen zou gokken zijn). Buckets volgen de
// aangifterubrieken: hoog (≥20%, rubriek 1a) en laag (>0%, rubriek 1b);
// 0%-regels dragen geen BTW en tellen hier niet mee.
export interface OmzetBtwResultaat {
  hoog: { netto: number; btw: number }
  laag: { netto: number; btw: number }
}

export function omzetBtwOpGrondslag(verkoopFacturen: any[], wcOrders: any[]): OmzetBtwResultaat {
  const grondslagCent: Record<string, number> = {}
  ;(verkoopFacturen || []).forEach((f: any) => (f?.regels || []).forEach((r: any) => {
    const pct = Number(r?.btw_pct) || 0
    if (pct <= 0) return
    grondslagCent[pct] = (grondslagCent[pct] || 0) + toCent(r?.netto)
  }))
  const fallback = { nettoCent: 0, btwCent: 0 }
  ;(wcOrders || []).forEach((o: any) => {
    const taxLines: any[] = o?.tax_lines || []
    if (taxLines.length > 0) {
      taxLines.forEach((tl: any) => {
        const pct = parseFloat(tl?.rate_percent || 0)
        if (pct <= 0) return
        const btwCent = toCent(parseFloat(tl?.tax_total || 0) + parseFloat(tl?.shipping_tax_total || 0))
        grondslagCent[pct] = (grondslagCent[pct] || 0) + Math.round(btwCent * 100 / pct)
      })
    } else {
      const btw = parseFloat(o?.total_tax || 0)
      fallback.btwCent += toCent(btw)
      fallback.nettoCent += toCent(parseFloat(o?.total || 0)) - toCent(btw)
    }
  })
  const cent = { hoog: { netto: 0, btw: 0 }, laag: { netto: 0, btw: 0 } }
  Object.entries(grondslagCent).forEach(([pctStr, nettoCent]) => {
    const pct = Number(pctStr)
    const bucket = pct >= 20 ? cent.hoog : cent.laag
    bucket.netto += nettoCent
    bucket.btw += Math.round(nettoCent * pct / 100)
  })
  cent.hoog.netto += fallback.nettoCent
  cent.hoog.btw += fallback.btwCent
  return {
    hoog: { netto: centNaarEuro(cent.hoog.netto), btw: centNaarEuro(cent.hoog.btw) },
    laag: { netto: centNaarEuro(cent.laag.netto), btw: centNaarEuro(cent.laag.btw) },
  }
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

// ── Werkruimte-badge (Administratie) ────────────────────────────────────────
// Telt periodes met status "Openstaand" (BoekhoudingPage): de periode is al
// voorbij (p.to < vandaag) én er is nog geen aangifte ingediend én nog geen
// betaling gekoppeld. `vandaag` als 'YYYY-MM-DD'-string, zelfde formaat als
// `p.to` — laat de aanroeper meerdere jaren opgeven (bv. huidig + vorig) zodat
// een periode die over de jaarwisseling nog open staat niet gemist wordt.
export function telOpenstaandeBtwPerioden(
  jaren: number[],
  periode: BtwPeriodeType,
  btwAangiftes: any[],
  bankKoppelingen: Record<string, any>,
  vandaag: string,
): number {
  const { ingediend, betaald } = geslotenPeriodeSets(btwAangiftes, bankKoppelingen)
  let n = 0
  for (const jaar of jaren) {
    for (const p of getPeriodes(jaar, periode)) {
      if (p.to < vandaag && !betaald.has(p.key) && !ingediend.has(p.key)) n++
    }
  }
  return n
}

// Meest recente periode met status Openstaand (of null): voor een
// dashboard-widget die één concrete actie toont i.p.v. alleen een telling.
export function laatsteOpenstaandeBtwPeriode(
  jaren: number[],
  periode: BtwPeriodeType,
  btwAangiftes: any[],
  bankKoppelingen: Record<string, any>,
  vandaag: string,
): BtwPeriode | null {
  const { ingediend, betaald } = geslotenPeriodeSets(btwAangiftes, bankKoppelingen)
  const open = jaren
    .flatMap(jaar => getPeriodes(jaar, periode))
    .filter(p => p.to < vandaag && !betaald.has(p.key) && !ingediend.has(p.key))
    .sort((a, b) => b.to.localeCompare(a.to))
  return open[0] || null
}
