// Traceerbaarheid en recall (HACCP-handboek hoofdstuk 11)
//
// Traceerbaarheid is geen zoekfunctie maar een aantoonbaar beheerste
// procedure. Verordening (EG) 178/2002 artikel 18 vraagt om twee dingen:
//
//   één stap terug    van elke partij bier is te zeggen welke
//                     ingrediëntlots erin zaten en van welke leverancier;
//   één stap vooruit  van elk ingrediëntlot is te zeggen in welke partijen
//                     het terechtkwam, onder welke lotcodes die verpakt zijn
//                     en aan welke afnemers ze geleverd zijn.
//
// Beide richtingen moeten dus op dezelfde plek uitkomen: bij de lotcode op de
// verpakking en bij de afnemer. Een zoekfunctie die vooruit blijft steken bij
// "batch X" laat de brouwer bij een terugroepactie met lege handen staan —
// hij heeft dan geen enkele code om aan zijn afnemers door te geven.
//
// Daarnaast vraagt het handboek om de verantwoording: hoeveel van de partij
// is werkelijk terug te vinden (massabalans), waar zitten de gaten, en is de
// oefening aantoonbaar uitgevoerd. Die drie zitten hieronder.
//
// Net als `haccp.ts` geeft deze module i18n-sleutels terug, geen tekst.

import type {
  Afboeking, Afvulling, AfvulSessie, Batch, BatchIngredient, Bestelling,
  BestellingPick, CorrigierendeActie, HaccpInst, Ingredient, Klant, Lot,
  TraceOefening, TraceRichting, Uitlevering,
} from '../types'
import { haccpInst } from './haccp'

// ── Veldnamen van een lot ───────────────────────────────────────────────────
// De inkoopflow schrijft `lotnummer`/`aankoop_datum`, oudere en geïmporteerde
// records `lotnr`/`aankoopdatum`. Eén plek die dat opvangt; overal elders
// wordt via deze helpers gelezen, zodat een zoekactie nooit stilletjes op de
// verkeerde schrijfwijze mismatcht.

export const lotNummer = (lot: Partial<Lot> | null | undefined): string =>
  String(lot?.lotnummer || lot?.lotnr || '').trim()

export const lotAankoopDatum = (lot: Partial<Lot> | null | undefined): string =>
  String(lot?.aankoop_datum || lot?.aankoopdatum || '')

/** Toonbare aanduiding van een lot: het leverancierslotnummer, of het interne
 *  nummer wanneer de leverancier er geen meegaf. */
export const lotLabel = (lot: Partial<Lot> | null | undefined): string =>
  lotNummer(lot) || (lot?.id != null ? `#${lot.id}` : '')

const aantalVan = (a: Partial<Afvulling> | null | undefined): number =>
  Number(a?.hoeveelheid ?? a?.aantal ?? 0) || 0

const norm = (v: unknown): string => String(v ?? '').trim().toLowerCase()

/** Lot-verwijzingen zijn historisch nu eens een number, dan weer een string. */
const zelfdeId = (a: unknown, b: unknown): boolean =>
  a != null && b != null && String(a) === String(b)

// ── Traceergaten ────────────────────────────────────────────────────────────
// Een traceerbaarheidsrapport dat zijn eigen gaten verzwijgt is gevaarlijker
// dan geen rapport: het suggereert volledigheid die er niet is. Elk gat komt
// daarom als expliciete regel terug, met het aantal erbij.

export type TraceGatCode =
  | 'bi_zonder_lot'
  | 'lot_zonder_lotnummer'
  | 'lot_zonder_leverancier'
  | 'afvulling_zonder_lotcode'
  | 'uitlevering_zonder_afnemer'

export interface TraceGat {
  code: TraceGatCode
  i18nKey: string
  aantal: number
}

export const GAT_KEYS: Record<TraceGatCode, string> = {
  bi_zonder_lot:              'haccp_trace_gat_bi_zonder_lot',
  lot_zonder_lotnummer:       'haccp_trace_gat_lot_zonder_nummer',
  lot_zonder_leverancier:     'haccp_trace_gat_lot_zonder_leverancier',
  afvulling_zonder_lotcode:   'haccp_trace_gat_afvulling_zonder_lotcode',
  uitlevering_zonder_afnemer: 'haccp_trace_gat_uitlevering_zonder_afnemer',
}

