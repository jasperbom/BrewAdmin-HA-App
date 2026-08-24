// Eigen productvelden van het Craftery-webshopthema.
//
// Het thema bewaart zijn extra productgegevens als post-meta met het voorvoegsel
// `_cf_` (spec sheet, smaakprofiel, Untappd, cadeaupakket-velden). Die velden
// vulde je tot nu toe in WordPress in — terwijl deze app het ABV, de stijl, de
// EBC en de inhoud van precies datzelfde bier al kent. Vandaar dit bestand: de
// velddefinities plus een voorstel dat de bekende waarden uit de administratie
// invult, klaar om mee te pushen als `meta_data`.
//
// De sleutels komen één-op-één uit het thema (`inc/woocommerce.php`,
// `inc/helpers.php`, `inc/delivery.php`, versie 5.28.x). Wijzigt het thema, dan
// wijzigt deze lijst mee — de app schrijft nooit meta-sleutels die hier niet in
// staan, en laat de rest van de meta in de winkel ongemoeid.

export type CrafteryVeldSoort = 'tekst' | 'lang' | 'getal' | 'schuif' | 'keuze' | 'ja_nee' | 'regels'

export interface CrafteryVeld {
  /** Meta-sleutel in WooCommerce, bijv. `_cf_abv`. */
  sleutel: string
  /** i18n-sleutel van het label. */
  label: string
  soort: CrafteryVeldSoort
  /** i18n-sleutel van de uitleg onder/naast het veld. */
  tip?: string
  /** Groep waarin het veld getoond wordt (i18n-sleutel). */
  groep: string
  /** Keuzewaarden bij `soort: 'keuze'`: waarde + i18n-label. */
  opties?: {v: string, l: string}[]
  placeholder?: string
}

export const CRAFTERY_VELDEN: CrafteryVeld[] = [
  // Spec sheet — de tabel op de productpagina, met ABV/IBU/EBC/kcal als
  // cijferstrip onder de winkelwagenknop.
  {sleutel: '_cf_abv',    label: 'cf_veld_abv',    soort: 'tekst', groep: 'cf_groep_specs', placeholder: '7,14%'},
  {sleutel: '_cf_ibu',    label: 'cf_veld_ibu',    soort: 'tekst', groep: 'cf_groep_specs', placeholder: '24'},
  {sleutel: '_cf_ebc',    label: 'cf_veld_ebc',    soort: 'tekst', groep: 'cf_groep_specs', placeholder: '12'},
  {sleutel: '_cf_kcal',   label: 'cf_veld_kcal',   soort: 'tekst', groep: 'cf_groep_specs', placeholder: '67'},
  {sleutel: '_cf_inhoud', label: 'cf_veld_inhoud', soort: 'tekst', groep: 'cf_groep_specs', placeholder: '33cl'},
  {sleutel: '_cf_stijl',  label: 'cf_veld_stijl',  soort: 'tekst', groep: 'cf_groep_specs', tip: 'cf_tip_stijl', placeholder: 'NEIPA'},
  {sleutel: '_cf_tag',    label: 'cf_veld_tag',    soort: 'tekst', groep: 'cf_groep_specs', tip: 'cf_tip_tag', placeholder: 'S–XXL of ×7'},

  // Infokaarten op de productpagina.
  {sleutel: '_cf_ingredienten', label: 'cf_veld_ingredienten', soort: 'lang', groep: 'cf_groep_kaarten', placeholder: 'water, gerstemout, hop, gist'},
  {sleutel: '_cf_smaak',        label: 'cf_veld_smaak',        soort: 'lang', groep: 'cf_groep_kaarten'},
  {sleutel: '_cf_serveertip',   label: 'cf_veld_serveertip',   soort: 'lang', groep: 'cf_groep_kaarten', placeholder: '6–8 °C · tulpglas'},

  // Smaakprofiel in cijfers (0–100). Vanaf twee ingevulde assen tekent het
  // thema de balken op de productpagina.
  {sleutel: '_cf_smaak_fruit',  label: 'cf_veld_smaak_fruit',  soort: 'schuif', groep: 'cf_groep_smaak', tip: 'cf_tip_smaakassen'},
  {sleutel: '_cf_smaak_body',   label: 'cf_veld_smaak_body',   soort: 'schuif', groep: 'cf_groep_smaak'},
  {sleutel: '_cf_smaak_bitter', label: 'cf_veld_smaak_bitter', soort: 'schuif', groep: 'cf_groep_smaak'},
  {sleutel: '_cf_smaak_zoet',   label: 'cf_veld_smaak_zoet',   soort: 'schuif', groep: 'cf_groep_smaak'},
  {sleutel: '_cf_smaak_droog',  label: 'cf_veld_smaak_droog',  soort: 'schuif', groep: 'cf_groep_smaak'},

  // Untappd-waardering.
  {sleutel: '_cf_untappd_score', label: 'cf_veld_untappd_score', soort: 'tekst', groep: 'cf_groep_untappd', placeholder: '4,75'},
  {sleutel: '_cf_untappd_count', label: 'cf_veld_untappd_count', soort: 'getal', groep: 'cf_groep_untappd', tip: 'cf_tip_untappd_count'},
  {sleutel: '_cf_untappd_url',   label: 'cf_veld_untappd_url',   soort: 'tekst', groep: 'cf_groep_untappd', placeholder: 'https://untappd.com/b/…'},

  // Uit roulatie + opvolger.
  {sleutel: '_cf_archief',           label: 'cf_veld_archief',           soort: 'ja_nee', groep: 'cf_groep_archief', tip: 'cf_tip_archief'},
  {sleutel: '_cf_archief_opvolger',  label: 'cf_veld_archief_opvolger',  soort: 'tekst',  groep: 'cf_groep_archief'},

  // Cadeaupakketten + levering.
  {sleutel: '_cf_bevat', label: 'cf_veld_bevat', soort: 'lang',  groep: 'cf_groep_pakket', tip: 'cf_tip_bevat'},
  {sleutel: '_cf_badge', label: 'cf_veld_badge', soort: 'tekst', groep: 'cf_groep_pakket', placeholder: 'Bestseller'},
  {sleutel: '_cf_levering', label: 'cf_veld_levering', soort: 'keuze', groep: 'cf_groep_pakket', tip: 'cf_tip_levering', opties: [
    {v: 'beide',     l: 'cf_lev_beide'},
    {v: 'verzenden', l: 'cf_lev_verzenden'},
    {v: 'afhalen',   l: 'cf_lev_afhalen'},
  ]},

  // Eigen regels: label/waarde-paren.
  {sleutel: '_cf_extra_specs', label: 'cf_veld_extra_specs', soort: 'regels', groep: 'cf_groep_extra', tip: 'cf_tip_extra_specs'},
  {sleutel: '_cf_extra_cards', label: 'cf_veld_extra_cards', soort: 'regels', groep: 'cf_groep_extra', tip: 'cf_tip_extra_cards'},
]

