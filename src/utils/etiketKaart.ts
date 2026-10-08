// De kaart "Etiket & website" als gegevens.
//
// EtiketKaart.tsx (components/batch) geeft alleen weer wat hier staat: per
// regel de waarde van de batch met zijn bron, wat het etiket nu vastlegt, het
// oordeel en de bronketen — met de tekst al vertaald. Alle getallen en
// oordelen komen uit utils/etiket.ts (`etiketWaarden`, `productEtiketWaarden`,
// `vergelijkEtiket`, `etiketStatus`, …); hier wordt alleen gekozen wat er in
// welke cel komt. Zo is de kaart te testen zonder React, en zegt hij op de
// batch, het product en het recept hetzelfde.
//
// Drie standen (opzet 5.1):
//  - `batch`: deze batch tegen het etiket van zijn product(en);
//  - `product`: het etiket tegen de referentiebatch (de volgende of de
//    laatste batch), anders tegen het huidige recept;
//  - `recept`: "Etiket verwacht" — alles uit het recept.
//
// Puur: geen React, geen opslag.

import type { Allergeen, BreweryDetails, Product, ProductArtikel, Recept, ThtKlasse } from '../types'
import {
  allergeenNamen, allergeenRegel, bronKortSleutel, decimaalteken, etiketKopieTekst, etiketRegelTekst,
  etiketStatus, etiketStatusTekst, etiketWaarden, fmtAbv, fmtGetal, ingredientenVerschil, productEtiketWaarden,
  receptEtiketWaarden, referentieBatch, vergelijkEtiket, websiteLooptAchter,
} from './etiket'
import type {
  AllergeenOordeel, EtiketActie, EtiketCtx, EtiketKleur, EtiketLot, EtiketRegel, EtiketStatus, EtiketVergelijking,
  EtiketWaarden, ProductEtiketWaarden, Vertaal, WebsiteStandOordeel,
} from './etiket'
import type { BierInfoBron } from './bierinfo'
import { huidigReceptVoorProduct, productVoorBatch } from './productKeten'
import { productIdsVoorBatch } from './calculations'
import { fmtSg } from './format'

export type EtiketKaartModus = 'batch' | 'product' | 'recept'

type BatchLike = {id: number} & Partial<Record<string, any>>
type ProductLike = Pick<Product, 'id'> & Partial<Product>
type ReceptLike = Pick<Recept, 'id'> & Partial<Recept>

// ── Kleine helpers ──────────────────────────────────────────────────────────

const tekst = (v: unknown): string => String(v ?? '').trim()

/** "2027-07-16" → "16-7-2027", zoals de schermen een datum noemen. */
export const datumKort = (iso: unknown): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(tekst(iso))
  return m ? `${Number(m[3])}-${Number(m[2])}-${m[1]}` : tekst(iso)
}

/** Een i18n-tekst met plaatshouders ingevuld. */
const vul = (t: Vertaal, sleutel: string, params: Record<string, string | number> = {}, fallback?: string): string => {
  let s = t(sleutel, fallback)
  for (const [k, v] of Object.entries(params)) s = s.split(`{${k}}`).join(String(v))
  return s
}

const RANG: Record<EtiketStatus['kleur'], number> = {rood: 2, oranje: 1, groen: 0}

// ── Het model ───────────────────────────────────────────────────────────────

export interface KaartChip {
  tekst: string
  /** Staat in de batch maar niet op het etiket (rood), of andersom. */
  nadruk: boolean
}

export interface KaartCel {
  /** De waarde ("7,0 % vol"); leeg = "—". */
  waarde: string
  /** De grijze bronregel eronder. */
  bron: string
  /** Allergeenchips in plaats van een waarde. */
  chips?: KaartChip[]
}

export interface KaartOordeel {
  tekst: string
  kleur: EtiketKleur
}

export interface KaartLot {
  /** "L2609-B1 e.v." of "L2608-B1". */
  lotcode: string
  /** Toelichting bij een voorspelde lotcode ("één per verpakking, …"). */
  toelichting: string
  /** "Fles 33 cl · 600 st"; leeg vóór de eerste sessie. */
  verpakking: string
  /** "THT ± 16-7-2027 (9 mnd, standaard)", "THT 2-7-2027" of "geen THT (≥ 10 % vol)". */
  tht: string
  voorspeld: boolean
  /** Deze verpakking heeft voor dit product nog geen artikel: "Artikel maken". */
  artikelMaken: {productId: number, verpakkingId: number} | null
}

export type KaartVeld = 'abv' | 'allergenen' | 'lot' | 'ibu' | 'ebc' | 'energie' | 'ingredienten'

