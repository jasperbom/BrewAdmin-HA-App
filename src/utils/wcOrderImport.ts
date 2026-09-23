/**
 * wcOrderImport.ts — de WooCommerce-orderimport als herbruikbare logica.
 *
 * Tot nu toe zat de import volledig in de knop op de bestellingenpagina. Nu
 * de app ook periodiek importeert (App.tsx, zolang een tabblad open staat)
 * moet dezelfde import op twee plekken draaien — vandaar hier, zonder React.
 *
 *  - `haalWcOrders`      — alle pagina's ophalen (fout op pagina > 1 = klaar)
 *  - `wcOrderNaarBestelling` / `wcOrderUpdate` — één order omzetten resp. de
 *                          betaal-/leveringsvelden van een bekende order verversen
 *  - `importeerWcOrders` — het geheel: geeft `{nieuw, updates, onbekendeRegels}`
 *  - `pasImportToe`      — het resultaat in de bestellingenlijst verwerken; laat
 *                          een order vallen die intussen al bestaat (twee tabs)
 *  - `importAuditRegels` / `importMelding` — logboek en schermtekst
 *  - `telNieuweWebshopOrders` / `importLeaseVrij` — voor de automatische import:
 *                          hoeveel orders meldt de server die hier nog niet zijn,
 *                          en mag dít tabblad nu importeren (lease)
 *
 * De mapping van orderregels (`mapWcOrderRegels`), betaalstatus en levering
 * blijft in utils/wcImport.ts resp. utils/levering.ts.
 */
import { newId } from './api'
import { tod } from './format'
import { findKlantVoorOrder } from './klant'
import { wcAdres } from './adres'
import {
  WcRefs, WC_IMPORT_STATUSSEN_DEFAULT, wcOrdersPad, mapWcOrderRegels,
  wcBetaalVelden, betaalVeldenGewijzigd, BETAAL_KEYS,
} from './wcImport'
import { wcLeveringVelden, leveringVeldenGewijzigd, leveringOmschrijving, LEVERING_KEYS, leesWcPaginas, WcPaginas, WcLinkContext } from './levering'

// Maximaal 10 pagina's van 100 orders per import; genoeg voor een eerste
// volledige haal en tegelijk een rem op een winkel met jaren historie.
export const WC_PER_PAGE = 100
export const WC_MAX_PAGINAS = 10

/** Zo lang houdt een tabblad de import-lease vast (ruim boven een import). */
export const WC_IMPORT_LEASE_MS = 2 * 60_000

export type WcGet = (pad: string) => Promise<any>
type Vertaal = (key: string) => string

export interface WcImportInstellingen {
  storeUrl?: string
  importStatussen?: string[]
  importVanaf?: string
}

export interface WcImportInvoer {
  wcGet: WcGet
  refs: WcRefs
  bestellingen: any[]
  klanten: any[]
  wcCreds: WcImportInstellingen | null | undefined
  t: Vertaal
  /** Vandaag (yyyy-mm-dd), voor een order zonder aanmaakdatum. */
  vandaag?: string
}

export interface WcImportResultaat {
  nieuw: any[]
  /** Per bestaande bestelling (BrewAdmin-id) de gewijzigde velden. */
  updates: Record<number, any>
  onbekendeRegels: number
}

/** Statussen en vanaf-datum zoals ingesteld, met de standaard als terugval. */
export function wcImportSelectie(wcCreds: WcImportInstellingen | null | undefined): {statussen: string[], vanaf: string} {
  const statussen = Array.isArray(wcCreds?.importStatussen) && wcCreds!.importStatussen!.length
    ? wcCreds!.importStatussen! : WC_IMPORT_STATUSSEN_DEFAULT
  return {statussen, vanaf: String(wcCreds?.importVanaf || '')}
}

/**
 * Alle orders ophalen, pagina voor pagina, tot de winkel niets nieuws meer
 * teruggeeft. Precies een veelvoud van 100 orders: WooCommerce antwoordt op de
 * pagina daarna met een fout i.p.v. een lege lijst. Wat we al binnen hebben
 * blijft dan geldig; alleen een fout op pagina 1 is een échte importfout.
 */
export async function haalWcOrders(wcGet: WcGet, opts: {statussen: string[], vanaf: string}): Promise<any[]> {
  const orders: any[] = []
  for (let page = 1; page <= WC_MAX_PAGINAS; page++) {
    let pagina: any
    try {
      pagina = await wcGet(wcOrdersPad({statussen: opts.statussen, vanaf: opts.vanaf, page, perPage: WC_PER_PAGE}))
    } catch (e) {
      if (page === 1) throw e
      break
    }
    if (!Array.isArray(pagina) || pagina.length === 0) break
    orders.push(...pagina)
    if (pagina.length < WC_PER_PAGE) break
  }
  return orders
}

