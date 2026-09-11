/**
 * levering.ts — hoe komt een bestelling bij de klant: afhalen of verzenden?
 *
 * Een WooCommerce-order zegt dat zelf, op de verzendregel (`shipping_lines`):
 * de methode-ID `local_pickup`/`pickup_location` betekent afhalen, al het
 * andere is bezorgen. Het Craftery-webshopthema hangt aan een afhaalbestelling
 * bovendien een **afhaalmoment** (meta `_craftery_afhaalmoment`, als
 * `JJJJ-MM-DD UU:MM` of `overleg`) en een privépagina waar de klant dat
 * moment kiest of verzet: `<winkel>/?afhaalmoment=<order-id>&sleutel=<order_key>`.
 *
 * Deze module leest die velden uit de order (`wcLeveringVelden`), bouwt de
 * link na (`afhaalLink`) en levert de tekstvariabelen voor de bestel- en
 * verzendbevestiging (`leveringMailVars`, `verzendMailVars`):
 *
 *  - afhalen zonder moment  → de uitnodiging mét link om een moment te kiezen
 *  - afhalen met moment     → het moment, plus de link om te verzetten
 *  - afhalen "in overleg"   → we nemen contact op
 *  - verzenden              → er volgt een verzendbevestiging zodra het pakket
 *                             de deur uit is
 *  - onbekend (handmatig)   → de neutrale oude regel
 *
 * Komt de klant niet opdagen, dan is er de **afspraak-gemist-mail**
 * (`afhaalGemistMailVars`): het gemiste moment plus dezelfde link waarmee de
 * klant een nieuw moment kiest. `afhaalmomentVerstreken` zegt of een
 * afhaalorder die nog openstaat zo'n mail verdient (het gekozen moment ligt in
 * het verleden).
 *
 * Bewaart zelf niets; de velden staan op de bestelling en worden bij elke
 * import ververst (een klant kiest zijn moment vaak pas ná het bestellen).
 */
import { getLang, t } from '../i18n'

export type Levering = 'afhalen' | 'verzenden'

/** Verzendmethode-ID's die WooCommerce en het Craftery-thema als afhalen zien. */
export const WC_AFHAAL_METHODEN: string[] = ['local_pickup', 'pickup_location', 'local_pickup_plus']

/** De waarde waarmee het thema "geen van de momenten past" vastlegt. */
export const AFHAAL_OVERLEG = 'overleg'

/** Meta-sleutels waaronder het thema het gekozen afhaalmoment bewaart. */
const AFHAALMOMENT_META = ['_craftery_afhaalmoment', '_wc_other/craftery/afhaalmoment']

/** De leveringsvelden zoals ze op een BrewAdmin-bestelling worden bewaard. */
export interface LeveringVelden {
  wc_levering?: Levering
  /** Verzendmethode zoals de klant hem zag ("Afhalen", "Vast tarief — 2 dozen"). */
  wc_verzendmethode?: string
  /** WooCommerce `order_key`; nodig voor de afhaalpagina van de klant. */
  wc_order_key?: string
  /** Gekozen afhaallocatie (WooCommerce Lokaal afhalen met meerdere adressen). */
  wc_afhaal_locatie?: string
  wc_afhaal_adres?: string
  /** `JJJJ-MM-DD UU:MM`, `overleg`, of leeg = nog niet gekozen. */
  wc_afhaalmoment?: string
}

const str = (x: unknown): string => String(x ?? '').trim()

const metaWaarde = (meta: unknown, key: string): string => {
  const lijst = Array.isArray(meta) ? meta : []
  const m = lijst.find((m: any) => str(m?.key) === key)
  return str((m as any)?.value)
}

export const isAfhaalMethode = (methodId: unknown): boolean =>
  WC_AFHAAL_METHODEN.includes(str(methodId).toLowerCase())