export interface KaartRegel {
  veld: KaartVeld
  label: string
  batch: KaartCel
  /** Null = deze regel heeft geen vastgelegde waarde (lotcode en THT). */
  etiket: KaartCel | null
  oordeel: KaartOordeel
  /** De bronketen, één regel per bron ("Bron per waarde", onderblad). */
  keten: string[]
  /** Allergenen: wat er nu op het etiket staat en wat het moet worden. */
  bevat?: {nu: string, moet: string} | null
  /** Lotcode en THT: één regel per verpakking. */
  lots?: KaartLot[]
  /** Ingeklapt tonen (ingrediënten: één regel tot je hem openklapt). */
  ingeklapt?: boolean
  /** Volledige teksten voor de uitgeklapte ingrediëntenregel. */
  volledig?: {batch: string, etiket: string}
}

export interface KaartTegel {
  veld: 'abv' | 'ibu' | 'ebc' | 'energie'
  label: string
  /** Groot getal ("7,0 %", "24 IBU", "60 kcal"). */
  waarde: string
  /** Kleine regel eronder ("berekend · etiket 6,2"). */
  sub: string
  kleur: EtiketKleur
  /** Titel en regels van het onderblad met de bronketen. */
  ketenTitel: string
  keten: string[]
}

export interface KaartProductBlok {
  productId: number | null
  /** Productnaam (alleen getoond bij meer dan één product). */
  naam: string
  status: {tekst: string, kleur: EtiketStatus['kleur'], actie: EtiketActie | null}
  /** "vergeleken met etiket v3 · 8-4-2025" (grijs, rechts in de kop). */
  vergelekenMet: string
  verplicht: KaartRegel[]
  website: KaartRegel[]
  /** Telefoon: het 2×2-cijferblok. */
  tegels: KaartTegel[]
  /** Telefoon: de allergeenchips van batch en etiket, met het oordeel. */
  allergenen: {
    batch: KaartChip[]
    etiketLabel: string
    etiket: KaartChip[]
    etiketTekst: string
    oordeel: KaartOordeel
    bevat: {nu: string, moet: string} | null
  }
  /** Telefoon: één regel lotcode en THT. */
  lotRegel: string
  /** Website: stand bij de laatste push/pull. Null = geen stand bekend. */
  website_stand: {tekst: string, achter: boolean} | null
  /** "Kopieer etiketgegevens": de platte tekst voor wie het etiket opmaakt. */
  kopie: string
}

export interface EtiketKaartModel {
  modus: EtiketKaartModus
  titel: string
  /** De statuschip in de kop: de zwaarste over alle producten. */
  status: {tekst: string, kleur: EtiketStatus['kleur'], actie: EtiketActie | null} | null
  /** De kop van de batchkolom: "Deze batch", "Volgende batch #2609", "Verwacht (recept)". */
  kolomBatch: string
  /** Eén blok per product; bij een batch zonder product één blok zonder product. */
  producten: KaartProductBlok[]
  /** Er valt niets te vergelijken (een product zonder batch en zonder recept). */
  leeg: boolean
  /** De batchwaarden achter de kaart (voor wie meer wil, zoals de ABV-regel). */
  waarden: EtiketWaarden | null
}

export interface EtiketKaartData extends EtiketCtx {
  /** Alle batches: de referentiebatch van een product, het huidige recept. */
  batches?: BatchLike[] | null
  producten?: ProductLike[] | null
  brouwerij?: Partial<BreweryDetails> | null
}

export interface EtiketKaartInvoer {
  modus: EtiketKaartModus
  /** Stand `batch`: de batch. */
  batch?: BatchLike | null
  /** Stand `product`: het product. */
  product?: ProductLike | null
  /** Stand `recept`: het recept. */
  recept?: ReceptLike | null
  data: EtiketKaartData
  /** Per product: de bewaarde webshopstand tegen wat een push nu zou sturen
   *  (`websiteOordeelVoorProduct`). Zonder: geen websiteregel. */
  website?: Record<number, WebsiteStandOordeel | null | undefined> | null
  taal?: string | null
}

// ── Getallen als tekst ──────────────────────────────────────────────────────

const pct = (abv: number | null, taal?: string | null): string => {
  if (abv === null) return ''
  const g = fmtGetal(Math.round(abv * 10) / 10, 1, taal)
  return decimaalteken(taal) === '.' ? `${g}%` : `${g} %`
}
const heel = (n: number | null): string => (n === null ? '' : String(Math.round(n)))

const abvBronTekst = (w: EtiketWaarden, t: Vertaal): string => {
  const a = w.abv
  let s = vul(t, a.bronSleutel, a.bronParams)
  if (!a.vastgezet && a.bron !== 'verwacht' && a.bron !== 'geen') s = `${s} · ${t('etiket_abv_niet_vastgezet')}`
  return s
}

// ── De bronketens ───────────────────────────────────────────────────────────

