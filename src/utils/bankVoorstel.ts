// ── Koppelvoorstel per banktransactie (Bank als werklijst) ──────────────────
// Het Bank-scherm is een wachtrij: per ongekoppelde transactie hooguit één
// voorstel, met de reden erbij, en één knop die het uitvoert. Deze module
// beslist wát dat voorstel is. Hij koppelt zelf niets — de gebruiker
// bevestigt met "Koppel" — en rekent met de regels die er al zijn:
//
//  - facturen via `besteMatch` (utils/bank.ts): het bedrag is de toegangseis,
//    factuurnummer en naam tellen mee, en bij een gelijke score is het
//    ambigu: dan géén voorstel maar de reden "meerdere kandidaten";
//  - met een datumgrens (ERP-plan F11): een factuur die meer dan
//    VOORSTEL_MAX_DAGEN_VOORUIT dagen ná de transactie gedateerd is, kan
//    niet met dat geld betaald zijn en doet nooit mee. `besteMatch` zelf
//    kende geen datum, waardoor een betaling van maart aan een factuur van
//    oktober met hetzelfde bedrag kon blijven hangen;
//  - een PSP-uitbetaling (Mollie e.d.) via `pspKandidaten` + `zoekPspCombinatie`,
//    met hun eigen tijdvak (zie bank.ts: de factuurdatum van een webshoporder
//    is de datum van afronden, vaak ná de uitbetaling);
//  - ingediende BTW-aangiftes die nog niet betaald zijn: bedrag op € 1 na
//    (de aangifte is in hele euro's), en het teken telt — een afschrijving is
//    een betaling, een bijschrijving een teruggave;
//  - ingediende accijnsmaanden, ook op € 1 na.
//
// Een terugboeking (storno) krijgt nooit een voorstel: dat is geen betaling
// van een factuur, de gebruiker beslist. De volgorde is die van de
// automatische koppeling bij het inlezen (`autoKoppelImport` in
// utils/bankImportKoppeling.ts), en de datumgrens deelt die via
// `besteMatchBinnenDatum`, zodat voorstel en import hetzelfde vinden.
//
// Puur, zonder React of t(): redenen komen terug als i18n-sleutel met
// variabelen; bedragen voor in de reden in centen.

import {
  besteMatch, scoreMatch, gekoppeldeFactuurIds, isGekoppeld, isPspTransactie,
  isBelastingdienstTransactie, pspKandidaten, zoekPspCombinatie, txKey,
  type MatchKandidaat, type MatchTransactie,
} from './bank'
import { isVerkoopFactuurOpen, openInkoopFacturen } from './facturen'
import { toCent } from './centen'
import { zoekPast } from './factuurFilter'

/** Zoveel dagen ná de transactie mag een factuur nog gedateerd zijn (vooruitbetaling). */
export const VOORSTEL_MAX_DAGEN_VOORUIT = 7

/** Marge tussen aangiftebedrag (hele euro's) en de betaling: € 1. */
export const AANGIFTE_MARGE_CENT = 100

export type VoorstelSoort = 'verkoop' | 'inkoop' | 'psp' | 'btw' | 'accijns'

export interface BankVoorstel {
  /** Wat "Koppel" doet; `null` = geen voorstel (de reden zegt waarom). */
  soort: VoorstelSoort | null
  /** Verkoop- of inkoopfactuur (ook een creditnota op de inkoop). */
  doelId?: number
  /** PSP: de facturen in de bundel. */
  factuurIds?: number[]
  /** BTW: de aangifteperiode ('2026-Q2' / '2026-M04'). */
  periodeKey?: string
  /** Accijns: de maand ('2026-09'). */
  maand?: string
  /** i18n-sleutel van de reden. */
  redenSleutel: string
  /** Variabelen voor de reden (geen bedragen: die staan hieronder in centen). */
  vars: Record<string, string | number>
  /** Meerdere kandidaten met dezelfde score: bewust geen voorstel. */
  ambigu?: boolean
  /** De factuur staat al op betaald (herkend in de betaalde facturen). */
  retro?: boolean
  /** BTW/accijns: verschil tussen betaling en aangifte (centen, ≥ 0). */
  verschilCent?: number
  /** PSP: som facturen − uitbetaling = transactiekosten (centen, ≥ 0). */
  kostenCent?: number
}