// BTW-nummer alléén uit échte BTW-nummervelden (bijv. _billing_vat_number,
// billing_eu_vat_number, btw_nummer). WooCommerce zet op elke order standaard
// meta zoals `is_vat_exempt: "no"` — een generieke /vat|btw/-match pakte die
// key, waardoor élke import onterecht als zakelijk werd gemarkeerd. De waarde
// moet bovendien op een BTW-nummer lijken (bevat cijfers, geen ja/nee-vlag).
export function wcBtwNummer(order: any): string {
  const vatMeta = (Array.isArray(order?.meta_data) ? order.meta_data : []).find((m: any) =>
    /(vat|btw)[_-]?(number|nummer|nr|id)\b/i.test(String(m?.key || '')))
  const vatRaw = String(order?.billing?.vat_number || vatMeta?.value || '').trim()
  return /\d/.test(vatRaw) && !/^(yes|no|true|false|0|1)$/i.test(vatRaw) ? vatRaw : ''
}

/**
 * De pagina-ID's en endpoint-slugs van de winkel, voor de bestellink per
 * order (utils/levering → bestelPaginaLink). `settings/advanced` vraagt
 * beheerrechten op de API-sleutel; lukt het niet, dan `null` en valt de
 * link terug op de payment_url van de order. Nooit een reden om de
 * orderimport te laten mislukken.
 */
export async function haalWcPaginas(wcGet: WcGet): Promise<WcPaginas | null> {
  try {
    const p = leesWcPaginas(await wcGet('settings/advanced'))
    return Object.keys(p).length ? p : null
  } catch {
    return null
  }
}

/** Eén WooCommerce-order → een nieuwe BrewAdmin-bestelling (status `nieuw`). */
export function wcOrderNaarBestelling(
  o: any, refs: WcRefs, bestaand: any[], klanten: any[], t: Vertaal, vandaag: string = tod(), link: WcLinkContext = {},
): any {
  // Productregels + verzendkosten + toeslagen, met autoritatieve
  // WooCommerce-bedragen. Zie utils/wcImport.ts.
  const regels = mapWcOrderRegels(o, refs)
  const company = String(o?.billing?.company || '').trim()
  const klantType: 'prive' | 'zakelijk' = (company || wcBtwNummer(o)) ? 'zakelijk' : 'prive'
  // Straat en huisnummer apart (utils/adres.ts): WooCommerce heeft één
  // adresregel, een NL-checkoutplugin losse velden.
  const adres = wcAdres(o)
  const nb: any = {
    id: newId(bestaand),
    status: 'nieuw',
    datum: String(o?.date_created || vandaag).slice(0, 10),
    // Of de klant al betaald heeft, wanneer en waarmee (zie
    // utils/wcImport → wcBetaalStatus). De betaaldatum is de dag die de
    // PSP uitbetaalt — niet de dag waarop jij de order afrondt en de
    // factuur maakt; de bankkoppeling zoekt daarop.
    ...wcBetaalVelden(o),
    // Afhalen of verzenden, afhaallocatie/-moment, de order_key voor de
    // afhaalpagina van de klant en de link naar de bestelling in de
    // webshop (utils/levering.ts).
    ...wcLeveringVelden(o, link),
    klant_naam: `${o?.billing?.first_name || ''} ${o?.billing?.last_name || ''}`.trim() || t('lbl_onbekend'),
    klant_email: o?.billing?.email || '',
    klant_straat: adres.straat,
    klant_huisnummer: adres.huisnummer,
    klant_postcode: o?.billing?.postcode || '',
    klant_stad: o?.billing?.city || '',
    klant_bedrijf: company,
    klant_type: klantType,
    regels,
    wc_order_id: o?.id,
    wc_order_nummer: String(o?.number || o?.id),
  }
  // Koppel direct aan een bestaande klantkaart (e-mail, of uniek op naam)
  // zodat de order niet eerst als "ongekoppeld" binnenkomt.
  const klant = findKlantVoorOrder(nb, klanten)
  if (klant) nb.klant_id = klant.id
  return nb
}

/**
 * Adres van een order die vóór v1.12.79 binnenkwam: toen ging `address_1`
 * ongesplitst naar de straat en bleef het huisnummer leeg — bij een
 * checkoutplugin met een los huisnummerveld viel het nummer zo helemaal weg.
 * Alleen zolang de straat nog precies die ruwe regel is en er geen huisnummer
 * staat; een adres dat iemand zelf heeft aangepast blijft staan.
 */
function adresHerstel(bestaand: any, o: any): Record<string, string> | null {
  if (String(bestaand?.klant_huisnummer || '').trim()) return null
  const ruw = String(o?.billing?.address_1 ?? '').replace(/\s+/g, ' ').trim()
  if (String(bestaand?.klant_straat ?? '').replace(/\s+/g, ' ').trim() !== ruw) return null
  const adres = wcAdres(o)
  if (!adres.huisnummer) return null
  return {klant_straat: adres.straat, klant_huisnummer: adres.huisnummer}
}

