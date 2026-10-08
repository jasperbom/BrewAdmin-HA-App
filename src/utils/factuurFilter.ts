// ── Filterregels van de factuurlijsten (Facturen › Verkoop | Inkoop) ────────
// Wat de filterbalk doet met een lijst facturen: status, periode, zoeken,
// relatie (klant/leverancier) en de totaalregel. Pure logica, gedeeld door de
// factuurlijsten en elke plek die er een telling of link naartoe maakt.
//
// Geen nieuwe definitie van "open", "vervallen" of "achterstallig": die staan
// in utils/facturen.ts en worden hier letterlijk hergebruikt (zelfde selectie,
// zelfde objecten), zodat de chip "Te laat" altijd hetzelfde aantal noemt als
// de badge en het Administratie-dashboard.
//
// De kernregel: **wat aandacht vraagt filter je niet weg.** Bij Open en Te laat
// (en Te verwerken bij Inkoop) doet de periode niet mee. Vóór de herindeling
// filterde "Toon alleen vervallen" bínnen de periode, waardoor een vervallen
// factuur van vorig jaar in januari nergens in de lijst te vinden was.

import { toCent, centNaarEuro, type RegelTotalen } from './centen'
import { findLiveKlant } from './klant'
import {
  isVerkoopFactuurOpen,
  vervallenVerkoopFacturen,
  openInkoopFacturen,
  achterstalligeInkoopFacturen,
} from './facturen'
import { telInboxOpen } from './inkoopInbox'
import { inBereik, OPEN_BEREIK, type Bereik } from './periode'

// ── Statussen ───────────────────────────────────────────────────────────────

export type FactuurStatusFilter = 'open' | 'te_laat' | 'betaald' | 'credit' | 'alles'
/** Inkoop kent ook het postvak: PDF's die nog geen factuur zijn. */
export type InkoopStatusFilter = FactuurStatusFilter | 'te_verwerken'

export interface StatusFilterDef<T extends string> {
  id: T
  /** i18n-sleutel van het chiplabel. */
  sleutel: string
}

export const FACTUUR_STATUS_FILTERS: readonly StatusFilterDef<FactuurStatusFilter>[] = [
  { id: 'open', sleutel: 'fb_status_open' },
  { id: 'te_laat', sleutel: 'fb_status_te_laat' },
  { id: 'betaald', sleutel: 'fb_status_betaald' },
  { id: 'credit', sleutel: 'fb_status_credit' },
  { id: 'alles', sleutel: 'fb_status_alles' },
]

export const INKOOP_STATUS_FILTERS: readonly StatusFilterDef<InkoopStatusFilter>[] = [
  { id: 'open', sleutel: 'fb_status_open' },
  { id: 'te_laat', sleutel: 'fb_status_te_laat' },
  { id: 'te_verwerken', sleutel: 'fb_status_te_verwerken' },
  { id: 'betaald', sleutel: 'fb_status_betaald' },
  { id: 'credit', sleutel: 'fb_status_credit' },
  { id: 'alles', sleutel: 'fb_status_alles' },
]

const VERKOOP_IDS = new Set<string>(FACTUUR_STATUS_FILTERS.map(s => s.id))
const INKOOP_IDS = new Set<string>(INKOOP_STATUS_FILTERS.map(s => s.id))

export const isFactuurStatusFilter = (x: unknown): x is FactuurStatusFilter =>
  typeof x === 'string' && VERKOOP_IDS.has(x)

export const isInkoopStatusFilter = (x: unknown): x is InkoopStatusFilter =>
  typeof x === 'string' && INKOOP_IDS.has(x)

/**
 * Doet de periode mee bij deze status? Niet bij Open, Te laat en Te
 * verwerken: wat nog iets van je vraagt, laat geen datumfilter verdwijnen.
 */
export const periodeGeldtVoorStatus = (status: InkoopStatusFilter): boolean =>
  status !== 'open' && status !== 'te_laat' && status !== 'te_verwerken'

// ── Filter uit een navigatiedoel ────────────────────────────────────────────

export interface GelezenFactuurFilter {
  status?: InkoopStatusFilter
  klantId?: number
  leverancier?: string
}

/**
 * Leest het `filter` van een navigatiedoel (`navDoel.filter`): een status
 * ('open', 'te_laat', 'betaald', 'credit', 'alles', 'te_verwerken'),
 * 'klant:<klantId>' of 'leverancier:<naam>'. Onbekend of leeg = {}.
 */