export interface VoorstelContext {
  verkoopFacturen?: any[] | null
  inkoopFacturen?: any[] | null
  btwAangiftes?: any[] | null
  accijnsAangiftes?: any[] | null
  bankKoppelingen?: Record<string, any> | null
  /** Klantnaam voor de naamvergelijking (live uit de klantkaart); standaard `klant_naam`. */
  klantNaam?: (f: any) => string
}

// ── Datums ──────────────────────────────────────────────────────────────────

const ISO_DAG = /^\d{4}-\d{2}-\d{2}$/
const dagVan = (s: unknown): string => String(s ?? '').slice(0, 10)

/** 'JJJJ-MM-DD' plus `n` dagen (in UTC gerekend: geen zomertijdwissel). Ongeldig = null. */
export const dagPlus = (iso: string, n: number): string | null => {
  if (!ISO_DAG.test(String(iso || ''))) return null
  const d = new Date(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)) + n))
  return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : null
}

/**
 * Kan een factuur van `factuurDatum` met een transactie van `txDatum` betaald
 * zijn? Nee als de factuur meer dan `maxDagen` dagen ná de transactie valt.
 * Zonder (geldige) datum aan een van beide kanten: geen grens.
 */
export function binnenDatumgrens(factuurDatum: unknown, txDatum: unknown, maxDagen = VOORSTEL_MAX_DAGEN_VOORUIT): boolean {
  const f = dagVan(factuurDatum)
  const tx = dagVan(txDatum)
  if (!ISO_DAG.test(f) || !ISO_DAG.test(tx)) return true
  const grens = dagPlus(tx, maxDagen)
  return grens === null || f <= grens
}

/**
 * `besteMatch` met de datumgrens (ERP-plan F11): een kandidaat die meer dan
 * VOORSTEL_MAX_DAGEN_VOORUIT dagen ná de transactie gedateerd is doet niet
 * mee — ook niet voor "ambigu". Eén regel voor het voorstel hieronder én de
 * automatische koppeling bij het inlezen (`autoKoppelImport` in
 * utils/bankImportKoppeling.ts); geef de factuurdatum mee als `datum`.
 */
export function besteMatchBinnenDatum<T extends MatchKandidaat & { datum?: unknown }>(
  tx: MatchTransactie & { datum?: unknown },
  kandidaten: readonly T[] | null | undefined,
  uitsluiten?: Set<number>,
): { kandidaat: T | null; ambigu: boolean } {
  return besteMatch(tx, (kandidaten || []).filter(k => binnenDatumgrens(k?.datum, tx?.datum)), uitsluiten)
}

/** Eerste dag van een BTW-periode: '2026-Q2' → '2026-04-01', '2026-M04' → '2026-04-01'. */
export function btwPeriodeStart(periodeKey: unknown): string | null {
  const m = /^(\d{4})-(?:Q([1-4])|M(\d{2}))$/.exec(String(periodeKey ?? ''))
  if (!m) return null
  const maand = m[2] ? (Number(m[2]) - 1) * 3 + 1 : Number(m[3])
  if (maand < 1 || maand > 12) return null
  return `${m[1]}-${String(maand).padStart(2, '0')}-01`
}

/** Eerste dag van een accijnsmaand: '2026-09' → '2026-09-01'. */
export function accijnsMaandStart(maand: unknown): string | null {
  const s = String(maand ?? '')
  if (!/^\d{4}-\d{2}$/.test(s)) return null
  const mm = Number(s.slice(5, 7))
  return mm >= 1 && mm <= 12 ? `${s}-01` : null
}

/** Valt de transactie niet vóór het begin van de periode? (Zonder datum: ja.) */
const nietVoor = (txDatum: unknown, start: string | null): boolean => {
  const tx = dagVan(txDatum)
  return !start || !ISO_DAG.test(tx) || tx >= start
}

// ── Kandidaten ──────────────────────────────────────────────────────────────

interface FactuurKandidaat extends MatchKandidaat { datum: string }