/** Alle meta-sleutels die de app van dit thema beheert. */
export const CRAFTERY_SLEUTELS: string[] = CRAFTERY_VELDEN.map(v => v.sleutel)

/** De groepen in de volgorde waarin ze getoond worden. */
export const CRAFTERY_GROEPEN: string[] = CRAFTERY_VELDEN.reduce((lijst: string[], v) =>
  lijst.includes(v.groep) ? lijst : [...lijst, v.groep], [])

const getal = (x: any): number | null => {
  if (x === null || x === undefined || String(x).trim() === '') return null
  const n = Number(String(x).replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

/** Komma als decimaalteken — zo staat het in de winkel ("7,14%"). */
const nlGetal = (n: number, decimalen: number): string =>
  n.toFixed(decimalen).replace('.', ',')

/**
 * Inhoud zoals het thema hem toont: liters uit de verpakking naar "33cl",
 * "75cl" of "20L". Onder een liter in centiliters (dat is hoe een fles
 * aangeduid wordt), daarboven in liters (fust).
 */
export const crafteryInhoud = (liter: any): string => {
  const l = getal(liter)
  if (l === null || l <= 0) return ''
  if (l < 1) {
    const cl = l * 100
    return `${Number.isInteger(cl) ? cl : Number(cl.toFixed(1))}cl`
  }
  return `${Number.isInteger(l) ? l : Number(l.toFixed(2))}L`
}

export interface CrafteryVoorstelInvoer {
  /** Het product uit deze app (naam, stijl, abv, ebc, ibu). */
  product?: {stijl?: string, abv?: any, ebc?: any, ibu?: any} | null
  /** De verpakking van dit artikel — bepaalt de inhoud. */
  inhoudLiter?: any
}

/**
 * Wat de app zelf al weet, in de vorm die het thema verwacht. Bedoeld om de
 * lege velden mee te vullen: het ABV, de stijl en de inhoud staan hier al in
 * de administratie, die hoef je niet nog eens in WordPress te typen.
 *
 * Alleen waarden die de app écht kent komen terug; er wordt niets verzonnen.
 */
export function crafteryVoorstel(invoer: CrafteryVoorstelInvoer): Record<string, string> {
  const p = invoer.product || {}
  const uit: Record<string, string> = {}

  const abv = getal(p.abv)
  if (abv !== null && abv > 0) uit._cf_abv = `${nlGetal(abv, 1)}%`

  const ibu = getal(p.ibu)
  if (ibu !== null && ibu > 0) uit._cf_ibu = String(Math.round(ibu))

  const ebc = getal(p.ebc)
  if (ebc !== null && ebc > 0) uit._cf_ebc = String(Math.round(ebc))

  const inhoud = crafteryInhoud(invoer.inhoudLiter)
  if (inhoud) uit._cf_inhoud = inhoud

  const stijl = String(p.stijl || '').trim()
  if (stijl) uit._cf_stijl = stijl

  return uit
}

/**
 * Vul de lege velden aan met het voorstel. Wat al een waarde heeft blijft
 * staan — een handmatige tekst in de winkel wint altijd van een afleiding.
 */
export function vulAanMetVoorstel(
  huidig: Record<string, any> | null | undefined,
  voorstel: Record<string, string>,
): Record<string, any> {
  const uit: Record<string, any> = {...(huidig || {})}
  for (const [sleutel, waarde] of Object.entries(voorstel)) {
    const bestaand = uit[sleutel]
    const leeg = bestaand === undefined || bestaand === null || String(bestaand).trim() === ''
    if (leeg && waarde) uit[sleutel] = waarde
  }
  return uit
}