export function leesFactuurFilter(filter: string | null | undefined): GelezenFactuurFilter {
  const f = String(filter ?? '').trim()
  if (!f) return {}
  if (isInkoopStatusFilter(f)) return { status: f }
  if (f.startsWith('klant:')) {
    const id = Number(f.slice('klant:'.length))
    return Number.isFinite(id) && f.length > 'klant:'.length ? { klantId: id } : {}
  }
  if (f.startsWith('leverancier:')) {
    const naam = f.slice('leverancier:'.length).trim()
    return naam ? { leverancier: naam } : {}
  }
  return {}
}

// ── Bedragen ────────────────────────────────────────────────────────────────

const centOf = (cent: unknown, euro: unknown): number =>
  cent !== null && cent !== undefined && cent !== '' && Number.isFinite(Number(cent))
    ? Math.round(Number(cent))
    : toCent(euro)

const maakTotalen = (netto_cent: number, btw_cent: number, bruto_cent: number): RegelTotalen => ({
  netto_cent, btw_cent, bruto_cent,
  netto: centNaarEuro(netto_cent),
  btw: centNaarEuro(btw_cent),
  bruto: centNaarEuro(bruto_cent),
})

/** Bedragen van een verkoopfactuur in centen (cent-velden gaan voor op euro's). */
export function verkoopCenten(f: any): RegelTotalen {
  return maakTotalen(centOf(f?.netto_cent, f?.netto), centOf(f?.btw_cent, f?.btw), centOf(f?.bruto_cent, f?.bruto))
}

/** Bedragen van een inkoopfactuur in centen (cent-velden gaan voor op euro's). */
export function inkoopCenten(f: any): RegelTotalen {
  return maakTotalen(
    centOf(f?.totaal_netto_cent, f?.totaal_netto),
    centOf(f?.totaal_btw_cent, f?.totaal_btw),
    centOf(f?.totaal_bruto_cent, f?.totaal_bruto),
  )
}

// ── Zoeken ──────────────────────────────────────────────────────────────────

/** Kleine letters, zonder accenten ("Café" vindt "cafe" en omgekeerd). */
export const normaliseerZoek = (s: unknown): string =>
  String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

export interface BedragZoek {
  /** Het bedrag in centen (zonder teken). */
  cent: number
  /** Geen decimalen getypt: "496" vindt alles van € 496,00 t/m € 496,99. */
  heel: boolean
}

/**
 * Leest een zoekopdracht als bedrag: '496,10', '496.10', '€ 496,10',
 * '1.000,00', '1,000.00', '1.000', '496'. Een scheidingsteken met precies
 * drie cijfers erachter (en geen ander scheidingsteken) is een
 * duizendtal-punt, zoals in '1.000'. Geen bedrag = null.
 */
export function leesBedragZoek(query: string): BedragZoek | null {
  let s = normaliseerZoek(query).replace(/€|\beuro?\b/g, '').replace(/\s+/g, '')
  s = s.replace(/^[-+−]/, '')
  if (!/^\d[\d.,]*$/.test(s)) return null
  const laatste = Math.max(s.lastIndexOf('.'), s.lastIndexOf(','))
  if (laatste < 0) return { cent: Number(s) * 100, heel: true }
  const teken = s[laatste]
  const ander = teken === '.' ? ',' : '.'
  const geheel = s.slice(0, laatste)
  const decimalen = s.slice(laatste + 1)
  if (decimalen.length === 0) {
    // "496," — nog aan het typen.
    const n = geheel.split(ander).join('').split(teken).join('')
    return /^\d+$/.test(n) ? { cent: Number(n) * 100, heel: true } : null
  }
  if (decimalen.length === 3 && !geheel.includes(ander)) {
    // Duizendtallen: alle groepen na de eerste moeten drie cijfers zijn.
    const groepen = s.split(teken)
    if (groepen.slice(1).every(g => g.length === 3)) return { cent: Number(groepen.join('')) * 100, heel: true }
    return null
  }
  if (decimalen.length > 2) return null
  // Decimaalteken = het laatste; het andere teken mag als duizendtal-scheiding.
  if (geheel.includes(teken)) return null
  const euros = geheel.split(ander).join('')
  if (!/^\d+$/.test(euros)) return null
  return { cent: Number(euros) * 100 + Number(decimalen.padEnd(2, '0')), heel: false }
}

/**
 * Past een rij bij de zoekopdracht? Tekst: elk woord moet ergens in de velden
 * staan (hoofdletter- en accentongevoelig). Bedrag: '496,10' vindt € 496,10
 * (ook een creditnota van − € 496,10); '496' alles van € 496,00 t/m € 496,99.
 * Eén van beide is genoeg — '2026' vindt zowel factuur 2026-0079 als € 2.026.
 * Een lege zoekopdracht past altijd.
 */