/** Reden per match-score (scoreMatch: +2 kenmerk, +1 naam). */
const REDEN_PER_SCORE = [
  'bank_vs_reden_bedrag',
  'bank_vs_reden_naam',
  'bank_vs_reden_nummer',
  'bank_vs_reden_nummer_naam',
] as const

const redenVoorScore = (score: number): string =>
  REDEN_PER_SCORE[Math.max(0, Math.min(REDEN_PER_SCORE.length - 1, Math.floor(score)))]

const geen = (redenSleutel: string, extra: Partial<BankVoorstel> = {}): BankVoorstel =>
  ({ soort: null, redenSleutel, vars: {}, ...extra })

/** Wat er voor alle transacties hetzelfde is: één keer opbouwen. */
interface Voorbereid {
  ctx: VoorstelContext
  verkoopOpen: FactuurKandidaat[]
  verkoopBetaald: FactuurKandidaat[]
  inkoopOpen: FactuurKandidaat[]
  inkoopBetaald: FactuurKandidaat[]
  creditnotasOpen: FactuurKandidaat[]
  bezetVerkoop: Set<number>
  bezetInkoop: Set<number>
  btwBetaald: Set<string>
  accijnsBetaald: Set<string>
}

function bereidVoor(ctx: VoorstelContext): Voorbereid {
  const naam = ctx.klantNaam || ((f: any) => String(f?.klant_naam || ''))
  const verkoop = (ctx.verkoopFacturen || []).filter((f: any) => f && typeof f === 'object')
  const inkoop = (ctx.inkoopFacturen || []).filter((f: any) => f && typeof f === 'object')
  const vk = (f: any): FactuurKandidaat => ({
    id: Number(f.id), bedrag: Number(f.bruto) || 0, nummer: f.factuurnummer,
    naam: naam(f) || f.klant_naam, datum: dagVan(f.datum),
  })
  const ik = (f: any, abs = false): FactuurKandidaat => ({
    id: Number(f.id), bedrag: abs ? Math.abs(Number(f.totaal_bruto) || 0) : (Number(f.totaal_bruto) || 0),
    nummer: f.factuurnummer, naam: f.leverancier, datum: dagVan(f.datum),
  })
  const openIn = openInkoopFacturen(inkoop)
  const koppelingen = ctx.bankKoppelingen || {}
  const btwBetaald = new Set<string>()
  const accijnsBetaald = new Set<string>()
  for (const k of Object.values(koppelingen) as any[]) {
    if (k?.soort === 'btw' && k.periodeKey) btwBetaald.add(String(k.periodeKey))
    if (k?.soort === 'accijns' && k.maandKey) accijnsBetaald.add(String(k.maandKey))
  }
  return {
    ctx,
    verkoopOpen: verkoop.filter(isVerkoopFactuurOpen).map(vk),
    verkoopBetaald: verkoop.filter((f: any) => f.status === 'betaald').map(vk),
    inkoopOpen: openIn.map((f: any) => ik(f)),
    inkoopBetaald: inkoop.filter((f: any) => f.status === 'betaald').map((f: any) => ik(f)),
    creditnotasOpen: openIn.filter((f: any) => (Number(f.totaal_bruto) || 0) < 0).map((f: any) => ik(f, true)),
    bezetVerkoop: gekoppeldeFactuurIds(koppelingen, 'verkoop'),
    bezetInkoop: gekoppeldeFactuurIds(koppelingen, 'inkoop'),
    btwBetaald,
    accijnsBetaald,
  }
}

interface MetGewicht { voorstel: BankVoorstel, gewicht: number }

/** Factuurmatch binnen de datumgrens: voorstel, ambigu of niets (null). */
function factuurMatch(
  tx: any, soort: 'verkoop' | 'inkoop', lijst: FactuurKandidaat[], bezet: Set<number>, retro: boolean,
): MetGewicht | 'ambigu' | null {
  const m = besteMatchBinnenDatum(tx, lijst, bezet)
  if (m.kandidaat) {
    const score = scoreMatch(tx, m.kandidaat)
    return {
      voorstel: {
        soort, doelId: m.kandidaat.id, redenSleutel: redenVoorScore(score), vars: {},
        ...(retro ? { retro: true } : {}),
      },
      gewicht: score,
    }
  }
  return m.ambigu ? 'ambigu' : null
}

