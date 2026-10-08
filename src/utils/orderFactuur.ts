// ── De verkoopfactuur van een bestelling ────────────────────────────────────
// Eén opbouw voor de factuur bij een bestelling: bij het afronden
// (Bestellingen), vooraf zodra een webshoporder betaald is (Bestellingen, of
// Bank bij een PSP-uitbetaling waarin de factuur nog ontbreekt), en de
// creditnota als een gefactureerde bestelling toch geannuleerd wordt.
//
// Waarom vooraf: een afhaalorder wordt pas afgerond als de klant hem ophaalt.
// Komt hij niet, dan blijft de order open — en zonder factuur valt de
// Mollie-uitbetaling waarin hij al zit niet uit te splitsen. De factuur hoort
// bij de verkoop en de betaling, niet bij het ophalen. Afronden maakt daarna
// geen tweede factuur, en de orderregels liggen vanaf dan vast.
//
// Puur en zonder React; nummer, datum en id geeft de aanroeper mee.

import { regelBedrag, heeftAutoritair } from './orderRegel'
import { statiegeldFactuurRegels, type StatiegeldSoort, type StatiegeldVerpakking } from './statiegeld'
import { totaliseerRegels, toCent, centNaarEuro } from './centen'
import { resolveKlantSnapshot } from './klant'
import { orderIsGefactureerd } from './facturen'
import { wcOrderAfgebroken } from './wcOrderImport'
import type { VerslagKoppeling } from './pspVerslag'

const rnd2 = (n: number): number => Math.round(n * 100) / 100

/** Netto en BTW per tarief, in de volgorde waarin de tarieven voorkomen. */
export function btwOverzicht(regels: readonly any[]): { tarief: number, netto: number, btw: number }[] {
  const tarieven = [...new Set((regels || []).map((r: any) => Number(r?.btw_pct || 0)))]
  return tarieven.map(tarief => {
    const rv = regels.filter((r: any) => Number(r?.btw_pct || 0) === tarief)
    return {
      tarief,
      netto: rnd2(rv.reduce((s: number, r: any) => s + Number(r?.netto || 0), 0)),
      btw: rnd2(rv.reduce((s: number, r: any) => s + Number(r?.btw_bedrag || 0), 0)),
    }
  })
}

/**
 * De factuurregels van een bestelling: één per orderregel (de bedragen van
 * WooCommerce blijven leidend, zie utils/orderRegel.ts) plus statiegeld bij
 * een handmatige order (utils/statiegeld.ts).
 */
export function orderFactuurRegels(
  order: any,
  verpakkingen: readonly StatiegeldVerpakking[] | null | undefined,
  statiegeldOmschrijving: (soort: StatiegeldSoort, vp: StatiegeldVerpakking) => string,
): any[] {
  const regels: any[] = (Array.isArray(order?.regels) ? order.regels : []).map((r: any) => {
    const b = regelBedrag(r)
    return {
      omschrijving: r.omschrijving || `${r.bier_naam} – ${r.verpakking_type}`,
      hoeveelheid: Number(r.aantal || 0),
      prijs_per_stuk: Number(r.prijs_per_stuk || 0),
      btw_pct: Number(r.btw_pct || 0),
      netto: b.netto,
      btw_bedrag: b.btw,
      bruto: b.bruto,
      ...(heeftAutoritair(r) ? { wc_netto: Number(r.wc_netto), wc_btw: Number(r.wc_btw) } : {}),
    }
  })
  regels.push(...statiegeldFactuurRegels(order, [...(verpakkingen || [])], statiegeldOmschrijving))
  return regels
}

export interface OrderFactuurOpties {
  id: number
  /** Het factuurnummer (server-reeks `factuur`, `volgendFactuurNummer`). */
  nummer: string
  /** Factuurdatum 'JJJJ-MM-DD'. */
  datum: string
  klanten?: readonly any[] | null
  verpakkingen?: readonly StatiegeldVerpakking[] | null
  statiegeldOmschrijving: (soort: StatiegeldSoort, vp: StatiegeldVerpakking) => string
}

/**
 * De verkoopfactuur van een bestelling. Klantgegevens uit de live klantkaart;
 * de betaaldatum en -methode uit WooCommerce gaan mee (de PSP-uitbetaling
 * zoekt op wanneer er betaald is). Betaald in de webshop = betaald hier: een
 * webshoporder vraagt niet nog eens om een overboeking.
 */
