// ── Aangiftes als stappen (Administratie › Aangiftes) ───────────────────────
// BTW en accijns lopen in hetzelfde ritme: een periode loopt, is na afloop
// berekend, wordt gecontroleerd door een tweede persoon, ingediend en betaald
// (of terugontvangen). Deze module bepaalt per periode in welke stap hij
// staat, welk bedrag erbij hoort (met teken), wanneer hij uiterlijk ingediend
// moet zijn en wat de volgende handeling is. De pagina zet dat neer; hij
// rekent zelf niets uit wat hier staat.
//
// Bewust zonder eigen definities van "open":
//  - BTW: ingediend = een record met `periodeKey` in `btw_aangiftes`, betaald
//    = een koppeling `{soort:'btw', periodeKey}` in `bank_koppelingen` (zelfde
//    bron als `geslotenPeriodeSets` in btw.ts). Of een periode om actie vraagt
//    volgt de regel van de werkruimte-badge (`telOpenstaandeBtwPerioden`):
//    voorbij, niet ingediend of betaald, en er was activiteit — een test
//    bewaakt dat beide tellingen gelijk blijven;
//  - accijns: de maanden uit `groepeerAccijnsPerMaand`, en "vraagt actie" is
//    precies `openAccijnsMaanden` (calculations.ts), de bron van de badge.
//
// Bedragen in centen; teksten komen terug als i18n-sleutel met variabelen.

import {
  getPeriodes, datumToPeriodeKey, effectievePeriodeKey, inBtwPeriode, inBtwJaar,
  omzetBtwOpGrondslag, type BtwPeriodeType, type BtwPeriode,
} from './btw'
import { btwUiterlijk } from './beslissingen'
import { openAccijnsMaanden } from './calculations'
import { accijnsMaandKey, groepeerAccijnsPerMaand } from './afboeking'
import { isGekoppeld, txKey } from './bank'
import { AANGIFTE_MARGE_CENT } from './bankVoorstel'
import { toCent } from './centen'
import { normaliseerGebruiker } from './rollen'

// ── Stappen ─────────────────────────────────────────────────────────────────

export const AANGIFTE_STAPPEN = ['lopend', 'berekend', 'gecontroleerd', 'ingediend', 'betaald'] as const
export type AangifteStap = typeof AANGIFTE_STAPPEN[number]
/** Stand van één stap in de stappenbalk. `overgeslagen`: een oude aangifte die zonder controle is ingediend. */
export type StapStand = 'klaar' | 'nu' | 'open' | 'overgeslagen'
export type AangifteActie = 'controleren' | 'indienen' | 'koppel_betaling'
export type AangifteSoort = 'btw' | 'accijns'
/** Hoe een afgeronde periode eindigde. `nihil`: ingediend met € 0, er valt niets te betalen. */
export type AangifteEinde = 'betaald' | 'terugontvangen' | 'nihil'
/** De controle door een tweede persoon: nog niet gevraagd, gevraagd (wacht op de controleur), akkoord, met opmerkingen. */
export type ControleFase = 'open' | 'aangevraagd' | 'akkoord' | 'opmerkingen'

export interface BetalingInfo {
  /** txKey van de gekoppelde transactie (de sleutel in `bank_koppelingen`). */
  sleutel: string
  datum: string
  bedragCent: number | null
}

export interface AangifteRij {
  soort: AangifteSoort
  /** '2026-Q3' / '2026-M09' (BTW) of '2026-09' (accijns). */
  sleutel: string
  jaar: number
  van: string
  tot: string
  stap: AangifteStap
  stappen: StapStand[]
  afgerond: boolean
  einde: AangifteEinde | null
  /** Telt in het segment en staat bovenaan de lijst (zelfde regel als de badge). */
  vraagtActie: boolean
  actie: AangifteActie | null
  /** > 0 te betalen, < 0 terug te ontvangen. Na indienen: het ingediende bedrag. */
  bedragCent: number
  /** Teruggave: de betaling komt als bijschrijving binnen. */
  teruggave: boolean
  /** De periode loopt nog: het bedrag is een stand tot nu. */
  totNu: boolean
  /** Voorbij, maar zonder één boeking en zonder bedrag. */
  geenActiviteit: boolean
  uiterlijk: string
  teLaat: boolean
  ingediendOp: string | null
  ingediendDoor: string | null
  betaling: BetalingInfo | null
  controle: ControleFase
  /** Het record waar de controle in staat (BTW: `{periode}`; accijns: de maandaangifte). */
  controleRecord: any | null
  /** Accijns: alle boekingen van de maand staan al op betaald (oude werkwijze). */
  boekingenBetaald: boolean
}

const tekst = (v: unknown): string => (v === null || v === undefined ? '' : String(v))

/** De stappenbalk: alles vóór de huidige stap klaar (of overgeslagen), de huidige `nu` (of klaar als hij is afgerond). */
export function stappenVoor(stap: AangifteStap, afgerond: boolean, overgeslagen: readonly AangifteStap[] = []): StapStand[] {
  const i = AANGIFTE_STAPPEN.indexOf(stap)
  return AANGIFTE_STAPPEN.map((s, j): StapStand => {
    if (j < i) return overgeslagen.includes(s) ? 'overgeslagen' : 'klaar'
    if (j === i) return afgerond ? 'klaar' : 'nu'
    return 'open'
  })
}