/**
 * Aangifte (BTW of accijns) waarvan het bedrag op € 1 na gelijk is aan de
 * transactie. De dichtstbijzijnde wint; twee even dichtbij = ambigu.
 */
function aangifteMatch<A>(
  tx: any, kandidaten: A[], bedragCent: (a: A) => number,
): { beste: A, verschilCent: number } | 'ambigu' | null {
  const tx_cent = Math.abs(toCent(tx?.bedrag))
  const binnen = kandidaten
    .map(a => ({ a, verschil: Math.abs(tx_cent - Math.abs(bedragCent(a))) }))
    .filter(x => x.verschil <= AANGIFTE_MARGE_CENT)
    .sort((x, y) => x.verschil - y.verschil)
  if (!binnen.length) return null
  if (binnen.length > 1 && binnen[1].verschil === binnen[0].verschil) return 'ambigu'
  return { beste: binnen[0].a, verschilCent: binnen[0].verschil }
}

/**
 * De BTW-aangifte waar deze transactie de betaling (afschrijving) of de
 * teruggave (bijschrijving) van is: bedrag op € 1 na, niet vóór het begin van
 * de periode, geen periode die al een betaling heeft (`betaald`). De
 * dichtstbijzijnde wint; even dichtbij = ambigu. Gedeeld door het voorstel en
 * de automatische koppeling bij het inlezen (utils/bankImportKoppeling.ts),
 * zodat die hetzelfde vinden.
 */
export function btwAangifteMatch(
  tx: any, btwAangiftes: readonly any[] | null | undefined, betaald: ReadonlySet<string>,
): { beste: any, verschilCent: number } | 'ambigu' | null {
  const credit = tx?.type === 'C'
  const kandidaten = (btwAangiftes || []).filter((a: any) => {
    if (!a?.periodeKey || betaald.has(String(a.periodeKey))) return false
    const b = toCent(a.bedrag)
    // Afschrijving = te betalen (> 0), bijschrijving = teruggave (< 0). Een
    // aangifte van nul kent geen betaling.
    if (credit ? b >= 0 : b <= 0) return false
    return nietVoor(tx?.datum, btwPeriodeStart(a.periodeKey))
  })
  return aangifteMatch(tx, kandidaten, (a: any) => toCent(a.bedrag))
}

/**
 * De ingediende accijnsmaand waar deze afschrijving de betaling van is (zie
 * `btwAangifteMatch`): bedrag > 0 op € 1 na, niet vóór de maand, nog zonder
 * betaling.
 */
export function accijnsAangifteMatch(
  tx: any, accijnsAangiftes: readonly any[] | null | undefined, betaald: ReadonlySet<string>,
): { beste: any, verschilCent: number } | 'ambigu' | null {
  const kandidaten = (accijnsAangiftes || []).filter((a: any) => {
    if (!a?.maand || a.status !== 'ingediend' || betaald.has(String(a.maand))) return false
    if (toCent(a.bedrag) <= 0) return false
    return nietVoor(tx?.datum, accijnsMaandStart(a.maand))
  })
  return aangifteMatch(tx, kandidaten, (a: any) => toCent(a.bedrag))
}

function btwMatch(tx: any, v: Voorbereid): MetGewicht | 'ambigu' | null {
  const credit = tx?.type === 'C'
  const m = btwAangifteMatch(tx, v.ctx.btwAangiftes, v.btwBetaald)
  if (m === 'ambigu') return 'ambigu'
  if (!m) return null
  const exact = m.verschilCent === 0
  return {
    voorstel: {
      soort: 'btw', periodeKey: String(m.beste.periodeKey),
      redenSleutel: credit
        ? (exact ? 'bank_vs_reden_teruggave' : 'bank_vs_reden_teruggave_bijna')
        : (exact ? 'bank_vs_reden_aangifte' : 'bank_vs_reden_aangifte_bijna'),
      vars: {}, verschilCent: m.verschilCent,
    },
    gewicht: -m.verschilCent,
  }
}