const abvKeten = (w: EtiketWaarden, pe: ProductEtiketWaarden | null, v: EtiketVergelijking | null,
  t: Vertaal, taal?: string | null): string[] => {
  const uit: string[] = []
  const a = w.abv
  for (const k of a.keten) {
    const label = k.bron === 'vastgezet' && a.vastgezetBron === 'lab' ? t('etiket_bron_abv_vastgezet_lab')
      : k.bron === 'berekend' ? (a.berekend ? vul(t, a.berekend.suikerPct > 0 ? 'etiket_bron_abv_berekend_suiker'
        : 'etiket_bron_abv_berekend', {og: fmtSg(a.og, ''), fg: fmtSg(a.fg, '')}) : t('etiket_bron_abv_balling'))
      : t(`etiket_bron_abv_${k.bron}`)
    uit.push(`${label}: ${fmtAbv(k.waarde, taal)}`)
  }
  if (a.zonderHergisting) uit.push(t('etiket_zonder_hergisting'))
  if (a.suiker.hergisting.length) uit.push(vul(t, 'etiket_keten_hergisting', {namen: a.suiker.hergisting.join(', ')}))
  if (pe) {
    uit.push(pe.abv.waarde !== null
      ? `${vul(t, pe.abv.bronSleutel, pe.abv.bronParams)}: ${fmtAbv(pe.abv.waarde, taal)}`
      : `${t('etiket_bron_etiket')}: ${t('etiket_oordeel_leeg')}`)
  }
  if (v?.abv.marge !== undefined) {
    uit.push(vul(t, 'etiket_keten_marge', {marge: fmtGetal(v.abv.marge, 1, taal)})
      + (v.abv.margeReden ? ` ${t(`etiket_marge_reden_${v.abv.margeReden}`)}` : ''))
  }
  if (a.labAdvies && a.labAdviesReden) uit.push(t(`etiket_lab_advies_${a.labAdviesReden}`))
  return uit
}

const getalKeten = (
  batch: {waarde: number | null, bronSleutel: string, verwacht: number | null, bron: string},
  etiket: {waarde: number | null, bronSleutel: string} | null,
  eenheid: string, receptSleutel: string, t: Vertaal,
): string[] => {
  const uit: string[] = []
  if (batch.waarde !== null) uit.push(`${t(batch.bronSleutel)}: ${heel(batch.waarde)} ${eenheid}`)
  if (batch.verwacht !== null && batch.bron !== 'recept') uit.push(`${t(receptSleutel)}: ${heel(batch.verwacht)} ${eenheid}`)
  if (etiket) uit.push(`${t(etiket.bronSleutel)}: ${etiket.waarde !== null ? `${heel(etiket.waarde)} ${eenheid}` : t('etiket_oordeel_leeg')}`)
  return uit.length ? uit : [t('etiket_bron_geen')]
}

// ── Lotcode en THT ──────────────────────────────────────────────────────────

const thtTekst = (lot: EtiketLot, t: Vertaal): string => {
  if (lot.thtBron === 'geen') return t('etiket_tht_geen')
  if (!lot.tht) return t('etiket_tht_onbekend')
  if (lot.voorspeld) {
    return vul(t, 'etiket_tht_voorspeld', {
      datum: datumKort(lot.tht),
      maanden: lot.thtMaanden ?? '',
      klasse: t(`etiket_tht_klasse_${lot.thtKlasse as ThtKlasse}`, lot.thtKlasse || ''),
    })
  }
  return vul(t, 'etiket_tht', {datum: datumKort(lot.tht)})
}

const kaartLot = (lot: EtiketLot, productId: number | null, t: Vertaal): KaartLot => {
  const lotcode = lot.voorspeld ? vul(t, 'etiket_lot_ev', {lotcode: lot.lotcode}) : (lot.lotcode || t('etiket_lot_zonder_code'))
  const verpakking = lot.voorspeld ? '' : [lot.verpakkingNaam, lot.aantal > 0 ? vul(t, 'etiket_lot_aantal', {n: lot.aantal}) : '']
    .filter(Boolean).join(' · ')
  const ontbreekt = lot.artikelOntbreekt && lot.verpakkingId !== null
    ? (productId !== null && lot.productIds.includes(productId) ? productId : lot.productIds[0] ?? null)
    : null
  return {
    lotcode,
    toelichting: lot.voorspeld ? t('etiket_lot_toelichting') : '',
    verpakking,
    tht: thtTekst(lot, t),
    voorspeld: lot.voorspeld,
    artikelMaken: ontbreekt !== null && lot.verpakkingId !== null ? {productId: ontbreekt, verpakkingId: lot.verpakkingId} : null,
  }
}

// ── Per product ─────────────────────────────────────────────────────────────

const chipsVan = (lijst: Allergeen[], nadruk: Allergeen[], t: Vertaal): KaartChip[] =>
  lijst.map(a => ({tekst: t(`etiket_allergeen_${a}`, a), nadruk: nadruk.includes(a)}))

const vergelekenMet = (pe: ProductEtiketWaarden | null, naam: string, t: Vertaal): string => {
  if (!pe) return ''
  if (pe.etiketVersie && pe.bijgewerkt) return vul(t, 'etiket_kaart_vergeleken_versie', {versie: pe.etiketVersie, datum: datumKort(pe.bijgewerkt)})
  if (pe.etiketVersie) return vul(t, 'etiket_kaart_vergeleken_versie_kort', {versie: pe.etiketVersie})
  return vul(t, 'etiket_kaart_vergeleken_product', {product: naam || t('lbl_naamloos')})
}

