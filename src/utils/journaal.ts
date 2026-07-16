// Journaal-helpers (ERP-plan 2.1). Bouwt onveranderlijke journaalregels op het
// moment dat een financieel feit definitief wordt en levert de rapportage-
// aggregaties die uit het journaal lezen. De regels zelf zijn append-only
// (server-side afgedwongen); elke correctie is een expliciete tegenboeking
// (storno) zodat het spoor controleerbaar blijft.
//
// Bedragen staan in hele centen (integers) — bewust vooruitlopend op
// ERP-plan 2.2, zodat het journaal nooit een float-migratie nodig heeft.

import type { JournaalRegel, JournaalDagboek, JournaalBron } from '../types'
import { newId } from './api'
import { effectievePeriodeKey, type BtwPeriodeType } from './btw'
import type { WinstVerliesResult } from './calculations'

// Regel-invoer zoals de boekingsbouwers die opleveren; id/boekstuk/geboekt_op
// worden centraal toegekend in voegBoekingToe.
export type JournaalRegelData = Omit<JournaalRegel, 'id' | 'boekstuk' | 'geboekt_op'>

export const toCent = (x: any): number => Math.round((Number(x) || 0) * 100)
export const centNaarEuro = (c: number): number => (Number(c) || 0) / 100

const rnd2 = (x: number) => Math.round(x * 100) / 100

// ── Boekingsbouwers ─────────────────────────────────────────────────────────

// Verkoopfactuur (incl. creditnota: bedragen zijn daar al negatief).
// Eén regel per BTW-tarief uit btw_overzicht; valt terug op de factuurregels
// (gegroepeerd op btw_pct) en anders op de factuurtotalen als één regel.
export const verkoopFactuurBoeking = (f: any): JournaalRegelData[] => {
  const basis = {
    datum: f?.datum || '',
    dagboek: 'verkoop' as JournaalDagboek,
    bron: 'verkoop_factuur' as JournaalBron,
    bron_id: f?.id,
    nummer: f?.factuurnummer || undefined,
    relatie: f?.klant_naam || undefined,
    omschrijving: [f?.factuurnummer, f?.klant_naam].filter(Boolean).join(' — ')
      || String(f?.factuurnummer || f?.id || ''),
  }
  let ovz: Array<{ tarief: number; netto: number; btw: number }> =
    Array.isArray(f?.btw_overzicht) && f.btw_overzicht.length ? f.btw_overzicht : []
  if (!ovz.length && Array.isArray(f?.regels) && f.regels.length) {
    const per: Record<string, { tarief: number; netto: number; btw: number }> = {}
    f.regels.forEach((r: any) => {
      const tarief = Number(r?.btw_pct) || 0
      const b = per[tarief] || (per[tarief] = { tarief, netto: 0, btw: 0 })
      b.netto = rnd2(b.netto + (Number(r?.netto) || 0))
      b.btw = rnd2(b.btw + (Number(r?.btw_bedrag) || 0))
    })
    ovz = Object.values(per)
  }
  // Fallback op factuurtotalen: geen uitsplitsing beschikbaar, of de regels
  // dragen zelf geen bedragen (bijv. bankboekingen met alleen prijs_per_stuk).
  const ovzTotaal = ovz.reduce((s, o) => s + toCent(o.netto) + toCent(o.btw), 0)
  if (!ovz.length || (ovzTotaal === 0 && (toCent(f?.netto) !== 0 || toCent(f?.btw) !== 0))) {
    ovz = [{ tarief: 0, netto: Number(f?.netto) || 0, btw: Number(f?.btw) || 0 }]
  }
  return ovz
    .filter(o => toCent(o.netto) !== 0 || toCent(o.btw) !== 0)
    .map(o => ({
      ...basis,
      btw_tarief: Number(o.tarief) || 0,
      netto_cent: toCent(o.netto),
      btw_cent: toCent(o.btw),
      bruto_cent: toCent(o.netto) + toCent(o.btw),
    }))
}

