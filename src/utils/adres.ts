/**
 * adres.ts — straat en huisnummer uit een WooCommerce-order.
 *
 * WooCommerce kent standaard geen huisnummerveld: de klant typt "Dorpsstraat
 * 12A" in één regel (`address_1`) en een eventuele toevoeging in
 * `address_2`. Nederlandse checkout-plugins (PostNL, MyParcel e.a.) splitsen
 * dat wél, in `_billing_street_name` / `_billing_house_number` /
 * `_billing_house_number_suffix` — en laten `address_1` dan soms alleen de
 * straat bevatten. De import zette tot nu toe `address_1` als straat neer en
 * liet het huisnummer leeg, waardoor het nummer bij zo'n plugin helemaal
 * wegviel en `address_2` altijd verdween.
 *
 *  - `splitsAdresRegel` — "Dorpsstraat 12A" → {straat, huisnummer}
 *  - `wcAdres`          — het factuuradres van een order, plugin-velden eerst
 */

export interface AdresDelen {
  straat: string
  huisnummer: string
}

const schoon = (v: unknown): string => String(v ?? '').replace(/\s+/g, ' ').trim()

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

/** Een veld van het factuuradres: eerst op `billing`, dan in de ordermeta. */
function billingVeld(order: any, naam: string): string {
  const direct = schoon(order?.billing?.[naam])
  if (direct) return direct
  const meta = Array.isArray(order?.meta_data) ? order.meta_data : []
  const m = meta.find((x: any) => x?.key === `_billing_${naam}` || x?.key === `billing_${naam}`)
  return schoon(m?.value)
}

const normaal = (s: string): string => s.toLowerCase().replace(/[\s-]/g, '')

/**
 * Straat en huisnummer van het factuuradres van een WooCommerce-order.
 * Volgorde: de losse velden van een checkout-plugin, anders `address_1`
 * gesplitst. `address_2` (toevoeging, "2 hoog", "bus 3") gaat achter het
 * huisnummer — er is geen tweede adresregel in de administratie, en weglaten
 * betekent een pakket dat niet aankomt.
 */
export function wcAdres(order: any): AdresDelen {
  const regel1 = schoon(order?.billing?.address_1)
  const regel2 = schoon(order?.billing?.address_2)
  const pluginNr = billingVeld(order, 'house_number')
  let straat: string
  let huisnummer: string
  let pluginToevoeging = ''
  if (pluginNr) {
    pluginToevoeging = billingVeld(order, 'house_number_suffix')
    huisnummer = metToevoeging(pluginNr, pluginToevoeging)
    const pluginStraat = billingVeld(order, 'street_name')
    if (pluginStraat) straat = pluginStraat
    else {
      // Sommige plugins zetten het nummer óók in address_1; niet dubbel tonen.
      const gesplitst = splitsAdresRegel(regel1)
      straat = gesplitst.huisnummer && normaal(gesplitst.huisnummer).startsWith(normaal(pluginNr))
        ? gesplitst.straat : regel1
    }
  } else {
    ({straat, huisnummer} = splitsAdresRegel(regel1))
  }
  // Een plugin die de toevoeging ook in address_2 zet: niet twee keer.
  if (regel2 && normaal(regel2) !== normaal(pluginToevoeging)) {
    huisnummer = !huisnummer ? regel2
      : /^\p{L}$/u.test(regel2) ? huisnummer + regel2
      : `${huisnummer} ${regel2}`
  }
  return {straat, huisnummer}
}