/** Tekstsleutel bij een opgeslagen gatcode. Een oude registratie kan een code
 *  bevatten die inmiddels niet meer voorkomt; die valt terug op de code zelf
 *  in plaats van op een lege regel. */
export const gatI18nKey = (code: string): string =>
  GAT_KEYS[code as TraceGatCode] || code

// ── Massabalans ─────────────────────────────────────────────────────────────
// De vraag bij een terugroepactie is niet "waar is het bier heen gegaan?"
// maar "kan ik elke verpakking aanwijzen?". Alles wat niet aan een afnemer,
// aan eigen gebruik, aan een afboeking of aan de eigen voorraad toe te wijzen
// is, staat nog in de handel zonder dat iemand weet bij wie.

export interface Massabalans {
  geproduceerd: number
  /** Extern geleverd aan een met naam bekende afnemer. */
  uitgeleverd_traceerbaar: number
  /** Extern geleverd zonder afnemer (toonbankverkoop, proeverij). */
  uitgeleverd_anoniem: number
  /** Eigen gebruik binnen de brouwerij — per definitie terug te vinden. */
  intern: number
  afgeboekt: number
  /** Rekenkundig resterende eigen voorraad (nooit negatief). */
  voorraad: number
  /** Meer uitgeleverd/afgeboekt dan afgevuld: een administratief gat. */
  tekort: number
  geblokkeerd: number
  verantwoord: number
  verantwoord_pct: number
}

const legeBalans = (): Massabalans => ({
  geproduceerd: 0, uitgeleverd_traceerbaar: 0, uitgeleverd_anoniem: 0,
  intern: 0, afgeboekt: 0, voorraad: 0, tekort: 0, geblokkeerd: 0,
  verantwoord: 0, verantwoord_pct: 0,
})

// ── Wie kreeg deze uitlevering? ─────────────────────────────────────────────
// `bestemming_naam` op de uitlevering is de bron van waarheid, maar orders
// vulden dat veld lang niet: het kwam uit een invulveld dat bij een
// binnenlandse levering niet eens getoond werd. Bij zo'n uitlevering is de
// afnemer wél bekend — via de pickregel hangt hij aan de bestelling. Die
// omweg wordt hier gemaakt, zodat ook al geboekte leveringen (webshop en
// handmatige orders) bij een terugroepactie gewoon terugkomen.

export interface AfnemerGegevens {
  naam: string
  adres?: string
  email?: string
  telefoon?: string
}

const uitBestelling = (b: Bestelling | undefined): AfnemerGegevens | null => {
  if (!b) return null
  const naam = String(b.klant_bedrijf || b.klant_naam || '').trim()
  if (!naam) return null
  return {
    naam,
    adres: [b.klant_straat, b.klant_huisnummer, b.klant_postcode, b.klant_stad]
      .filter(Boolean).join(' ') || undefined,
    email: b.klant_email || undefined,
  }
}

export const afnemerVanUitlevering = (
  u: Partial<Uitlevering> | null | undefined,
  picks: BestellingPick[] = [],
  bestellingen: Bestelling[] = []
): AfnemerGegevens | null => {
  const direct = String(u?.bestemming_naam || '').trim()
  if (direct) {
    return {
      naam: direct,
      adres: String(u?.bestemming_adres || '') || undefined,
    }
  }
  if (u?.id == null) return null
  const pick = (picks || []).find(p =>
    p.uitlevering_id === u.id || (p.uitlevering_ids || []).includes(u.id as number))
  if (!pick) return null
  return uitBestelling((bestellingen || []).find(b => b.id === pick.bestelling_id))
}

/** Resolver-functie voor één traceeractie, zodat de pickregels maar één keer
 *  doorzocht hoeven te worden. */
export type AfnemerResolver = (u: Uitlevering) => AfnemerGegevens | null

