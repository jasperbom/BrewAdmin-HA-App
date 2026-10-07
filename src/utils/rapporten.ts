// ── Rapporten (Administratie) ───────────────────────────────────────────────
// De pure kant van Rapporten: welke rapporten er zijn, de opbouw van de winst-
// en verliesrekening, de balansposten op een peildatum, de openstaande posten,
// de omzet per artikel en het journaal met dagboekfilter. Alles in hele centen
// (utils/centen.ts); de pagina (pages/admin/RapportenSectie.tsx) vertaalt en
// toont.
//
// Geen nieuwe definitie van "open": een verkoopfactuur is open zoals
// `isVerkoopFactuurOpen` het zegt, een inkoopfactuur zoals
// `openInkoopFacturen` (utils/facturen.ts). Op een peildatum in het verleden
// telt daarnaast een factuur mee die toen nog niet betaald was — betaald na
// de peildatum.
//
// Puur en zonder React — direct unit-testbaar.

import type {
  JournaalDagboek, JournaalRegel, KapitaalBoeking, BewaardBankAfschrift, BewaardeBankTransactie, BankSaldo,
} from '../types'
import { toCent } from './centen'
import { isVerkoopFactuurOpen, openInkoopFacturen } from './facturen'
import { verkoopCenten, inkoopCenten, zoekPast } from './factuurFilter'
import { inBereik, isIsoDatum, type Bereik } from './periode'
import { ouderdomsAnalyse, type WinstVerliesResult, type OuderdomsRij } from './calculations'
import { ibanSleutel, sorteerAfschriften } from './bank'

// ── Welke rapporten ─────────────────────────────────────────────────────────

export type RapportId = 'wv' | 'marge' | 'balans' | 'openstaand' | 'omzet' | 'journaal'

export interface RapportGroep {
  id: 'resultaat' | 'positie' | 'analyse'
  /** i18n-sleutel van de groepskop. */
  sleutel: string
  rapporten: readonly RapportId[]
}

/** De rapporten in drie groepen, in de volgorde van het menu. */
export const RAPPORT_GROEPEN: readonly RapportGroep[] = [
  { id: 'resultaat', sleutel: 'rap_groep_resultaat', rapporten: ['wv', 'marge'] },
  { id: 'positie', sleutel: 'rap_groep_positie', rapporten: ['balans', 'openstaand'] },
  { id: 'analyse', sleutel: 'rap_groep_analyse', rapporten: ['omzet', 'journaal'] },
]

export const RAPPORT_IDS: readonly RapportId[] = RAPPORT_GROEPEN.flatMap(g => g.rapporten)

/** i18n-sleutel van de naam van een rapport. */
export const RAPPORT_SLEUTEL: Readonly<Record<RapportId, string>> = {
  wv: 'rap_wv', marge: 'rap_marge', balans: 'rap_balans',
  openstaand: 'rap_openstaand', omzet: 'rap_omzet', journaal: 'rap_journaal',
}

/** Rapporten die met dezelfde periode vorig jaar vergelijken. */
export const VERGELIJKBARE_RAPPORTEN: readonly RapportId[] = ['wv', 'omzet']

/** Rapporten op een peildatum (het einde van de periode) in plaats van over een periode. */
export const PEILDATUM_RAPPORTEN: readonly RapportId[] = ['balans', 'openstaand']

// De tabbladen van vóór de herindeling (oude links, het dashboard).
const OUDE_RAPPORT_IDS: Readonly<Record<string, RapportId>> = {
  ouderdom: 'openstaand', omzet_cat: 'omzet', transacties: 'journaal',
}

export const isRapportId = (x: unknown): x is RapportId =>
  typeof x === 'string' && (RAPPORT_IDS as readonly string[]).includes(x)

/** Eén waarde als rapport: een huidige id, of een oude tabbladnaam. */
const alsRapport = (x: unknown): RapportId | null => {
  if (isRapportId(x)) return x
  if (typeof x === 'string' && OUDE_RAPPORT_IDS[x]) return OUDE_RAPPORT_IDS[x]
  return null
}

/**
 * Het rapport uit een navigatiedoel: eerst `tab`, dan `filter` (oude links
 * zetten het rapport in de filter), anders `standaard`.
 */
export function leesRapport(tab: unknown, filter: unknown, standaard: RapportId = 'wv'): RapportId {
  return alsRapport(tab) || alsRapport(filter) || standaard
}

// ── Datums ──────────────────────────────────────────────────────────────────

const ONDERGRENS = '0000-01-01'
const BOVENGRENS = '9999-12-31'

/** Het bereik als twee datums voor functies die strings verwachten (open = alles). */
export const bereikGrenzen = (b: Bereik): { van: string, tot: string } =>
  ({ van: b.van ?? ONDERGRENS, tot: b.tot ?? BOVENGRENS })

/**
 * De peildatum van Balans en Openstaande posten: het einde van de gekozen
 * periode, of vandaag als dat einde in de toekomst ligt of er geen einde is
 * ("alles"). Een balans van over drie maanden bestaat nog niet.
 */