export function zoekPast(velden: readonly unknown[], bedragen: readonly unknown[], query: string): boolean {
  const q = normaliseerZoek(query).trim()
  if (!q) return true
  const bedrag = leesBedragZoek(q)
  if (bedrag) {
    for (const b of bedragen) {
      const n = Number(b)
      if (b === null || b === undefined || b === '' || !Number.isFinite(n)) continue
      const c = Math.abs(toCent(n))
      if (bedrag.heel ? Math.floor(c / 100) * 100 === bedrag.cent : c === bedrag.cent) return true
    }
  }
  const hooiberg = velden.map(normaliseerZoek).join('\u0001')
  return q.split(/\s+/).every(woord => hooiberg.includes(woord))
}

// ── Verkoop ─────────────────────────────────────────────────────────────────

export interface VerkoopFilter {
  status: FactuurStatusFilter
  /** Periode; genegeerd bij Open en Te laat. Weg = alles. */
  bereik?: Bereik | null
  zoek?: string
  /** Alleen facturen van deze klant (klantkaart, ook via het e-mailadres). */
  klantId?: number | string | null
}

export interface VerkoopFilterContext {
  klanten: any[]
  breweryDetails: any
  /** Vandaag als 'JJJJ-MM-DD' (lokale dag). */
  vandaagIso: string
}

/** Klantnaam zoals de lijst hem toont: de live klantkaart, anders de snapshot. */
export const verkoopKlantNaam = (f: any, klanten: any[]): string => {
  const live = findLiveKlant(f, klanten || [])
  return String(live?.naam || f?.klant_naam || '')
}

const isVerkoopCredit = (f: any): boolean => f?.status === 'credit' || verkoopCenten(f).bruto_cent < 0

const verkoopStatusPast = (f: any, status: FactuurStatusFilter, teLaat: Set<any>): boolean => {
  switch (status) {
    case 'open': return isVerkoopFactuurOpen(f)
    case 'te_laat': return teLaat.has(f)
    case 'betaald': return f?.status === 'betaald'
    case 'credit': return isVerkoopCredit(f)
    case 'alles':
    default: return true
  }
}

const verkoopKlantPast = (f: any, klantId: VerkoopFilter['klantId'], klanten: any[]): boolean => {
  if (klantId === null || klantId === undefined || klantId === '') return true
  const live = findLiveKlant(f, klanten || [])
  const id = live?.id ?? f?.klant_id
  return id !== null && id !== undefined && String(id) === String(klantId)
}

const verkoopZoekPast = (f: any, zoek: string | undefined, klanten: any[]): boolean => {
  if (!zoek || !zoek.trim()) return true
  const c = verkoopCenten(f)
  const regels: any[] = Array.isArray(f?.regels) ? f.regels : []
  return zoekPast(
    [f?.factuurnummer, verkoopKlantNaam(f, klanten), f?.klant_naam, f?.klant_email, f?.omschrijving,
      ...regels.map(r => r?.omschrijving)],
    [c.bruto, c.netto],
    zoek,
  )
}

/** Nieuwste eerst; bij gelijke datum het hoogste id (het laatst aangemaakte) eerst. */
const nieuwsteEerst = (a: any, b: any): number => {
  const d = String(b?.datum || '').localeCompare(String(a?.datum || ''))
  if (d !== 0) return d
  return (Number(b?.id) || 0) - (Number(a?.id) || 0)
}

const vervallenSet = (facturen: readonly any[], ctx: VerkoopFilterContext): Set<any> =>
  new Set(vervallenVerkoopFacturen(facturen as any[], ctx.klanten || [], ctx.breweryDetails, ctx.vandaagIso))

/**
 * De verkoopfacturen die bij de filter passen, nieuwste eerst.
 * - open = `isVerkoopFactuurOpen`; te_laat = `vervallenVerkoopFacturen`
 *   (beide uit utils/facturen.ts) — en bij die twee doet de periode niet mee;
 * - betaald = status `betaald`; credit = status `credit` of een negatief
 *   brutobedrag; alles = alles.
 */
