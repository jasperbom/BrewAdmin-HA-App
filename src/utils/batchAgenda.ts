// De Agenda van Batches: per tank welke batch er wanneer in zit of hem
// gereserveerd heeft — op het bureau als balken op een tijdlijn (Gantt), op
// een telefoon als lijst per tank ("GV1 · Kadeblond #2609 · 15-9 → ± 16-10").
// Eén indeling voor beide, zodat de lijst en de balken nooit iets anders
// zeggen.
//
// Een balk loopt van het moment dat de batch de tank innam (de brouwdag, of
// de dag dat hij naar deze tank verhuisde — `tank_historie`) tot de verwachte
// afvuldatum (`verwachteAfvulDatum`: vergistingsschema + conditioneren, of een
// handmatige tanktijd). Gepland en Brouwen = gereserveerd, Vergisten en
// Conditioneren = bezet.
//
// Puur: geen React en geen opslag. Datums zijn JJJJ-MM-DD; `vandaag` komt van
// de aanroeper.

import type { Batch, Tank } from '../types'
import { normaliseerStatus, verwachteAfvulDatum } from './volgendeStap'
import { verpakProjectie } from './vergisting'
import { ymd } from './format'

type BatchLike = Pick<Batch, 'id'> & Partial<Batch>
type TankLike = Pick<Tank, 'id'> & Partial<Pick<Tank, 'naam'>>

/** De statussen die een tank innemen: gereserveerd (Gepland, Brouwen) of bezet. */
export const AGENDA_STATUSSEN: readonly string[] = ['Gepland', 'Brouwen', 'Vergisten', 'Conditioneren']

/** Standaard tankbezetting als er geen schema en geen tanktijd is (zoals de oude planning). */
export const AGENDA_STANDAARD_DAGEN = 14

const IS_DATUM = /^\d{4}-\d{2}-\d{2}/
const tekst = (v: unknown): string => String(v ?? '').trim()
const datumVan = (v: unknown): string => (IS_DATUM.test(tekst(v)) ? tekst(v).slice(0, 10) : '')

const dagNr = (iso: string): number =>
  Math.round(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / 86_400_000)