export function peildatumVoor(bereik: Bereik, vandaag: string): string {
  if (bereik.tot === null || !isIsoDatum(bereik.tot) || bereik.tot > vandaag) return vandaag
  return bereik.tot
}

const dag = (x: unknown): string => String(x ?? '').slice(0, 10)

/**
 * Bestond dit record op de peildatum? Met een datum: als die op of vóór de
 * peildatum ligt. Zonder datum weten we het niet; dan telt hij alleen mee op
 * de balans van vandaag (waar hij nu wel staat).
 */
const bestondOp = (datum: unknown, peildatum: string, vandaag: string): boolean => {
  const d = dag(datum)
  return isIsoDatum(d) ? d <= peildatum : peildatum >= vandaag
}

/** Was iets dat nu betaald is op de peildatum nog onbetaald? Alleen met een betaaldatum ná de peildatum. */
const betaaldNa = (betaaldDatum: unknown, peildatum: string): boolean => {
  const d = dag(betaaldDatum)
  return isIsoDatum(d) && d > peildatum
}

// ── Winst & verlies, van boven naar beneden opgeteld ────────────────────────

export const KS_GRONDSTOFFEN = 'Grondstoffen'
export const KS_VERPAKKING = 'Verpakkingsmateriaal'

export type WvRegelId = 'omzet' | 'grondstoffen' | 'verpakking' | 'brutomarge' | 'overig' | 'accijns' | 'netto'

export interface WvKostensoort {
  kostensoort: string
  /** Wat hij van het resultaat afhaalt (kosten negatief). */
  cent: number
}

export interface WvRegel {
  id: WvRegelId
  /** `post` telt op; `subtotaal` is de som van alles erboven. */
  soort: 'post' | 'subtotaal'
  /** Effect op het resultaat: omzet positief, kosten negatief. */
  cent: number
  /** Alleen bij `overig`: de kostensoorten erachter, grootste eerst. */
  kostensoorten?: WvKostensoort[]
}

/**
 * De winst-en-verliesrekening in de volgorde waarin hij optelt: Omzet;
 * − Grondstoffen; − Verpakkingsmateriaal; = Brutomarge; − Overige kosten;
 * − Accijns; = Nettoresultaat. Vroeger stond "Brutowinst" onder het totaal
 * van álle kosten terwijl hij alleen grondstoffen en verpakking aftrok — de
 * regels telden niet op. Nu is elk subtotaal letterlijk de som van de regels
 * erboven (in centen), en het nettoresultaat is `berekenWv(...).nettowinst`.
 */
export function wvOpbouw(wv: Pick<WinstVerliesResult, 'omzet' | 'inkoopPerKostensoort' | 'accijnsKosten'>): WvRegel[] {
  const omzet = toCent(wv?.omzet)
  const perKs = wv?.inkoopPerKostensoort || {}
  const grondstoffen = toCent(perKs[KS_GRONDSTOFFEN])
  const verpakking = toCent(perKs[KS_VERPAKKING])
  const overige: WvKostensoort[] = Object.entries(perKs)
    .filter(([ks]) => ks !== KS_GRONDSTOFFEN && ks !== KS_VERPAKKING)
    .map(([kostensoort, euro]) => ({ kostensoort, cent: -toCent(euro) }))
    .filter(k => k.cent !== 0)
    .sort((a, b) => a.cent - b.cent || a.kostensoort.localeCompare(b.kostensoort, 'nl'))
  const overig = overige.reduce((s, k) => s + k.cent, 0)
  const accijns = -toCent(wv?.accijnsKosten)
  const brutomarge = omzet - grondstoffen - verpakking
  return [
    { id: 'omzet', soort: 'post', cent: omzet },
    { id: 'grondstoffen', soort: 'post', cent: -grondstoffen },
    { id: 'verpakking', soort: 'post', cent: -verpakking },
    { id: 'brutomarge', soort: 'subtotaal', cent: brutomarge },
    { id: 'overig', soort: 'post', cent: overig, kostensoorten: overige },
    { id: 'accijns', soort: 'post', cent: accijns },
    { id: 'netto', soort: 'subtotaal', cent: brutomarge + overig + accijns },
  ]
}

/** Het verschil met vorig jaar in procenten; null als vorig jaar nul was. */
export function verschilPct(nuCent: number, vorigCent: number): number | null {
  if (!vorigCent) return null
  return ((nuCent - vorigCent) / Math.abs(vorigCent)) * 100
}

/**
 * Een percentage voor een CSV-cel: een heel getal, zonder plusteken en zonder
 * %-teken (de kolomkop zegt "%"). Met "+35%" maakte de formulebeveiliging van
 * utils/csv.ts er tekst van ("'+35%") en kon een spreadsheet er niet mee
 * rekenen. Leeg zonder waarde.
 */
export function csvProcent(p: number | null): string {
  if (p === null || !Number.isFinite(p)) return ''
  return String(Math.round(p) || 0)
}

// ── Journaal met dagboekfilter ──────────────────────────────────────────────

export type DagboekFilter = 'alle' | JournaalDagboek | 'kapitaal'