export function bouwOrderFactuur(order: any, o: OrderFactuurOpties): any {
  const regels = orderFactuurRegels(order, o.verpakkingen, o.statiegeldOmschrijving)
  const tot = totaliseerRegels(regels)
  const snap = resolveKlantSnapshot(order, [...(o.klanten || [])]) || {}
  return {
    id: o.id,
    datum: o.datum,
    factuurnummer: o.nummer,
    bestelling_id: order.id,
    order_datum: order.datum || o.datum,
    ...(order.wc_betaald_datum ? { wc_betaald_datum: order.wc_betaald_datum } : {}),
    ...(order.wc_betaal_methode ? { wc_betaal_methode: order.wc_betaal_methode } : {}),
    klant_id: snap.klant_id ?? null,
    klant_naam: snap.klant_naam || '',
    klant_bedrijf: snap.klant_bedrijf || '',
    klant_email: snap.klant_email || '',
    klant_straat: snap.klant_straat || '',
    klant_huisnummer: snap.klant_huisnummer || '',
    klant_postcode: snap.klant_postcode || '',
    klant_stad: snap.klant_stad || '',
    klant_btw_nummer: snap.klant_btw_nummer || '',
    klant_adres: [snap.klant_straat, snap.klant_huisnummer, snap.klant_postcode, snap.klant_stad].filter(Boolean).join(' '),
    regels,
    btw_overzicht: btwOverzicht(regels),
    netto: tot.netto,
    btw: tot.btw,
    bruto: tot.bruto,
    netto_cent: tot.netto_cent,
    btw_cent: tot.btw_cent,
    bruto_cent: tot.bruto_cent,
    status: order.wc_betaald ? 'betaald' : 'open',
    ...(order.wc_betaald ? { betaald_datum: order.wc_betaald_datum || o.datum } : {}),
    definitief: true,
  }
}

/** Waarom een bestelling niet vooraf gefactureerd kan worden. */
export type VoorafBlokkade = 'status' | 'al_gefactureerd' | 'afgebroken' | 'niet_betaald' | 'geen_regels'

/**
 * Kan deze bestelling nu al gefactureerd worden (null), of waarom niet? Het
 * kan als hij in de webshop betaald is, daar niet geannuleerd of terugbetaald
 * is, nog geen factuur heeft, niet geannuleerd is en regels heeft. Gepickt
 * hoeft niet: de factuur volgt de verkoop, niet het picken. Een order die niet
 * vooraf betaald is krijgt zijn factuur gewoon bij het afronden.
 */
export function voorafFactuurBlokkade(order: any, verkoopFacturen: readonly any[] | null | undefined): VoorafBlokkade | null {
  if (!order || order.status === 'geannuleerd') return 'status'
  if (orderIsGefactureerd(order, verkoopFacturen)) return 'al_gefactureerd'
  if (wcOrderAfgebroken(order)) return 'afgebroken'
  if (!order.wc_betaald) return 'niet_betaald'
  if (!(Array.isArray(order.regels) && order.regels.length)) return 'geen_regels'
  return null
}

/** i18n-sleutel bij een `VoorafBlokkade`. */
export const voorafBlokkadeSleutel = (b: VoorafBlokkade): string => `order_vooraf_blokkade_${b}`

const zelfdeId = (a: unknown, b: unknown): boolean => a != null && b != null && String(a) === String(b)

/** Is er een creditnota die naar deze factuur verwijst? */
export const factuurIsGecrediteerd = (factuur: any, verkoopFacturen: readonly any[] | null | undefined): boolean =>
  !!factuur && (verkoopFacturen || []).some((c: any) => c?.status === 'credit' && zelfdeId(c.credit_van_factuur_id, factuur.id))

/**
 * De verkoopfactuur van een bestelling: via `factuur_id` op de order, anders
 * de factuur met dit `bestelling_id` die zelf geen creditnota is en niet
 * gecrediteerd. Geen factuur = null.
 */