export function filterVerkoopFacturen<T>(
  facturen: readonly T[] | null | undefined,
  filter: VerkoopFilter,
  ctx: VerkoopFilterContext,
): T[] {
  const lijst = (facturen || []).filter(Boolean) as T[]
  const teLaat = filter.status === 'te_laat' ? vervallenSet(lijst, ctx) : new Set<any>()
  const bereik = periodeGeldtVoorStatus(filter.status) ? (filter.bereik || OPEN_BEREIK) : OPEN_BEREIK
  return lijst
    .filter((f: any) => verkoopStatusPast(f, filter.status, teLaat)
      && inBereik(f?.datum, bereik)
      && verkoopKlantPast(f, filter.klantId, ctx.klanten)
      && verkoopZoekPast(f, filter.zoek, ctx.klanten))
    .sort(nieuwsteEerst)
}

/**
 * Aantal per status bij de overige filters (zoeken, klant, periode), voor de
 * cijfers op de chips. Open en Te laat tellen buiten de periode om, net als
 * de lijst zelf.
 */
export function telVerkoopStatussen(
  facturen: readonly any[] | null | undefined,
  filter: Omit<VerkoopFilter, 'status'>,
  ctx: VerkoopFilterContext,
): Record<FactuurStatusFilter, number> {
  const lijst = (facturen || []).filter(Boolean)
  const teLaat = vervallenSet(lijst, ctx)
  const bereik = filter.bereik || OPEN_BEREIK
  const uit: Record<FactuurStatusFilter, number> = { open: 0, te_laat: 0, betaald: 0, credit: 0, alles: 0 }
  for (const f of lijst) {
    if (!verkoopKlantPast(f, filter.klantId, ctx.klanten) || !verkoopZoekPast(f, filter.zoek, ctx.klanten)) continue
    const inPeriode = inBereik(f?.datum, bereik)
    for (const s of FACTUUR_STATUS_FILTERS) {
      if ((!periodeGeldtVoorStatus(s.id) || inPeriode) && verkoopStatusPast(f, s.id, teLaat)) uit[s.id]++
    }
  }
  return uit
}

// ── Inkoop ──────────────────────────────────────────────────────────────────

export interface InkoopFilter {
  /** `te_verwerken` (het postvak) geeft hier een lege lijst: dat zijn geen facturen. */
  status: InkoopStatusFilter
  /** Periode; genegeerd bij Open, Te laat en Te verwerken. Weg = alles. */
  bereik?: Bereik | null
  zoek?: string
  /** Alleen facturen van deze leverancier (naam, hoofdletter-/accentongevoelig). */
  leverancier?: string | null
}

export interface InkoopFilterContext {
  /** Vandaag als 'JJJJ-MM-DD' (lokale dag). */
  vandaagIso: string
}

const isInkoopCredit = (f: any): boolean => inkoopCenten(f).bruto_cent < 0

const inkoopStatusPast = (f: any, status: InkoopStatusFilter, open: Set<any>, teLaat: Set<any>): boolean => {
  switch (status) {
    case 'te_verwerken': return false
    case 'open': return open.has(f)
    case 'te_laat': return teLaat.has(f)
    case 'betaald': return f?.status === 'betaald'
    case 'credit': return isInkoopCredit(f)
    case 'alles':
    default: return true
  }
}

export const zelfdeLeverancier = (a: unknown, b: unknown): boolean =>
  normaliseerZoek(a).trim() === normaliseerZoek(b).trim()

const inkoopLeverancierPast = (f: any, leverancier: string | null | undefined): boolean =>
  !leverancier || !leverancier.trim() || zelfdeLeverancier(f?.leverancier, leverancier)

const inkoopZoekPast = (f: any, zoek: string | undefined): boolean => {
  if (!zoek || !zoek.trim()) return true
  const c = inkoopCenten(f)
  const regels: any[] = Array.isArray(f?.regels) ? f.regels : []
  return zoekPast(
    [f?.factuurnummer, f?.leverancier, f?.omschrijving, ...regels.flatMap(r => [r?.naam, r?.artikelcode])],
    [c.bruto, c.netto],
    zoek,
  )
}

/**
 * De inkoopfacturen die bij de filter passen, nieuwste eerst.
 * - open = `openInkoopFacturen` (niet betaald); te_laat =
 *   `achterstalligeInkoopFacturen` (onbetaald en ouder dan
 *   INKOOP_ACHTERSTALLIG_DAGEN) — en bij die twee doet de periode niet mee;
 * - betaald = status `betaald`; credit = negatief brutobedrag; alles = alles.
 * Het postvak (Te verwerken) zijn geen facturen: die status geeft hier een
 * lege lijst; de items zelf komen uit utils/inkoopInbox.ts (`inboxOpen`).
 */