export const DAGBOEK_FILTERS: readonly { id: DagboekFilter, sleutel: string }[] = [
  { id: 'alle', sleutel: 'jr_alle' },
  { id: 'verkoop', sleutel: 'jr_verkoop' },
  { id: 'inkoop', sleutel: 'jr_inkoop' },
  { id: 'accijns', sleutel: 'jr_accijns' },
  { id: 'btw', sleutel: 'jr_btw' },
  { id: 'memoriaal', sleutel: 'jr_memoriaal' },
  { id: 'kapitaal', sleutel: 'jr_kapitaal' },
]

export const isDagboekFilter = (x: unknown): x is DagboekFilter =>
  typeof x === 'string' && DAGBOEK_FILTERS.some(d => d.id === x)

/** i18n-sleutel van een dagboek (`jr_<dagboek>`). */
export const dagboekSleutel = (d: string): string => `jr_${d}`

export interface JournaalFilter {
  dagboek: DagboekFilter
  /** Alleen deze kostensoorten (inkoop). */
  kostensoorten?: string[]
  /** Alle kostensoorten behalve deze (de "overige kosten"). */
  nietKostensoorten?: string[]
}

export const GEEN_JOURNAAL_FILTER: JournaalFilter = { dagboek: 'alle' }

const tekstLijst = (x: unknown): string[] =>
  Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string' && s.trim() !== '') : []

/**
 * Een journaalfilter uit opslag (sessionStorage, JSON) of een andere bron die
 * niet te vertrouwen is: alleen een bekend dagboek en lijsten met tekst; al
 * het andere valt terug op "alle". Zo staat het filter er nog als je vanuit
 * een journaalregel naar de factuur gaat en terugkomt.
 */
export function leesJournaalFilter(x: unknown): JournaalFilter {
  let v: unknown = x
  if (typeof v === 'string') {
    try { v = JSON.parse(v) } catch { return GEEN_JOURNAAL_FILTER }
  }
  if (!v || typeof v !== 'object') return GEEN_JOURNAAL_FILTER
  const o = v as Record<string, unknown>
  if (!isDagboekFilter(o.dagboek)) return GEEN_JOURNAAL_FILTER
  const kostensoorten = tekstLijst(o.kostensoorten)
  const nietKostensoorten = tekstLijst(o.nietKostensoorten)
  return {
    dagboek: o.dagboek,
    ...(kostensoorten.length ? { kostensoorten } : {}),
    ...(nietKostensoorten.length ? { nietKostensoorten } : {}),
  }
}

/** Welke boekingen achter een regel van de winst-en-verliesrekening zitten. */
export function journaalFilterVoorWv(id: WvRegelId, kostensoort?: string): JournaalFilter | null {
  switch (id) {
    case 'omzet': return { dagboek: 'verkoop' }
    case 'grondstoffen': return { dagboek: 'inkoop', kostensoorten: [KS_GRONDSTOFFEN] }
    case 'verpakking': return { dagboek: 'inkoop', kostensoorten: [KS_VERPAKKING] }
    case 'overig': return kostensoort
      ? { dagboek: 'inkoop', kostensoorten: [kostensoort] }
      : { dagboek: 'inkoop', nietKostensoorten: [KS_GRONDSTOFFEN, KS_VERPAKKING] }
    case 'accijns': return { dagboek: 'accijns' }
    default: return null
  }
}

/** Een regel zoals het journaalrapport hem toont: een journaalregel of een kapitaalboeking. */
export interface JournaalWeergaveRegel {
  sleutel: string
  datum: string
  dagboek: JournaalDagboek | 'kapitaal'
  nummer: string
  relatie: string
  omschrijving: string
  kostensoort?: string
  btw_tarief?: number
  netto_cent: number
  btw_cent: number
  bruto_cent: number
  storno: boolean
  migratie: boolean
  /** Een kapitaalboeking: staat (nog) niet in het journaal. */
  buitenJournaal: boolean
  /** Waar de regel vandaan komt, om het brondocument te openen. */
  bron?: JournaalRegel['bron']
  bron_id?: number | string
}

/**
 * Kapitaalstortingen en -onttrekkingen als losse regels naast het journaal
 * (ERP-plan F3: ze worden nog niet geboekt). Storting positief, onttrekking
 * negatief, zonder BTW.
 */
export function kapitaalAlsRegels(boekingen: readonly KapitaalBoeking[] | null | undefined): JournaalWeergaveRegel[] {
  return (boekingen || []).filter(Boolean).map(k => {
    // Zelfde teken als het gestort kapitaal op de balans (kapitaalOp).
    const cent = toCent(k.bedrag) * (k.type === 'storting' ? 1 : -1)
    return {
      sleutel: `kap-${k.id}`,
      datum: dag(k.datum),
      dagboek: 'kapitaal' as const,
      nummer: `KAP-${k.id}`,
      relatie: k.eigenaar || '',
      omschrijving: k.omschrijving || '',
      netto_cent: cent,
      btw_cent: 0,
      bruto_cent: cent,
      storno: false,
      migratie: false,
      buitenJournaal: true,
    }
  })
}

