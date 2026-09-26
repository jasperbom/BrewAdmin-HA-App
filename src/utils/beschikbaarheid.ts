// Beschikbaarheid van één afvulling: wat er nog vrij is nadat open
// bestellingen hun picks hebben vastgelegd. De enige plek voor die telling —
// de kassa, de bestellingen en de productpagina rekenen er allemaal mee.
//
// Stond eerder drie keer inline, en de kopieën waren uit elkaar gegroeid:
//  - alleen de productpagina trok afboekingen af. Gebroken of vermiste
//    flessen bleven in de kassa als AGP-voorraad staan en een exportorder kon
//    ze picken (een reservering op bier dat niet bestaat);
//  - een pick zonder bronlocatie ("automatisch" in de pickmodal, de
//    standaard) telde overal als reservering op de AGP. De uitlevering haalt
//    zo'n pick juist eerst uit vrije voorraad (`bouwVerkoopUitleveringen`),
//    dus de flesjes die voor een deels gepickte order klaarstonden, bleven
//    voor de kassa en voor andere orders "vrij" — en de uitslag voor die order
//    liep daarna vast op AGP-voorraad die als gereserveerd telde.
//
// De afspraak "zonder locatie = AGP" (CLAUDE.md) gaat over afboekingen, niet
// over picks.

import type { Afvulling, Locatie, Uitlevering, Verplaatsing, Afboeking } from '../types'
import { voorraadPerLocatie, getAgpLocatie, pickUitgeslagen } from './calculations'

/** Minimale vorm van een pickregel — alleen wat de telling nodig heeft. */
export interface PickRegel {
  bestelling_id: number
  afvulling_id: number
  aantal: number | string
  /** Gekozen bronlocatie; leeg = de app kiest (vrije locaties eerst). */
  bron_locatie_id?: number | null
  uitlevering_id?: number | null
  uitlevering_ids?: number[] | null
}

/** Minimale vorm van een bestelling: de status bepaalt of hij nog meetelt. */
export interface PickBestelling {
  id: number
  status?: string
}

/** Statussen waarbij een pick niets meer reserveert. */
const AFGEHANDELD = new Set(['afgerond', 'geannuleerd'])

/** Picks die nog voorraad vastleggen: niet uitgeleverd (dan zit de
 * uitlevering zelf al in de voorraad), bestelling bekend en niet afgerond of
 * geannuleerd. `excludeBestellingId` laat de picks van één order weg — die
 * van de order die je op dat moment aan het picken bent. */
export const openPicks = <P extends PickRegel>(
  picks: P[] | null | undefined,
  bestellingen: PickBestelling[] | null | undefined,
  excludeBestellingId?: number | null,
): P[] => {
  const open = new Set<number>()
  for (const b of bestellingen || []) {
    if (b && !AFGEHANDELD.has(String(b.status || ''))) open.add(b.id)
  }
  return (picks || []).filter(p => {
    if (!p) return false
    if (excludeBestellingId != null && p.bestelling_id === excludeBestellingId) return false
    if (pickUitgeslagen(p)) return false
    return open.has(p.bestelling_id)
  })
}

const som = (rijen: Array<{aantal?: number | string | null}>): number =>
  rijen.reduce((s, r) => s + (Number(r.aantal) || 0), 0)

export interface BeschikbaarData {
  bestellingPicks?: PickRegel[] | null
  bestellingen?: PickBestelling[] | null
  uit?: Uitlevering[] | null
  afboekingen?: Afboeking[] | null
}

export interface BeschikbaarPerLocatieData extends BeschikbaarData {
  locaties: Locatie[]
  verplaatsingen?: Verplaatsing[] | null
}

/** Totaal nog vrij van een afvulling: afgevuld − open picks − uitgeleverd −
 * afgeboekt, nooit onder nul. Een negatieve (correctie-)afboeking telt weer
 * bij. */
export const beschikbaarVoorAfvulling = (
  afv: Afvulling | null | undefined,
  data: BeschikbaarData,
  excludeBestellingId?: number | null,
): number => {
  if (!afv) return 0
  const gepickt = som(openPicks(data.bestellingPicks, data.bestellingen, excludeBestellingId)
    .filter(p => p.afvulling_id === afv.id))
  const uitgeleverd = som((data.uit || []).filter(u => u && u.afvulling_id === afv.id))
  const afgeboekt = som((data.afboekingen || []).filter(a => a && a.afvulling_id === afv.id))
  const afgevuld = Number(afv.hoeveelheid ?? afv.aantal ?? 0) || 0
  return Math.max(0, afgevuld - gepickt - uitgeleverd - afgeboekt)
}

