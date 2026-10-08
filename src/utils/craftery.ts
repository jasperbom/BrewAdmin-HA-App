// Vertaling tussen de bierinformatie uit de administratie (`utils/bierinfo.ts`)
// en de eigen productvelden van het Craftery-webshopthema.
//
// Het thema bewaart zijn extra productgegevens als post-meta met het
// voorvoegsel `_cf_`. Dat is puur de vorm waarin de webshop ze wil hebben —
// de gegevens zelf zijn gewone bierinformatie die je in de app bijhoudt. Dit
// bestand doet dus één ding: heen en weer vertalen. Er wordt hier niets
// bewaard en niets bedacht.
//
// De sleutels komen één-op-één uit het thema (`inc/woocommerce.php`,
// `inc/helpers.php`, `inc/delivery.php`, versie 5.28.x). Wijzigt het thema, dan
// wijzigt deze tabel mee — de app schrijft nooit een meta-sleutel die hier niet
// in staat, en laat de rest van de meta in de winkel ongemoeid.

import { BIER_VELDEN, BierInfoBron, bierInfoVoorArtikel } from './bierinfo'

/** Bierinformatie-veld → meta-sleutel van het thema. */
export const CRAFTERY_META: Record<string, string> = {
  abv:            '_cf_abv',
  ibu:            '_cf_ibu',
  ebc:            '_cf_ebc',
  kcal:           '_cf_kcal',
  inhoud:         '_cf_inhoud',
  stijl:          '_cf_stijl',
  ingredienten:   '_cf_ingredienten',
  smaakprofiel:   '_cf_smaak',
  serveertip:     '_cf_serveertip',
  smaak_fruit:    '_cf_smaak_fruit',
  smaak_body:     '_cf_smaak_body',
  smaak_bitter:   '_cf_smaak_bitter',
  smaak_zoet:     '_cf_smaak_zoet',
  smaak_droog:    '_cf_smaak_droog',
  untappd_score:  '_cf_untappd_score',
  untappd_aantal: '_cf_untappd_count',
  untappd_url:    '_cf_untappd_url',
  uit_roulatie:   '_cf_archief',
  opvolger:       '_cf_archief_opvolger',
  extra_specs:    '_cf_extra_specs',
  extra_blokken:  '_cf_extra_cards',
  tag:            '_cf_tag',
  pakket_inhoud:  '_cf_bevat',
  badge:          '_cf_badge',
  levering:       '_cf_levering',
}

/** Alle meta-sleutels die de app van dit thema beheert. */
export const CRAFTERY_SLEUTELS: string[] = Object.values(CRAFTERY_META)

/** Meta-sleutel → bierinformatie-veld (de omgekeerde tabel). */
const VELD_PER_SLEUTEL: Record<string, string> = Object.fromEntries(
  Object.entries(CRAFTERY_META).map(([veld, sleutel]) => [sleutel, veld]))

const leeg = (w: any): boolean =>
  w === undefined || w === null ||
  (Array.isArray(w) ? w.length === 0 : String(w).trim() === '')

const tekst = (v: unknown): string => String(v ?? '').trim()

// ── De Bevat-regel achter de ingrediënten ───────────────────────────────────
//
// Het thema heeft (nog) geen eigen allergeenveld. Tot dat er is, gaat de
// Bevat-regel van het etiket ("Bevat: gerst, tarwe.") bij een push als
// laatste zin achter de ingrediëntentekst (`_cf_ingredienten`), en haalt een
// pull hem er weer af — anders belandt hij in het productveld `ingredienten`
// en gaat hij bij de volgende push een tweede keer mee. Er komt geen nieuwe
// `_cf_`-sleutel bij: het thema zit niet in deze repo.
//
// De zin herkennen gebeurt in elk van de vijf talen: dat is opmaak van de
// webshoptekst, geen weergavetekst. Toevoegen gebeurt niet zodra het woord er
// staat (ruim); weghalen alleen bij de echte zin met dubbele punt (streng),
// zodat "mout (contains gluten)" blijft staan.
const BEVAT_WOORD = /(?:^|[^\p{L}])(bevat|contains|enthält|contient|contiene)(?![\p{L}])/iu
const BEVAT_ZIN = /(^|[^\p{L}])(?:bevat|contains|enthält|contient|contiene)\s*:/iu

/** De ingrediëntentekst zonder de Bevat-zin erachter. */
export const zonderBevatRegel = (ingredienten: unknown): string => {
  const s = tekst(ingredienten)
  const m = BEVAT_ZIN.exec(s)
  if (!m) return s
  // m[1] is het teken vóór het woord: tot en met dat teken blijft staan.
  return s.slice(0, m.index + m[1].length).replace(/[\s.,;]+$/, '').trim()
}

/**
 * De ingrediëntentekst met de Bevat-regel als laatste zin — alleen als die
 * tekst nog geen "Bevat" noemt.
 */