export const maakAfnemerResolver = (
  picks: BestellingPick[] = [],
  bestellingen: Bestelling[] = []
): AfnemerResolver => u => afnemerVanUitlevering(u, picks, bestellingen)

/** Een uitlevering telt als traceerbaar zodra er een afnemer bij te vinden is. */
export const heeftAfnemer = (
  u: Partial<Uitlevering> | null | undefined,
  resolver?: AfnemerResolver
): boolean => resolver
  ? !!resolver(u as Uitlevering)?.naam
  : !!String(u?.bestemming_naam || '').trim()

export const berekenMassabalans = (
  afvullingen: Afvulling[],
  uitleveringen: Uitlevering[],
  afboekingen: Afboeking[],
  resolver?: AfnemerResolver
): Massabalans => {
  const b = legeBalans()
  const avIds = new Set((afvullingen || []).map(a => a.id))
  for (const a of (afvullingen || [])) {
    b.geproduceerd += aantalVan(a)
    if (a.geblokkeerd) b.geblokkeerd += aantalVan(a)
  }
  for (const u of (uitleveringen || [])) {
    if (!avIds.has(u.afvulling_id as number)) continue
    const n = Number(u.aantal || 0) || 0
    if (u.type_uitlevering === 'intern') b.intern += n
    else if (heeftAfnemer(u, resolver)) b.uitgeleverd_traceerbaar += n
    else b.uitgeleverd_anoniem += n
  }
  for (const a of (afboekingen || [])) {
    if (!avIds.has(a.afvulling_id)) continue
    b.afgeboekt += Number(a.aantal || 0) || 0
  }
  const rest = b.geproduceerd - b.uitgeleverd_traceerbaar - b.uitgeleverd_anoniem
    - b.intern - b.afgeboekt
  b.voorraad = Math.max(0, rest)
  b.tekort = Math.max(0, -rest)
  b.verantwoord = b.uitgeleverd_traceerbaar + b.intern + b.afgeboekt + b.voorraad
  b.verantwoord_pct = b.geproduceerd > 0
    ? Math.round((b.verantwoord / b.geproduceerd) * 1000) / 10
    : 0
  return b
}

// ── Trace ───────────────────────────────────────────────────────────────────

export interface TraceData {
  lots?: Lot[]
  ingredienten?: Ingredient[]
  batches?: Batch[]
  batchIngredienten?: BatchIngredient[]
  afvullingen?: Afvulling[]
  sessies?: AfvulSessie[]
  uitleveringen?: Uitlevering[]
  afboekingen?: Afboeking[]
  klanten?: Klant[]
  // Nodig om de afnemer van een uitlevering uit een order te herleiden.
  bestellingPicks?: BestellingPick[]
  bestellingen?: Bestelling[]
}

/** Eén afnemer met alles wat nodig is om hem te bellen, plus de lotcodes die
 *  hij in huis heeft. Zonder contactgegevens is een afnemerslijst bij een
 *  terugroepactie waardeloos. */
export interface TraceAfnemer {
  naam: string
  adres?: string
  land?: string
  email?: string
  telefoon?: string
  aantal: number
  laatste_datum: string
  lotcodes: string[]
}

export interface TraceLotRegel {
  lot: Lot
  ingredient_naam: string
  lotnummer: string
  leverancier: string
  aankoop_datum: string
  factuur_nummer: string
}

export interface TraceResultaat {
  gevonden: boolean
  richting: TraceRichting
  zoekterm: string
  lots: TraceLotRegel[]
  leveranciers: string[]
  batches: Batch[]
  sessies: AfvulSessie[]
  lotcodes: string[]
  afvullingen: Afvulling[]
  uitleveringen: Uitlevering[]
  afnemers: TraceAfnemer[]
  balans: Massabalans
  gaten: TraceGat[]
}

const leegResultaat = (richting: TraceRichting, zoekterm: string): TraceResultaat => ({
  gevonden: false, richting, zoekterm,
  lots: [], leveranciers: [], batches: [], sessies: [], lotcodes: [],
  afvullingen: [], uitleveringen: [], afnemers: [], balans: legeBalans(), gaten: [],
})