export interface PickVerdeling {
  /** Wat er per locatie nog vrij is na de picks (≥ 0). */
  beschikbaar: Record<number, number>
  /** Wat de picks per locatie vastleggen. */
  gereserveerd: Record<number, number>
}

/** Legt de open picks van één afvulling op de fysieke voorraad per locatie.
 *
 * - Een pick mét bronlocatie ligt op die locatie vast.
 * - Een pick zónder bronlocatie gaat eerst van de vrije locaties af, in
 *   dezelfde volgorde als de uitlevering hem straks pakt (locatievolgorde,
 *   alleen waar nog iets ligt); alleen wat daar niet meer past, komt op de
 *   AGP. Bij binnenland komt zo'n pick nooit uit de AGP, bij export/intra-EU
 *   pas als de vrije voorraad op is.
 *
 * Eerst de picks met een gekozen locatie, dan de rest: een vaste keuze gaat
 * voor op wat de app zelf mag verdelen. */
export const verdeelPicksOverLocaties = (
  fysiek: Record<number, number>,
  picks: PickRegel[],
  locaties: Locatie[],
): PickVerdeling => {
  const agpId = getAgpLocatie(locaties).id
  const rest: Record<number, number> = {...(fysiek || {})}
  const gereserveerd: Record<number, number> = {}
  const leg = (loc: number, n: number) => {
    rest[loc] = (rest[loc] || 0) - n
    gereserveerd[loc] = (gereserveerd[loc] || 0) + n
  }

  let automatisch = 0
  for (const p of picks || []) {
    const n = Number(p?.aantal) || 0
    if (n <= 0) continue
    if (p.bron_locatie_id != null) leg(Number(p.bron_locatie_id), n)
    else automatisch += n
  }
  for (const l of locaties || []) {
    if (automatisch <= 0) break
    if (l.is_agp || l.id === agpId) continue
    const n = Math.min(automatisch, Math.max(0, rest[l.id] || 0))
    if (n <= 0) continue
    leg(l.id, n)
    automatisch -= n
  }
  if (automatisch > 0) leg(agpId, automatisch)

  const beschikbaar: Record<number, number> = {}
  for (const k of Object.keys(rest)) beschikbaar[Number(k)] = Math.max(0, rest[Number(k)] || 0)
  return {beschikbaar, gereserveerd}
}

/** Beschikbaar per locatie: fysieke voorraad (`voorraadPerLocatie`, dus mét
 * verplaatsingen, uitleveringen en afboekingen) min de open picks, verdeeld
 * zoals `verdeelPicksOverLocaties` beschrijft. Zonder locaties leeg. */
export const beschikbaarPerLocatieNaPicks = (
  afv: Afvulling | null | undefined,
  data: BeschikbaarPerLocatieData,
  excludeBestellingId?: number | null,
): Record<number, number> => {
  if (!afv || !(data.locaties || []).length) return {}
  const fysiek = voorraadPerLocatie(afv, data.locaties, data.uit || [], data.verplaatsingen || [], data.afboekingen || [])
  const picks = openPicks(data.bestellingPicks, data.bestellingen, excludeBestellingId)
    .filter(p => p.afvulling_id === afv.id)
  return verdeelPicksOverLocaties(fysiek, picks, data.locaties).beschikbaar
}

/** Vrij buiten de AGP: wat verkocht kan worden zonder eerst uit te slaan. */
export const beschikbaarBuitenAgpNaPicks = (
  afv: Afvulling | null | undefined,
  data: BeschikbaarPerLocatieData,
  excludeBestellingId?: number | null,
): number => {
  const perLoc = beschikbaarPerLocatieNaPicks(afv, data, excludeBestellingId)
  const agpId = getAgpLocatie(data.locaties).id
  let totaal = 0
  for (const k of Object.keys(perLoc)) {
    if (Number(k) !== agpId) totaal += Number(perLoc[Number(k)] || 0)
  }
  return totaal
}
