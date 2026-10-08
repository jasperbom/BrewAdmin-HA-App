// De kostensoort van een inkoopfactuur achteraf anders indelen ("Overig" →
// "Installatie"), ook als de factuur al meetelt in een ingediende of betaalde
// BTW-periode. De kostensoort zegt alleen wáár de kosten in de winst-en-
// verliesrekening staan: bedragen, BTW-tarief, datum en BTW-periode blijven
// precies gelijk, dus de aangifte verandert er niet door. Daarom mag dit wél
// waar het gewone bewerken op de periode-lock stuit (magFactuurMuteren).
//
// Het journaal is append-only: een herindeling is een storno van wat er voor
// de factuur staat plus een herboeking met de nieuwe kostensoorten, op dezelfde
// datum en in dezelfde BTW-periode als de geboekte regels. Klopt het journaal
// niet met de regels van de factuur (andere bedragen), dan boekt dit niets:
// een herindeling mag nooit ongemerkt een bedrag of de BTW verschuiven.
//
// Puur en zonder React.

import type { JournaalRegel } from '../types'
import { toCent } from './centen'
import type { BtwPeriodeType } from './btw'
import { inkoopFactuurBoeking, inkoopRegelKostensoort, stornoBoekingVoor, type JournaalRegelData } from './journaal'

/** Sleutel voor "de hele factuur" in een wijziging: een factuur zonder regels
 *  met een bedrag wordt in het journaal op zijn totalen geboekt. */
export const HELE_FACTUUR = -1

/** Nieuwe kostensoort per regel-index (of `HELE_FACTUUR`). */
export type KostensoortWijziging = Record<number, string>

/** Ingrediënt- en verpakkingsregels horen bij de voorraad (lots en
 *  onderdelen): die blijven Grondstoffen en Verpakkingsmateriaal. */
export const kostensoortAanpasbaar = (r: any): boolean => r?.type !== 'ingredient' && r?.type !== 'verpakking'

/** Telt de regel mee in het journaal: draagt hij een bedrag? */
export const regelTeltMee = (r: any): boolean => toCent(r?.netto) !== 0 || toCent(r?.btw_bedrag) !== 0

const regelsVan = (f: any): any[] => (Array.isArray(f?.regels) ? f.regels : [])

/** Boekt het journaal deze factuur op zijn totalen (geen regel met een bedrag)? */
export const boektOpTotalen = (f: any): boolean => !regelsVan(f).some(regelTeltMee)

export interface HerindelingRegel {
  /** Index in `factuur.regels`, of `HELE_FACTUUR`. */
  index: number
  /** Omschrijving van de regel; leeg bij de hele factuur. */
  omschrijving: string
  /** Nettobedrag in hele centen. */
  netto_cent: number
  kostensoort: string
  /** Mag de kostensoort met de hand anders (geen voorraadregel)? */
  aanpasbaar: boolean
}

/**
 * De regels van de factuur zoals ze in de W&V staan: alleen regels met een
 * bedrag, met hun kostensoort en of die anders mag. Een factuur zonder zulke
 * regels staat als geheel in het journaal; die geeft één regel voor de hele
 * factuur (als hij een bedrag heeft).
 */
export function herindelingRegels(f: any): HerindelingRegel[] {
  if (boektOpTotalen(f)) {
    const netto = toCent(f?.totaal_netto)
    if (!netto && !toCent(f?.totaal_btw)) return []
    return [{ index: HELE_FACTUUR, omschrijving: '', netto_cent: netto, kostensoort: f?.kostensoort || 'Overig', aanpasbaar: true }]
  }
  const uit: HerindelingRegel[] = []
  regelsVan(f).forEach((r, index) => {
    if (!regelTeltMee(r)) return
    uit.push({
      index,
      omschrijving: String(r?.naam || '').trim(),
      netto_cent: toCent(r?.netto),
      kostensoort: inkoopRegelKostensoort(r),
      aanpasbaar: kostensoortAanpasbaar(r),
    })
  })
  return uit
}

/** Valt er aan deze factuur iets in te delen? */
export const kanHerindelen = (f: any): boolean => herindelingRegels(f).some(r => r.aanpasbaar)

const schoon = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

/**
 * De factuur met de nieuwe kostensoorten. Alleen het veld `kostensoort`, en
 * alleen op regels die dat mogen (of op de factuur zelf als hij op zijn
 * totalen geboekt is); de rest blijft hetzelfde. Verandert er niets, dan komt
 * dezelfde factuur terug.
 */
export function herindeelKostensoorten(f: any, wijziging: KostensoortWijziging): any {
  if (!f) return f
  let regelsAnders = false
  const regels = regelsVan(f).map((r, i) => {
    const nieuw = schoon(wijziging?.[i])
    if (!nieuw || !kostensoortAanpasbaar(r) || nieuw === inkoopRegelKostensoort(r)) return r
    regelsAnders = true
    return { ...r, kostensoort: nieuw }
  })
  const geheel = schoon(wijziging?.[HELE_FACTUUR])
  const geheelAnders = !!geheel && boektOpTotalen(f) && geheel !== (f.kostensoort || 'Overig')
  if (!regelsAnders && !geheelAnders) return f
  return { ...f, ...(regelsAnders ? { regels } : {}), ...(geheelAnders ? { kostensoort: geheel } : {}) }
}