export function orderFactuurVan(order: any, verkoopFacturen: readonly any[] | null | undefined): any | null {
  if (!order) return null
  const lijst = (verkoopFacturen || []).filter((f: any) => f && typeof f === 'object')
  if (order.factuur_id != null) {
    const f = lijst.find((x: any) => zelfdeId(x.id, order.factuur_id))
    if (f) return f
  }
  return lijst.find((f: any) => zelfdeId(f.bestelling_id, order.id) && f.status !== 'credit' && !factuurIsGecrediteerd(f, lijst)) || null
}

const centVan = (cent: unknown, euro: unknown): number =>
  cent !== null && cent !== undefined && cent !== '' && Number.isFinite(Number(cent)) ? Math.round(Number(cent)) : toCent(euro)

/**
 * De creditnota die een factuur helemaal tenietdoet: dezelfde regels en
 * BTW-uitsplitsing met het omgekeerde teken, status `credit`, met
 * `credit_van_factuur_id` en `bestelling_id` (de terugstorting in een
 * PSP-uitbetaling vindt hem daarop, zie utils/pspVerslag.ts). De totalen zijn
 * precies min die van de factuur.
 */
export function bouwCreditnota(factuur: any, o: { id: number, nummer: string, datum: string }): any {
  const min = (v: unknown): number => rnd2(-Number(v || 0))
  const regels = (Array.isArray(factuur?.regels) ? factuur.regels : []).map((r: any) => {
    const { wc_netto, wc_btw, ...rest } = r || {}
    return {
      ...rest,
      hoeveelheid: -Number(r?.hoeveelheid || 0),
      netto: min(r?.netto),
      btw_bedrag: min(r?.btw_bedrag),
      bruto: min(r?.bruto),
      ...(wc_netto != null ? { wc_netto: min(wc_netto) } : {}),
      ...(wc_btw != null ? { wc_btw: min(wc_btw) } : {}),
    }
  })
  const nettoCent = -centVan(factuur?.netto_cent, factuur?.netto)
  const btwCent = -centVan(factuur?.btw_cent, factuur?.btw)
  const brutoCent = -centVan(factuur?.bruto_cent, factuur?.bruto)
  const overzicht = Array.isArray(factuur?.btw_overzicht) && factuur.btw_overzicht.length
    ? factuur.btw_overzicht.map((x: any) => ({ tarief: Number(x?.tarief || 0), netto: min(x?.netto), btw: min(x?.btw) }))
    : btwOverzicht(regels)
  const klant = Object.fromEntries(Object.entries(factuur || {}).filter(([k]) => k.startsWith('klant_')))
  return {
    id: o.id,
    datum: o.datum,
    factuurnummer: o.nummer,
    ...klant,
    ...(factuur?.bestelling_id != null ? { bestelling_id: factuur.bestelling_id } : {}),
    credit_van_factuur_id: factuur?.id ?? null,
    regels,
    btw_overzicht: overzicht,
    netto: centNaarEuro(nettoCent),
    btw: centNaarEuro(btwCent),
    bruto: centNaarEuro(brutoCent),
    netto_cent: nettoCent,
    btw_cent: btwCent,
    bruto_cent: brutoCent,
    status: 'credit',
    definitief: true,
  }
}

export interface TeFactureren {
  bestellingId: number
  /** null = kan nu gefactureerd worden. */
  blokkade: VoorafBlokkade | null
}

/**
 * De bestellingen uit een uitbetalingsverslag waar nog geen factuur voor is
 * (uitkomst `geen_factuur`), elk met de reden als hij nu niet vooraf
 * gefactureerd kan worden. Bank biedt daarvoor "Factuur maken" aan.
 */
export function teFacturerenUitVerslag(
  koppeling: Pick<VerslagKoppeling, 'matches'> | null | undefined,
  bestellingen: readonly any[] | null | undefined,
  verkoopFacturen: readonly any[] | null | undefined,
): TeFactureren[] {
  const ids: number[] = []
  for (const m of koppeling?.matches || []) {
    if (m.uitkomst !== 'geen_factuur' || m.bestellingId === undefined || ids.includes(m.bestellingId)) continue
    ids.push(m.bestellingId)
  }
  return ids.map(id => {
    const b = (bestellingen || []).find((x: any) => zelfdeId(x?.id, id))
    return { bestellingId: id, blokkade: b ? voorafFactuurBlokkade(b, verkoopFacturen) : 'status' }
  })
}