export const metBevatRegel = (ingredienten: unknown, bevatRegel: unknown): string => {
  const s = tekst(ingredienten)
  const bevat = tekst(bevatRegel)
  if (!bevat || BEVAT_WOORD.test(s)) return s
  if (!s) return bevat
  return `${s.replace(/[\s.]+$/, '')}. ${bevat}`
}

/** Wat `crafteryMeta` vertaalt, plus de Bevat-regel van het etiket. */
export interface CrafteryBron extends BierInfoBron {
  /**
   * "Bevat: gerst, tarwe." — gaat bij een push achter de ingrediëntentekst.
   * Alleen als er een ingrediëntentekst ís: zonder tekst sturen we niets, want
   * een kale Bevat-zin zou de ingrediënten in de winkel overschrijven.
   */
  bevatRegel?: string | null
}

/**
 * De `meta_data` voor de WooCommerce-push: alle bierinformatie van dit artikel,
 * omgezet naar de sleutels van het thema, met de Bevat-regel achter de
 * ingrediënten als die is meegegeven.
 *
 * Lege waarden blijven weg — een push kan zo nooit iets in de webshop wissen
 * wat de app nog niet weet.
 */
export function crafteryMeta(bron: CrafteryBron): Record<string, any> {
  const info = bierInfoVoorArtikel(bron)
  const uit: Record<string, any> = {}

  for (const [veld, waarde] of Object.entries(info)) {
    const sleutel = CRAFTERY_META[veld]
    if (!sleutel) continue
    // Het thema bewaart de "uit roulatie"-schakelaar als 'yes'/'no'.
    if (veld === 'uit_roulatie') {
      if (typeof waarde === 'boolean') uit[sleutel] = waarde ? 'yes' : 'no'
      continue
    }
    if (leeg(waarde)) continue
    uit[sleutel] = Array.isArray(waarde) ? waarde : String(waarde)
  }
  const ing = CRAFTERY_META.ingredienten
  if (!leeg(uit[ing]) && tekst(bron.bevatRegel)) uit[ing] = metBevatRegel(uit[ing], bron.bevatRegel)
  return uit
}

/**
 * De omgekeerde weg: meta uit de winkel terug naar bierinformatie, gesplitst
 * naar het niveau waar het hoort. Bedoeld om in één keer over te stappen
 * wanneer de gegevens nu nog in WordPress staan.
 *
 * Afgeleide velden komen niet terug: ABV, stijl en inhoud staan in de
 * administratie zelf, dus een afwijkende winkelwaarde is geen invoer maar een
 * verschil dat bij de volgende push rechtgezet wordt. De Bevat-zin achter de
 * ingrediënten ook niet: die hoort bij het etiket (`product.allergenen`), niet
 * bij de ingrediëntentekst.
 */
export function crafteryLees(meta?: Record<string, any> | null): {
  product: Record<string, any>, artikel: Record<string, any>,
} {
  const product: Record<string, any> = {}
  const artikel: Record<string, any> = {}

  for (const [sleutel, ruw] of Object.entries(meta || {})) {
    const veld = VELD_PER_SLEUTEL[sleutel]
    if (!veld) continue
    const definitie = BIER_VELDEN.find(v => v.veld === veld)
    if (!definitie || definitie.afgeleid) continue

    let waarde: any = ruw
    if (definitie.soort === 'ja_nee') waarde = ruw === 'yes' || ruw === true
    else if (definitie.soort === 'regels') {
      waarde = Array.isArray(ruw)
        ? ruw.map((r: any) => ({label: String(r?.label ?? ''), value: String(r?.value ?? '')}))
        : []
    } else {
      waarde = ruw === null || ruw === undefined ? '' : String(ruw)
      if (veld === 'ingredienten') waarde = zonderBevatRegel(waarde)
    }
    if (definitie.soort !== 'ja_nee' && leeg(waarde)) continue
    ;(definitie.niveau === 'artikel' ? artikel : product)[veld] = waarde
  }
  return {product, artikel}
}

/**
 * Zet een lijst `meta_data` uit een WooCommerce-antwoord om naar een plat
 * object met alleen de sleutels die de app beheert.
 */
export function crafteryMetaUitWc(metaData?: any[] | null): Record<string, any> {
  const uit: Record<string, any> = {}
  for (const m of (Array.isArray(metaData) ? metaData : [])) {
    const sleutel = String(m?.key || '')
    if (!CRAFTERY_SLEUTELS.includes(sleutel)) continue
    uit[sleutel] = m?.value
  }
  return uit
}

/** i18n-sleutel van het label bij een meta-sleutel, voor de verschillenlijst. */
export function crafteryLabel(sleutel: string): string | null {
  const veld = VELD_PER_SLEUTEL[sleutel]
  return BIER_VELDEN.find(v => v.veld === veld)?.label || null
}