/** Wat "Kopieer etiketgegevens" kopieert. In de batchstand: wat er voor déze
 *  batch op het etiket hoort — de ABV van het etiket zolang die binnen de
 *  marge valt (dan hoeft er niets te veranderen), anders die van de batch; de
 *  allergenen van de batch als het etiket ze mist of nog niet kent (en de
 *  batch ze volledig kent), anders die van het etiket. Lotcode en THT van de
 *  eerste verpakking. Elders: het etiket zoals het is. */
const kopieVoor = (
  modus: EtiketKaartModus, product: ProductLike | null, w: EtiketWaarden | null, v: EtiketVergelijking | null,
  lot: EtiketLot | null, data: EtiketKaartData, t: Vertaal, taal?: string | null,
): string => {
  if (!product) return ''
  let abv: number | null | undefined
  let allergenen: Allergeen[] | null | undefined
  if (modus === 'batch' && w && v) {
    if (v.abv.oordeel === 'buiten_marge' || v.abv.oordeel === 'leeg') abv = w.abv.waarde
    const al = v.allergenen.oordeel
    if ((al === 'ontbreekt' || al === 'teveel' || al === 'leeg') && w.allergenen.volledig) allergenen = w.allergenen.lijst
  }
  const verpakking = lot && lot.verpakkingId !== null
    ? (data.verpakkingen || []).find(x => Number(x.id) === lot.verpakkingId) : null
  const artikel = lot && lot.verpakkingId !== null
    ? (data.productArtikelen || []).find(a => Number(a.product_id) === Number(product.id) && Number(a.verpakking_id) === lot.verpakkingId)
    : null
  return etiketKopieTekst({
    product,
    abv: abv ?? undefined,
    allergenen: allergenen ?? undefined,
    inhoudLiter: verpakking?.inhoud_liter ?? artikel?.inhoud_liter ?? null,
    lotcode: lot && modus === 'batch' ? lot.lotcode : null,
    tht: lot && modus === 'batch' ? lot.tht : null,
    brouwerij: data.brouwerij || null,
    ean: tekst(artikel?.ean) || null,
    taal,
  }, t)
}