export interface KostensoortVerschuiving {
  index: number
  omschrijving: string
  van: string
  naar: string
}

/** Wat er verschoof, per regel (voor het auditlogboek en het scangeheugen). */
export function kostensoortVerschuivingen(oud: any, nieuw: any): KostensoortVerschuiving[] {
  if (!oud || !nieuw || oud === nieuw) return []
  const uit: KostensoortVerschuiving[] = []
  const nieuweRegels = regelsVan(nieuw)
  regelsVan(oud).forEach((r, i) => {
    const van = inkoopRegelKostensoort(r)
    const naar = inkoopRegelKostensoort(nieuweRegels[i])
    if (nieuweRegels[i] && van !== naar) uit.push({ index: i, omschrijving: String(r?.naam || '').trim(), van, naar })
  })
  const geheelVan = oud.kostensoort || 'Overig'
  const geheelNaar = nieuw.kostensoort || 'Overig'
  if (boektOpTotalen(oud) && geheelVan !== geheelNaar) {
    uit.push({ index: HELE_FACTUUR, omschrijving: '', van: geheelVan, naar: geheelNaar })
  }
  return uit
}

// ── Journaal ────────────────────────────────────────────────────────────────

interface Som { netto: number, btw: number }

// Wat de aangifte van een regel ziet: datum, BTW-periode, tarief en soort —
// alles behalve de kostensoort. Een herindeling moet hierop precies gelijk
// uitkomen. Oude regels zonder soort of tarief tellen als binnenlands, 0 %.
const aangifteSleutel = (r: Partial<JournaalRegel>): string =>
  [r.datum || '', r.btw_periode || '', Number(r.btw_tarief) || 0, r.btw_soort || 'binnenlands'].join('|')

const volledigeSleutel = (r: Partial<JournaalRegel>): string =>
  [aangifteSleutel(r), r.kostensoort || 'Overig'].join('|')

const tel = (regels: ReadonlyArray<Partial<JournaalRegel>>, sleutel: (r: Partial<JournaalRegel>) => string): Map<string, Som> => {
  const m = new Map<string, Som>()
  for (const r of regels) {
    const k = sleutel(r)
    const s = m.get(k) || { netto: 0, btw: 0 }
    s.netto += Number(r.netto_cent) || 0
    s.btw += Number(r.btw_cent) || 0
    m.set(k, s)
  }
  // Wat per saldo nul is (geboekt en weer gestorneerd) telt niet.
  for (const [k, s] of [...m]) if (s.netto === 0 && s.btw === 0) m.delete(k)
  return m
}

const gelijk = (a: Map<string, Som>, b: Map<string, Som>): boolean =>
  a.size === b.size && [...a].every(([k, s]) => {
    const t = b.get(k)
    return !!t && t.netto === s.netto && t.btw === s.btw
  })

/** Eén waarde als alle regels hem delen, anders `undefined`. */
const enige = <T,>(waarden: T[]): T | undefined => (new Set(waarden).size === 1 ? waarden[0] : undefined)

export interface HerindelingBoeking {
  storno: JournaalRegelData[]
  herboeking: JournaalRegelData[]
}

/**
 * De journaalboeking voor een herindeling van `factuur` (de factuur mét de
 * nieuwe kostensoorten): een storno van alles wat er voor de factuur staat en
 * een herboeking, op de datum en in de BTW-periode van de geboekte regels —
 * ook als het periodetype sindsdien anders is ingesteld.
 *
 * - Leeg (`{storno: [], herboeking: []}`) als er niets verschuift, of als de
 *   factuur niet in het journaal staat (dan is er niets te verplaatsen).
 * - `null` als de herboeking per datum, BTW-periode, tarief en soort andere
 *   bedragen zou geven dan er nu staan: journaal en factuur lopen uiteen, en
 *   een herindeling verandert nooit een bedrag of de BTW.
 */
export function herindelingBoeking(
  journaal: ReadonlyArray<JournaalRegel> | null | undefined,
  factuur: any,
  periodeType: BtwPeriodeType,
): HerindelingBoeking | null {
  const leeg: HerindelingBoeking = { storno: [], herboeking: [] }
  const bestaand = (journaal || []).filter(r => r?.bron === 'inkoop_factuur' && String(r?.bron_id) === String(factuur?.id))
  const stand = tel(bestaand, volledigeSleutel)
  if (!stand.size) return leeg
  // De datum en BTW-periode zoals ze geboekt zijn (wat nu nog meetelt).
  const tellend = bestaand.filter(r => stand.has(volledigeSleutel(r)))
  const datum = enige(tellend.map(r => r.datum || ''))
  const periode = enige(tellend.map(r => r.btw_periode || ''))
  const herboeking = inkoopFactuurBoeking(factuur, periodeType).map(r => {
    const { btw_periode: berekend, ...rest } = r
    const p = periode !== undefined ? periode : (berekend || '')
    return { ...rest, ...(datum !== undefined ? { datum } : {}), ...(p ? { btw_periode: p } : {}) }
  })
  if (!gelijk(tel(bestaand, aangifteSleutel), tel(herboeking, aangifteSleutel))) return null
  if (gelijk(stand, tel(herboeking, volledigeSleutel))) return leeg
  return { storno: stornoBoekingVoor(bestaand as JournaalRegel[], 'inkoop_factuur', factuur.id), herboeking }
}
