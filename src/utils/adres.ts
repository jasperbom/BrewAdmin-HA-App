/**
 * adres.ts — straat en huisnummer uit een WooCommerce-order.
 *
 * WooCommerce kent standaard geen huisnummerveld: de klant typt "Dorpsstraat
 * 12A" in één regel (`address_1`) en een eventuele toevoeging in
 * `address_2`. Nederlandse checkouts splitsen dat vaak wél, en laten
 * `address_1` dan soms alleen de straat bevatten. Waar het losse nummer staat
 * hangt af van de checkout:
 *
 *  - klassieke checkout (PostNL, MyParcel, Postcode.nl e.a.): ordermeta
 *    `_billing_house_number` / `_billing_house_number_suffix` /
 *    `_billing_street_name` — WooCommerce bewaart elk extra `billing_`-veld
 *    zo, dus ook een eigen veld als `billing_huisnummer`;
 *  - blokcheckout (extra adresvelden van een thema of plugin): ordermeta
 *    `_wc_billing/<namespace>/<veld>`, bijv. `_wc_billing/craftery/huisnummer`;
 *  - een plugin die het REST-antwoord uitbreidt: `billing.house_number`.
 *
 * Elk van die plekken wordt gelezen, voor het factuur- én het verzendadres.
 * Is het factuuradres leeg of zonder nummer terwijl het verzendadres van
 * hetzelfde adres het wél heeft, dan telt het verzendadres.
 *
 *  - `splitsAdresRegel` — "Dorpsstraat 12A" → {straat, huisnummer}
 *  - `wcAdresVolledig`  — het adres van een order: straat, huisnummer,
 *                         postcode, plaats en van welke kant het komt
 *  - `wcAdres`          — alleen straat en huisnummer daarvan
 */

export interface AdresDelen {
  straat: string
  huisnummer: string
}

export type AdresKant = 'billing' | 'shipping'

export interface WcAdres extends AdresDelen {
  postcode: string
  stad: string
  /** Factuuradres, of het verzendadres als dat van de factuur leeg of onvolledig was. */
  kant: AdresKant
}

const schoon = (v: unknown): string =>
  typeof v === 'string' || typeof v === 'number' ? String(v).replace(/\s+/g, ' ').trim() : ''

// Huisnummer achteraan (NL/BE/DE): 12, 12A, 12 A, 12-3, 12/2, 12 bis, 12 bus 3.
// De straat moet een letter bevatten, zodat "Laan 1940-1945 12" niet op
// "1940" knipt maar op "12".
const NUMMER_ACHTER = /^(.*?\p{L}.*?)[\s,]+(\d+\p{L}{0,3}(?:[\s,]*(?:[-/]|bus|box)?\s*[\p{L}\d]{1,4})?)\.?$/iu
// Huisnummer vooraan (FR/UK): "12 Rue de Rivoli", "221B Baker Street".
const NUMMER_VOOR = /^(\d+\p{L}?)[\s,]+(.*\p{L}.*)$/u

/** Knip één adresregel in straat en huisnummer; zonder nummer blijft alles straat. */
export function splitsAdresRegel(regel: unknown): AdresDelen {
  const r = schoon(regel)
  const achter = r.match(NUMMER_ACHTER)
  if (achter) return {straat: achter[1].replace(/,$/, '').trim(), huisnummer: achter[2].trim()}
  const voor = r.match(NUMMER_VOOR)
  if (voor) return {straat: voor[2].trim(), huisnummer: voor[1]}
  return {straat: r, huisnummer: ''}
}

/** Nummer + toevoeging: "12" + "A" → "12A", "12" + "3" → "12-3", "12" + "bis" → "12 bis". */
function metToevoeging(nr: string, toevoeging: string): string {
  const tv = toevoeging.replace(/^[-\s]+/, '')
  if (!tv) return nr
  if (/^\p{L}$/u.test(tv)) return nr + tv
  if (/^\d/.test(tv)) return `${nr}-${tv}`
  return `${nr} ${tv}`
}

// Veldnamen zoals checkouts ze gebruiken, vergeleken zonder hoofdletters,
// streepjes en underscores ("house_number", "house-number", "HouseNumber").
const veldNaam = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '')
const NUMMER_VELDEN = new Set(['housenumber', 'housenr', 'huisnummer', 'huisnr', 'streetnumber'])
const TOEVOEGING_VELDEN = new Set([
  'housenumbersuffix', 'housenumberaddition', 'housenumberextension', 'housenumberext', 'housenumberadd',
  'housenrsuffix', 'huisnummertoevoeging', 'huisnrtoevoeging', 'toevoeging',
])
const STRAAT_VELDEN = new Set(['streetname', 'straatnaam', 'straat'])