const productBlok = (
  modus: EtiketKaartModus, w: EtiketWaarden, product: ProductLike | null, data: EtiketKaartData,
  website: WebsiteStandOordeel | null | undefined, t: Vertaal, taal?: string | null,
  etiketVooraf?: ProductEtiketWaarden | null,
): KaartProductBlok => {
  const pe = product ? (etiketVooraf || productEtiketWaarden(product, data)) : null
  const v = pe ? vergelijkEtiket(w, pe) : null
  const naam = tekst(product?.naam)
  const s = v ? etiketStatus(v, {websiteAchter: website?.status === 'achter'}) : null
  const status = s
    ? {tekst: etiketStatusTekst(s, t), kleur: s.kleur, actie: s.actie}
    // Zonder product is er geen etiket: dezelfde oranje chip als een etiket
    // dat nog niet is vastgelegd (de ketenregel biedt "Product kiezen").
    : {tekst: t('etiket_status_niet_vastgelegd'), kleur: 'oranje' as const, actie: null}
  const oordeelVan = (r: EtiketRegel | AllergeenOordeel | undefined): KaartOordeel =>
    r ? {tekst: etiketRegelTekst(r, t, taal), kleur: r.kleur} : {tekst: t('etiket_oordeel_geen_product'), kleur: 'grijs'}
  const etiketBron = (sleutel: string, params?: Record<string, string>) => vul(t, sleutel, params || {})
  const leegEtiket: KaartCel = {waarde: '', bron: t('etiket_geen_product_kort')}

  // ── Verplicht op het etiket ──
  const abv: KaartRegel = {
    veld: 'abv', label: t('etiket_regel_abv'),
    batch: {waarde: fmtAbv(w.abv.waarde, taal), bron: w.abv.waarde === null ? t('etiket_bron_geen') : abvBronTekst(w, t)},
    etiket: pe ? {waarde: fmtAbv(pe.abv.waarde, taal), bron: pe.abv.waarde === null ? t('etiket_oordeel_leeg')
      : etiketBron(pe.abv.bronSleutel, pe.abv.bronParams)} : leegEtiket,
    oordeel: oordeelVan(v?.abv),
    keten: abvKeten(w, pe, v, t, taal),
  }

  const al = w.allergenen
  const ontbreekt = v?.allergenen.ontbreekt || []
  const teveel = v?.allergenen.teveel || []
  const batchAllergeenBron = al.bron === 'geen' ? t('etiket_allergenen_geen_regels')
    : al.bron === 'recept' ? t('etiket_allergenen_bron_recept')
    : al.herkomst.length ? vul(t, 'etiket_allergenen_uit', {namen: al.herkomst.join(', ')})
    : al.volledig ? t('etiket_allergenen_geen') : ''
  const verschilt = !!pe && pe.allergenen.gezet && (ontbreekt.length > 0 || teveel.length > 0)
  const nietVastgelegd = !!pe && !pe.allergenen.gezet && al.lijst.length > 0
  // "Op het etiket nu → Moet worden" alleen als de gedrukte regel echt
  // verandert. Gluten heet op het etiket naar de graansoort (gerst, tarwe):
  // ontbreekt alleen het vinkje gluten bij gerst + tarwe, dan blijft de regel
  // gelijk — het oordeel (zelfde vergelijking als CCP 3) blijft wel staan.
  const bevatNu = pe && pe.allergenen.gezet
    ? (allergeenRegel(pe.allergenen.lijst, t) || t('etiket_allergenen_geen')) : t('etiket_oordeel_leeg')
  const bevatMoet = allergeenRegel(al.lijst, t) || t('etiket_allergenen_geen')
  const bevat = (verschilt || nietVastgelegd) && bevatNu !== bevatMoet ? {nu: bevatNu, moet: bevatMoet} : null
  const etiketAllergenenBron = pe
    ? (pe.allergenen.gezet ? etiketBron(pe.abv.bronSleutel, pe.abv.bronParams) : t('etiket_oordeel_leeg'))
    : t('etiket_geen_product_kort')
  const allergenen: KaartRegel = {
    veld: 'allergenen', label: t('etiket_regel_allergenen'),
    batch: {waarde: al.lijst.length ? '' : (al.volledig ? t('etiket_allergenen_geen') : '—'), bron: batchAllergeenBron,
      chips: chipsVan(al.lijst, ontbreekt, t)},
    etiket: pe ? {waarde: pe.allergenen.gezet && !pe.allergenen.lijst.length ? t('etiket_allergenen_geen') : '',
      bron: etiketAllergenenBron, chips: chipsVan(pe.allergenen.lijst, teveel, t)} : leegEtiket,
    oordeel: oordeelVan(v?.allergenen),
    bevat,
    keten: [
      ...Object.entries(al.perAllergeen).map(([a, namen]) =>
        `${t(`etiket_allergeen_${a}`, a)}: ${(namen || []).join(', ')}`),
      ...(al.nietBeoordeeld.length ? [vul(t, 'etiket_oordeel_onvolledig', {ingredienten: al.nietBeoordeeld.join(', ')})] : []),
      ...(al.nietInCatalogus.length ? [vul(t, 'etiket_keten_niet_in_catalogus', {namen: al.nietInCatalogus.join(', ')})] : []),
      ...(pe ? [`${etiketAllergenenBron}: ${pe.allergenen.gezet ? (allergeenNamen(pe.allergenen.lijst, t).join(', ') || t('etiket_allergenen_geen')) : t('etiket_oordeel_leeg')}`] : []),
    ],
  }

  const eigenLots = product
    ? w.lots.filter(l => l.voorspeld || !l.productIds.length || l.productIds.includes(Number(product.id)))
    : w.lots
  const lots = eigenLots.map(l => kaartLot(l, product ? Number(product.id) : null, t))
  const lotOordeel: KaartOordeel = !lots.length ? {tekst: t('etiket_lot_geen'), kleur: 'grijs'}
    : lots.some(l => l.voorspeld) ? {tekst: t('etiket_lot_volgt'), kleur: 'grijs'}
    : lots.some(l => l.artikelMaken) ? {tekst: t('etiket_lot_artikel_ontbreekt'), kleur: 'oranje'}
    : {tekst: t('etiket_lot_vastgelegd'), kleur: 'grijs'}
  const lot: KaartRegel = {
    veld: 'lot', label: t('etiket_regel_lot'),
    batch: {waarde: lots.map(l => l.lotcode).join(', '), bron: ''},
    etiket: null,
    oordeel: lotOordeel,
    lots,
    keten: eigenLots.map(l => `${l.voorspeld ? vul(t, 'etiket_lot_ev', {lotcode: l.lotcode}) : l.lotcode}: ${thtTekst(l, t)}`),
  }

  // ── Voor de website ──
  const ibu: KaartRegel = {
    veld: 'ibu', label: t('etiket_regel_ibu'),
    batch: {waarde: w.ibu.waarde !== null ? `${heel(w.ibu.waarde)} IBU` : '', bron: t(w.ibu.bronSleutel)},
    etiket: pe ? {waarde: heel(pe.ibu.waarde), bron: pe.ibu.waarde === null ? t('etiket_oordeel_leeg') : t(pe.ibu.bronSleutel)} : leegEtiket,
    oordeel: oordeelVan(v?.ibu),
    keten: getalKeten(w.ibu, pe ? pe.ibu : null, 'IBU', 'etiket_bron_ibu_recept', t),
  }
  const ebc: KaartRegel = {
    veld: 'ebc', label: t('etiket_regel_ebc'),
    batch: {waarde: w.ebc.waarde !== null ? `${heel(w.ebc.waarde)} EBC` : '', bron: t(w.ebc.bronSleutel)},
    etiket: pe ? {waarde: heel(pe.ebc.waarde), bron: pe.ebc.waarde === null ? t('etiket_oordeel_leeg') : t(pe.ebc.bronSleutel)} : leegEtiket,
    oordeel: oordeelVan(v?.ebc),
    keten: getalKeten(w.ebc, pe ? pe.ebc : null, 'EBC', 'etiket_bron_ebc_recept', t),
  }
  const energieTekst = (kcal: number | null, kj: number | null) =>
    kcal !== null && kj !== null ? vul(t, 'etiket_energie_waarde', {kcal: heel(kcal), kj: heel(kj)}) : ''
  const energie: KaartRegel = {
    veld: 'energie', label: t('etiket_regel_energie'),
    batch: {waarde: energieTekst(w.energie.kcal, w.energie.kj), bron: t(w.energie.bronSleutel)},
    etiket: pe ? {waarde: pe.energie.vermeld ? energieTekst(pe.energie.kcal, pe.energie.kj) : '',
      bron: t(pe.energie.bronSleutel)} : leegEtiket,
    oordeel: oordeelVan(v?.energie),
    keten: [
      ...(w.energie.bron !== 'geen' ? [`${t(w.energie.bronSleutel)}: ${energieTekst(w.energie.kcal, w.energie.kj)}`] : []),
      ...(pe ? [pe.energie.vermeld
        ? `${t('etiket_bron_etiket')}: ${energieTekst(pe.energie.kcal, pe.energie.kj) || t('etiket_oordeel_leeg')}`
        : `${t('etiket_bron_etiket')}: ${t('etiket_energie_niet_vermeld')}`] : []),
      t('etiket_keten_energie_factoren'),
    ],
  }
  const verschil = pe ? ingredientenVerschil(w.ingredienten.tekst, pe.ingredienten.tekst) : {ontbreekt: [], teveel: []}
  const ingEtiketBron = pe ? t(pe.ingredienten.bronSleutel) : ''
  const ingEtiketWaarde = !pe || !pe.ingredienten.tekst ? ''
    : verschil.ontbreekt.length && !verschil.teveel.length
      ? vul(t, 'etiket_ingredienten_zonder', {bron: ingEtiketBron, namen: verschil.ontbreekt.join(', ')})
      : verschil.teveel.length && !verschil.ontbreekt.length
        ? vul(t, 'etiket_ingredienten_met', {bron: ingEtiketBron, namen: verschil.teveel.join(', ')})
        : pe.ingredienten.tekst
  const ingredienten: KaartRegel = {
    veld: 'ingredienten', label: t('etiket_regel_ingredienten'),
    batch: {waarde: w.ingredienten.tekst, bron: t(w.ingredienten.bronSleutel)},
    etiket: pe ? {waarde: ingEtiketWaarde, bron: pe.ingredienten.tekst ? ingEtiketBron : t('etiket_oordeel_leeg')} : leegEtiket,
    oordeel: oordeelVan(v?.ingredienten),
    ingeklapt: true,
    volledig: {batch: w.ingredienten.tekst, etiket: pe?.ingredienten.tekst || ''},
    keten: [
      `${t(w.ingredienten.bronSleutel)}: ${w.ingredienten.tekst || t('etiket_bron_geen')}`,
      ...(pe ? [`${ingEtiketBron || t('etiket_bron_etiket')}: ${pe.ingredienten.tekst || t('etiket_oordeel_leeg')}`] : []),
    ],
  }

  // ── Telefoon: tegels ──
  const sub = (...delen: string[]) => delen.filter(Boolean).join(' · ')
  const tegels: KaartTegel[] = [
    {veld: 'abv', label: t('etiket_regel_abv'), waarde: pct(w.abv.waarde, taal) || '—',
      sub: sub(t(bronKortSleutel(w.abv.bron)), pe ? (pe.abv.waarde !== null
        ? vul(t, 'etiket_tegel_etiket', {waarde: fmtGetal(Math.round(pe.abv.waarde * 10) / 10, 1, taal)})
        : t('etiket_tegel_etiket_leeg')) : ''),
      kleur: v ? v.abv.kleur : 'grijs', ketenTitel: t('etiket_regel_abv'), keten: abv.keten},
    {veld: 'ibu', label: t('etiket_regel_ibu'), waarde: w.ibu.waarde !== null ? `${heel(w.ibu.waarde)} IBU` : '—',
      sub: sub(t(bronKortSleutel(w.ibu.bron === 'geen' ? 'geen' : w.ibu.bron)),
        pe && pe.ibu.waarde !== null ? vul(t, 'etiket_tegel_website', {waarde: heel(pe.ibu.waarde)}) : ''),
      kleur: v ? v.ibu.kleur : 'grijs', ketenTitel: t('etiket_regel_ibu'), keten: ibu.keten},
    {veld: 'ebc', label: t('etiket_regel_ebc'), waarde: w.ebc.waarde !== null ? `${heel(w.ebc.waarde)} EBC` : '—',
      sub: sub(t(bronKortSleutel(w.ebc.bron === 'geen' ? 'geen' : 'recept')),
        v?.ebc.oordeel === 'gelijk' ? t('etiket_tegel_gelijk')
          : pe && pe.ebc.waarde !== null ? vul(t, 'etiket_tegel_website', {waarde: heel(pe.ebc.waarde)}) : ''),
      kleur: v ? v.ebc.kleur : 'grijs', ketenTitel: t('etiket_regel_ebc'), keten: ebc.keten},
    {veld: 'energie', label: t('etiket_tegel_energie'), waarde: w.energie.kcal !== null ? `${heel(w.energie.kcal)} kcal` : '—',
      sub: sub(w.energie.kj !== null ? `${heel(w.energie.kj)} kJ` : '',
        pe ? t(pe.energie.vermeld ? 'etiket_tegel_op_etiket' : 'etiket_tegel_niet_op_etiket') : ''),
      kleur: v ? v.energie.kleur : 'grijs', ketenTitel: t('etiket_regel_energie'), keten: energie.keten},
  ]

  const eersteLot = eigenLots[0] || null
  const lotRegel = !eigenLots.length ? t('etiket_lot_geen')
    : eersteLot && eersteLot.voorspeld
      ? vul(t, 'etiket_lot_regel_voorspeld', {lotcode: vul(t, 'etiket_lot_ev', {lotcode: eersteLot.lotcode})})
      : lots.map(l => [l.lotcode, l.tht].filter(Boolean).join(' · ')).join('; ')

  const standOp = website?.standOp ? datumKort(website.standOp.slice(0, 10)) : ''
  const website_stand = website && website.status !== 'onbekend'
    ? {tekst: vul(t, website.status === 'achter' ? 'etiket_website_achter' : 'etiket_website_gelijk', {datum: standOp}),
       achter: website.status === 'achter'}
    : null

  return {
    productId: product ? Number(product.id) : null,
    naam,
    status,
    vergelekenMet: vergelekenMet(pe, naam, t),
    verplicht: modus === 'recept' ? [abv, allergenen] : [abv, allergenen, lot],
    website: [ibu, ebc, energie, ingredienten],
    tegels,
    allergenen: {
      batch: allergenen.batch.chips || [],
      etiketLabel: pe?.etiketVersie ? vul(t, 'etiket_tegel_etiket_versie', {versie: pe.etiketVersie}) : t('etiket_tegel_etiket_label'),
      etiket: allergenen.etiket?.chips || [],
      etiketTekst: allergenen.etiket?.chips?.length ? '' : (allergenen.etiket?.waarde || allergenen.etiket?.bron || ''),
      oordeel: allergenen.oordeel,
      bevat,
    },
    lotRegel,
    website_stand,
    kopie: kopieVoor(modus, product, w, v, eersteLot, data, t, taal),
  }
}

