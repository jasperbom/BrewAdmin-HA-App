/**
 * wcOrderImport.ts — de WooCommerce-orderimport als herbruikbare logica.
 *
 * Tot nu toe zat de import volledig in de knop op de bestellingenpagina. Nu
 * de app ook periodiek importeert (App.tsx, zolang een tabblad open staat)
 * moet dezelfde import op twee plekken draaien — vandaar hier, zonder React.
 *
 *  - `haalWcOrders`      — alle pagina's ophalen (fout op pagina > 1 = klaar)
 *  - `haalBekendeWcOrders` — de openstaande orders die we al hebben, per id en
 *                          in elke status: ook een annulering of terugbetaling
 *                          in de winkel moet hier aankomen
 *  - `wcOrderNaarBestelling` / `wcOrderUpdate` — één order omzetten resp. de
 *                          betaal-/leverings-/statusvelden van een bekende order verversen
 *  - `importeerWcOrders` — het geheel: geeft `{nieuw, updates, onbekendeRegels}`
 *  - `pasImportToe`      — het resultaat in de bestellingenlijst verwerken; laat
 *                          een order vallen die intussen al bestaat (twee tabs)
 *  - `importAuditRegels` / `importMelding` — logboek en schermtekst
 *  - `telNieuweWebshopOrders` / `importLeaseVrij` — voor de automatische import:
 *                          hoeveel orders meldt de server die hier nog niet zijn,
 *                          en mag dít tabblad nu importeren (lease)
 *  - `telWebshopAfgebroken` — open orders die in de winkel geannuleerd,
 *                          mislukt of terugbetaald zijn (attentiepost)
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
  wcBetaalVelden, betaalVeldenGewijzigd, BETAAL_KEYS, betaalVeldenNaEigenSync,
  wcOrderStatus, WC_NIET_BETAALD_STATUSSEN, WC_AFGEBROKEN_STATUSSEN,
} from './wcImport'
import { wcLeveringVelden, leveringVeldenGewijzigd, leveringOmschrijving, LEVERING_KEYS, leesWcPaginas, WcPaginas, WcLinkContext } from './levering'

// Maximaal 10 pagina's van 100 orders per import; genoeg voor een eerste
// volledige haal en tegelijk een rem op een winkel met jaren historie.
export const WC_PER_PAGE = 100
export const WC_MAX_PAGINAS = 10

/** Zo lang houdt een tabblad de import-lease vast (ruim boven een import). */
export const WC_IMPORT_LEASE_MS = 2 * 60_000

/** Minimale tijd tussen twee imports die door een servermelding komen. */
export const WC_IMPORT_MELDING_MIN_MS = 60_000

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
  /**
   * De picks (`bestelling_picks`). Alleen mét deze lijst annuleert de import
   * een order die in de winkel geannuleerd of terugbetaald is: zonder weten we
   * niet of er al bier voor klaarligt, en dan blijft het bij een signaal.
   */
  bestellingPicks?: any[]
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

/** Bestelstatussen waarin een webshoporder hier nog openstaat. */
export const WC_OPEN_BESTELSTATUSSEN: string[] = ['nieuw', 'bevestigd', 'gepickt', 'verzonden']

/**
 * De webshoporders die hier nog openstaan maar niet in de gewone selectie
 * zaten (`haalWcOrders` vraagt alleen de ingestelde statussen op). Een order
 * die in de winkel geannuleerd, mislukt of terugbetaald is, valt daar juist
 * uit — zonder deze tweede ronde bleef hij hier eeuwig 'nieuw', reserveerde
 * hij voorraad en bleef hij 'betaald'.
 */
export function teVerversenWcIds(bestellingen: any[], alOpgehaald: Iterable<any> = []): number[] {
  const gezien = new Set(Array.from(alOpgehaald, (id: any) => String(id)))
  const ids: number[] = []
  for (const b of (bestellingen || [])) {
    if (b?.wc_order_id == null || !WC_OPEN_BESTELSTATUSSEN.includes(b.status)) continue
    const id = Number(b.wc_order_id)
    if (!Number.isInteger(id) || id <= 0 || gezien.has(String(id))) continue
    gezien.add(String(id))
    ids.push(id)
  }
  return ids
}

/**
 * Bekende orders per id ophalen, in elke status (`include` + `status=any`),
 * 100 per verzoek. Alleen de gevraagde id's komen terug — een winkel die
 * `include` negeert levert zo nooit een nieuwe order op. Een fout slaat de
 * rest stil over (zoals `haalWcPaginas`): dit is een verversing, nooit een
 * reden om de import te laten mislukken.
 */