/**
 * Betaalstatus en levering van een order die we al hebben. Een webshoporder
 * komt vaak binnen als `pending` (iDEAL nog niet afgerond) en is een uur later
 * betaald; zonder deze verversing bleef de app voor altijd denken dat er nog
 * geld moest komen — en zei de factuurmail dat ook. Het afhaalmoment kiest (of
 * verzet) de klant vaak pas ná het bestellen, dus dat gaat op dezelfde manier.
 * Geeft `null` als er niets veranderd is.
 */
export function wcOrderUpdate(bestaand: any, o: any, link: WcLinkContext = {}): Record<string, any> | null {
  const velden = wcBetaalVelden(o)
  const levering = wcLeveringVelden(o, link)
  // Een veld dat in de winkel verdwenen is (afhaallocatie na een wissel naar
  // bezorgen, betaaldatum na een terugboeking) moet hier ook weg — anders
  // blijft de order elke ronde opnieuw als "gewijzigd" gelden.
  const leeg = (keys: string[]) => Object.fromEntries(keys.map(k => [k, null]))
  const upd = {
    ...(betaalVeldenGewijzigd(bestaand, velden) ? {...leeg(BETAAL_KEYS), ...velden} : {}),
    ...(leveringVeldenGewijzigd(bestaand, levering) ? {...leeg(LEVERING_KEYS), ...levering} : {}),
    ...(adresHerstel(bestaand, o) || {}),
  }
  return Object.keys(upd).length ? upd : null
}

/** De hele import: ophalen, nieuwe orders omzetten, bekende orders verversen. */
export async function importeerWcOrders(invoer: WcImportInvoer): Promise<WcImportResultaat> {
  const orders = await haalWcOrders(invoer.wcGet, wcImportSelectie(invoer.wcCreds))
  // De winkelpagina's voor de bestellink per order; één klein verzoek per
  // import, en bij een bestaande order alleen een update als de link wijzigt.
  const link: WcLinkContext = {storeUrl: invoer.wcCreds?.storeUrl || '', paginas: orders.length ? await haalWcPaginas(invoer.wcGet) : null}
  const bestellingen = invoer.bestellingen || []
  const opWcId = new Map<any, any>()
  for (const b of bestellingen) if (b?.wc_order_id != null) opWcId.set(b.wc_order_id, b)
  const nieuw: any[] = []
  const updates: Record<number, any> = {}
  let onbekendeRegels = 0
  for (const o of orders) {
    const bestaand = opWcId.get(o?.id)
    if (bestaand) {
      const upd = wcOrderUpdate(bestaand, o, link)
      if (upd) updates[bestaand.id] = upd
      continue
    }
    if (o?.id != null && nieuw.some(n => n.wc_order_id === o.id)) continue
    const nb = wcOrderNaarBestelling(o, invoer.refs, [...bestellingen, ...nieuw], invoer.klanten || [], invoer.t, invoer.vandaag, link)
    onbekendeRegels += (nb.regels || []).filter((r: any) => r.wc_onbekend).length
    nieuw.push(nb)
  }
  return {nieuw, updates, onbekendeRegels}
}

/**
 * Het resultaat in de bestellingenlijst verwerken. Een nieuwe order waarvan
 * de `wc_order_id` intussen al in de lijst zit (een ander tabblad was eerder)
 * gaat niet nog een keer mee.
 */
export function pasImportToe(prev: any[], r: WcImportResultaat): any[] {
  const lijst = prev || []
  const bekend = new Set(lijst.map((b: any) => b?.wc_order_id).filter((id: any) => id != null))
  return [
    ...lijst.map((b: any) => r.updates[b.id] ? {...b, ...r.updates[b.id]} : b),
    ...r.nieuw.filter(n => !bekend.has(n.wc_order_id)),
  ]
}

export interface ImportAuditRegel {
  entiteit_id: number
  actie: 'aangemaakt' | 'gewijzigd'
  omschrijving: string
}

export function importAuditRegels(r: WcImportResultaat): ImportAuditRegel[] {
  const uit: ImportAuditRegel[] = r.nieuw.map(o => ({
    entiteit_id: o.id, actie: 'aangemaakt', omschrijving: `WC import — ${o.klant_naam || 'onbekend'}`,
  }))
  for (const id of Object.keys(r.updates)) {
    const upd = r.updates[Number(id)]
    const delen = [
      'wc_betaald' in upd ? `betaalstatus ${upd.wc_betaald ? 'betaald' : 'open'}` : '',
      'wc_levering' in upd ? `levering ${leveringOmschrijving(upd)}` : '',
      'klant_huisnummer' in upd ? `adres ${upd.klant_straat} ${upd.klant_huisnummer}` : '',
    ].filter(Boolean)
    uit.push({entiteit_id: Number(id), actie: 'gewijzigd', omschrijving: `WC bijgewerkt — ${delen.join(' · ')}`})
  }
  return uit
}

