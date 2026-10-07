// Inventarisatie: tellen, vergelijken met de administratie en het verschil
// terugboeken (ERP-plan 0.7).
//
// De administratieve stand wordt bij het aanmaken van een telling bevroren,
// maar een inventarisatie kan dagen openstaan terwijl kassa, bestellingen en
// brouwdagen doorgaan. Wie daarna afrondt, zou elke verkoop, uitslag of
// afboeking van tussendoor nóg een keer als telverschil boeken — een tekort
// wordt een vermissing mét accijns, terwijl die flesjes al verkocht en
// veraccijnsd zijn. `verouderdeTellingen` spoort zulke regels op;
// `herijkTelling` zet de bevroren stand op de actuele. Automatisch verrekenen
// kan niet: of de fysieke telling vóór of ná de mutatie viel, weet alleen de
// gebruiker.

import { normaliseerZoek } from './factuurFilter'
import { dagNotatie } from './periode'

/** Eén telregel zoals InventarisatiePage hem bewaart. */
export interface InventarisatieTellingBasis {
  id: number
  ref_type: 'lot' | 'afvulling'
  ref_id: number
  naam?: string
  administratief: number
  geteld: number
  verschil: number
  voorcalc_accijns_per_eenheid?: number
  accijns_impact?: number
  /** Waar `voorcalc_accijns_per_eenheid` op rust (`accijnsWaardeVoorraad`):
   * de bevroren voorcalculatie of een schatting op het tarief van de
   * aanmaakdag. Ontbreekt op oudere regels. */
  accijns_bron?: 'voorcalc' | 'geschat'
  verklaring?: string
  eenheid?: string
  /** Heeft de gebruiker hier zelf een telling ingevoerd? Ontbreekt op oudere
   * regels; dan geldt een geteld aantal dat afwijkt van de administratie als
   * ingevoerd. */
  geteld_ingevoerd?: boolean
}

/** Beschikbare biervoorraad per afvulling: afgevuld min uitgeleverd, min
 * afgeboekt (een bijboeking telt erbij) en min wat voor een open bestelling
 * gepickt is. Dezelfde stand waarmee een telling wordt aangemaakt, zodat een
 * vergelijking achteraf appels met appels is. */
export const bierBeschikbaarPerAfvulling = (
  afvullingen: any[],
  uitleveringen: any[],
  afboekingen: any[],
  picks: any[],
  bestellingen: any[]
): Record<number, number> => {
  const map: Record<number, number> = {}
  const openOrders = new Set(
    (bestellingen || []).filter((b: any) => b?.status === 'open').map((b: any) => b.id)
  )
  for (const a of afvullingen || []) {
    const uitgeleverd = (uitleveringen || [])
      .filter((u: any) => u?.afvulling_id === a.id)
      .reduce((s: number, u: any) => s + Number(u.aantal || 0), 0)
    const afgeboekt = (afboekingen || [])
      .filter((ab: any) => ab?.afvulling_id === a.id)
      .reduce((s: number, ab: any) => s + Number(ab.aantal || 0), 0)
    const gepickt = (picks || [])
      .filter((p: any) => p?.afvulling_id === a.id && openOrders.has(p.bestelling_id))
      .reduce((s: number, p: any) => s + Number(p.aantal || 0), 0)
    map[a.id] = Math.max(0, Number(a.hoeveelheid || 0) - gepickt - uitgeleverd - afgeboekt)
  }
  return map
}

export interface VerouderdeTelling {
  tellingId: number
  naam?: string
  /** De bij het aanmaken bevroren administratieve stand. */
  bevroren: number
  /** De administratieve stand nu. */
  actueel: number
}

const GELIJK = 1e-9

/** De telregels waarvan de administratieve stand sinds het aanmaken is
 * veranderd. Bier: de actuele `bierBeschikbaarPerAfvulling`; ingrediënt: de
 * actuele hoeveelheid van het lot. */
export const verouderdeTellingen = (
  tellingen: InventarisatieTellingBasis[],
  liveBier: Record<number, number>,
  lots: any[]
): VerouderdeTelling[] => {
  const uit: VerouderdeTelling[] = []
  for (const tel of tellingen || []) {
    let actueel: number
    if (tel.ref_type === 'afvulling') {
      actueel = Number(liveBier?.[tel.ref_id] || 0)
    } else {
      const lot = (lots || []).find((l: any) => l?.id === tel.ref_id)
      actueel = Number(lot?.hoeveelheid || 0)
    }
    const bevroren = Number(tel.administratief || 0)
    if (Math.abs(actueel - bevroren) > GELIJK) {
      uit.push({ tellingId: tel.id, naam: tel.naam, bevroren, actueel })
    }
  }
  return uit
}

/** Zet de administratieve stand van een telregel op de actuele en rekent het
 * verschil opnieuw uit. Een aantal dat de gebruiker zelf heeft ingevoerd
 * blijft staan; een regel die nog niet geteld is, schuift met de
 * administratie mee (anders verschijnt de tussentijdse mutatie als
 * telverschil). */
export const herijkTelling = <T extends InventarisatieTellingBasis>(tel: T, actueel: number): T => {
  const ingevoerd = tel.geteld_ingevoerd === true || Number(tel.geteld) !== Number(tel.administratief)
  const geteld = ingevoerd ? Number(tel.geteld) : actueel
  const verschil = geteld - actueel
  return {
    ...tel,
    administratief: actueel,
    geteld,
    verschil,
    accijns_impact: (tel.voorcalc_accijns_per_eenheid || 0) * verschil,
  }
}