const alsWeergave = (r: JournaalRegel): JournaalWeergaveRegel => ({
  sleutel: `jr-${r.id}`,
  datum: dag(r.datum),
  dagboek: r.dagboek,
  nummer: r.nummer || '',
  relatie: r.relatie || '',
  omschrijving: r.omschrijving || '',
  ...(r.kostensoort ? { kostensoort: r.kostensoort } : {}),
  ...(r.btw_tarief !== undefined && r.btw_tarief !== null ? { btw_tarief: Number(r.btw_tarief) } : {}),
  netto_cent: Number(r.netto_cent) || 0,
  btw_cent: Number(r.btw_cent) || 0,
  bruto_cent: Number(r.bruto_cent) || 0,
  storno: r.storno_van !== undefined && r.storno_van !== null,
  migratie: !!r.migratie,
  buitenJournaal: false,
  bron: r.bron,
  bron_id: r.bron_id,
})

const volgnummer = (s: string): number => Number(s.replace(/^\D+/, '')) || 0

/**
 * Het journaal in het bereik plus de kapitaalboekingen, nieuwste eerst (bij
 * gelijke datum de laatst geboekte eerst).
 */
export function journaalWeergave(
  journaal: readonly JournaalRegel[] | null | undefined,
  kapitaal: readonly KapitaalBoeking[] | null | undefined,
  bereik: Bereik,
): JournaalWeergaveRegel[] {
  const regels = [
    ...(journaal || []).filter(r => r && inBereik(r.datum, bereik)).map(alsWeergave),
    ...kapitaalAlsRegels(kapitaal).filter(r => inBereik(r.datum, bereik)),
  ]
  return regels.sort((a, b) =>
    b.datum.localeCompare(a.datum)
    || Number(a.buitenJournaal) - Number(b.buitenJournaal)
    || volgnummer(b.sleutel) - volgnummer(a.sleutel))
}

/** De kostensoort van een inkoopregel; zonder telt hij als Overig, zoals in de W&V. */
const kostensoortVan = (r: JournaalWeergaveRegel): string => r.kostensoort || 'Overig'

const pastBijDagboek = (r: JournaalWeergaveRegel, f: JournaalFilter): boolean => {
  if (f.dagboek !== 'alle' && r.dagboek !== f.dagboek) return false
  if (f.kostensoorten?.length || f.nietKostensoorten?.length) {
    if (r.dagboek !== 'inkoop') return false
    const ks = kostensoortVan(r)
    if (f.kostensoorten?.length && !f.kostensoorten.includes(ks)) return false
    if (f.nietKostensoorten?.length && f.nietKostensoorten.includes(ks)) return false
  }
  return true
}

const pastBijZoek = (r: JournaalWeergaveRegel, zoek: string): boolean =>
  zoekPast(
    [r.omschrijving, r.nummer, r.relatie, r.kostensoort, r.btw_tarief !== undefined ? `${r.btw_tarief}%` : ''],
    [r.netto_cent / 100, r.bruto_cent / 100],
    zoek,
  )

/** De regels die bij het dagboek, de kostensoort en de zoekterm passen. */
export function filterJournaal(
  regels: readonly JournaalWeergaveRegel[],
  filter: JournaalFilter,
  zoek = '',
): JournaalWeergaveRegel[] {
  return regels.filter(r => pastBijDagboek(r, filter) && pastBijZoek(r, zoek))
}

/** Aantal regels per dagboekchip, binnen de zoekterm (de kostensoortfilter telt niet mee). */
export function telDagboeken(regels: readonly JournaalWeergaveRegel[], zoek = ''): Record<DagboekFilter, number> {
  const uit: Record<DagboekFilter, number> = { alle: 0, verkoop: 0, inkoop: 0, accijns: 0, btw: 0, memoriaal: 0, kapitaal: 0 }
  for (const r of regels) {
    if (!pastBijZoek(r, zoek)) continue
    uit.alle++
    uit[r.dagboek]++
  }
  return uit
}

export interface CentTotalen { netto_cent: number, btw_cent: number, bruto_cent: number }

export function somCenten(regels: readonly { netto_cent: number, btw_cent: number, bruto_cent: number }[]): CentTotalen {
  return regels.reduce<CentTotalen>((s, r) => ({
    netto_cent: s.netto_cent + (r.netto_cent || 0),
    btw_cent: s.btw_cent + (r.btw_cent || 0),
    bruto_cent: s.bruto_cent + (r.bruto_cent || 0),
  }), { netto_cent: 0, btw_cent: 0, bruto_cent: 0 })
}

// ── Debiteuren, crediteuren en accijns op een peildatum ─────────────────────

/**
 * Verkoopfacturen die op de peildatum openstonden: gedateerd op of vóór de
 * peildatum en toen nog niet betaald. Nu open = `isVerkoopFactuurOpen`
 * (creditnota's tellen niet); daarnaast een factuur die pas ná de peildatum
 * betaald is. Een betaalde factuur zonder betaaldatum telt als betaald.
 */