const vanDagNr = (n: number): string => {
  const d = new Date(n * 86_400_000)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

/** Een datum (JJJJ-MM-DD) plus `n` dagen. */
export const plusDagen = (iso: string, n: number): string => vanDagNr(dagNr(iso) + Math.round(n))

/** Hele dagen van a naar b. */
export const dagenVan = (a: string, b: string): number => dagNr(b) - dagNr(a)

export interface AgendaItem<B extends BatchLike = BatchLike> {
  batch: B
  /** De tank-id; leeg = zonder tank. */
  tankId: string
  /** Vanaf wanneer de batch deze tank inneemt (JJJJ-MM-DD). */
  van: string
  /** Tot wanneer: de verwachte afvuldatum (JJJJ-MM-DD), minstens een dag na `van`. */
  tot: string
  dagen: number
  /** Einde van het vergistingsschema (grens vergisten → conditioneren), als die binnen de balk valt. */
  fermentEind: string | null
  /** De duur is berekend (schema + conditioneren), niet handmatig als tanktijd ingevuld. */
  geschat: boolean
  /** Gepland en de brouwdag is voorbij. */
  overTijd: boolean
  /** In de tank en de verwachte afvuldatum is voorbij: de balk loopt door tot vandaag. */
  afvullenOverTijd: boolean
  /** De baan binnen de rij (0 = bovenste): batches die elkaar in één tank overlappen staan onder elkaar. */
  baan: number
}

export interface AgendaRij<B extends BatchLike = BatchLike> {
  tankId: string
  /** De naam van de tank (of het id); leeg voor de rij zonder tank. */
  naam: string
  zonderTank: boolean
  /** Bestaat de tank nog? Een batch in een verwijderde tank staat in een eigen rij. */
  bestaat: boolean
  items: AgendaItem<B>[]
  /** Aantal banen in de rij (minstens 1). */
  banen: number
}

export interface AgendaOpties {
  vandaag: string
  /** `planningInst.conditioneren_dagen` — standaard 14. */
  conditionerenDagen?: number | null
}

/**
 * Vanaf wanneer neemt de batch zijn huidige tank in? In de tank de laatste
 * keer dat hij in deze tank kwam (`tank_historie`, bijv. van GV3 naar BBT1),
 * anders — en bij Gepland/Brouwen altijd — de brouwdatum.
 */
export const tankVanaf = (batch: BatchLike): string => {
  const datum = datumVan(batch.datum)
  const status = normaliseerStatus(tekst(batch.status))
  const tank = tekst(batch.tank)
  if (!tank || (status !== 'Vergisten' && status !== 'Conditioneren')) return datum
  const keren = (Array.isArray(batch.tank_historie) ? batch.tank_historie : [])
    .filter(h => !!h && tekst(h.tank) === tank && !!datumVan(h.from))
    .map(h => datumVan(h.from))
    .sort()
  const laatste = keren[keren.length - 1]
  return laatste && (!datum || laatste >= datum) ? laatste : datum
}

/** Eén agenda-item per batch die een tank inneemt (zonder brouwdatum: geen item). */
export function agendaItems<B extends BatchLike>(batches: ReadonlyArray<B> | null | undefined, opties: AgendaOpties): AgendaItem<B>[] {
  const vandaag = datumVan(opties.vandaag)
  const cond = opties.conditionerenDagen != null && Number.isFinite(Number(opties.conditionerenDagen))
    ? Math.max(0, Number(opties.conditionerenDagen)) : 14
  const uit: AgendaItem<B>[] = []
  for (const b of batches || []) {
    if (!b) continue
    const status = normaliseerStatus(tekst(b.status))
    if (!AGENDA_STATUSSEN.includes(status)) continue
    const van = tankVanaf(b)
    if (!van) continue
    const inTank = status === 'Vergisten' || status === 'Conditioneren'
    let tot = datumVan(verwachteAfvulDatum({ ...b, status }, cond)) || plusDagen(van, AGENDA_STANDAARD_DAGEN)
    if (dagenVan(van, tot) < 1) tot = plusDagen(van, 1)
    const afvullenOverTijd = inTank && !!vandaag && tot < vandaag
    if (afvullenOverTijd) tot = dagenVan(van, vandaag) >= 1 ? vandaag : plusDagen(van, 1)
    const proj = verpakProjectie({ ...b, status }, cond)
    const fe = proj.fermentEindMs != null ? ymd(new Date(proj.fermentEindMs + 12 * 3_600_000)) : null
    uit.push({
      batch: b, tankId: tekst(b.tank), van, tot, dagen: dagenVan(van, tot),
      fermentEind: fe && fe > van && fe < tot ? fe : null,
      geschat: proj.geschat,
      overTijd: status === 'Gepland' && !!vandaag && datumVan(b.datum) < vandaag,
      afvullenOverTijd,
      baan: 0,
    })
  }
  return uit
}

/** Banen binnen één rij: wat elkaar overlapt komt onder elkaar (aansluiten mag). */
const verdeelBanen = <B extends BatchLike>(items: AgendaItem<B>[]): { items: AgendaItem<B>[]; banen: number } => {
  const gesorteerd = [...items].sort((a, b) => a.van.localeCompare(b.van) || a.tot.localeCompare(b.tot) || (Number(a.batch.id) || 0) - (Number(b.batch.id) || 0))
  const eindes: string[] = []
  const uit = gesorteerd.map(it => {
    let baan = eindes.findIndex(e => e <= it.van)
    if (baan < 0) { baan = eindes.length; eindes.push(it.tot) } else eindes[baan] = it.tot
    return { ...it, baan }
  })
  return { items: uit, banen: Math.max(1, eindes.length) }
}

/**
 * De agenda per tank: eerst "zonder tank" (alleen als daar iets staat), dan
 * alle tanks in hun eigen volgorde — ook een lege tank, dat is juist de ruimte
 * om te plannen — en dan tanks die niet meer bestaan maar nog een batch hebben.
 */
export function agendaPerTank<B extends BatchLike>(
  batches: ReadonlyArray<B> | null | undefined,
  tanks: ReadonlyArray<TankLike> | null | undefined,
  opties: AgendaOpties,
): AgendaRij<B>[] {
  const items = agendaItems(batches, opties)
  const per = new Map<string, AgendaItem<B>[]>()
  for (const it of items) per.set(it.tankId, [...(per.get(it.tankId) || []), it])
  const rij = (tankId: string, naam: string, zonderTank: boolean, bestaat: boolean): AgendaRij<B> => {
    const { items: verdeeld, banen } = verdeelBanen(per.get(tankId) || [])
    return { tankId, naam, zonderTank, bestaat, items: verdeeld, banen }
  }
  const rijen: AgendaRij<B>[] = []
  if ((per.get('') || []).length) rijen.push(rij('', '', true, true))
  const bekend = new Set<string>()
  for (const tk of tanks || []) {
    const id = tekst(tk?.id)
    if (!id || bekend.has(id)) continue
    bekend.add(id)
    rijen.push(rij(id, tekst(tk.naam) || id, false, true))
  }
  for (const id of [...per.keys()].filter(id => id && !bekend.has(id)).sort()) rijen.push(rij(id, id, false, false))
  return rijen
}

export interface AgendaBereik {
  start: string
  eind: string
  /** Aantal dagen van start tot eind (minstens 1). */
  dagen: number
}

/**
 * Het bereik van de tijdlijn: een week vóór vandaag tot minstens twee maanden
 * erna, en altijd tot een week na de laatste verwachte afvuldatum.
 */
export function agendaBereik(
  items: ReadonlyArray<Pick<AgendaItem, 'tot'>>, vandaag: string,
  opties: { voor?: number; minNa?: number; marge?: number } = {},
): AgendaBereik {
  const start = plusDagen(vandaag, -(opties.voor ?? 7))
  let eind = plusDagen(vandaag, opties.minNa ?? 60)
  for (const it of items) if (it.tot > eind) eind = it.tot
  eind = plusDagen(eind, opties.marge ?? 7)
  return { start, eind, dagen: Math.max(1, dagenVan(start, eind)) }
}

/** Waar een datum op de tijdlijn staat, in procenten van de breedte (niet begrensd). */
export const positieOp = (datum: string, bereik: AgendaBereik): number =>
  (dagenVan(bereik.start, datum) / bereik.dagen) * 100

export interface BalkPositie {
  /** Links en breedte in procenten, binnen 0–100: een balk steekt nooit buiten de tijdlijn. */
  links: number
  breedte: number
  /** De balk begint vóór de tijdlijn (of loopt erna door): hij is daar afgekapt. */
  afgekaptLinks: boolean
  afgekaptRechts: boolean
}

/**
 * De balk van een item op de tijdlijn, afgekapt op de randen — zo schuift een
 * batch die al lang in de tank zit niet over het tanklabel heen. Null als hij
 * helemaal buiten het bereik valt.
 */
export function balkPositie(item: Pick<AgendaItem, 'van' | 'tot'>, bereik: AgendaBereik): BalkPositie | null {
  const a = dagenVan(bereik.start, item.van)
  const b = dagenVan(bereik.start, item.tot)
  if (b <= 0 || a >= bereik.dagen) return null
  const l = Math.max(0, a)
  const r = Math.min(bereik.dagen, b)
  return {
    links: (l / bereik.dagen) * 100,
    breedte: Math.max(0.5, ((r - l) / bereik.dagen) * 100),
    afgekaptLinks: a < 0,
    afgekaptRechts: b > bereik.dagen,
  }
}

/** De datum bij een plek op de tijdlijn (0 = links, 1 = rechts), afgerond op hele dagen. */
export const datumOpPositie = (fractie: number, bereik: AgendaBereik): string =>
  plusDagen(bereik.start, Math.round((Number.isFinite(fractie) ? fractie : 0) * bereik.dagen))

/** De eerste van elke maand binnen het bereik, met zijn plek (voor de maandlabels). */
export function maandMarkers(bereik: AgendaBereik): Array<{ datum: string; links: number }> {
  const uit: Array<{ datum: string; links: number }> = []
  let j = Number(bereik.start.slice(0, 4))
  let m = Number(bereik.start.slice(5, 7))
  for (let i = 0; i < 240; i++) {
    const datum = `${j}-${String(m).padStart(2, '0')}-01`
    if (datum > bereik.eind) break
    const links = positieOp(datum, bereik)
    if (links >= 0 && links <= 100) uit.push({ datum, links })
    m += 1
    if (m > 12) { m = 1; j += 1 }
  }
  return uit
}