const lotRegel = (lot: Lot, ingredienten: Ingredient[]): TraceLotRegel => ({
  lot,
  ingredient_naam: (ingredienten || []).find(i => i.id === lot.ingredient_id)?.naam || '',
  lotnummer: lotLabel(lot),
  leverancier: String(lot.leverancier || ''),
  aankoop_datum: lotAankoopDatum(lot),
  factuur_nummer: String(lot.factuur_nummer || ''),
})

/** Afnemers samengevoegd per naam: één klant die drie keer besteld heeft moet
 *  één keer gebeld worden, met alle betrokken lotcodes erbij. */
const bouwAfnemers = (
  uitleveringen: Uitlevering[],
  lotcodePerAfvulling: Map<number, string>,
  klanten: Klant[],
  resolver: AfnemerResolver
): TraceAfnemer[] => {
  const perNaam = new Map<string, TraceAfnemer>()
  for (const u of uitleveringen) {
    // Eigen gebruik is geen afnemer: bij een terugroepactie hoeft de brouwer
    // zichzelf niet te bellen, en het zou de afnemerslijst vervuilen.
    if (u.type_uitlevering === 'intern') continue
    const gevonden = resolver(u)
    const naam = gevonden?.naam || ''
    if (!naam) continue
    const klant = (klanten || []).find(k =>
      norm(k.naam) === norm(naam) || (!!k.email && norm(k.email) === norm(gevonden?.email)))
    const bestaand = perNaam.get(norm(naam))
    const code = lotcodePerAfvulling.get(u.afvulling_id as number) || ''
    const regel: TraceAfnemer = bestaand || {
      naam,
      // Klantkaart eerst: die is actueel, het adres op de uitlevering is een
      // momentopname van toen.
      adres: [klant?.straat, klant?.postcode, klant?.stad].filter(Boolean).join(' ')
        || gevonden?.adres || '',
      land: u.bestemming_land || undefined,
      email: klant?.email || gevonden?.email,
      telefoon: klant?.telefoon,
      aantal: 0,
      laatste_datum: '',
      lotcodes: [],
    }
    regel.aantal += Number(u.aantal || 0) || 0
    const datum = String(u.datum || '')
    if (datum > regel.laatste_datum) regel.laatste_datum = datum
    if (code && !regel.lotcodes.includes(code)) regel.lotcodes.push(code)
    perNaam.set(norm(naam), regel)
  }
  return [...perNaam.values()].sort((a, b) => b.aantal - a.aantal || a.naam.localeCompare(b.naam))
}

/** Gedeelde kern van beide richtingen: van een verzameling batches (eventueel
 *  ingeperkt tot enkele afvulsessies) naar lotcodes, afnemers, massabalans en
 *  traceergaten. Dat beide richtingen hier doorheen lopen is precies de eis
 *  uit artikel 18: één stap terug en één stap vooruit leveren hetzelfde beeld.
 */