export function openVerkoopOp<T>(facturen: readonly T[] | null | undefined, peildatum: string, vandaag: string): T[] {
  return (facturen || []).filter((f: any) => {
    if (!f || !bestondOp(f.datum, peildatum, vandaag)) return false
    if (isVerkoopFactuurOpen(f)) return true
    return f.status === 'betaald' && betaaldNa(f.betaald_datum, peildatum)
  })
}

/** Inkoopfacturen die op de peildatum openstonden (nu open = `openInkoopFacturen`, of betaald ná de peildatum). */
export function openInkoopOp<T>(facturen: readonly T[] | null | undefined, peildatum: string, vandaag: string): T[] {
  const nuOpen = new Set<unknown>(openInkoopFacturen((facturen || []) as any[]))
  return (facturen || []).filter((f: any) => {
    if (!f || !bestondOp(f.datum, peildatum, vandaag)) return false
    if (nuOpen.has(f)) return true
    return betaaldNa(f.betaald_datum, peildatum)
  })
}

/** Accijnsrecords die op de peildatum nog niet betaald waren. */
export function openAccijnsOp<T>(records: readonly T[] | null | undefined, peildatum: string, vandaag: string): T[] {
  return (records || []).filter((r: any) => {
    if (!r || !bestondOp(r.datum, peildatum, vandaag)) return false
    return !r.betaald || betaaldNa(r.betaal_datum, peildatum)
  })
}

export const accijnsCent = (r: any): number => toCent(r?.totaal_accijns || r?.accijns || 0)

/** Gestort kapitaal op de peildatum: stortingen min onttrekkingen tot en met die dag. */
export function kapitaalOp(boekingen: readonly KapitaalBoeking[] | null | undefined, peildatum: string, vandaag: string): number {
  return (boekingen || [])
    .filter(k => k && bestondOp(k.datum, peildatum, vandaag))
    .reduce((s, k) => s + toCent(k.bedrag) * (k.type === 'storting' ? 1 : -1), 0)
}

/** Waarde van de ingrediëntvoorraad (alleen de stand van nu: lots kennen geen historie). */
export function voorraadWaardeCent(lots: readonly any[] | null | undefined): number {
  const euro = (lots || [])
    .filter(l => l && l.beschikbaar !== false && Number(l.hoeveelheid) > 0 && Number(l.prijs_per_eenheid))
    .reduce((s, l) => s + (Number(l.hoeveelheid) || 0) * (Number(l.prijs_per_eenheid) || 0), 0)
  return toCent(euro)
}

// ── Liquide middelen op een peildatum ───────────────────────────────────────

export interface RekeningStand {
  iban: string
  cent: number
  /** De dag waarop dit saldo gold (einde van het afschrift). */
  datum: string
  bron: 'afschrift' | 'bank_saldi'
}

export interface LiquideMiddelen {
  cent: number
  rekeningen: RekeningStand[]
  /** Rekeningen met afschriften, maar geen enkel afschrift tot de peildatum: saldo onbekend (telt als 0). */
  onbekend: string[]
}

/** Een bewaarde banktransactie, voor zover het saldo erop rekent. */
export type SaldoTransactie = Pick<BewaardeBankTransactie, 'id' | 'datum' | 'type' | 'bedrag'>

/**
 * Het banksaldo op de peildatum, per rekening: het eindsaldo van het laatste
 * bewaarde afschrift dat op of vóór de peildatum eindigt. Valt de peildatum
 * midden in een afschrift (en zijn de transacties meegegeven), dan het
 * beginsaldo van dat afschrift plus zijn transacties tot en met de
 * peildatum — dat is preciezer dan het eindsaldo van een eerder afschrift.
 * Zonder bewaard afschrift het laatst bekende saldo uit `bank_saldi` als dat
 * van op of vóór de peildatum is (afschriften van vóór het bewaren); een
 * saldo zonder datum alleen op de balans van vandaag. Is dat saldo nieuwer
 * dan het laatste bewaarde afschrift tot de peildatum (een ouder afschrift
 * opnieuw ingelezen), dan gaat het saldo voor.
 */