// ── Lijst en telling: filteren en samenvatten ──────────────────────────────

export type InventarisatieType = 'ingredienten' | 'bier' | 'volledig'
export type InventarisatieStatus = 'open' | 'afgerond'

/** Een inventarisatie zoals InventarisatiePage hem bewaart. */
export interface InventarisatieBasis<T extends InventarisatieTellingBasis = InventarisatieTellingBasis> {
  id: number
  datum: string
  type: InventarisatieType
  status: InventarisatieStatus
  tellingen: T[]
  opmerkingen?: string
}

export type InventarisatieStatusFilter = 'alle' | InventarisatieStatus
export type InventarisatieTypeFilter = 'alle' | InventarisatieType

const zoekIn = (velden: readonly unknown[], zoek: string): boolean => {
  const q = normaliseerZoek(zoek).trim()
  if (!q) return true
  const hooiberg = velden.map(normaliseerZoek).join('\u0001')
  // Elk woord moet ergens voorkomen ("blond fles" vindt "Blond — Fles 33cl").
  return q.split(/\s+/).every(w => hooiberg.includes(w))
}

/** De lijst tellingen met status-, type- en zoekfilter, nieuwste eerst. De
 * zoekterm vindt het nummer (#12), de datum (ook DD-MM-JJJJ), de opmerkingen
 * en de namen van de getelde regels. */
export const filterInventarisaties = <I extends InventarisatieBasis>(
  lijst: readonly I[] | null | undefined,
  filter: { status?: InventarisatieStatusFilter; type?: InventarisatieTypeFilter; zoek?: string }
): I[] =>
  (lijst || [])
    .filter(inv => !!inv)
    .filter(inv => !filter.status || filter.status === 'alle' || inv.status === filter.status)
    .filter(inv => !filter.type || filter.type === 'alle' || inv.type === filter.type)
    .filter(inv => zoekIn([
      `#${inv.id}`, inv.datum, dagNotatie(String(inv.datum || '').slice(0, 10)), inv.opmerkingen,
      ...(inv.tellingen || []).map(tel => tel?.naam),
    ], filter.zoek || ''))
    .slice()
    .sort((a, b) => Number(b.id || 0) - Number(a.id || 0))

/** Aantal per statuschip, binnen het type- en zoekfilter (zodat het cijfer op
 * de chip gelijk is aan de lijst eronder). */
export const telInventarisatieStatussen = <I extends InventarisatieBasis>(
  lijst: readonly I[] | null | undefined,
  filter: { type?: InventarisatieTypeFilter; zoek?: string }
): Record<InventarisatieStatusFilter, number> => {
  const basis = filterInventarisaties(lijst, { ...filter, status: 'alle' })
  return {
    alle: basis.length,
    open: basis.filter(i => i.status === 'open').length,
    afgerond: basis.filter(i => i.status === 'afgerond').length,
  }
}

/** Heeft deze regel een verschil? */
export const heeftVerschil = (tel: Pick<InventarisatieTellingBasis, 'verschil'>): boolean =>
  Math.abs(Number(tel?.verschil) || 0) > GELIJK

/** De regels van één telling: alleen verschillen en/of een zoekterm (naam of
 * verklaring). `blijfZichtbaar` houdt regels in beeld die bij het aanzetten
 * van "alleen verschillen" een verschil hadden: wie daar het aantal
 * corrigeert, ziet de regel anders onder zijn vingers verdwijnen. */
export const filterTellingen = <T extends InventarisatieTellingBasis>(
  tellingen: readonly T[] | null | undefined,
  filter: { alleenVerschillen?: boolean; zoek?: string; blijfZichtbaar?: ReadonlySet<number> | null }
): T[] =>
  (tellingen || [])
    .filter(tel => !!tel)
    .filter(tel => !filter.alleenVerschillen || heeftVerschil(tel) || !!filter.blijfZichtbaar?.has(tel.id))
    .filter(tel => zoekIn([tel.naam, tel.verklaring], filter.zoek || ''))

export interface TellingSamenvatting {
  /** Regels met een verschil: grondstoffen (lots) en bier (afvullingen). */
  lotVerschillen: number
  bierVerschillen: number
  /** Verschillen zonder verklaring — die blokkeren het doorvoeren. */
  zonderVerklaring: number
  /** Accijns op de getelde tekorten (positief bedrag) en overschotten. */
  tekortAccijns: number
  overschotAccijns: number
}

/** Wat het afronden van deze telling zou doorvoeren. */
export const tellingSamenvatting = (tellingen: readonly InventarisatieTellingBasis[] | null | undefined): TellingSamenvatting => {
  const uit: TellingSamenvatting = { lotVerschillen: 0, bierVerschillen: 0, zonderVerklaring: 0, tekortAccijns: 0, overschotAccijns: 0 }
  for (const tel of tellingen || []) {
    if (!tel || !heeftVerschil(tel)) continue
    if (tel.ref_type === 'afvulling') uit.bierVerschillen++
    else uit.lotVerschillen++
    if (!String(tel.verklaring || '').trim()) uit.zonderVerklaring++
    const impact = Number(tel.accijns_impact) || 0
    if (impact < 0) uit.tekortAccijns += -impact
    else if (impact > 0) uit.overschotAccijns += impact
  }
  return uit
}