function accijnsMatch(tx: any, v: Voorbereid): MetGewicht | 'ambigu' | null {
  const m = accijnsAangifteMatch(tx, v.ctx.accijnsAangiftes, v.accijnsBetaald)
  if (m === 'ambigu') return 'ambigu'
  if (!m) return null
  return {
    voorstel: {
      soort: 'accijns', maand: String(m.beste.maand),
      redenSleutel: m.verschilCent === 0 ? 'bank_vs_reden_accijns' : 'bank_vs_reden_accijns_bijna',
      vars: {}, verschilCent: m.verschilCent,
    },
    gewicht: -m.verschilCent,
  }
}

function pspMatch(tx: any, v: Voorbereid): MetGewicht {
  const kandidaten = pspKandidaten(v.ctx.verkoopFacturen || [], { datum: tx?.datum, alGekoppeld: v.bezetVerkoop })
  const ids = zoekPspCombinatie(Number(tx?.bedrag) || 0, kandidaten)
  if (!ids || !ids.length) return { voorstel: geen('bank_vs_reden_psp_geen'), gewicht: 0 }
  const gekozen = new Set(ids)
  const som = kandidaten.filter((f: any) => gekozen.has(f.id)).reduce((s: number, f: any) => s + toCent(f.bruto), 0)
  return {
    voorstel: {
      soort: 'psp', factuurIds: ids, redenSleutel: 'bank_vs_reden_psp',
      vars: { n: ids.length }, kostenCent: Math.max(0, som - Math.abs(toCent(tx?.bedrag))),
    },
    gewicht: 0,
  }
}

const AMBIGU = (): BankVoorstel => geen('bank_vs_reden_ambigu', { ambigu: true })

function voorstelMetGewicht(tx: any, v: Voorbereid): MetGewicht | null {
  if (!tx || typeof tx !== 'object' || isGekoppeld(tx)) return null
  if (tx.storno) return { voorstel: geen('bank_vs_reden_storno'), gewicht: 0 }
  const stap = (m: MetGewicht | 'ambigu' | null): MetGewicht | null =>
    m === 'ambigu' ? { voorstel: AMBIGU(), gewicht: 0 } : m

  if (tx.type === 'C') {
    const r = stap(factuurMatch(tx, 'verkoop', v.verkoopOpen, v.bezetVerkoop, false))
      || stap(factuurMatch(tx, 'verkoop', v.verkoopBetaald, v.bezetVerkoop, true))
      || stap(factuurMatch(tx, 'inkoop', v.creditnotasOpen, v.bezetInkoop, false))
      || stap(btwMatch(tx, v))
    if (r) return r
    if (isPspTransactie(tx)) return pspMatch(tx, v)
  } else {
    const r = stap(factuurMatch(tx, 'inkoop', v.inkoopOpen, v.bezetInkoop, false))
      || stap(factuurMatch(tx, 'inkoop', v.inkoopBetaald, v.bezetInkoop, true))
      || stap(btwMatch(tx, v))
      || stap(accijnsMatch(tx, v))
    if (r) return r
  }
  if (isBelastingdienstTransactie(tx)) return { voorstel: geen('bank_vs_reden_belastingdienst'), gewicht: 0 }
  return { voorstel: geen('bank_vs_reden_geen'), gewicht: 0 }
}

/**
 * Het voorstel voor één transactie, of `null` als hij al gekoppeld is.
 * Zonder voorstel komt er een object met `soort: null` en de reden terug.
 */
export function bankVoorstel(tx: any, ctx: VoorstelContext): BankVoorstel | null {
  return voorstelMetGewicht(tx, bereidVoor(ctx))?.voorstel ?? null
}

/** Sleutel van een transactie in het resultaat van `bankVoorstellen`. */
export const bankVoorstelSleutel = (tx: any): string =>
  tx?.id !== undefined && tx?.id !== null ? `id:${tx.id}` : `key:${txKey(tx)}`

/** Waar wijst het voorstel naartoe? Twee voorstellen met hetzelfde doel botsen. */
const doelVan = (v: BankVoorstel): string | null => {
  if (v.soort === 'verkoop' || v.soort === 'inkoop') return `${v.soort}:${v.doelId}`
  if (v.soort === 'btw') return `btw:${v.periodeKey}`
  if (v.soort === 'accijns') return `accijns:${v.maand}`
  return null
}