// ── De kaart ────────────────────────────────────────────────────────────────

/** De producten van een batch voor de kaart: `product_id` en `product_ids`,
 *  anders het product van zijn afvullingen (een oude batch zonder koppeling). */
export const productenVoorEtiketKaart = (
  batch: BatchLike, producten: ProductLike[] | null | undefined, afvullingen?: EtiketCtx['afvullingen'],
): ProductLike[] => {
  const lijst = producten || []
  const uit = productIdsVoorBatch(batch)
    .map(id => lijst.find(p => Number(p.id) === Number(id)))
    .filter((p): p is ProductLike => !!p)
  if (uit.length) return uit
  const id = productVoorBatch(batch, {afvullingen: afvullingen || [], producten: lijst}).productId
  const p = id != null ? lijst.find(x => Number(x.id) === Number(id)) : null
  return p ? [p] : []
}

/**
 * Dezelfde regels als de kaart, uit al berekende waarden: voor het
 * batchdossier (utils/batchRapport.ts bevriest `etiketWaarden` en per product
 * `productEtiketWaarden`; BatchRapportExport zet de blokken op papier). Zo
 * zegt het dossier precies wat de kaart in Gereed zegt.
 */
export const etiketKaartBlokken = (
  w: EtiketWaarden,
  producten: Array<{product: ProductLike, etiket: ProductEtiketWaarden}>,
  t: Vertaal,
  taal?: string | null,
): KaartProductBlok[] => (producten.length ? producten : [null]).map(p =>
  productBlok('batch', w, p ? p.product : null, {}, null, t, taal, p ? p.etiket : null))