// Inkoopfactuur: één regel per combinatie kostensoort + BTW-tarief + btw_soort
// (verlegde BTW — intracom/import — heeft btw_bedrag 0 op de regels zelf).
// Valt terug op de factuurtotalen als er geen regels zijn.
export const inkoopFactuurBoeking = (f: any, periodeType: BtwPeriodeType): JournaalRegelData[] => {
  const basis = {
    datum: f?.datum || '',
    dagboek: 'inkoop' as JournaalDagboek,
    bron: 'inkoop_factuur' as JournaalBron,
    bron_id: f?.id,
    nummer: f?.factuurnummer || undefined,
    relatie: f?.leverancier || undefined,
    omschrijving: [f?.factuurnummer, f?.leverancier].filter(Boolean).join(' — ')
      || String(f?.factuurnummer || f?.id || ''),
    btw_periode: effectievePeriodeKey(f || {}, periodeType) || undefined,
  }
  // Alleen regels die zelf een bedrag dragen tellen mee in de uitsplitsing;
  // bankboekingen hebben regels zonder netto-veld en vallen dan terug op de
  // factuurtotalen als één regel.
  const regels: any[] = (Array.isArray(f?.regels) ? f.regels : [])
    .filter((r: any) => toCent(r?.netto) !== 0 || toCent(r?.btw_bedrag) !== 0)
  if (!regels.length) {
    const netto = toCent(f?.totaal_netto)
    const btw = toCent(f?.totaal_btw)
    if (!netto && !btw) return []
    return [{ ...basis, kostensoort: 'Overig', netto_cent: netto, btw_cent: btw, bruto_cent: netto + btw }]
  }
  const per: Record<string, JournaalRegelData> = {}
  regels.forEach((r: any) => {
    const kostensoort = r?.kostensoort
      || (r?.type === 'ingredient' ? 'Grondstoffen'
        : r?.type === 'verpakking' ? 'Verpakkingsmateriaal'
        : 'Overig')
    const tarief = Number(r?.btw_tarief) || 0
    const soort = (r?.btw_soort === 'intracom_eu' || r?.btw_soort === 'import_niet_eu')
      ? r.btw_soort : 'binnenlands'
    const k = `${kostensoort}|${tarief}|${soort}`
    const b = per[k] || (per[k] = {
      ...basis, kostensoort, btw_tarief: tarief, btw_soort: soort,
      netto_cent: 0, btw_cent: 0, bruto_cent: 0,
    })
    b.netto_cent += toCent(r?.netto)
    b.btw_cent += toCent(r?.btw_bedrag)
    b.bruto_cent = b.netto_cent + b.btw_cent
  })
  return Object.values(per).filter(r => r.netto_cent !== 0 || r.btw_cent !== 0)
}

// Accijnsaangifte (maand) op het moment van indienen; het bedrag is dan met
// 4-ogen-controle vastgesteld. Boekdatum = laatste dag van de aangiftemaand.
export const accijnsAangifteBoeking = (maand: string, bedrag: number, omschrijving: string): JournaalRegelData[] => {
  const cent = toCent(bedrag)
  if (!cent) return []
  return [{
    datum: laatsteDagVan(maand),
    dagboek: 'accijns',
    bron: 'accijns_aangifte',
    bron_id: maand,
    omschrijving,
    netto_cent: cent,
    btw_cent: 0,
    bruto_cent: cent,
  }]
}

// BTW-aangifte (periode) op het moment van indienen. Positief = te betalen,
// negatief = teruggave. Boekdatum = laatste dag van de periode.
export const btwAangifteBoeking = (periodeKey: string, bedrag: number, omschrijving: string): JournaalRegelData[] => {
  const cent = toCent(bedrag)
  return [{
    datum: laatsteDagVanPeriode(periodeKey),
    dagboek: 'btw',
    bron: 'btw_aangifte',
    bron_id: periodeKey,
    btw_periode: periodeKey,
    omschrijving,
    netto_cent: 0,
    btw_cent: cent,
    bruto_cent: cent,
  }]
}

// Tegenboeking: neutraliseert het netto-effect van alle bestaande regels voor
// één brondocument (inclusief eerdere storno's), per uitsplitsingsbucket.
// Gebruikt bij wijzigen (storno + herboeking) en verwijderen van een nog
// muteerbaar document, en bij het terugzetten van een aangifte.
export const stornoBoekingVoor = (
  journaal: JournaalRegel[],
  bron: JournaalBron,
  bronId: number | string,
): JournaalRegelData[] => {
  const bestaand = (journaal || []).filter(r => r?.bron === bron && String(r?.bron_id) === String(bronId))
  if (!bestaand.length) return []
  const per: Record<string, { voorbeeld: JournaalRegel; netto: number; btw: number }> = {}
  bestaand.forEach(r => {
    const k = [r.datum, r.dagboek, r.btw_tarief ?? '', r.kostensoort ?? '', r.btw_soort ?? '', r.btw_periode ?? ''].join('|')
    const b = per[k] || (per[k] = { voorbeeld: r, netto: 0, btw: 0 })
    b.netto += Number(r.netto_cent) || 0
    b.btw += Number(r.btw_cent) || 0
  })
  const laatsteBoekstuk = Math.max(...bestaand.map(r => Number(r.boekstuk) || 0))
  return Object.values(per)
    .filter(b => b.netto !== 0 || b.btw !== 0)
    .map(({ voorbeeld, netto, btw }) => ({
      datum: voorbeeld.datum,
      dagboek: voorbeeld.dagboek,
      bron,
      bron_id: bronId,
      nummer: voorbeeld.nummer,
      relatie: voorbeeld.relatie,
      omschrijving: voorbeeld.omschrijving,
      btw_tarief: voorbeeld.btw_tarief,
      btw_soort: voorbeeld.btw_soort,
      kostensoort: voorbeeld.kostensoort,
      btw_periode: voorbeeld.btw_periode,
      netto_cent: -netto,
      btw_cent: -btw,
      bruto_cent: -(netto + btw),
      storno_van: laatsteBoekstuk,
    }))
}