/**
 * Voorstellen voor een hele lijst. Wijzen twee transacties naar dezelfde
 * factuur of aangifte, dan houdt de beste match (hoogste score, kleinste
 * verschil) zijn voorstel en krijgt de ander de reden "past ook bij een
 * andere transactie"; even goed = allebei geen voorstel. Met één klik op
 * "Koppel" mag dezelfde factuur nooit twee betalingen krijgen.
 */
export function bankVoorstellen(transacties: any[] | null | undefined, ctx: VoorstelContext): Map<string, BankVoorstel> {
  const v = bereidVoor(ctx)
  const uit = new Map<string, BankVoorstel>()
  const perDoel = new Map<string, { sleutel: string, gewicht: number }[]>()
  for (const tx of transacties || []) {
    const r = voorstelMetGewicht(tx, v)
    if (!r) continue
    const sleutel = bankVoorstelSleutel(tx)
    uit.set(sleutel, r.voorstel)
    const doel = doelVan(r.voorstel)
    if (!doel) continue
    const rij = perDoel.get(doel)
    if (rij) rij.push({ sleutel, gewicht: r.gewicht })
    else perDoel.set(doel, [{ sleutel, gewicht: r.gewicht }])
  }
  for (const rij of perDoel.values()) {
    if (rij.length < 2) continue
    const hoogste = Math.max(...rij.map(x => x.gewicht))
    const winnaars = rij.filter(x => x.gewicht === hoogste)
    for (const x of rij) {
      if (winnaars.length === 1 && x === winnaars[0]) continue
      uit.set(x.sleutel, geen('bank_vs_reden_dubbel', { ambigu: true }))
    }
  }
  return uit
}

// ── Handmatig koppelen: de kandidaten in de kiezers ─────────────────────────
// "Koppel aan verkoopfactuur…" e.d. openen een kiezer met zoeken in plaats van
// een keuzelijst met alle facturen. Hier geen datumgrens en geen score: de
// gebruiker kiest zelf. Wat qua bedrag klopt staat bovenaan. Een open factuur
// die al aan een andere transactie hangt blijft kiesbaar — een deelbetaling in
// twee keer kon in de oude keuzelijst ook — maar staat achteraan en gemarkeerd
// (`elders`). Het voorstel zelf kiest zo'n factuur nooit (één factuur, één
// betaling); een betaalde factuur die al ergens aan hangt doet niet mee.

export type FactuurKiezerSoort = 'verkoop' | 'inkoop' | 'creditnota'

export interface FactuurKiezerOpties {
  /** Ook facturen die al op betaald staan (zonder bankkoppeling). */
  ookBetaald?: boolean
  zoek?: string
  bankKoppelingen?: Record<string, any> | null
  klantNaam?: (f: any) => string
}

export interface FactuurKiezerRegel {
  factuur: any
  id: number
  /** Bedrag zoals de transactie het ziet (positief), in centen. */
  bedragCent: number
  /** Gelijk aan het transactiebedrag. */
  klopt: boolean
  betaald: boolean
  naam: string
  /** Hangt al aan een andere banktransactie (deelbetaling?): achteraan. */
  elders: boolean
}

/** Kandidaten voor de factuurkiezer: vrije facturen eerst, daarin bedrag klopt eerst, dan nieuwste eerst. */
export function factuurKiezerKandidaten(
  tx: any, soort: FactuurKiezerSoort, facturen: any[] | null | undefined, opties: FactuurKiezerOpties = {},
): FactuurKiezerRegel[] {
  const verkoop = soort === 'verkoop'
  const bezet = gekoppeldeFactuurIds(opties.bankKoppelingen, verkoop ? 'verkoop' : 'inkoop', tx ? txKey(tx) : undefined)
  const txCent = Math.abs(toCent(tx?.bedrag))
  const naam = (f: any): string => verkoop
    ? String((opties.klantNaam ? opties.klantNaam(f) : '') || f?.klant_naam || '')
    : String(f?.leverancier || '')
  const regels: FactuurKiezerRegel[] = []
  for (const f of facturen || []) {
    if (!f || typeof f !== 'object') continue
    const bedrag = toCent(verkoop ? f.bruto : f.totaal_bruto)
    if (soort === 'creditnota' ? bedrag >= 0 : bedrag <= 0) continue
    const betaald = f.status === 'betaald'
    const open = verkoop ? isVerkoopFactuurOpen(f) : !betaald
    const elders = bezet.has(Number(f.id))
    if (elders && !open) continue
    if (!open && !(opties.ookBetaald && betaald)) continue
    const n = naam(f)
    if (opties.zoek && !zoekPastKiezer(f, n, Math.abs(bedrag), opties.zoek)) continue
    regels.push({ factuur: f, id: Number(f.id), bedragCent: Math.abs(bedrag), klopt: Math.abs(bedrag) === txCent, betaald, naam: n, elders })
  }
  return regels.sort((a, b) =>
    (a.elders === b.elders ? 0 : a.elders ? 1 : -1)
    || (a.klopt === b.klopt ? 0 : a.klopt ? -1 : 1)
    || String(b.factuur.datum || '').localeCompare(String(a.factuur.datum || ''))
    || b.id - a.id)
}