/** Waartegen het etiket van een product getoetst wordt. */
export interface ProductVergelijking {
  waarden: EtiketWaarden
  /** De referentiebatch (`referentieBatch`), of null als het recept de maat is. */
  ref: BatchLike | null
  /** Zonder referentiebatch: het huidige recept ("Etiket verwacht"). */
  recept: ReceptLike | null
}

/**
 * De waarden waartegen het etiket van een product getoetst wordt: die van de
 * referentiebatch (de nieuwste met een gemeten FG, anders de laatst
 * afgevulde), en zonder referentiebatch die van het huidige recept. Null als
 * er geen van beide is. Eén keuze voor de kaart, de kop van de productpagina,
 * de ketenstrook en de productlijst — zodat ze nooit iets anders zeggen.
 */
export const productVergelijking = (
  product: ProductLike | null | undefined, data: EtiketKaartData,
): ProductVergelijking | null => {
  if (!product) return null
  const ref = referentieBatch(product, data.batches)
  if (ref) return {waarden: etiketWaarden(ref, data), ref, recept: null}
  const huidig = huidigReceptVoorProduct(product, data.batches, data.recepten)
  const recept = huidig.receptId ? (data.recepten || []).find(r => r.id === huidig.receptId) || null : null
  return recept ? {waarden: receptEtiketWaarden(recept, data), ref: null, recept} : null
}