export async function haalBekendeWcOrders(wcGet: WcGet, ids: number[]): Promise<any[]> {
  const gevraagd = new Set(ids.map(id => String(id)))
  const uniek = Array.from(gevraagd).slice(0, WC_PER_PAGE * WC_MAX_PAGINAS)
  const uit: any[] = []
  for (let i = 0; i < uniek.length; i += WC_PER_PAGE) {
    const deel = uniek.slice(i, i + WC_PER_PAGE)
    let antwoord: any
    try {
      antwoord = await wcGet(`orders?include=${deel.join(',')}&status=any&per_page=${WC_PER_PAGE}`)
    } catch {
      break
    }
    if (Array.isArray(antwoord)) uit.push(...antwoord.filter((o: any) => o && gevraagd.has(String(o.id))))
  }
  return uit
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
    // Webshopstatus alleen als hij om aandacht vraagt (zie wcOrderUpdate).
    ...(WC_NIET_BETAALD_STATUSSEN.includes(wcOrderStatus(o)) ? {wc_status: wcOrderStatus(o)} : {}),
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
 *
 * Is de order in de winkel geannuleerd, mislukt of terugbetaald, dan komt de
 * webshopstatus als `wc_status` op de bestelling (badge en attentiepost).
 * Geannuleerd of terugbetaald terwijl hij hier nog `nieuw` of `bevestigd` is,
 * zonder picks en zonder factuur: dan annuleert de import hem zelf, zodat de
 * reservering vrijvalt. Is er al gepickt, dan blijft de status staan — daar
 * beslist de gebruiker. `heeftPicks` onbekend = niet annuleren. Een mislukte
 * betaling (`failed`) kan de klant nog opnieuw doen: alleen het signaal.
 * Geeft `null` als er niets veranderd is.
 */
export function wcOrderUpdate(bestaand: any, o: any, link: WcLinkContext = {}, opts: {heeftPicks?: boolean} = {}): Record<string, any> | null {
  // Onze eigen `completed` (terugschrijven) telt niet als betaling.
  const velden = betaalVeldenNaEigenSync(bestaand, o, wcBetaalVelden(o))
  const levering = wcLeveringVelden(o, link)
  // Zonder winkelpagina's (settings/advanced mislukte, tijdelijk of blijvend)
  // blijft de eerder bepaalde bestellink staan en telt hij niet als wijziging;
  // anders klapte een haperende winkel de link van élke order om en weer terug.
  if (!link.paginas && String(bestaand?.wc_bestel_url ?? '').trim()) levering.wc_bestel_url = bestaand.wc_bestel_url
  // Een veld dat in de winkel verdwenen is (afhaallocatie na een wissel naar
  // bezorgen, betaaldatum na een terugboeking) moet hier ook weg — anders
  // blijft de order elke ronde opnieuw als "gewijzigd" gelden.
  const leeg = (keys: string[]) => Object.fromEntries(keys.map(k => [k, null]))
  const upd: Record<string, any> = {
    ...(betaalVeldenGewijzigd(bestaand, velden) ? {...leeg(BETAAL_KEYS), ...velden} : {}),
    ...(leveringVeldenGewijzigd(bestaand, levering) ? {...leeg(LEVERING_KEYS), ...levering} : {}),
    ...(adresHerstel(bestaand, o) || {}),
  }
  // Webshopstatus: alleen bewaren zodra het ertoe doet (of als hij er al
  // stond, zodat een mislukte order die alsnog betaald wordt weer schoon is);
  // anders kreeg élke bekende order bij de eerste import een update.
  const status = wcOrderStatus(o)
  const oud = String(bestaand?.wc_status ?? '').trim()
  if (status && status !== oud && (oud || WC_NIET_BETAALD_STATUSSEN.includes(status))) upd.wc_status = status
  if (WC_AFGEBROKEN_STATUSSEN.includes(status) && (bestaand?.status === 'nieuw' || bestaand?.status === 'bevestigd')
    && opts.heeftPicks === false && bestaand?.factuur_id == null) {
    upd.status = 'geannuleerd'
  }
  return Object.keys(upd).length ? upd : null
}

/** De hele import: ophalen, nieuwe orders omzetten, bekende orders verversen. */
export async function importeerWcOrders(invoer: WcImportInvoer): Promise<WcImportResultaat> {
  const orders = await haalWcOrders(invoer.wcGet, wcImportSelectie(invoer.wcCreds))
  const bestellingen = invoer.bestellingen || []
  // Openstaande orders die niet in de selectie zaten (geannuleerd, mislukt,
  // terugbetaald …) apart per id ophalen; die leveren alleen verversingen op.
  const teVerversen = teVerversenWcIds(bestellingen, orders.map((o: any) => o?.id))
  const bekend = teVerversen.length ? await haalBekendeWcOrders(invoer.wcGet, teVerversen) : []
  // De winkelpagina's voor de bestellink per order; één klein verzoek per
  // import, en bij een bestaande order alleen een update als de link wijzigt.
  const link: WcLinkContext = {storeUrl: invoer.wcCreds?.storeUrl || '',
    paginas: orders.length || bekend.length ? await haalWcPaginas(invoer.wcGet) : null}
  const opWcId = new Map<any, any>()
  for (const b of bestellingen) if (b?.wc_order_id != null) opWcId.set(b.wc_order_id, b)
  const metPicks = Array.isArray(invoer.bestellingPicks)
    ? new Set(invoer.bestellingPicks.map((p: any) => p?.bestelling_id)) : null
  const verversOpties = (b: any) => ({heeftPicks: metPicks ? metPicks.has(b.id) : undefined})
  const nieuw: any[] = []
  const updates: Record<number, any> = {}
  let onbekendeRegels = 0
  for (const o of orders) {
    const bestaand = opWcId.get(o?.id)
    if (bestaand) {
      const upd = wcOrderUpdate(bestaand, o, link, verversOpties(bestaand))
      if (upd) updates[bestaand.id] = upd
      continue
    }
    if (o?.id != null && nieuw.some(n => n.wc_order_id === o.id)) continue
    const nb = wcOrderNaarBestelling(o, invoer.refs, [...bestellingen, ...nieuw], invoer.klanten || [], invoer.t, invoer.vandaag, link)
    onbekendeRegels += (nb.regels || []).filter((r: any) => r.wc_onbekend).length
    nieuw.push(nb)
  }
  // De apart opgehaalde bekende orders: alleen verversen, nooit iets nieuws.
  const opWcIdTekst = new Map<string, any>()
  for (const b of bestellingen) if (b?.wc_order_id != null) opWcIdTekst.set(String(b.wc_order_id), b)
  for (const o of bekend) {
    const bestaand = opWcIdTekst.get(String(o?.id))
    if (!bestaand || updates[bestaand.id]) continue
    const upd = wcOrderUpdate(bestaand, o, link, verversOpties(bestaand))
    if (upd) updates[bestaand.id] = upd
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
      'wc_status' in upd ? `webshopstatus ${upd.wc_status}` : '',
      'status' in upd ? `status ${upd.status}` : '',
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
  // In de winkel geannuleerd, mislukt of terugbetaald: apart noemen, want
  // daar hoort (bij een order met picks) de gebruiker iets mee te doen.
  const afgebroken = Object.values(r.updates)
    .filter((u: any) => WC_NIET_BETAALD_STATUSSEN.includes(String(u?.wc_status ?? ''))).length
  const delen = [
    r.onbekendeRegels > 0 ? t('msg_wc_regels_onbekend').replace('{n}', String(r.onbekendeRegels)) : '',
    bijgewerkt > 0 ? t('msg_wc_betaalstatus_bijgewerkt').replace('{n}', String(bijgewerkt)) : '',
    afgebroken > 0 ? t('msg_wc_afgebroken').replace('{n}', String(afgebroken)) : '',
  ].filter(Boolean)
  return delen.length ? `${melding} — ${delen.join(' · ')}` : melding
}

/** Is deze webshoporder in de winkel geannuleerd, mislukt of terugbetaald? */
export const wcOrderAfgebroken = (b: any): boolean =>
  WC_NIET_BETAALD_STATUSSEN.includes(String(b?.wc_status ?? '').trim().toLowerCase())

/**
 * Webshoporders die in de winkel geannuleerd, mislukt of terugbetaald zijn
 * terwijl ze hier nog openstaan (attentiepost). Een order zonder picks die
 * geannuleerd of terugbetaald is annuleert de import zelf; wat hier overblijft
 * vraagt een beslissing: al gepickt, of een mislukte betaling die de klant
 * misschien nog opnieuw doet.
 */
export function telWebshopAfgebroken(bestellingen: any[]): number {
  return (bestellingen || []).filter((b: any) =>
    b && wcOrderAfgebroken(b) && b.status !== 'afgerond' && b.status !== 'geannuleerd').length
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
 * `gemeldOntbrekend` = hoeveel door de server gemelde orders hier nog
 * ontbreken (`telNieuweWebshopOrders`): dan geldt in plaats van het interval
 * alleen een ondergrens van een minuut. De lease van een ander tabblad blijft
 * altijd gelden.
 */
export function importLeaseVrij(
  status: WcImportStatus | null | undefined, nu: number, tabId: string, intervalMin: number, gemeldOntbrekend: number = 0,
): boolean {
  const bezigTot = Number(status?.bezig_tot) || 0
  if (bezigTot > nu && status?.door && status.door !== tabId) return false
  const laatste = status?.laatste_import ? new Date(status.laatste_import).getTime() : 0
  if (Number.isFinite(laatste) && laatste > 0 && intervalMin > 0) {
    // Meldt de server een order die hier nog ontbreekt, dan niet wachten op
    // het interval (de HA-melding staat al op de telefoon) — alleen een korte
    // ondergrens tegen herhaalde imports achter elkaar.
    const grens = gemeldOntbrekend > 0 ? WC_IMPORT_MELDING_MIN_MS : Math.max(0, intervalMin - 1) * 60_000
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