// Kent id, boekstuk en geboekt_op toe en hangt de regels achter het journaal.
// Aanroepen binnen een setJournaal-updater: setJournaal(prev =>
// voegBoekingToe(prev, regels)). newId is monotoon, dus herhaald aanroepen
// binnen dezelfde tick levert unieke, oplopende id's.
export const voegBoekingToe = (
  prev: JournaalRegel[],
  regels: JournaalRegelData[],
  extra: Partial<JournaalRegel> = {},
): JournaalRegel[] => {
  const huidig = Array.isArray(prev) ? prev : []
  if (!regels.length) return huidig
  const boekstuk = newId(huidig)
  const geboekt_op = new Date().toISOString()
  return [...huidig, ...regels.map(r => ({ ...r, ...extra, id: newId(huidig), boekstuk, geboekt_op }))]
}

// ── Rapportage uit het journaal ─────────────────────────────────────────────

// W&V op journaalbasis (ERP-plan 2.1): omzet en inkoopkosten komen uit de
// onveranderlijke journaalregels. Accijnskosten blijven bewust uit de
// accijnsrecords zelf komen: die zijn al bevroren per maand (periode-lock,
// plan 0.4) en dragen de werkelijke uitslagdatum — de aangifteboeking in het
// journaal is het maandtotaal en zou de lopende (nog niet ingediende) maand
// missen. Zelfde uitvoervorm als berekenWinstVerlies.
export const berekenWinstVerliesUitJournaal = (
  journaal: JournaalRegel[],
  accRecords: any[],
  van: string,
  tot: string,
): WinstVerliesResult => {
  const inPeriod = (datum: string | undefined) => !!datum && datum >= van && datum <= tot
  let omzetCent = 0
  const inkoopCent: Record<string, number> = {}
  ;(journaal || []).forEach(r => {
    if (!inPeriod(r?.datum)) return
    if (r.dagboek === 'verkoop') omzetCent += Number(r.netto_cent) || 0
    else if (r.dagboek === 'inkoop') {
      const ks = r.kostensoort || 'Overig'
      inkoopCent[ks] = (inkoopCent[ks] || 0) + (Number(r.netto_cent) || 0)
    }
  })
  const inkoopPerKostensoort: Record<string, number> = {}
  Object.entries(inkoopCent).forEach(([ks, cent]) => {
    if (cent !== 0) inkoopPerKostensoort[ks] = centNaarEuro(cent)
  })
  const omzet = centNaarEuro(omzetCent)
  const inkoopTotaal = centNaarEuro(Object.values(inkoopCent).reduce((s, v) => s + v, 0))
  const accijnsKosten = (accRecords || [])
    .filter((r: any) => inPeriod(r?.datum))
    .reduce((s: number, r: any) => s + (r.totaal_accijns || r.accijns || 0), 0)
  const brutowinst = omzet
    - (inkoopPerKostensoort['Grondstoffen'] || 0)
    - (inkoopPerKostensoort['Verpakkingsmateriaal'] || 0)
  const nettowinst = omzet - inkoopTotaal - accijnsKosten
  return { omzet, inkoopPerKostensoort, inkoopTotaal, accijnsKosten, brutowinst, nettowinst }
}

// ── Datumhelpers ────────────────────────────────────────────────────────────

// Laatste dag van een maand 'YYYY-MM' → 'YYYY-MM-DD'.
export const laatsteDagVan = (maand: string): string => {
  const y = parseInt(String(maand).slice(0, 4), 10)
  const m = parseInt(String(maand).slice(5, 7), 10)
  if (!y || !m) return String(maand || '')
  const laatste = new Date(y, m, 0).getDate()
  return `${y}-${String(m).padStart(2, '0')}-${String(laatste).padStart(2, '0')}`
}

// Laatste dag van een BTW-periodeKey ('YYYY-Qn' of 'YYYY-Mnn') → 'YYYY-MM-DD'.
export const laatsteDagVanPeriode = (periodeKey: string): string => {
  const y = String(periodeKey || '').slice(0, 4)
  const rest = String(periodeKey || '').slice(5)
  if (rest.startsWith('Q')) {
    const q = parseInt(rest.slice(1), 10)
    if (!q) return String(periodeKey || '')
    return laatsteDagVan(`${y}-${String(q * 3).padStart(2, '0')}`)
  }
  if (rest.startsWith('M')) return laatsteDagVan(`${y}-${rest.slice(1)}`)
  return String(periodeKey || '')
}