/** Leest afhalen/verzenden, locatie, afhaalmoment en order_key uit een WooCommerce-order. */
export function wcLeveringVelden(order: any): LeveringVelden {
  const shipping: any[] = Array.isArray(order?.shipping_lines) ? order.shipping_lines : []
  const uit: LeveringVelden = {}
  const orderKey = str(order?.order_key)
  if (orderKey) uit.wc_order_key = orderKey

  const afhaal = shipping.find(s => isAfhaalMethode(s?.method_id))
  if (afhaal) {
    uit.wc_levering = 'afhalen'
    const methode = str(afhaal.method_title) || str(afhaal.method_id)
    if (methode) uit.wc_verzendmethode = methode
    const locatie = metaWaarde(afhaal.meta_data, 'pickup_location')
    const adres = metaWaarde(afhaal.meta_data, 'pickup_address')
    if (locatie) uit.wc_afhaal_locatie = locatie
    if (adres) uit.wc_afhaal_adres = adres
    // Het moment staat op de order zelf, niet op de verzendregel.
    for (const key of AFHAALMOMENT_META) {
      const moment = metaWaarde(order?.meta_data, key)
      if (moment) { uit.wc_afhaalmoment = moment; break }
    }
  } else if (shipping.length) {
    uit.wc_levering = 'verzenden'
    const methode = str(shipping[0].method_title) || str(shipping[0].method_id)
    if (methode) uit.wc_verzendmethode = methode
  }
  return uit
}

export const LEVERING_KEYS: (keyof LeveringVelden)[] = [
  'wc_levering', 'wc_verzendmethode', 'wc_order_key', 'wc_afhaal_locatie', 'wc_afhaal_adres', 'wc_afhaalmoment',
]

/**
 * Is wat de bestelling over de levering bewaart nog gelijk aan wat WooCommerce
 * nu zegt? Het afhaalmoment wordt vaak pas ná het bestellen gekozen (of
 * verzet), dus een bestaande order moet bij een volgende import bijgewerkt
 * worden.
 */
export function leveringVeldenGewijzigd(bestelling: any, velden: LeveringVelden): boolean {
  return LEVERING_KEYS.some(k => str(bestelling?.[k]) !== str(velden[k]))
}

/** Winkel-URL met protocol en zonder slash aan het eind; leeg blijft leeg. */
const normWinkelUrl = (url: unknown): string => {
  const s = str(url).replace(/\/+$/, '')
  if (!s) return ''
  return /^https?:\/\//i.test(s) ? s : `https://${s}`
}

/**
 * De privépagina waar de klant zijn afhaalmoment kiest of verzet — precies
 * zoals `craftery_pickup_manage_url()` in het thema hem bouwt. Zonder
 * winkel-URL, order-ID of order_key is er geen link.
 */
export function afhaalLink(storeUrl: unknown, orderId: unknown, orderKey: unknown): string {
  const basis = normWinkelUrl(storeUrl)
  const id = str(orderId)
  const key = str(orderKey)
  if (!basis || !id || !key) return ''
  return `${basis}/?afhaalmoment=${encodeURIComponent(id)}&sleutel=${encodeURIComponent(key)}`
}

const LOCALES: Record<string, string> = {nl: 'nl-NL', en: 'en-GB', de: 'de-DE', fr: 'fr-FR', es: 'es-ES'}

/** Het afhaalmoment (`JJJJ-MM-DD UU:MM`) als Date in lokale tijd; null bij `overleg`, leeg of onleesbaar. */
export function afhaalmomentDate(moment: unknown): Date | null {
  const mt = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(str(moment))
  if (!mt) return null
  const [jaar, maand, dag, uur, minuut] = mt.slice(1).map(Number)
  const d = new Date(jaar, maand - 1, dag, uur, minuut)
  // JavaScript rolt "maand 13" stilletjes door naar het volgende jaar; zo'n
  // waarde is onleesbaar, geen datum.
  const klopt = d.getFullYear() === jaar && d.getMonth() === maand - 1 && d.getDate() === dag
    && d.getHours() === uur && d.getMinutes() === minuut
  return klopt ? d : null
}