export function liquideMiddelenOp(
  afschriften: readonly BewaardBankAfschrift[] | null | undefined,
  bankSaldi: Record<string, BankSaldo | null | undefined> | null | undefined,
  peildatum: string,
  vandaag: string,
  transacties?: readonly SaldoTransactie[] | null,
): LiquideMiddelen {
  const perRekening = new Map<string, BewaardBankAfschrift[]>()
  for (const a of sorteerAfschriften(afschriften as BewaardBankAfschrift[] | undefined)) {
    const k = ibanSleutel(a)
    const lijst = perRekening.get(k) || []
    lijst.push(a)
    perRekening.set(k, lijst)
  }
  const saldi = new Map<string, BankSaldo>()
  for (const [sleutel, b] of Object.entries(bankSaldi || {})) {
    if (!b) continue
    saldi.set(String(b.iban || '').trim() || sleutel || 'onbekend', b)
  }
  const rekeningen: RekeningStand[] = []
  const onbekend: string[] = []
  const ibans = [...new Set([...perRekening.keys(), ...saldi.keys()])].sort()
  const txPerId = new Map<string, SaldoTransactie>()
  for (const tx of transacties || []) if (tx && tx.id !== undefined && tx.id !== null) txPerId.set(String(tx.id), tx)
  for (const iban of ibans) {
    const eigen = perRekening.get(iban) || []
    const tot = eigen.filter(a => isIsoDatum(dag(a.tot)) && dag(a.tot) <= peildatum)
    const laatste = tot.length ? tot[tot.length - 1] : null
    // Een afschrift waar de peildatum midden in valt (en dat niet al eindigt op de peildatum).
    const lopend = laatste && dag(laatste.tot) === peildatum ? null
      : [...eigen].reverse().find(a => isIsoDatum(dag(a.van)) && dag(a.van) <= peildatum && dag(a.tot) > peildatum) || null
    const lopendeTx = lopend && txPerId.size
      ? (lopend.transactie_ids || []).map(id => txPerId.get(String(id))).filter((x): x is SaldoTransactie => !!x)
      : []
    if (lopend && lopendeTx.length === (lopend.transactie_ids || []).length && lopendeTx.length > 0) {
      const mutatie = lopendeTx
        .filter(tx => dag(tx.datum) <= peildatum)
        .reduce((som, tx) => som + (tx.type === 'C' ? 1 : -1) * toCent(tx.bedrag), 0)
      rekeningen.push({ iban, cent: toCent(lopend.beginsaldo) + mutatie, datum: peildatum, bron: 'afschrift' })
      continue
    }
    const s = saldi.get(iban)
    const sDatum = dag(s?.datum)
    // Een nieuwer saldo in `bank_saldi` (van een afschrift dat niet bewaard is,
    // bv. van vóór het bewaren) gaat vóór een ouder bewaard afschrift dat later
    // opnieuw is ingelezen. Bij een gelijke datum is het hetzelfde afschrift.
    const saldoNieuwer = !!s && isIsoDatum(sDatum) && sDatum <= peildatum
      && (!laatste || sDatum > dag(laatste.tot))
    if (laatste && !saldoNieuwer) {
      rekeningen.push({ iban, cent: toCent(laatste.eindsaldo), datum: dag(laatste.tot), bron: 'afschrift' })
      continue
    }
    if (s && (isIsoDatum(sDatum) ? sDatum <= peildatum : peildatum >= vandaag)) {
      rekeningen.push({ iban, cent: toCent(s.eindsaldo), datum: isIsoDatum(sDatum) ? sDatum : '', bron: 'bank_saldi' })
      continue
    }
    if (perRekening.has(iban) || s) onbekend.push(iban)
  }
  return { cent: rekeningen.reduce((s, r) => s + r.cent, 0), rekeningen, onbekend }
}

// ── De balans op een peildatum ──────────────────────────────────────────────

export interface BalansInvoer {
  peildatum: string
  vandaag: string
  verkoopFacturen: readonly any[]
  inkoopFacturen: readonly any[]
  accijns: readonly any[]
  kapitaalBoekingen: readonly KapitaalBoeking[]
  bankAfschriften: readonly BewaardBankAfschrift[]
  bankSaldi: Record<string, BankSaldo | null | undefined> | null
  /** Bewaarde banktransacties (voor een peildatum midden in een afschrift). */
  bankTransacties?: readonly SaldoTransactie[] | null
  /** BTW-positie op de peildatum in centen (utils/balans.ts `btwPositieOp`): positief = af te dragen. */
  btwCent: number
  /** Alleen als huidige stand bekend. */
  voorraadCent: number
  /** Alleen als huidige stand bekend. */
  altSchuldCent: number
}

export interface BalansOp {
  peildatum: string
  /** Staat de balans op vandaag? Anders zijn voorraad en alt-schuld "huidige stand". */
  isVandaag: boolean
  debiteuren: number
  voorraad: number
  liquide: LiquideMiddelen
  crediteuren: number
  accijnsSchuld: number
  btw: number
  altSchuld: number
  kapitaal: number
  activa: number
  /** Alle passiva behalve het eigen vermogen. */
  vreemd: number
  /** Sluitpost: activa − vreemd vermogen − gestort kapitaal. */
  eigenVermogen: number
}

/** De balansposten op de peildatum, alles in centen. */
export function balansOp(inv: BalansInvoer): BalansOp {
  const { peildatum, vandaag } = inv
  const debiteuren = openVerkoopOp(inv.verkoopFacturen, peildatum, vandaag)
    .reduce((s, f) => s + verkoopCenten(f).bruto_cent, 0)
  const crediteuren = openInkoopOp(inv.inkoopFacturen, peildatum, vandaag)
    .reduce((s, f) => s + inkoopCenten(f).bruto_cent, 0)
  const accijnsSchuld = openAccijnsOp(inv.accijns, peildatum, vandaag).reduce((s, r) => s + accijnsCent(r), 0)
  const kapitaal = kapitaalOp(inv.kapitaalBoekingen, peildatum, vandaag)
  const liquide = liquideMiddelenOp(inv.bankAfschriften, inv.bankSaldi, peildatum, vandaag, inv.bankTransacties)
  const voorraad = Math.round(Number(inv.voorraadCent) || 0)
  const altSchuld = Math.round(Number(inv.altSchuldCent) || 0)
  const btw = Math.round(Number(inv.btwCent) || 0)
  const activa = debiteuren + voorraad + liquide.cent
  const vreemd = crediteuren + accijnsSchuld + btw + altSchuld
  return {
    peildatum, isVandaag: peildatum >= vandaag,
    debiteuren, voorraad, liquide, crediteuren, accijnsSchuld, btw, altSchuld, kapitaal,
    activa, vreemd, eigenVermogen: activa - vreemd - kapitaal,
  }
}