const zoekPastKiezer = (f: any, naam: string, bedragCent: number, zoek: string): boolean =>
  zoekPast([f.factuurnummer, naam, f.datum, f.omschrijving], [bedragCent / 100], zoek)

export interface AangifteKiezerRegel {
  /** BTW: periodeKey; accijns: maand. */
  sleutel: string
  aangifte: any
  /** Aangiftebedrag zonder teken, in centen. */
  bedragCent: number
  /** Verschil met de transactie, in centen (≥ 0). */
  verschilCent: number
}

const metVerschil = (tx: any, sleutel: string, a: any): AangifteKiezerRegel => {
  const b = Math.abs(toCent(a?.bedrag))
  return { sleutel, aangifte: a, bedragCent: b, verschilCent: Math.abs(b - Math.abs(toCent(tx?.bedrag))) }
}

const dichtstbij = (a: AangifteKiezerRegel, b: AangifteKiezerRegel): number =>
  a.verschilCent - b.verschilCent || b.sleutel.localeCompare(a.sleutel)

/**
 * Ingediende BTW-aangiftes die nog niet betaald zijn, voor de kiezer
 * "BTW-afdracht/teruggave…". Een te betalen bedrag hoort bij een
 * afschrijving, een teruggave (negatief) bij een bijschrijving. Dichtst bij
 * het transactiebedrag eerst — dezelfde regels als de oude keuzelijst.
 */
export function btwKiezerKandidaten(tx: any, btwAangiftes: any[] | null | undefined, bankKoppelingen?: Record<string, any> | null): AangifteKiezerRegel[] {
  const betaald = new Set<string>()
  for (const k of Object.values(bankKoppelingen || {}) as any[]) if (k?.soort === 'btw' && k.periodeKey) betaald.add(String(k.periodeKey))
  const credit = tx?.type === 'C'
  return (btwAangiftes || [])
    .filter((a: any) => a?.periodeKey && !betaald.has(String(a.periodeKey)))
    .filter((a: any) => (toCent(a.bedrag) < 0) === credit)
    .map((a: any) => metVerschil(tx, String(a.periodeKey), a))
    .sort(dichtstbij)
}

/**
 * Accijnsmaanden waar nog een betaling bij hoort: ingediend, of al op betaald
 * gezet zonder bankkoppeling ("koppel alsnog het betaalbewijs"). Alleen voor
 * een afschrijving; dichtst bij het bedrag eerst.
 */
export function accijnsKiezerKandidaten(tx: any, accijnsAangiftes: any[] | null | undefined, bankKoppelingen?: Record<string, any> | null): AangifteKiezerRegel[] {
  if (tx?.type === 'C') return []
  const gekoppeld = new Set<string>()
  for (const k of Object.values(bankKoppelingen || {}) as any[]) if (k?.soort === 'accijns' && k.maandKey) gekoppeld.add(String(k.maandKey))
  return (accijnsAangiftes || [])
    .filter((a: any) => a?.maand && (a.status === 'ingediend' || a.status === 'betaald') && !gekoppeld.has(String(a.maand)))
    .map((a: any) => metVerschil(tx, String(a.maand), a))
    .sort(dichtstbij)
}