const bouwResultaat = (
  richting: TraceRichting,
  zoekterm: string,
  batches: Batch[],
  sessieFilter: AfvulSessie[] | null,
  lotRegels: TraceLotRegel[],
  d: TraceData
): TraceResultaat => {
  const batchIds = new Set(batches.map(b => b.id))
  const alleSessies = (d.sessies || []).filter(s => batchIds.has(s.batch_id))
  const sessies = sessieFilter && sessieFilter.length ? sessieFilter : alleSessies
  const sessieIds = new Set(sessies.map(s => s.id))
  const beperkt = !!(sessieFilter && sessieFilter.length)

  const afvullingen = (d.afvullingen || []).filter(a =>
    beperkt ? sessieIds.has(a.sessie_id as number) : batchIds.has(a.batch_id))
  const avIds = new Set(afvullingen.map(a => a.id))

  const lotcodePerAfvulling = new Map<number, string>()
  for (const a of afvullingen) {
    const viaSessie = sessies.find(s => s.id === a.sessie_id)?.lotcode
    const code = String(a.lotcode || viaSessie || '')
    if (code) lotcodePerAfvulling.set(a.id, code)
  }
  const lotcodes = [...new Set([
    ...sessies.map(s => String(s.lotcode || '')),
    ...[...lotcodePerAfvulling.values()],
  ].filter(Boolean))].sort()

  const uitleveringen = (d.uitleveringen || []).filter(u =>
    avIds.has(u.afvulling_id as number)
    // Uitleveringen van vóór de sessies hangen alleen aan de batch. Die tellen
    // mee zolang de zoekactie niet tot één sessie is ingeperkt.
    || (!beperkt && u.afvulling_id == null && batchIds.has(u.batch_id)))
  const afboekingen = (d.afboekingen || []).filter(a => avIds.has(a.afvulling_id))

  const resolver = maakAfnemerResolver(d.bestellingPicks || [], d.bestellingen || [])
  const afnemers = bouwAfnemers(uitleveringen, lotcodePerAfvulling, d.klanten || [], resolver)
  const balans = berekenMassabalans(afvullingen, uitleveringen, afboekingen, resolver)

  // ── Traceergaten binnen deze omvang ──
  const biInScope = (d.batchIngredienten || []).filter(b => batchIds.has(b.batch_id))
  const gaten: TraceGat[] = []
  const push = (code: TraceGatCode, aantal: number) => {
    if (aantal > 0) gaten.push({code, i18nKey: GAT_KEYS[code], aantal})
  }
  push('bi_zonder_lot', biInScope.filter(b => b.lot_id == null || b.lot_id === '').length)
  push('lot_zonder_lotnummer', lotRegels.filter(r => !lotNummer(r.lot)).length)
  push('lot_zonder_leverancier', lotRegels.filter(r => !r.leverancier).length)
  push('afvulling_zonder_lotcode', afvullingen.filter(a => !lotcodePerAfvulling.get(a.id)).length)
  push('uitlevering_zonder_afnemer',
    uitleveringen.filter(u => u.type_uitlevering !== 'intern' && !heeftAfnemer(u, resolver)).length)

  return {
    gevonden: true, richting, zoekterm,
    lots: lotRegels,
    leveranciers: [...new Set(lotRegels.map(r => r.leverancier).filter(Boolean))].sort(),
    batches, sessies, lotcodes, afvullingen, uitleveringen, afnemers, balans, gaten,
  }
}

/** Eén stap vooruit: van een leverancierslotnummer naar de lotcodes op de
 *  verpakking en de afnemers die ze hebben. */
export const traceVooruit = (zoekRuw: string, d: TraceData): TraceResultaat => {
  const zoek = norm(zoekRuw)
  if (!zoek) return leegResultaat('vooruit', String(zoekRuw || ''))
  const gevondenLots = (d.lots || []).filter(l =>
    norm(lotNummer(l)).includes(zoek) || `#${l.id}` === zoek)
  if (!gevondenLots.length) return leegResultaat('vooruit', String(zoekRuw))

  const lotIds = gevondenLots.map(l => l.id)
  const gebruikt = (d.batchIngredienten || []).filter(b =>
    lotIds.some(id => zelfdeId(id, b.lot_id)))
  const batchIds = new Set(gebruikt.map(b => b.batch_id))
  const batches = (d.batches || []).filter(b => batchIds.has(b.id))
  const lotRegels = gevondenLots.map(l => lotRegel(l, d.ingredienten || []))
  if (!batches.length) {
    // Het lot is (nog) niet verbruikt: geen batches, maar wél een geldig
    // resultaat — de leverancier en de resterende voorraad zijn bekend.
    return {
      ...leegResultaat('vooruit', String(zoekRuw)),
      gevonden: true,
      lots: lotRegels,
      leveranciers: [...new Set(lotRegels.map(r => r.leverancier).filter(Boolean))].sort(),
    }
  }
  return bouwResultaat('vooruit', String(zoekRuw), batches, null, lotRegels, d)
}