// ── Openstaande posten (ouderdom) ───────────────────────────────────────────

export interface OpenPostInvoer {
  id: number | string
  relatie: string
  datum?: string
  nummer?: string
  bedrag_cent: number
}

export type OuderdomBucket = 'b0_30' | 'b31_60' | 'b61_90' | 'b90plus'

export const OUDERDOM_BUCKETS: readonly OuderdomBucket[] = ['b0_30', 'b31_60', 'b61_90', 'b90plus']

export interface OpenPost extends OpenPostInvoer {
  /** Dagen sinds de factuurdatum op de peildatum. */
  dagen: number
  bucket: OuderdomBucket
}

export interface OpenRelatie extends OuderdomsRij {
  sleutel: string
  /** De facturen erachter, oudste eerst. */
  posten: OpenPost[]
}

export interface OpenstaandePosten {
  rijen: OpenRelatie[]
  totalen: OuderdomsRij
  aantal: number
}

const relatieSleutel = (r: string): string => String(r || '').trim().toLowerCase()

// Zelfde indeling als ouderdomsAnalyse (calculations.ts): dagen sinds de
// factuurdatum, afgerond naar beneden; zonder datum 0.
const dagenSinds = (datum: string | undefined, peildatum: string): number =>
  datum ? Math.floor((new Date(peildatum).getTime() - new Date(datum).getTime()) / 86400000) : 0

const bucketVoor = (dagen: number): OuderdomBucket =>
  dagen <= 30 ? 'b0_30' : dagen <= 60 ? 'b31_60' : dagen <= 90 ? 'b61_90' : 'b90plus'

/**
 * De openstaande posten per relatie in ouderdomsklassen (via
 * `ouderdomsAnalyse`, dus dezelfde klassen en totalen), met per relatie de
 * facturen erachter.
 */
export function openstaandePosten(posten: readonly OpenPostInvoer[], peildatum: string): OpenstaandePosten {
  const geldig = (posten || []).filter(p => p && Math.round(Number(p.bedrag_cent) || 0) !== 0)
  const analyse = ouderdomsAnalyse(
    geldig.map(p => ({ relatie: p.relatie, bedrag: (Number(p.bedrag_cent) || 0) / 100, datum: p.datum })),
    peildatum,
  )
  const perRelatie = new Map<string, OpenPost[]>()
  for (const p of geldig) {
    const dagen = dagenSinds(p.datum, peildatum)
    const k = relatieSleutel(p.relatie)
    const lijst = perRelatie.get(k) || []
    lijst.push({ ...p, bedrag_cent: Math.round(Number(p.bedrag_cent) || 0), dagen, bucket: bucketVoor(dagen) })
    perRelatie.set(k, lijst)
  }
  const rijen = analyse.rijen.map(r => {
    const sleutel = relatieSleutel(r.relatie)
    const lijst = (perRelatie.get(sleutel) || [])
      .sort((a, b) => String(a.datum || '').localeCompare(String(b.datum || '')))
    return { ...r, sleutel, posten: lijst }
  })
  return { rijen, totalen: analyse.totalen, aantal: geldig.length }
}

// ── Omzet per artikel ───────────────────────────────────────────────────────

export type OmzetGroepSoort = 'artikel' | 'omschrijving' | 'statiegeld' | 'zonder_regels'

export interface OmzetGroep {
  sleutel: string
  soort: OmzetGroepSoort
  /** De omschrijving zoals hij het eerst op een factuur stond (leeg: naamloos). */
  label: string
  statiegeld_soort?: 'snd' | 'fust'
  aantal: number
  netto_cent: number
  btw_cent: number
  bruto_cent: number
  /** Aantal factuurregels in de groep. */
  regels: number
}

const normaliseerOmschrijving = (s: unknown): string =>
  String(s ?? '').trim().replace(/\s+/g, ' ').toLowerCase()

const heeftId = (x: unknown): boolean => x !== null && x !== undefined && String(x).trim() !== ''

/**
 * Bij welke groep een factuurregel hoort: statiegeld apart (per soort), dan
 * de artikel-identiteit als de regel die draagt (`artikel_id`, `product_id`,
 * `sku`), anders de omschrijving (zonder hoofdletters en dubbele spaties).
 */