/**
 * Alles wat de kaart "Etiket & website" toont, per product één blok. De
 * statuschip in de kop is de zwaarste over de producten (rood > oranje >
 * groen); de knop van de kaart volgt die (`actie`).
 */
export const etiketKaartModel = (invoer: EtiketKaartInvoer, t: Vertaal): EtiketKaartModel => {
  const {modus, data, taal} = invoer
  const titel = t(modus === 'recept' ? 'etiket_kaart_titel_recept' : 'etiket_kaart_titel')
  let w: EtiketWaarden | null = null
  let kolomBatch = t('etiket_kolom_batch')
  let producten: ProductLike[] = []

  if (modus === 'batch' && invoer.batch) {
    w = etiketWaarden(invoer.batch, data)
    producten = productenVoorEtiketKaart(invoer.batch, data.producten, data.afvullingen)
  } else if (modus === 'product' && invoer.product) {
    producten = [invoer.product]
    const v = productVergelijking(invoer.product, data)
    if (v?.ref) {
      w = v.waarden
      const afgevuld = ['Afgevuld', 'Verpakt', 'Gesloten'].includes(tekst(v.ref.status))
      const nr = tekst(v.ref.batch_nummer) || String(v.ref.id)
      kolomBatch = vul(t, afgevuld ? 'etiket_kolom_laatste_batch' : 'etiket_kolom_volgende_batch', {nr})
    } else if (v) {
      w = v.waarden
      kolomBatch = t('etiket_kolom_recept')
    }
  } else if (modus === 'recept' && invoer.recept) {
    w = receptEtiketWaarden(invoer.recept, data)
    kolomBatch = t('etiket_kolom_recept')
    producten = invoer.product ? [invoer.product] : []
  }

  if (!w) {
    return {modus, titel, status: null, kolomBatch, producten: [], leeg: true, waarden: null}
  }
  const blokken = (producten.length ? producten : [null]).map(p =>
    productBlok(modus, w as EtiketWaarden, p, data, p ? invoer.website?.[Number(p.id)] : null, t, taal))
  const zwaarste = blokken.reduce((max, b) => (RANG[b.status.kleur] > RANG[max.status.kleur] ? b : max), blokken[0])
  // Zonder product (een recept dat aan geen product hangt) is er geen etiket
  // om mee te vergelijken: dan geen chip.
  const status = modus === 'recept' && !producten.length ? null : zwaarste.status
  return {modus, titel, status, kolomBatch, producten: blokken, leeg: false, waarden: w}
}

// ── Website ─────────────────────────────────────────────────────────────────

/**
 * Loopt de webshop achter op het etiket van dit product? Per artikel met een
 * bewaarde stand (`wc.meta_stand`) dezelfde vergelijking als de push zou
 * maken (`websiteLooptAchter`); één artikel dat achterloopt maakt het product
 * "achter". Geen enkele stand = `onbekend` (nooit "achter"). De recepten zijn
 * die van `product.recept_ids`, zoals bij de push op de productpagina.
 */
export const websiteOordeelVoorProduct = (
  product: ProductLike | null | undefined,
  productArtikelen: Array<Pick<ProductArtikel, 'product_id'> & Partial<ProductArtikel>> | null | undefined,
  bron?: (Omit<BierInfoBron, 'product' | 'artikel' | 'recepten'> & {recepten?: ReceptLike[] | null, bevatRegel?: string | null}) | null,
): WebsiteStandOordeel => {
  if (!product) return {status: 'onbekend', verschillen: [], standOp: null}
  const eigen = (productArtikelen || []).filter(a => !!a && Number(a.product_id) === Number(product.id) && !!a.wc?.meta_stand)
  const ids = product.recept_ids || []
  const recepten = (bron?.recepten || []).filter(r => ids.includes(r.id))
  let achter: WebsiteStandOordeel | null = null
  let gelijk: WebsiteStandOordeel | null = null
  for (const a of eigen) {
    const o = websiteLooptAchter(a, product, {...(bron || {}), recepten})
    if (o.status === 'achter' && (!achter || tekst(o.standOp) > tekst(achter.standOp))) achter = o
    if (o.status === 'gelijk' && (!gelijk || tekst(o.standOp) > tekst(gelijk.standOp))) gelijk = o
  }
  return achter || gelijk || {status: 'onbekend', verschillen: [], standOp: null}
}