/**
 * Het afhaalmoment zoals een mens het leest: "zaterdag 30 augustus om 13:00".
 * De sleutel is lokale tijd van de winkel (`JJJJ-MM-DD UU:MM`); `overleg`
 * wordt "in overleg". Onleesbaar? Dan de ruwe waarde, nooit een lege string.
 */
export function afhaalmomentLabel(moment: unknown, lang: string = getLang()): string {
  const m = str(moment)
  if (!m) return ''
  if (m === AFHAAL_OVERLEG) return t('afhaal_in_overleg')
  const d = afhaalmomentDate(m)
  if (!d) return m
  const locale = LOCALES[lang] || LOCALES.nl
  const dag = d.toLocaleDateString(locale, {weekday: 'long', day: 'numeric', month: 'long'})
  const tijd = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  return t('afhaal_moment_om').replace('{dag}', dag).replace('{tijd}', tijd)
}

/**
 * Ligt het gekozen afhaalmoment in het verleden terwijl de bestelling nog
 * niet is afgerond of geannuleerd? Dan is de klant (waarschijnlijk) niet
 * komen opdagen en verdient de order de afspraak-gemist-mail. Een moment
 * "in overleg" of nog niet gekozen kan niet gemist worden.
 */
export function afhaalmomentVerstreken(
  bestelling: (Partial<LeveringVelden> & {status?: string, [k: string]: unknown}) | null | undefined,
  nu: Date = new Date(),
): boolean {
  if (!bestelling || bestelling.wc_levering !== 'afhalen') return false
  if (bestelling.status === 'afgerond' || bestelling.status === 'geannuleerd') return false
  const d = afhaalmomentDate(bestelling.wc_afhaalmoment)
  return !!d && d.getTime() < nu.getTime()
}

/** Korte omschrijving voor een badge of tooltip: "Afhalen · Brouwerij · za 30 aug om 13:00". */
export function leveringOmschrijving(b: Partial<LeveringVelden> | null | undefined): string {
  if (!b?.wc_levering) return ''
  const delen = [t(b.wc_levering === 'afhalen' ? 'orders_levering_afhalen' : 'orders_levering_verzenden')]
  if (b.wc_levering === 'afhalen') {
    if (b.wc_afhaal_locatie) delen.push(b.wc_afhaal_locatie)
    delen.push(b.wc_afhaalmoment ? afhaalmomentLabel(b.wc_afhaalmoment) : t('orders_afhaalmoment_open'))
  } else if (b.wc_verzendmethode) {
    delen.push(b.wc_verzendmethode)
  }
  return delen.join(' · ')
}

export interface LeveringMailVars {
  /** De alinea over de levering voor in de bestelbevestiging. */
  levering: string
  afhaallink: string
  afhaalmoment: string
  afhaallocatie: string
  verzendmethode: string
}

/**
 * De leveringsvariabelen voor de bestelbevestiging. `{levering}` is de kant-
 * en-klare alinea; de losse variabelen zijn er voor wie een eigen tekst
 * schrijft.
 */
export function leveringMailVars(
  bestelling: (Partial<LeveringVelden> & {wc_order_id?: number | null}) | null | undefined,
  opts: {storeUrl?: string} = {},
): LeveringMailVars {
  const b = bestelling || {}
  const link = afhaalLink(opts.storeUrl, b.wc_order_id, b.wc_order_key)
  const locatieNaam = str(b.wc_afhaal_locatie)
  const locatie = locatieNaam ? t('mail_levering_bij_locatie').replace('{locatie}', locatieNaam) : ''
  const moment = afhaalmomentLabel(b.wc_afhaalmoment)
  const methode = str(b.wc_verzendmethode)

  let tekst: string
  if (b.wc_levering === 'afhalen') {
    if (str(b.wc_afhaalmoment) === AFHAAL_OVERLEG) {
      tekst = t('mail_levering_afhalen_overleg')
    } else if (moment) {
      tekst = t('mail_levering_afhalen_moment') + (link ? '\n' + t('mail_levering_afhalen_verzetten') : '')
    } else if (link) {
      tekst = t('mail_levering_afhalen_kies')
    } else {
      tekst = t('mail_levering_afhalen_contact')
    }
  } else if (b.wc_levering === 'verzenden') {
    tekst = t('mail_levering_verzenden')
  } else {
    tekst = t('mail_levering_onbekend')
  }
  const levering = tekst
    .split('{locatie}').join(locatie)
    .split('{moment}').join(moment)
    .split('{link}').join(link)
    .split('{methode}').join(methode)
  return {levering, afhaallink: link, afhaalmoment: moment, afhaallocatie: locatieNaam, verzendmethode: methode}
}