export function filterInkoopFacturen<T>(
  facturen: readonly T[] | null | undefined,
  filter: InkoopFilter,
  ctx: InkoopFilterContext,
): T[] {
  const lijst = (facturen || []).filter(Boolean) as T[]
  const open = filter.status === 'open' ? new Set<any>(openInkoopFacturen(lijst as any[])) : new Set<any>()
  const teLaat = filter.status === 'te_laat' ? new Set<any>(achterstalligeInkoopFacturen(lijst as any[], ctx.vandaagIso)) : new Set<any>()
  const bereik = periodeGeldtVoorStatus(filter.status) ? (filter.bereik || OPEN_BEREIK) : OPEN_BEREIK
  return lijst
    .filter((f: any) => inkoopStatusPast(f, filter.status, open, teLaat)
      && inBereik(f?.datum, bereik)
      && inkoopLeverancierPast(f, filter.leverancier)
      && inkoopZoekPast(f, filter.zoek))
    .sort(nieuwsteEerst)
}

/**
 * Aantal per status bij de overige filters, voor de chips. `inbox` (de key
 * `inkoop_inbox`) vult Te verwerken: de items die nog op een mens wachten
 * (`telInboxOpen`) — zonder lijst 0.
 */
export function telInkoopStatussen(
  facturen: readonly any[] | null | undefined,
  filter: Omit<InkoopFilter, 'status'>,
  ctx: InkoopFilterContext,
  inbox?: unknown,
): Record<InkoopStatusFilter, number> {
  const lijst = (facturen || []).filter(Boolean)
  const open = new Set<any>(openInkoopFacturen(lijst))
  const teLaat = new Set<any>(achterstalligeInkoopFacturen(lijst, ctx.vandaagIso))
  const bereik = filter.bereik || OPEN_BEREIK
  const uit: Record<InkoopStatusFilter, number> = {
    open: 0, te_laat: 0, betaald: 0, credit: 0, alles: 0, te_verwerken: inbox ? telInboxOpen(inbox) : 0,
  }
  for (const f of lijst) {
    if (!inkoopLeverancierPast(f, filter.leverancier) || !inkoopZoekPast(f, filter.zoek)) continue
    const inPeriode = inBereik(f?.datum, bereik)
    for (const s of FACTUUR_STATUS_FILTERS) {
      if ((!periodeGeldtVoorStatus(s.id) || inPeriode) && inkoopStatusPast(f, s.id, open, teLaat)) uit[s.id]++
    }
  }
  return uit
}

// ── Totaalregel ─────────────────────────────────────────────────────────────

export interface LijstTotalen extends RegelTotalen {
  aantal: number
  /** Hoeveel van de getoonde facturen te laat zijn (alleen met context). */
  te_laat_aantal: number
  te_laat_bruto_cent: number
  te_laat_bruto: number
}

const somTotalen = (lijst: readonly any[], centen: (f: any) => RegelTotalen, teLaat: Set<any>): LijstTotalen => {
  let n = 0, b = 0, br = 0, laatN = 0, laatCent = 0
  for (const f of lijst) {
    const c = centen(f)
    n += c.netto_cent
    b += c.btw_cent
    br += c.bruto_cent
    if (teLaat.has(f)) { laatN++; laatCent += c.bruto_cent }
  }
  return {
    ...maakTotalen(n, b, br),
    aantal: lijst.length,
    te_laat_aantal: laatN,
    te_laat_bruto_cent: laatCent,
    te_laat_bruto: centNaarEuro(laatCent),
  }
}

/**
 * De totaalregel van de getoonde verkoopfacturen, in centen opgeteld ("de
 * totaalregel rekent altijd met wat je ziet"). Met context zegt hij ook
 * hoeveel daarvan te laat is — met dezelfde selectie als de badge.
 */
export function verkoopTotalen(
  getoond: readonly any[] | null | undefined,
  ctx?: VerkoopFilterContext,
): LijstTotalen {
  const lijst = (getoond || []).filter(Boolean)
  const teLaat = ctx ? vervallenSet(lijst, ctx) : new Set<any>()
  return somTotalen(lijst, verkoopCenten, teLaat)
}

/** De totaalregel van de getoonde inkoopfacturen (te laat = achterstallig). */
export function inkoopTotalen(
  getoond: readonly any[] | null | undefined,
  ctx?: InkoopFilterContext,
): LijstTotalen {
  const lijst = (getoond || []).filter(Boolean)
  const teLaat = ctx ? new Set<any>(achterstalligeInkoopFacturen(lijst, ctx.vandaagIso)) : new Set<any>()
  return somTotalen(lijst, inkoopCenten, teLaat)
}