// `_billing_house_number`, `billing_house_number`, `_wc_billing/ns/house-number`.
const KLASSIEK_META = /^_?(billing|shipping)_(.+)$/i
const BLOK_META = /^_?wc_(billing|shipping)\/(?:.*\/)?([^/]+)$/i

/**
 * Een los adresveld (huisnummer, toevoeging, straatnaam) van één kant van de
 * order: eerst op het adresobject zelf, dan in de ordermeta (klassieke en
 * blokcheckout). Alleen tekst of een getal telt — geen vinkje of object.
 */
function losVeld(order: any, kant: AdresKant, namen: Set<string>): string {
  const adres = order?.[kant]
  if (adres && typeof adres === 'object') {
    for (const [k, v] of Object.entries(adres)) {
      const s = namen.has(veldNaam(k)) ? schoon(v) : ''
      if (s) return s
    }
  }
  const meta = Array.isArray(order?.meta_data) ? order.meta_data : []
  for (const m of meta) {
    const key = String(m?.key ?? '')
    const hit = key.match(BLOK_META) || key.match(KLASSIEK_META)
    if (!hit || hit[1].toLowerCase() !== kant || !namen.has(veldNaam(hit[2]))) continue
    const s = schoon(m?.value)
    if (s) return s
  }
  return ''
}

const normaal = (s: string): string => s.toLowerCase().replace(/[\s-]/g, '')

/**
 * Straat en huisnummer van één kant van de order. Volgorde: de losse velden
 * van de checkout, anders `address_1` gesplitst. `address_2` (toevoeging,
 * "2 hoog", "bus 3") gaat achter het huisnummer — er is geen tweede
 * adresregel in de administratie, en weglaten betekent een pakket dat niet
 * aankomt.
 */
function kantAdres(order: any, kant: AdresKant): WcAdres {
  const regel1 = schoon(order?.[kant]?.address_1)
  const regel2 = schoon(order?.[kant]?.address_2)
  const losNr = losVeld(order, kant, NUMMER_VELDEN)
  let straat: string
  let huisnummer: string
  let losToevoeging = ''
  if (losNr) {
    losToevoeging = losVeld(order, kant, TOEVOEGING_VELDEN)
    huisnummer = metToevoeging(losNr, losToevoeging)
    const losStraat = losVeld(order, kant, STRAAT_VELDEN)
    if (losStraat) straat = losStraat
    else {
      // Sommige checkouts zetten het nummer óók in address_1; niet dubbel tonen.
      const gesplitst = splitsAdresRegel(regel1)
      straat = gesplitst.huisnummer && normaal(gesplitst.huisnummer).startsWith(normaal(losNr))
        ? gesplitst.straat : regel1
    }
  } else {
    ({straat, huisnummer} = splitsAdresRegel(regel1))
  }
  // Een checkout die de toevoeging ook in address_2 zet: niet twee keer.
  if (regel2 && normaal(regel2) !== normaal(losToevoeging)) {
    huisnummer = !huisnummer ? regel2
      : /^\p{L}$/u.test(regel2) ? huisnummer + regel2
      : `${huisnummer} ${regel2}`
  }
  return {straat, huisnummer, postcode: schoon(order?.[kant]?.postcode), stad: schoon(order?.[kant]?.city), kant}
}

const postcodeSleutel = (s: string): string => s.toUpperCase().replace(/\s+/g, '')

/**
 * Het adres van een WooCommerce-order: het factuuradres, met het verzendadres
 * als terugval. Dat laatste alleen als het factuuradres leeg is (een checkout
 * die alleen het verzendadres vraagt), of als het geen huisnummer heeft terwijl
 * het verzendadres met dezelfde straat of postcode er wél een heeft — dan is
 * het hetzelfde adres en kwam het nummer alleen aan de verzendkant binnen. Een
 * ander verzendadres neemt nooit de plaats in van het factuuradres.
 */
export function wcAdresVolledig(order: any): WcAdres {
  const factuur = kantAdres(order, 'billing')
  const verzend = kantAdres(order, 'shipping')
  if (!factuur.straat && !factuur.huisnummer) return verzend.straat || verzend.huisnummer ? verzend : factuur
  if (!factuur.huisnummer && verzend.huisnummer) {
    const zelfdeStraat = !!verzend.straat && normaal(verzend.straat) === normaal(factuur.straat)
    const zelfdePostcode = !!factuur.postcode && postcodeSleutel(factuur.postcode) === postcodeSleutel(verzend.postcode)
    if (zelfdeStraat || zelfdePostcode) return {...factuur, straat: verzend.straat || factuur.straat, huisnummer: verzend.huisnummer}
  }
  return factuur
}

/** Straat en huisnummer van een WooCommerce-order (zie `wcAdresVolledig`). */
export function wcAdres(order: any): AdresDelen {
  const {straat, huisnummer} = wcAdresVolledig(order)
  return {straat, huisnummer}
}