/** Schermtekst na een import; niet-herkende regels en verversingen erbij. */
export function importMelding(r: WcImportResultaat, t: Vertaal): string {
  const bijgewerkt = Object.keys(r.updates).length
  const melding = t('msg_wc_orders_imported').replace('{n}', String(r.nieuw.length))
  // Niet-herkende regels expliciet melden: die komen als vrije regel binnen
  // (geen picking) en horen gecontroleerd te worden.
  const delen = [
    r.onbekendeRegels > 0 ? t('msg_wc_regels_onbekend').replace('{n}', String(r.onbekendeRegels)) : '',
    bijgewerkt > 0 ? t('msg_wc_betaalstatus_bijgewerkt').replace('{n}', String(bijgewerkt)) : '',
  ].filter(Boolean)
  return delen.length ? `${melding} — ${delen.join(' · ')}` : melding
}

// ── Automatische import ─────────────────────────────────────────────────────

/** De stand die de server (`wc_import_status`) en de tabbladen delen. */
export interface WcImportStatus {
  nieuw?: Array<{id: number, nummer?: string, naam?: string, totaal?: string, valuta?: string, datum?: string}>
  gemeld_ids?: number[]
  laatste_check?: string
  laatste_fout?: string | null
  bezig_tot?: number | null
  door?: string | null
  laatste_import?: string
  laatste_import_door?: string
  laatste_import_aantal?: number
}

/** Hoeveel webshoporders de server meldt die hier nog niet als bestelling staan. */
export function telNieuweWebshopOrders(status: WcImportStatus | null | undefined, bestellingen: any[]): number {
  const nieuw = Array.isArray(status?.nieuw) ? status!.nieuw! : []
  if (!nieuw.length) return 0
  const bekend = new Set((bestellingen || []).map((b: any) => b?.wc_order_id).filter((id: any) => id != null))
  return nieuw.filter(o => o && o.id != null && !bekend.has(o.id)).length
}

/**
 * Mag dit tabblad nu importeren? Niet zolang een ánder tabblad de lease
 * vasthoudt, en niet als er korter dan het interval geleden al geïmporteerd is
 * (op een minuut speling na, zodat twee tabbladen met dezelfde klok elkaar
 * niet allebei overslaan). Een eigen lease telt niet als blokkade.
 */
export function importLeaseVrij(status: WcImportStatus | null | undefined, nu: number, tabId: string, intervalMin: number): boolean {
  const bezigTot = Number(status?.bezig_tot) || 0
  if (bezigTot > nu && status?.door && status.door !== tabId) return false
  const laatste = status?.laatste_import ? new Date(status.laatste_import).getTime() : 0
  if (Number.isFinite(laatste) && laatste > 0 && intervalMin > 0) {
    const grens = Math.max(0, intervalMin - 1) * 60_000
    if (nu - laatste < grens) return false
  }
  return true
}

/**
 * Vangnet tegen dubbele webshoporders (twee tabbladen die precies tegelijk
 * importeerden vóór de lease van de ander zichtbaar was). Van twee
 * bestellingen met dezelfde `wc_order_id` blijft de oudste (laagste id)
 * staan; een dubbel vervalt alleen zolang er nog niets mee gedaan is —
 * status `nieuw`, geen picks, geen factuur — want anders zou er voorraad of
 * een factuur aan een verdwenen order hangen. Geeft `null` als er niets te
 * schonen valt.
 */
export function verwijderDubbeleWcOrders(bestellingen: any[], picks: any[] = []): {lijst: any[], verwijderd: any[]} | null {
  const lijst = bestellingen || []
  const metPicks = new Set((picks || []).map((p: any) => p?.bestelling_id))
  const eerste = new Map<any, any>()
  const verwijderd: any[] = []
  for (const b of [...lijst].sort((a, c) => (Number(a?.id) || 0) - (Number(c?.id) || 0))) {
    const wcId = b?.wc_order_id
    if (wcId == null) continue
    if (!eerste.has(wcId)) { eerste.set(wcId, b); continue }
    const onaangeroerd = b.status === 'nieuw' && !metPicks.has(b.id) && b.factuur_id == null
    if (onaangeroerd) verwijderd.push(b)
  }
  if (!verwijderd.length) return null
  const weg = new Set(verwijderd.map(b => b.id))
  return {lijst: lijst.filter((b: any) => !weg.has(b?.id)), verwijderd}
}