/** Eén stap terug: van een lotcode op de verpakking (of een batch) naar de
 *  gebruikte ingrediëntlots en hun leveranciers. */
export const traceTerug = (zoekRuw: string, d: TraceData): TraceResultaat => {
  const zoek = norm(zoekRuw)
  if (!zoek) return leegResultaat('terug', String(zoekRuw || ''))

  // Bij een terugroepactie heb je een verpakking in handen met een lotcode
  // erop; die moet net zo goed als ingang werken als de batchnaam.
  const sessies = (d.sessies || []).filter(s => norm(s.lotcode).includes(zoek))
  const viaLotcode = new Set(sessies.map(s => s.batch_id))
  const batches = (d.batches || []).filter(b =>
    viaLotcode.has(b.id)
    || norm(b.naam).includes(zoek)
    || norm(b.batch_nummer).includes(zoek)
    || String(b.id) === zoek)
  if (!batches.length) return leegResultaat('terug', String(zoekRuw))

  const batchIds = new Set(batches.map(b => b.id))
  const gebruikt = (d.batchIngredienten || []).filter(b => batchIds.has(b.batch_id))
  const lotRegels = (d.lots || [])
    .filter(l => gebruikt.some(b => zelfdeId(l.id, b.lot_id)))
    .map(l => lotRegel(l, d.ingredienten || []))
  return bouwResultaat('terug', String(zoekRuw), batches, sessies, lotRegels, d)
}

export const traceZoek = (
  richting: TraceRichting,
  zoek: string,
  d: TraceData
): TraceResultaat =>
  richting === 'vooruit' ? traceVooruit(zoek, d) : traceTerug(zoek, d)

// ── Traceeroefening ─────────────────────────────────────────────────────────
// Het handboek vraagt niet of de brouwer kán traceren, maar of hij het
// aantoonbaar periodiek gedáán heeft. Een oefening die niet vastligt heeft bij
// een inspectie niet plaatsgevonden.

export interface OefeningStatus {
  laatste: TraceOefening | null
  /** Maanden sinds de laatste oefening; null wanneer er nog geen is. */
  maanden_geleden: number | null
  /** Uiterste datum voor de volgende oefening (YYYY-MM-DD). */
  volgende_voor: string | null
  verlopen: boolean
}

/** Geldige oefeningen: een registratie die door een latere is vervangen telt
 *  niet meer mee (maar blijft wel bestaan — append-only). */
export const geldigeOefeningen = (oefeningen: TraceOefening[]): TraceOefening[] => {
  const vervangen = new Set((oefeningen || []).map(o => o.vervangt_id).filter(x => x != null))
  return (oefeningen || []).filter(o => !vervangen.has(o.id))
}

/** Nieuwste eerst. Twee oefeningen op dezelfde dag komen op volgorde van
 *  registratie, zodat de laatst vastgelegde ook als laatste telt. */
export const oefeningenNieuwsteEerst = (oefeningen: TraceOefening[]): TraceOefening[] =>
  (oefeningen || []).slice().sort((a, b) =>
    String(b.datum || '').localeCompare(String(a.datum || '')) || (b.id - a.id))

const maandenTussen = (van: string, tot: Date): number | null => {
  const d = new Date(`${String(van).slice(0, 10)}T00:00:00`)
  if (isNaN(d.getTime())) return null
  const maanden = (tot.getFullYear() - d.getFullYear()) * 12 + (tot.getMonth() - d.getMonth())
  return tot.getDate() < d.getDate() ? maanden - 1 : maanden
}

export const oefeningStatus = (
  oefeningen: TraceOefening[],
  instRaw?: Partial<HaccpInst> | null,
  nu: Date = new Date()
): OefeningStatus => {
  const inst = haccpInst(instRaw)
  const laatste = oefeningenNieuwsteEerst(geldigeOefeningen(oefeningen))[0] || null
  if (!laatste) {
    return {laatste: null, maanden_geleden: null, volgende_voor: null, verlopen: true}
  }
  const basis = new Date(`${String(laatste.datum).slice(0, 10)}T00:00:00`)
  let volgende_voor: string | null = null
  if (!isNaN(basis.getTime())) {
    const v = new Date(basis.getTime())
    v.setMonth(v.getMonth() + inst.trace_oefening_maanden)
    volgende_voor = v.toISOString().slice(0, 10)
  }
  const maanden = maandenTussen(laatste.datum, nu)
  return {
    laatste,
    maanden_geleden: maanden,
    volgende_voor,
    verlopen: maanden == null || maanden >= inst.trace_oefening_maanden,
  }
}