export interface AfhaalGemistMailVars {
  /** Het gemiste moment, leesbaar ("zaterdag 30 augustus om 13:00"). */
  afhaalmoment: string
  afhaallink: string
  afhaallocatie: string
  /** De alinea met de uitnodiging om een nieuw moment te kiezen (mét link, anders "neem contact op"). */
  afhaalregel: string
}

/**
 * De variabelen voor de afspraak-gemist-mail: het moment dat de klant heeft
 * laten schieten en de link naar zijn afhaalpagina om een nieuw moment te
 * kiezen. Zonder link (geen winkel-URL, handmatige order) vraagt de tekst de
 * klant om contact op te nemen.
 */
export function afhaalGemistMailVars(
  bestelling: (Partial<LeveringVelden> & {wc_order_id?: number | null}) | null | undefined,
  opts: {storeUrl?: string} = {},
): AfhaalGemistMailVars {
  const b = bestelling || {}
  const link = afhaalLink(opts.storeUrl, b.wc_order_id, b.wc_order_key)
  const locatieNaam = str(b.wc_afhaal_locatie)
  const locatie = locatieNaam ? t('mail_levering_bij_locatie').replace('{locatie}', locatieNaam) : ''
  const moment = afhaalmomentLabel(b.wc_afhaalmoment)
  const afhaalregel = t(link ? 'mail_afhaal_gemist_kies' : 'mail_afhaal_gemist_contact')
    .split('{locatie}').join(locatie)
    .split('{link}').join(link)
  return {afhaalmoment: moment, afhaallink: link, afhaallocatie: locatieNaam, afhaalregel}
}

export interface VerzendMailVars {
  verzenddatum: string
  track: string
  /** Lege string zonder track & trace, anders de regel "Je kunt je pakket volgen via: …". */
  trackregel: string
}

/** Datum als dd-mm-jjjj (zelfde notatie als de overige mailvariabelen). */
const fmtDatum = (datum: unknown): string => {
  const d = str(datum)
  if (!d) return ''
  const parsed = new Date(d)
  if (Number.isNaN(parsed.getTime())) return d
  return parsed.toLocaleDateString('nl-NL', {day: '2-digit', month: '2-digit', year: 'numeric'})
}

/** De variabelen voor de verzendbevestiging. */
export function verzendMailVars(bestelling: {verzend_datum?: string | null, verzend_tracking?: string | null} | null | undefined): VerzendMailVars {
  const track = str(bestelling?.verzend_tracking)
  return {
    verzenddatum: fmtDatum(bestelling?.verzend_datum),
    track,
    trackregel: track ? t('mail_trackregel').replace('{track}', track) : '',
  }
}

/**
 * Hoort bij deze bestelling een verzendbevestiging? Een afhaalbestelling niet:
 * die klant komt zelf langs. Zonder e-mailadres valt er ook niets te mailen.
 */
export const wilVerzendbevestiging = (bestelling: {wc_levering?: string, klant_email?: string} | null | undefined, email?: string): boolean =>
  !!str(email ?? bestelling?.klant_email) && bestelling?.wc_levering !== 'afhalen'