export function omzetGroepVan(r: any): { sleutel: string, soort: OmzetGroepSoort, statiegeld_soort?: 'snd' | 'fust' } {
  if (r?.statiegeld_soort === 'snd' || r?.statiegeld_soort === 'fust') {
    return { sleutel: `st:${r.statiegeld_soort}`, soort: 'statiegeld', statiegeld_soort: r.statiegeld_soort }
  }
  if (heeftId(r?.artikel_id)) return { sleutel: `a:${String(r.artikel_id).trim()}`, soort: 'artikel' }
  if (heeftId(r?.product_id)) return { sleutel: `p:${String(r.product_id).trim()}`, soort: 'artikel' }
  if (heeftId(r?.sku)) return { sleutel: `s:${String(r.sku).trim().toLowerCase()}`, soort: 'artikel' }
  return { sleutel: `o:${normaliseerOmschrijving(r?.omschrijving)}`, soort: 'omschrijving' }
}

const volgordeSoort: Record<OmzetGroepSoort, number> = { artikel: 0, omschrijving: 0, zonder_regels: 1, statiegeld: 2 }

/**
 * Omzet per artikel over de verkoopfacturen in het bereik. Creditnota's
 * tellen negatief mee (zoals in de W&V); een factuur zonder regels telt in
 * één groep met zijn totalen, zodat de som altijd de omzet van de facturen is.
 * Grootste netto-omzet eerst; statiegeld en facturen zonder regels onderaan.
 */
export function omzetPerArtikel(facturen: readonly any[] | null | undefined, bereik: Bereik): OmzetGroep[] {
  const groepen = new Map<string, OmzetGroep>()
  const voeg = (sleutel: string, soort: OmzetGroepSoort, label: string, extra: Partial<OmzetGroep>,
    aantal: number, netto: number, btw: number, bruto: number) => {
    const g = groepen.get(sleutel) || { sleutel, soort, label, aantal: 0, netto_cent: 0, btw_cent: 0, bruto_cent: 0, regels: 0, ...extra }
    if (!g.label && label) g.label = label
    g.aantal += aantal
    g.netto_cent += netto
    g.btw_cent += btw
    g.bruto_cent += bruto
    g.regels += 1
    groepen.set(sleutel, g)
  }
  for (const f of facturen || []) {
    if (!f || !inBereik(f.datum, bereik)) continue
    const regels: any[] = Array.isArray(f.regels) ? f.regels.filter(Boolean) : []
    if (!regels.length) {
      const c = verkoopCenten(f)
      if (c.netto_cent || c.btw_cent || c.bruto_cent) voeg('zonder_regels', 'zonder_regels', '', {}, 0, c.netto_cent, c.btw_cent, c.bruto_cent)
      continue
    }
    for (const r of regels) {
      const g = omzetGroepVan(r)
      const netto = toCent(r.netto)
      const btw = toCent(r.btw_bedrag)
      const bruto = r.bruto !== undefined && r.bruto !== null && r.bruto !== '' ? toCent(r.bruto) : netto + btw
      const label = String(r.omschrijving ?? '').trim().replace(/\s+/g, ' ')
      voeg(g.sleutel, g.soort, g.soort === 'statiegeld' ? '' : label,
        g.statiegeld_soort ? { statiegeld_soort: g.statiegeld_soort } : {},
        Number(r.hoeveelheid) || 0, netto, btw, bruto)
    }
  }
  return [...groepen.values()].sort((a, b) =>
    volgordeSoort[a.soort] - volgordeSoort[b.soort]
    || b.netto_cent - a.netto_cent
    || a.label.localeCompare(b.label, 'nl'))
}

export interface OmzetVergelijkRij extends OmzetGroep {
  /** Netto-omzet in dezelfde periode vorig jaar; null zonder vergelijking. */
  vorig_netto_cent: number | null
}

/**
 * De groepen van nu naast die van vorig jaar (op dezelfde sleutel). Een
 * artikel dat vorig jaar verkocht werd en nu niet staat er ook, met nul: een
 * omzet die wegviel hoort zichtbaar te zijn.
 */
export function vergelijkOmzet(nu: readonly OmzetGroep[], vorig: readonly OmzetGroep[] | null): OmzetVergelijkRij[] {
  if (!vorig) return nu.map(g => ({ ...g, vorig_netto_cent: null }))
  const vorigPer = new Map(vorig.map(g => [g.sleutel, g]))
  const rijen: OmzetVergelijkRij[] = nu.map(g => ({ ...g, vorig_netto_cent: vorigPer.get(g.sleutel)?.netto_cent ?? 0 }))
  const nuSleutels = new Set(nu.map(g => g.sleutel))
  for (const g of vorig) {
    if (nuSleutels.has(g.sleutel)) continue
    rijen.push({ ...g, aantal: 0, netto_cent: 0, btw_cent: 0, bruto_cent: 0, regels: 0, vorig_netto_cent: g.netto_cent })
  }
  return rijen.sort((a, b) =>
    volgordeSoort[a.soort] - volgordeSoort[b.soort]
    || b.netto_cent - a.netto_cent
    || (b.vorig_netto_cent || 0) - (a.vorig_netto_cent || 0)
    || a.label.localeCompare(b.label, 'nl'))
}