export interface OefeningOordeel {
  geslaagd: boolean
  redenen: {code: string; i18nKey: string; params?: Record<string, string | number>}[]
}

/** Een oefening slaagt wanneer de partij volledig verantwoord is, er geen
 *  traceergaten zijn en het binnen de gestelde tijd lukte. Slaagt hij niet,
 *  dan hoort er een maatregel bij — dat is de hele reden om te oefenen. */
export const beoordeelOefening = (
  resultaat: Pick<TraceResultaat, 'balans' | 'gaten' | 'lotcodes'>,
  duurMinuten: number | null | undefined,
  instRaw?: Partial<HaccpInst> | null
): OefeningOordeel => {
  const inst = haccpInst(instRaw)
  const redenen: OefeningOordeel['redenen'] = []
  const pct = resultaat.balans.verantwoord_pct
  if (pct < inst.trace_min_verantwoord_pct) {
    redenen.push({
      code: 'onvoldoende_verantwoord',
      i18nKey: 'haccp_trace_oordeel_verantwoord',
      params: {pct, min: inst.trace_min_verantwoord_pct},
    })
  }
  if (resultaat.balans.tekort > 0) {
    redenen.push({
      code: 'tekort',
      i18nKey: 'haccp_trace_oordeel_tekort',
      params: {aantal: resultaat.balans.tekort},
    })
  }
  for (const gat of resultaat.gaten) {
    redenen.push({code: gat.code, i18nKey: gat.i18nKey, params: {n: gat.aantal}})
  }
  if (duurMinuten != null && duurMinuten > inst.trace_max_duur_minuten) {
    redenen.push({
      code: 'te_lang',
      i18nKey: 'haccp_trace_oordeel_duur',
      params: {duur: duurMinuten, max: inst.trace_max_duur_minuten},
    })
  }
  return {geslaagd: redenen.length === 0, redenen}
}

/** Een oefening die niet slaagt levert een openstaande maatregel op. Zonder
 *  die opvolging is oefenen een formaliteit: het gat blijft dan bestaan tot
 *  het bij een echte terugroepactie pijn doet. */
export const capaUitOefening = (
  oefening: TraceOefening,
  omschrijving: string,
  id: number
): CorrigierendeActie => ({
  id,
  datum: oefening.datum,
  omschrijving,
  oorzaak: '',
  actie: oefening.conclusie,
  verantwoordelijke: oefening.paraaf?.gebruiker || '',
  status: 'open',
  bron: 'trace',
  trace_oefening_id: oefening.id,
})

/** Bevriest een zoekresultaat tot de registratie zoals die bewaard wordt. */
export const oefeningVanResultaat = (
  resultaat: TraceResultaat,
  extra: Pick<TraceOefening, 'id' | 'datum' | 'conclusie' | 'paraaf'>
    & Partial<Pick<TraceOefening, 'duur_minuten' | 'capa_id' | 'vervangt_id'>>
): TraceOefening => ({
  ...extra,
  richting: resultaat.richting,
  zoekterm: resultaat.zoekterm,
  aantal_batches: resultaat.batches.length,
  aantal_lots: resultaat.lots.length,
  aantal_lotcodes: resultaat.lotcodes.length,
  aantal_afnemers: resultaat.afnemers.length,
  lotcodes: resultaat.lotcodes,
  geproduceerd: resultaat.balans.geproduceerd,
  verantwoord: resultaat.balans.verantwoord,
  verantwoord_pct: resultaat.balans.verantwoord_pct,
  gaten: resultaat.gaten.map(g => ({code: g.code, aantal: g.aantal})),
})