/**
 * Uiterste datum om in te dienen (en te betalen): de laatste dag van de maand
 * ná het tijdvak — Q3 (t/m 30-09) uiterlijk 31-10, september uiterlijk 31-10.
 * Voor BTW de regel van de Belastingdienst (`btwUiterlijk`), voor accijns de
 * maandaangifte bij de Douane met dezelfde termijn (art. 19 AWR).
 */
export const aangifteUiterlijk = (tot: string): string => btwUiterlijk(tot)

/** 'JJJJ-MM-DD' → 'DD-MM' (de korte datum in een lijstregel). */
export const dagMaand = (iso: unknown): string => {
  const s = tekst(iso).slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s.slice(8, 10)}-${s.slice(5, 7)}` : ''
}

const laatsteDag = (maand: string): string => {
  const j = Number(maand.slice(0, 4))
  const m = Number(maand.slice(5, 7))
  const d = new Date(Date.UTC(j, m, 0)).getUTCDate()
  return `${maand}-${String(d).padStart(2, '0')}`
}

// ── Controle door een tweede persoon (Douane §12.2 / §12.4) ─────────────────

/** De fase van de controle in een record (BTW-controlerecord of accijnsmaand). */
export function controleFase(rec: any): ControleFase {
  if (!rec || typeof rec !== 'object') return 'open'
  if (rec.controle_status === 'akkoord') return 'akkoord'
  if (rec.controle_status === 'opmerkingen') return 'opmerkingen'
  // "Vraag controle aan" legt berekend_datum vast; een oud record heeft soms
  // alleen de naam van de controleur (die werd bij het typen al bewaard).
  if (tekst(rec.berekend_datum) || tekst(rec.reviewer).trim()) return 'aangevraagd'
  return 'open'
}

/**
 * Sleutels waaronder de controle van een BTW-periode bewaard kan zijn: de
 * periodesleutel ('2026-Q3', '2026-M09'), en voor een maand ook de oude vorm
 * '<jaar>-<maandnaam>' in elk van de vijf talen (de maandnaam hing af van de
 * schermtaal waarin de controle werd vastgelegd). Bij een kwartaal waren oud
 * en nieuw al gelijk.
 */
export function btwControleSleutels(periodeKey: string): string[] {
  const m = /^(\d{4})-M(\d{2})$/.exec(tekst(periodeKey))
  if (!m) return [tekst(periodeKey)]
  const jaar = Number(m[1])
  const i = Number(m[2]) - 1
  const oud: string[] = []
  for (const taal of ['nl', 'en', 'de', 'fr', 'es']) {
    const p = getPeriodes(jaar, 'maand', taal)[i]
    const k = p ? `${jaar}-${p.label.replace(/\s+/g, '_')}` : ''
    if (k && k !== periodeKey && !oud.includes(k)) oud.push(k)
  }
  return [periodeKey, ...oud]
}

const isControleRecord = (a: any): boolean => !!a && typeof a === 'object' && !a.periodeKey && typeof a.periode === 'string'

/** Het controlerecord van een BTW-periode: eerst op de periodesleutel, anders op een oude sleutel. */
export function btwControleRecord(btwAangiftes: readonly any[] | null | undefined, periodeKey: string): any | null {
  const lijst = (btwAangiftes || []).filter(isControleRecord)
  for (const k of btwControleSleutels(periodeKey)) {
    const rec = lijst.find((a: any) => a.periode === k)
    if (rec) return rec
  }
  return null
}

/**
 * Velden in het controlerecord van een periode zetten. Een record onder een
 * oude sleutel krijgt meteen de periodesleutel (migratie bij de eerste
 * schrijfactie); zonder record komt er een bij. Het record krijgt nooit een
 * `periodeKey`: dat veld betekent "ingediend" (`geslotenPeriodeSets`).
 */
export function metBtwControle(btwAangiftes: readonly any[] | null | undefined, periodeKey: string, velden: Record<string, unknown>): any[] {
  const lijst = [...(btwAangiftes || [])]
  const bestaand = btwControleRecord(lijst, periodeKey)
  if (bestaand) return lijst.map((a: any) => (a === bestaand ? { ...a, ...velden, periode: periodeKey } : a))
  return [...lijst, { periode: periodeKey, status: 'berekend', ...velden }]
}

/**
 * Wie je als controleur kunt kiezen: de gebruikers uit het rollenbeheer
 * (`gebruikers_rollen.gebruikers`). Zijn er geen, dan een lege lijst — de
 * pagina vraagt dan een vrije naam. `extra` (de ingelogde gebruiker, een al
 * vastgelegde controleur) komt er alleen bij als er een lijst is, zonder een
 * tweede schrijfwijze van dezelfde naam.
 */
export function controleurOpties(conf: unknown, extra: readonly unknown[] = []): string[] {
  const g = conf && typeof conf === 'object' ? (conf as { gebruikers?: unknown }).gebruikers : null
  const namen = g && typeof g === 'object' ? Object.keys(g as Record<string, unknown>).filter(n => n.trim()) : []
  if (!namen.length) return []
  const uit: string[] = []
  const gezien = new Set<string>()
  for (const n of [...namen, ...extra.map(tekst)]) {
    const k = normaliseerGebruiker(n)
    if (!k || gezien.has(k)) continue
    gezien.add(k)
    uit.push(n.trim())
  }
  return uit.sort((a, b) => a.localeCompare(b))
}

/** Is de controleur dezelfde als iemand die de aangifte berekende of indiende? (hoofdletterongevoelig, zoals HA namen vergelijkt) */
export function zelfdePersoon(controleur: unknown, personen: readonly unknown[]): boolean {
  const c = normaliseerGebruiker(controleur)
  return !!c && personen.some(p => normaliseerGebruiker(p) === c)
}

export interface ControleInvoer {
  controleur: string
  bevindingen: string
  /** "Toch akkoord": er is geen tweede persoon (eenmanszaak). */
  tochAkkoord: boolean
}

/**
 * Waarom de controle nog niet vastgelegd kan worden (i18n-sleutel), of null.
 * Dezelfde persoon als de berekenaar of indiener mag akkoord geven — een
 * eenmanszaak heeft niemand anders — maar alleen met "toch akkoord" én
 * bevindingen, zodat het bewijs zegt wat er gecontroleerd is. Opmerkingen
 * zonder tekst zijn geen opmerkingen.
 */
export function controleBlokkade(invoer: ControleInvoer, rec: any, akkoord: boolean): string | null {
  if (!tekst(invoer.controleur).trim()) return 'agf_reden_geen_controleur'
  const bevindingen = tekst(invoer.bevindingen).trim()
  if (!akkoord) return bevindingen ? null : 'agf_reden_opmerkingen_leeg'
  if (zelfdePersoon(invoer.controleur, [rec?.berekend_door, rec?.ingediend_door])) {
    if (!invoer.tochAkkoord) return 'agf_reden_toch_akkoord'
    if (!bevindingen) return 'agf_reden_bevindingen'
  }
  return null
}

// ── Bankkoppeling ───────────────────────────────────────────────────────────

/** De gekoppelde betaling van een BTW-periode of accijnsmaand, of null. */
export function koppelingVoor(
  bankKoppelingen: Record<string, any> | null | undefined,
  bankTransacties: readonly any[] | null | undefined,
  soort: AangifteSoort,
  sleutel: string,
): BetalingInfo | null {
  const k = Object.keys(bankKoppelingen || {}).find(key => {
    const v = (bankKoppelingen || {})[key]
    return soort === 'btw'
      ? v?.soort === 'btw' && v.periodeKey === sleutel
      : v?.soort === 'accijns' && v.maandKey === sleutel
  })
  if (!k) return null
  const tx = (bankTransacties || []).find((t: any) => txKey(t) === k)
  if (tx) return { sleutel: k, datum: tekst(tx.datum), bedragCent: toCent(tx.bedrag) }
  // De transactie is niet (meer) bewaard: de sleutel zelf is datum|type|bedrag|referentie.
  const [datum, , bedrag] = k.split('|')
  const b = Number(bedrag)
  return { sleutel: k, datum: tekst(datum), bedragCent: Number.isFinite(b) && bedrag !== '' ? toCent(b) : null }
}

export interface BetaalKandidaat {
  tx: any
  sleutel: string
  /** Verschil met het aangiftebedrag in centen (absolute waarden). */
  verschilCent: number
}

/**
 * Banktransacties die bij een aangifte kunnen horen: van de goede kant (een
 * betaling is een afschrijving, een teruggave een bijschrijving), nog nergens
 * aan gekoppeld (één transactie = één koppeling, ook niet aan een factuur of
 * de andere aangifte) en niet van vóór de periode. Binnen € 1 van het bedrag
 * (een BTW-aangifte is in hele euro's) als voorstel, dichtstbij eerst; de rest
 * nieuwste eerst.
 */
export function betalingKandidaten(
  transacties: readonly any[] | null | undefined,
  opties: { credit: boolean, bedragCent: number, vanaf: string },
): { voorgesteld: BetaalKandidaat[], overig: BetaalKandidaat[] } {
  const doel = Math.abs(Number(opties.bedragCent) || 0)
  const kandidaten = (transacties || [])
    .filter((tx: any) => tx && tx.type === (opties.credit ? 'C' : 'D') && !isGekoppeld(tx) && tekst(tx.datum) >= opties.vanaf)
    .map((tx: any): BetaalKandidaat => ({ tx, sleutel: txKey(tx), verschilCent: Math.abs(Math.abs(toCent(tx.bedrag)) - doel) }))
  const nieuwsteEerst = (a: BetaalKandidaat, b: BetaalKandidaat) => tekst(b.tx.datum).localeCompare(tekst(a.tx.datum)) || a.sleutel.localeCompare(b.sleutel)
  return {
    voorgesteld: kandidaten.filter(k => k.verschilCent <= AANGIFTE_MARGE_CENT).sort((a, b) => a.verschilCent - b.verschilCent || nieuwsteEerst(a, b)),
    overig: kandidaten.filter(k => k.verschilCent > AANGIFTE_MARGE_CENT).sort(nieuwsteEerst),
  }
}

/** Precies één voorstel: dat mag de lijstregel meteen koppelen ("Koppel betaling (28-09)"). Anders null. */
export const enigVoorstel = (k: { voorgesteld: BetaalKandidaat[] }): BetaalKandidaat | null =>
  k.voorgesteld.length === 1 ? k.voorgesteld[0] : null

// ── BTW: cijfers per periode ────────────────────────────────────────────────

export interface CentPaar { nettoCent: number, btwCent: number }
export interface VerlegdRubriek extends CentPaar {
  /** Grondslag van verlegde regels op 0%: vrijwel altijd een vergeten tarief. */
  nulNettoCent: number
}

export interface BtwCijfers {
  /** Rubriek 1a / 1b: verschuldigde BTW op grondslag per tarief (omzetBtwOpGrondslag). */
  hoog: CentPaar
  laag: CentPaar
  omzetBtwCent: number
  /** Voorbelasting zoals bij indienen geteld: de BTW-totalen van de inkoopfacturen. */
  voorbelastingCent: number
  /** Binnenlandse voorbelasting per tarief (de tabel bij rubriek 5b). */
  perTarief: { tarief: number, nettoCent: number, btwCent: number }[]
  /** Rubriek 4a (import van buiten de EU) en 4b (verwerving uit de EU): verlegd. */
  r4a: VerlegdRubriek
  r4b: VerlegdRubriek
  /** Rubriek 5b: binnenlandse voorbelasting per tarief + de verlegde BTW. */
  rubriek5bCent: number
  /** Wat ingediend wordt: omzet-BTW min voorbelasting. Negatief = teruggave. */
  teBetalenCent: number
  aantalVerkoop: number
  aantalInkoop: number
  aantalWc: number
  verkoopNettoCent: number
  inkoopNettoCent: number
  /** Statiegeld Nederland in de periode (informatie; de afdracht loopt via Verkoop › Statiegeld). */
  sndCent: number
}

export interface BtwCijferBron {
  verkoopFacturen: readonly any[] | null | undefined
  inkoopFacturen: readonly any[] | null | undefined
  /** Webshoporders waar in de app nog geen verkoopfactuur voor is (`wcOrdersNogNietGefactureerd`). */
  wcOrders: readonly any[] | null | undefined
  periodeType: BtwPeriodeType
}

const WC_TELT = ['completed', 'processing']
const wcDatum = (o: any): string => tekst(o?.date_paid || o?.date_created).slice(0, 10)

/** Webshoporders die in [van, tot] meetellen (afgerond of in behandeling, op betaaldatum). */
export const wcOrdersInBereik = (orders: readonly any[] | null | undefined, van: string, tot: string): any[] =>
  (orders || []).filter((o: any) => {
    const d = wcDatum(o)
    return d >= van && d <= tot && WC_TELT.includes(o?.status)
  })

const omzetCent = (verkoop: any[], orders: any[]): { hoog: CentPaar, laag: CentPaar } => {
  const o = omzetBtwOpGrondslag(verkoop, orders)
  return {
    hoog: { nettoCent: toCent(o.hoog.netto), btwCent: toCent(o.hoog.btw) },
    laag: { nettoCent: toCent(o.laag.netto), btwCent: toCent(o.laag.btw) },
  }
}

/** Alle cijfers van één BTW-periode: rubrieken, voorbelasting per tarief en het te betalen bedrag. */
export function btwPeriodeCijfers(p: { key: string, from: string, to: string }, bron: BtwCijferBron): BtwCijfers {
  const type = bron.periodeType
  const verkoop = (bron.verkoopFacturen || []).filter((f: any) => inBtwPeriode(f, type, p.key))
  const inkoop = (bron.inkoopFacturen || []).filter((f: any) => f && effectievePeriodeKey(f, type) === p.key)
  const orders = wcOrdersInBereik(bron.wcOrders, p.from, p.to)
  const { hoog, laag } = omzetCent(verkoop, orders)
  const omzetBtwCent = hoog.btwCent + laag.btwCent
  const voorbelastingCent = inkoop.reduce((s: number, f: any) => s + toCent(f.totaal_btw), 0)

  const tarieven = new Map<number, { tarief: number, nettoCent: number, btwCent: number }>()
  const verlegd = {
    import_niet_eu: { netto: 0, btw: 0, nul: 0 },
    intracom_eu: { netto: 0, btw: 0, nul: 0 },
  }
  for (const f of inkoop) {
    for (const r of (f.regels || []) as any[]) {
      const soort = r?.btw_soort || 'binnenlands'
      if (soort === 'binnenlands') {
        const k = Number(r?.btw_tarief ?? 0) || 0
        const rij = tarieven.get(k) || { tarief: k, nettoCent: 0, btwCent: 0 }
        rij.nettoCent += toCent(r?.netto)
        rij.btwCent += toCent(r?.btw_bedrag)
        tarieven.set(k, rij)
      } else if (soort === 'intracom_eu' || soort === 'import_niet_eu') {
        // Verlegd: de afnemer berekent zelf de BTW over de netto-grondslag;
        // die is tegelijk aftrekbaar (5b), dus per saldo nul.
        const nettoCent = toCent(r?.netto)
        const tarief = Number(r?.btw_tarief) || 0
        verlegd[soort].netto += nettoCent
        verlegd[soort].btw += nettoCent * tarief / 100
        if (!tarief && nettoCent > 0) verlegd[soort].nul += nettoCent
      }
    }
  }
  const rub = (v: { netto: number, btw: number, nul: number }): VerlegdRubriek =>
    ({ nettoCent: v.netto, btwCent: Math.round(v.btw), nulNettoCent: v.nul })
  const r4a = rub(verlegd.import_niet_eu)
  const r4b = rub(verlegd.intracom_eu)
  const perTarief = [...tarieven.values()].sort((a, b) => a.tarief - b.tarief)
  const rubriek5bCent = perTarief.reduce((s, r) => s + r.btwCent, 0) + r4a.btwCent + r4b.btwCent

  let sndCent = 0
  for (const f of (bron.verkoopFacturen || []) as any[]) {
    if (!f?.datum || f.datum < p.from || f.datum > p.to) continue
    for (const r of (f.regels || []) as any[]) if (r?.statiegeld_soort === 'snd') sndCent += toCent(r.netto)
  }

  const wcNettoCent = orders.reduce((s: number, o: any) => s + toCent(parseFloat(o?.total || 0)) - toCent(parseFloat(o?.total_tax || 0)), 0)
  return {
    hoog, laag, omzetBtwCent, voorbelastingCent, perTarief, r4a, r4b, rubriek5bCent,
    teBetalenCent: omzetBtwCent - voorbelastingCent,
    aantalVerkoop: verkoop.length,
    aantalInkoop: inkoop.length,
    aantalWc: orders.length,
    verkoopNettoCent: verkoop.reduce((s: number, f: any) => s + toCent(f.netto), 0) + wcNettoCent,
    inkoopNettoCent: inkoop.reduce((s: number, f: any) => s + toCent(f.totaal_netto), 0),
    sndCent,
  }
}

/** Het jaartotaal (kop van de pagina): omzet-BTW min voorbelasting over het hele jaar, op de effectieve periode. */
export function btwJaarCijfers(jaar: number, bron: BtwCijferBron): { omzetBtwCent: number, voorbelastingCent: number, teBetalenCent: number } {
  const type = bron.periodeType
  const verkoop = (bron.verkoopFacturen || []).filter((f: any) => f && inBtwJaar(f, type, jaar))
  const orders = wcOrdersInBereik(bron.wcOrders, `${jaar}-01-01`, `${jaar}-12-31`)
  const { hoog, laag } = omzetCent(verkoop, orders)
  const omzetBtwCent = hoog.btwCent + laag.btwCent
  const voorbelastingCent = (bron.inkoopFacturen || [])
    .filter((f: any) => f && inBtwJaar(f, type, jaar))
    .reduce((s: number, f: any) => s + toCent(f.totaal_btw), 0)
  return { omzetBtwCent, voorbelastingCent, teBetalenCent: omzetBtwCent - voorbelastingCent }
}

/**
 * Perioden waarin iets te declareren viel: een verkoop- of inkoopfactuur met
 * een datum erin. Dezelfde regel als de badge (`periodesMetActiviteit` in
 * btw.ts, op de factuurdatum).
 */
export const btwActievePerioden = (facturen: readonly any[] | null | undefined, type: BtwPeriodeType): Set<string> =>
  new Set((facturen || []).map((f: any) => datumToPeriodeKey(tekst(f?.datum), type)).filter(Boolean))

// ── BTW: de stap per periode ────────────────────────────────────────────────

export interface BtwStappenBron {
  periodeType: BtwPeriodeType
  /** Vandaag, 'JJJJ-MM-DD' (lokale kalenderdag). */
  vandaag: string
  btwAangiftes: readonly any[] | null | undefined
  bankKoppelingen: Record<string, any> | null | undefined
  bankTransacties?: readonly any[] | null
  /** Het te betalen bedrag van een periode (btwPeriodeCijfers().teBetalenCent). */
  bedragCent: (periodeKey: string) => number
  /** btwActievePerioden(verkoop + inkoop). */
  actief: ReadonlySet<string>
}

/** De stap van één BTW-periode; null voor een periode die nog moet beginnen. */
export function btwRij(p: BtwPeriode, bron: BtwStappenBron): AangifteRij | null {
  const vandaag = bron.vandaag
  if (p.from > vandaag) return null
  const ingediend = (bron.btwAangiftes || []).find((a: any) => a?.periodeKey === p.key) || null
  const betaling = koppelingVoor(bron.bankKoppelingen, bron.bankTransacties, 'btw', p.key)
  const controleRecord = btwControleRecord(bron.btwAangiftes, p.key)
  const controle = controleFase(controleRecord)
  const berekendCent = Math.round(Number(bron.bedragCent(p.key)) || 0)
  const bedragCent = ingediend ? toCent(ingediend.bedrag) : berekendCent
  const uiterlijk = aangifteUiterlijk(p.to)
  const lopend = !ingediend && !betaling && p.to >= vandaag
  const actief = bron.actief.has(p.key)
  const geenControle: AangifteStap[] = controle === 'akkoord' ? [] : ['gecontroleerd']

  const basis = {
    soort: 'btw' as const, sleutel: p.key, jaar: Number(p.key.slice(0, 4)), van: p.from, tot: p.to,
    bedragCent, teruggave: bedragCent < 0, uiterlijk,
    ingediendOp: ingediend ? tekst(ingediend.ingediend_datum) || null : null,
    ingediendDoor: ingediend ? tekst(ingediend.ingediend_door) || null : null,
    betaling, controle, controleRecord, boekingenBetaald: false,
  }

  if (betaling || (ingediend && bedragCent === 0)) {
    const einde: AangifteEinde = betaling ? (bedragCent < 0 ? 'terugontvangen' : 'betaald') : 'nihil'
    return {
      ...basis, stap: 'betaald', afgerond: true, einde,
      stappen: stappenVoor('betaald', true, [...geenControle, ...(ingediend ? [] : ['ingediend' as const])]),
      vraagtActie: false, actie: null, totNu: false, geenActiviteit: false, teLaat: false,
    }
  }
  if (ingediend) {
    return {
      ...basis, stap: 'ingediend', afgerond: false, einde: null,
      stappen: stappenVoor('ingediend', false, geenControle),
      vraagtActie: false, actie: 'koppel_betaling', totNu: false, geenActiviteit: false, teLaat: false,
    }
  }
  if (lopend) {
    return {
      ...basis, stap: 'lopend', afgerond: false, einde: null, stappen: stappenVoor('lopend', false),
      vraagtActie: false, actie: null, totNu: true, geenActiviteit: false, teLaat: false,
    }
  }
  const geenActiviteit = !actief && bedragCent === 0
  const vraagtActie = actief || bedragCent !== 0
  const stap: AangifteStap = controle === 'akkoord' ? 'gecontroleerd' : 'berekend'
  return {
    ...basis, stap, afgerond: false, einde: null, stappen: stappenVoor(stap, false),
    vraagtActie,
    actie: geenActiviteit ? null : stap === 'gecontroleerd' ? 'indienen' : 'controleren',
    totNu: false, geenActiviteit,
    teLaat: vraagtActie && vandaag > uiterlijk,
  }
}

/** De BTW-perioden van een jaar die al begonnen zijn, in kalendervolgorde. */
export function btwRijen(jaar: number, bron: BtwStappenBron): AangifteRij[] {
  return getPeriodes(jaar, bron.periodeType)
    .map(p => btwRij(p, bron))
    .filter((r): r is AangifteRij => !!r)
}

// ── Accijns: de stap per maand ──────────────────────────────────────────────

export interface AccijnsStappenBron {
  /** Vandaag als Date (lopende maand, en het venster van openAccijnsMaanden). */
  vandaag: Date
  acc: readonly any[] | null | undefined
  accijnsAangiftes: readonly any[] | null | undefined
  bankKoppelingen: Record<string, any> | null | undefined
  bankTransacties?: readonly any[] | null
}

/** Accijns van één record (oude records: `totaal_accijns`). */
export const accijnsVanRecord = (a: any): number => Number(a?.accijns ?? a?.totaal_accijns ?? 0) || 0

/**
 * Het maandtotaal in centen, zoals het bij indienen wordt vastgelegd: de som
 * van de records, één keer afgerond (dezelfde berekening als het oude
 * `setAangifteStatus`, zodat lijst, detail en ingediend bedrag gelijk zijn).
 */
export const accijnsMaandCent = (records: readonly any[] | null | undefined): number =>
  toCent((records || []).reduce((s: number, a: any) => s + accijnsVanRecord(a), 0))

const lokaleIso = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** De maand vóór `maand` ('2026-01' → '2025-12'). */
const vorigeMaand = (maand: string): string => {
  const j = Number(maand.slice(0, 4))
  const m = Number(maand.slice(5, 7))
  return m === 1 ? `${j - 1}-12` : `${j}-${String(m - 1).padStart(2, '0')}`
}

/**
 * De accijnsmaanden, nieuwste eerst; met `jaar` alleen dat jaar. Dat zijn de
 * maanden met boekingen en de lopende maand (groepeerAccijnsPerMaand), plus:
 *  - de vorige maand, ook zonder boekingen: de lopende maand kan nog niet
 *    aangegeven worden, dus dít is de maand waarvoor je een nulaangifte doet
 *    (in de oude AccijnsPage kon dat op de lopende maand zelf);
 *  - elke maand met een aangifterecord (een gevraagde controle of een
 *    ingediende nulaangifte blijft zo zichtbaar, ook na die vorige maand).
 * Een maand zonder boekingen vraagt geen actie (zoals de badge) en heeft geen
 * knop in de lijst; het indienen gaat via het detail.
 */
export function accijnsRijen(bron: AccijnsStappenBron, jaar?: number | null): AangifteRij[] {
  const vandaagIso = lokaleIso(bron.vandaag)
  const huidig = accijnsMaandKey(bron.vandaag)
  const { byMonth, maanden: metBoekingen } = groepeerAccijnsPerMaand<any>(bron.acc as any[], huidig)
  const open = new Set(openAccijnsMaanden(bron.accijnsAangiftes as any[] || [], bron.acc as any[] || [], bron.vandaag))
  const aangiftes = bron.accijnsAangiftes || []
  const extra = [vorigeMaand(huidig), ...aangiftes.map((x: any) => tekst(x?.maand).slice(0, 7))]
    .filter(m => /^\d{4}-(0[1-9]|1[0-2])$/.test(m) && m <= huidig)
  const maanden = [...new Set([...metBoekingen, ...extra])].sort((a, b) => b.localeCompare(a))
  return maanden
    .filter(m => jaar === null || jaar === undefined || m.startsWith(`${jaar}-`))
    .map((maand): AangifteRij => {
      const records = byMonth[maand] || []
      const rec = aangiftes.find((x: any) => x?.maand === maand) || null
      const status = tekst(rec?.status) || 'open'
      const ingediend = status === 'ingediend' || status === 'betaald'
      const somCent = accijnsMaandCent(records)
      const bedragCent = ingediend && rec?.bedrag !== undefined && rec?.bedrag !== null ? toCent(rec.bedrag) : somCent
      const betaling = koppelingVoor(bron.bankKoppelingen, bron.bankTransacties, 'accijns', maand)
      const controle = controleFase(rec)
      const tot = laatsteDag(maand)
      const uiterlijk = aangifteUiterlijk(tot)
      const lopend = !ingediend && maand >= huidig
      const geenControle: AangifteStap[] = controle === 'akkoord' ? [] : ['gecontroleerd']
      const basis = {
        soort: 'accijns' as const, sleutel: maand, jaar: Number(maand.slice(0, 4)), van: `${maand}-01`, tot,
        bedragCent, teruggave: false, uiterlijk,
        ingediendOp: ingediend ? tekst(rec?.ingediend_datum) || null : null,
        ingediendDoor: ingediend ? tekst(rec?.ingediend_door) || null : null,
        betaling, controle, controleRecord: rec,
        boekingenBetaald: records.length > 0 && records.every((a: any) => !!a?.betaald),
        vraagtActie: open.has(maand),
        geenActiviteit: records.length === 0 && !ingediend,
      }
      if (status === 'betaald') {
        // Zonder indiendatum: achteraf via de bank op betaald gezet, nooit als
        // ingediend gemarkeerd (de oude werkwijze) — die stap is overgeslagen.
        const nietIngediend: AangifteStap[] = tekst(rec?.ingediend_datum) ? [] : ['ingediend']
        return {
          ...basis, stap: 'betaald', afgerond: true, einde: 'betaald',
          stappen: stappenVoor('betaald', true, [...geenControle, ...nietIngediend]), actie: null, totNu: false, teLaat: false,
        }
      }
      // Nulaangifte: ingediend met € 0 — er komt nooit een betaling (zoals bij BTW).
      if (status === 'ingediend' && bedragCent === 0) {
        return {
          ...basis, stap: 'betaald', afgerond: true, einde: 'nihil',
          stappen: stappenVoor('betaald', true, geenControle), actie: null, totNu: false, teLaat: false,
        }
      }
      if (status === 'ingediend') {
        return {
          ...basis, stap: 'ingediend', afgerond: false, einde: null,
          stappen: stappenVoor('ingediend', false, geenControle), actie: 'koppel_betaling', totNu: false, teLaat: false,
        }
      }
      if (lopend) {
        return {
          ...basis, stap: 'lopend', afgerond: false, einde: null, stappen: stappenVoor('lopend', false),
          actie: null, totNu: true, teLaat: false,
        }
      }
      const stap: AangifteStap = controle === 'akkoord' ? 'gecontroleerd' : 'berekend'
      return {
        ...basis, stap, afgerond: false, einde: null, stappen: stappenVoor(stap, false),
        actie: basis.geenActiviteit ? null : stap === 'gecontroleerd' ? 'indienen' : 'controleren', totNu: false,
        teLaat: !basis.geenActiviteit && vandaagIso > uiterlijk,
      }
    })
}

// ── Volgorde en tellingen ───────────────────────────────────────────────────

/**
 * De lijst: eerst wat om actie vraagt (de vroegste uiterste datum bovenaan),
 * daarna de rest, nieuwste eerst.
 */
export function sorteerRijen(rijen: readonly AangifteRij[]): AangifteRij[] {
  const actie = rijen.filter(r => r.vraagtActie)
    .sort((a, b) => a.uiterlijk.localeCompare(b.uiterlijk) || a.sleutel.localeCompare(b.sleutel))
  const rest = rijen.filter(r => !r.vraagtActie)
    .sort((a, b) => b.van.localeCompare(a.van) || b.sleutel.localeCompare(a.sleutel))
  return [...actie, ...rest]
}

export const telVraagtActie = (rijen: readonly AangifteRij[]): number => rijen.filter(r => r.vraagtActie).length

// ── Teksten (i18n-sleutels) ─────────────────────────────────────────────────

export interface Tekst { sleutel: string, vars: Record<string, string> }

/** Het label van de huidige stap ("Berekend", "Terugontvangen", "Nihil"). */
export function stapSleutel(rij: AangifteRij): string {
  if (rij.afgerond) return rij.einde === 'nihil' ? 'agf_stap_nihil' : rij.einde === 'terugontvangen' ? 'agf_stap_terugontvangen' : 'agf_stap_betaald'
  return `agf_stap_${rij.stap}`
}

/** De naam van stap `i` in de balk: de laatste heet "Terugontvangen" bij een teruggave. */
export const stapNaamSleutel = (rij: AangifteRij, i: number): string =>
  i === AANGIFTE_STAPPEN.length - 1 && (rij.teruggave || rij.einde === 'terugontvangen') ? 'agf_stap_terugontvangen' : `agf_stap_${AANGIFTE_STAPPEN[i]}`

/** Wat er onder het bedrag staat: tot nu, te betalen, terug te ontvangen, betaald, terugontvangen, nihil. */
export function bedragSleutel(rij: AangifteRij): string {
  if (rij.totNu) return 'agf_bedrag_tot_nu'
  if (rij.afgerond) return rij.einde === 'nihil' ? 'agf_bedrag_nihil' : rij.einde === 'terugontvangen' ? 'agf_bedrag_terugontvangen' : 'agf_bedrag_betaald'
  return rij.bedragCent < 0 ? 'agf_bedrag_terug' : 'agf_bedrag_te_betalen'
}

/** De korte regel onder de periode: uiterlijk, te laat, ingediend, afgerond … */
export function subRegel(rij: AangifteRij): Tekst {
  if (rij.totNu) return { sleutel: 'agf_sub_loopt_tot', vars: { datum: dagMaand(rij.tot) } }
  if (rij.afgerond) {
    if (rij.einde === 'nihil') return { sleutel: 'agf_sub_nihil', vars: {} }
    const datum = dagMaand(rij.betaling?.datum || (rij.soort === 'accijns' ? rij.controleRecord?.betaald_datum : ''))
    if (!datum) return { sleutel: 'agf_sub_afgerond', vars: {} }
    return { sleutel: rij.einde === 'terugontvangen' ? 'agf_sub_terugontvangen' : 'agf_sub_betaald', vars: { datum } }
  }
  if (rij.stap === 'ingediend') {
    const datum = dagMaand(rij.ingediendOp)
    return datum ? { sleutel: 'agf_sub_ingediend', vars: { datum } } : { sleutel: 'agf_sub_ingediend_kort', vars: {} }
  }
  if (rij.geenActiviteit) return { sleutel: 'agf_sub_geen_boekingen', vars: {} }
  if (rij.teLaat) return { sleutel: 'agf_sub_te_laat', vars: { datum: dagMaand(rij.uiterlijk) } }
  if (rij.controle === 'opmerkingen') return { sleutel: 'agf_sub_opmerkingen', vars: { datum: dagMaand(rij.uiterlijk) } }
  const naam = tekst(rij.controleRecord?.reviewer).trim()
  if (rij.controle === 'aangevraagd' && naam) return { sleutel: 'agf_sub_wacht_controle', vars: { naam, datum: dagMaand(rij.uiterlijk) } }
  return { sleutel: 'agf_sub_uiterlijk', vars: { datum: dagMaand(rij.uiterlijk) } }
}

/** Het label van de volgende-stapknop. */
export function actieSleutel(rij: AangifteRij): string | null {
  if (rij.actie === 'controleren') return 'agf_actie_controleren'
  if (rij.actie === 'indienen') return 'agf_actie_indienen'
  if (rij.actie === 'koppel_betaling') return rij.teruggave ? 'agf_actie_koppel_teruggave' : 'agf_actie_koppel'
  return null
}

export type PilKleur = 'blauw' | 'groen' | 'grijs' | 'oranje'
/** De statuspil van een regel zonder knop (lopend, afgerond, geen activiteit) of van een kaart. */
export function pilVoor(rij: AangifteRij): { sleutel: string, kleur: PilKleur } {
  if (rij.afgerond) return { sleutel: 'agf_pil_afgerond', kleur: 'groen' }
  if (rij.totNu) return { sleutel: 'agf_pil_lopend', kleur: 'blauw' }
  if (rij.stap === 'ingediend') return { sleutel: 'agf_stap_ingediend', kleur: 'blauw' }
  if (rij.geenActiviteit) return { sleutel: 'agf_pil_geen_activiteit', kleur: 'grijs' }
  return { sleutel: 'agf_pil_actie', kleur: 'oranje' }
}

// ── Navigatiedoel ───────────────────────────────────────────────────────────

/**
 * Het doel uit een link (`{tab, filter}`): welk segment, welk jaar en welke
 * periode open moet. Een BTW-sleutel van het andere periodetype (een maand bij
 * kwartaalaangifte) gaat naar de periode waar die in valt.
 */
export function leesAangifteDoel(
  doel: { tab?: unknown, filter?: unknown } | null | undefined,
  periodeType: BtwPeriodeType,
): { tab: AangifteSoort, jaar: number | null, sleutel: string | null } {
  const filter = tekst(doel?.filter)
  const tabIn = tekst(doel?.tab)
  const accijnsMaand = /^\d{4}-(0[1-9]|1[0-2])$/.test(filter)
  const tab: AangifteSoort = tabIn === 'accijns' || (tabIn !== 'btw' && accijnsMaand) ? 'accijns' : 'btw'
  if (tab === 'accijns') {
    return accijnsMaand ? { tab, jaar: Number(filter.slice(0, 4)), sleutel: filter } : { tab, jaar: null, sleutel: null }
  }
  const m = /^(\d{4})-(Q([1-4])|M(0[1-9]|1[0-2]))$/.exec(filter)
  if (!m) return { tab, jaar: null, sleutel: null }
  const jaar = Number(m[1])
  if (m[3] && periodeType === 'kwartaal') return { tab, jaar, sleutel: filter }
  if (m[4] && periodeType === 'maand') return { tab, jaar, sleutel: filter }
  // Ander periodetype: de eerste maand van het kwartaal, of het kwartaal van de maand.
  const maand = m[3] ? String((Number(m[3]) - 1) * 3 + 1).padStart(2, '0') : m[4]
  return { tab, jaar, sleutel: datumToPeriodeKey(`${jaar}-${maand}-01`, periodeType) }
}
