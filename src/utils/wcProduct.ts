// WooCommerce-productvelden — de volledige productkaart uit de webshop, hier
// beheerd zodat je niet twee keer hetzelfde hoeft in te typen.
//
// Uitgangspunten:
//
//  1. **De app is de bron, maar overschrijft nooit blind.** Een veld dat lokaal
//     leeg is gaat *niet* mee in de payload. Zo kan een push nooit een
//     omschrijving, categorie of afbeelding in de webshop wissen doordat je hem
//     hier nog niet had ingevuld. Wil je iets écht leegmaken, dan doe je dat in
//     WooCommerce zelf (of je zet een spatie — dat is een waarde).
//  2. **Prijzen zijn lokaal altijd exclusief BTW.** WooCommerce-winkels voeren
//     prijzen doorgaans inclusief BTW in; `prijzenInclBtw` (instelling bij de
//     WooCommerce-koppeling) bepaalt hoe er omgerekend wordt.
//  3. **Afbeeldingen zijn verwijzingen, geen uploads.** De WooCommerce REST API
//     accepteert alleen een `id` (bestaande media) of een `src` (URL die de
//     winkel zelf ophaalt); base64 uit deze app kan er niet in. Vandaar dat
//     afbeeldingen hier als lijst met id/URL beheerd worden.
//  4. **Geen enkel veld is verplicht.** Elk artikel dat nog geen `wc`-blok
//     heeft gedraagt zich exact als vroeger: alleen voorraad wordt gepusht.

export type WcStatus = 'publish' | 'draft' | 'pending' | 'private'
export type WcZichtbaarheid = 'visible' | 'catalog' | 'search' | 'hidden'
export type WcBackorders = 'no' | 'notify' | 'yes'
export type WcBtwStatus = 'taxable' | 'shipping' | 'none'

export const WC_STATUSSEN: WcStatus[] = ['publish', 'draft', 'pending', 'private']
export const WC_ZICHTBAARHEDEN: WcZichtbaarheid[] = ['visible', 'catalog', 'search', 'hidden']
export const WC_BACKORDERS: WcBackorders[] = ['no', 'notify', 'yes']
export const WC_BTW_STATUSSEN: WcBtwStatus[] = ['taxable', 'shipping', 'none']

export interface WcAfbeelding {
  /** Media-id in WordPress (na een pull altijd gevuld). */
  id?: number
  /** Publieke URL — WooCommerce haalt de afbeelding zelf op bij een push. */
  src?: string
  alt?: string
  naam?: string
}

export interface WcCategorie { id: number; naam: string; parent?: number }

/** Alle WooCommerce-velden die de app beheert, opgeslagen per artikel. */
export interface WcVelden {
  /** Product-id in WooCommerce; gevuld zodra het artikel gekoppeld of aangemaakt is. */
  wc_id?: number
  naam?: string
  slug?: string
  status?: WcStatus
  zichtbaarheid?: WcZichtbaarheid
  uitgelicht?: boolean
  korte_omschrijving?: string
  omschrijving?: string
  /** Actieprijs, in dezelfde eenheid als `verkoopprijs`: exclusief BTW. */
  actieprijs?: number | string
  actie_van?: string
  actie_tot?: string
  gewicht?: number | string
  lengte?: number | string
  breedte?: number | string
  hoogte?: number | string
  categorie_ids?: number[]
  tags?: string[]
  verzendklasse?: string
  btw_status?: WcBtwStatus
  btw_klasse?: string
  backorders?: WcBackorders
  lage_voorraad?: number | string
  apart_verkopen?: boolean
  menu_volgorde?: number | string
  afbeeldingen?: WcAfbeelding[]
  /** Laatste geslaagde push resp. pull (ISO-tijdstip). */
  gesynct?: string
  gepulld?: string
  /** Permalink uit WooCommerce — handig om de productpagina te openen. */
  permalink?: string
  /**
   * Eigen productvelden van het thema of een plugin (`meta_data` in de REST
   * API). Het Craftery-thema zet hier bijvoorbeeld `_cf_abv`, `_cf_stijl` en
   * de smaakassen neer — zie `utils/craftery.ts`. Alleen de sleutels die de
   * app kent worden gelezen en geschreven; de rest van de meta van de winkel
   * blijft onaangeraakt.
   */
  meta?: Record<string, WcMetaWaarde>
}

/** Een meta-waarde: tekst, getal of een lijstje label/waarde-regels. */
export type WcMetaWaarde = string | number | WcMetaRegel[]
export interface WcMetaRegel { label: string; value: string }

export interface WcPayloadInput {
  velden?: WcVelden | null
  /** Naam wanneer `velden.naam` leeg is (meestal "product + verpakking"). */
  naamFallback?: string
  sku?: string | null
  /** Normale verkoopprijs, exclusief BTW (uit het artikel zelf). */
  prijsExcl?: number | string | null
  btwPct?: number | string | null
  /** Voorraad om mee te sturen; `null`/undefined = voorraad niet aanraken. */
  voorraad?: number | null
  /** Winkel voert prijzen inclusief BTW in (WooCommerce-standaard in NL). */
  prijzenInclBtw?: boolean
  /** Omschrijving wanneer `velden.omschrijving` leeg is (productomschrijving). */
  omschrijvingFallback?: string
  /** Alleen bij aanmaken: WooCommerce vereist een producttype. */
  nieuw?: boolean
}

const _leeg = (v: any) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '')

// Een meta-waarde telt als leeg bij een lege tekst of een lege regellijst.
const _leegMeta = (v: any): boolean =>
  v === undefined || v === null ||
  (Array.isArray(v) ? v.length === 0 : String(v).trim() === '')

const _num = (v: any): number | null => {
  if (_leeg(v)) return null
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

/** Rond af op hele centen en geef WooCommerce's stringformaat terug. */
export const wcPrijsString = (
  bedragExcl: number | string | null | undefined,
  btwPct: number | string | null | undefined,
  inclBtw: boolean,
): string => {
  const excl = _num(bedragExcl)
  if (excl === null || excl < 0) return ''
  const pct = _num(btwPct) ?? 0
  const bedrag = inclBtw ? excl * (1 + pct / 100) : excl
  return (Math.round(bedrag * 100) / 100).toFixed(2)
}

/** Omgekeerde weg: een WooCommerce-prijs terug naar een bedrag exclusief BTW. */
export const wcPrijsNaarExcl = (
  wcPrijs: number | string | null | undefined,
  btwPct: number | string | null | undefined,
  inclBtw: boolean,
): number | null => {
  const p = _num(wcPrijs)
  if (p === null) return null
  const pct = _num(btwPct) ?? 0
  const excl = inclBtw ? p / (1 + pct / 100) : p
  return Math.round(excl * 100) / 100
}

const _dim = (v: any): string => {
  const n = _num(v)
  return n === null ? '' : String(n)
}

/**
 * Bouw de payload voor een WooCommerce product-PUT (bijwerken) of -POST
 * (aanmaken). Lege lokale velden blijven weg zodat de webshop ze behoudt.
 */
export function bouwWcPayload(input: WcPayloadInput): Record<string, any> {
  const v = input.velden || {}
  const inclBtw = input.prijzenInclBtw !== false
  const out: Record<string, any> = {}

  if (input.nieuw) out.type = 'simple'

  const naam = !_leeg(v.naam) ? String(v.naam).trim() : String(input.naamFallback || '').trim()
  if (naam) out.name = naam
  if (!_leeg(input.sku)) out.sku = String(input.sku).trim()
  if (!_leeg(v.slug)) out.slug = String(v.slug).trim()

  if (v.status && WC_STATUSSEN.includes(v.status)) out.status = v.status
  if (v.zichtbaarheid && WC_ZICHTBAARHEDEN.includes(v.zichtbaarheid)) out.catalog_visibility = v.zichtbaarheid
  if (typeof v.uitgelicht === 'boolean') out.featured = v.uitgelicht
  if (typeof v.apart_verkopen === 'boolean') out.sold_individually = v.apart_verkopen

  const omschrijving = !_leeg(v.omschrijving) ? String(v.omschrijving) : String(input.omschrijvingFallback || '')
  if (!_leeg(omschrijving)) out.description = omschrijving
  if (!_leeg(v.korte_omschrijving)) out.short_description = String(v.korte_omschrijving)

  const prijs = wcPrijsString(input.prijsExcl, input.btwPct, inclBtw)
  if (prijs) out.regular_price = prijs
  const actie = wcPrijsString(v.actieprijs, input.btwPct, inclBtw)
  if (actie) {
    out.sale_price = actie
    // Alleen een ingevulde periode meesturen: lege datums zouden een lopende
    // actie in de winkel per direct beëindigen.
    if (!_leeg(v.actie_van)) out.date_on_sale_from = String(v.actie_van)
    if (!_leeg(v.actie_tot)) out.date_on_sale_to = String(v.actie_tot)
  }

  if (input.voorraad !== undefined && input.voorraad !== null && Number.isFinite(input.voorraad)) {
    out.manage_stock = true
    // WooCommerce weigert een negatieve voorraad niet, maar toont hem wel —
    // een tekort hoort niet als "min drie op voorraad" in de winkel te staan.
    out.stock_quantity = Math.max(0, Math.round(input.voorraad as number))
  }
  if (v.backorders && WC_BACKORDERS.includes(v.backorders)) out.backorders = v.backorders
  const laag = _num(v.lage_voorraad)
  if (laag !== null) out.low_stock_amount = laag

  const gewicht = _dim(v.gewicht)
  if (gewicht) out.weight = gewicht
  const lengte = _dim(v.lengte), breedte = _dim(v.breedte), hoogte = _dim(v.hoogte)
  if (lengte || breedte || hoogte) out.dimensions = {length: lengte, width: breedte, height: hoogte}
  if (!_leeg(v.verzendklasse)) out.shipping_class = String(v.verzendklasse)

  if (v.btw_status && WC_BTW_STATUSSEN.includes(v.btw_status)) out.tax_status = v.btw_status
  if (!_leeg(v.btw_klasse)) out.tax_class = String(v.btw_klasse)

  const cats = (v.categorie_ids || []).map(n => _num(n)).filter((n): n is number => n !== null)
  if (cats.length) out.categories = cats.map(id => ({id}))
  const tags = (v.tags || []).map(s => String(s).trim()).filter(Boolean)
  if (tags.length) out.tags = tags.map(name => ({name}))

  const afb = (v.afbeeldingen || [])
    .map(a => (a.id ? {id: a.id, ...(a.alt ? {alt: a.alt} : {})} : (a.src ? {src: a.src, ...(a.alt ? {alt: a.alt} : {})} : null)))
    .filter(Boolean) as Record<string, any>[]
  if (afb.length) out.images = afb

  const volgorde = _num(v.menu_volgorde)
  if (volgorde !== null) out.menu_order = volgorde

  // Eigen productvelden. Lege waarden blijven weg — zelfde regel als hierboven:
  // wat je hier niet invult, blijft in de winkel staan zoals het was.
  const meta = Object.entries(v.meta || {})
    .filter(([sleutel, waarde]) => sleutel && !_leegMeta(waarde))
    .map(([key, value]) => ({key, value: Array.isArray(value) ? value : String(value)}))
  if (meta.length) out.meta_data = meta

  return out
}

/** Zet een WooCommerce-productantwoord om naar het lokale veldenblok. */
export function leesWcProduct(
  wc: any,
  opties?: {btwPct?: number | string | null, prijzenInclBtw?: boolean, metaSleutels?: string[]},
): WcVelden {
  const p = wc || {}
  const inclBtw = opties?.prijzenInclBtw !== false
  const actieExcl = wcPrijsNaarExcl(p.sale_price, opties?.btwPct, inclBtw)
  const dims = p.dimensions || {}
  const uit: WcVelden = {
    wc_id: _num(p.id) ?? undefined,
    naam: p.name || '',
    slug: p.slug || '',
    status: WC_STATUSSEN.includes(p.status) ? p.status : undefined,
    zichtbaarheid: WC_ZICHTBAARHEDEN.includes(p.catalog_visibility) ? p.catalog_visibility : undefined,
    uitgelicht: typeof p.featured === 'boolean' ? p.featured : undefined,
    korte_omschrijving: p.short_description || '',
    omschrijving: p.description || '',
    actieprijs: actieExcl !== null && actieExcl > 0 ? actieExcl.toFixed(2) : '',
    actie_van: (p.date_on_sale_from || '').slice(0, 10),
    actie_tot: (p.date_on_sale_to || '').slice(0, 10),
    gewicht: p.weight || '',
    lengte: dims.length || '',
    breedte: dims.width || '',
    hoogte: dims.height || '',
    categorie_ids: Array.isArray(p.categories) ? p.categories.map((c: any) => _num(c?.id)).filter((n: any): n is number => n !== null) : [],
    tags: Array.isArray(p.tags) ? p.tags.map((tg: any) => String(tg?.name || '')).filter(Boolean) : [],
    verzendklasse: p.shipping_class || '',
    btw_status: WC_BTW_STATUSSEN.includes(p.tax_status) ? p.tax_status : undefined,
    btw_klasse: p.tax_class || '',
    backorders: WC_BACKORDERS.includes(p.backorders) ? p.backorders : undefined,
    lage_voorraad: p.low_stock_amount ?? '',
    apart_verkopen: typeof p.sold_individually === 'boolean' ? p.sold_individually : undefined,
    menu_volgorde: _num(p.menu_order) ?? '',
    afbeeldingen: Array.isArray(p.images)
      ? p.images.map((i: any) => ({id: _num(i?.id) ?? undefined, src: i?.src || '', alt: i?.alt || '', naam: i?.name || ''}))
      : [],
    permalink: p.permalink || '',
  }
  // Alleen de meta-sleutels die de app beheert overnemen: de winkel zit vol
  // meta van WooCommerce zelf en van andere plugins, en daar blijven we af.
  const sleutels = opties?.metaSleutels || []
  if (sleutels.length) {
    const gevonden: Record<string, WcMetaWaarde> = {}
    for (const m of (Array.isArray(p.meta_data) ? p.meta_data : [])) {
      const key = String(m?.key || '')
      if (!sleutels.includes(key)) continue
      const w = m?.value
      gevonden[key] = Array.isArray(w)
        ? w.map((r: any) => ({label: String(r?.label ?? ''), value: String(r?.value ?? '')}))
        : (w === null || w === undefined ? '' : String(w))
    }
    uit.meta = gevonden
  }
  return uit
}

/** De normale verkoopprijs uit een WooCommerce-product, exclusief BTW. */
export const wcRegulierePrijsExcl = (
  wc: any,
  btwPct: number | string | null | undefined,
  prijzenInclBtw?: boolean,
): number | null => wcPrijsNaarExcl(wc?.regular_price, btwPct, prijzenInclBtw !== false)

export interface WcVerschil { veld: string; lokaal: string; extern: string }

const _toonWaarde = (val: any): string => {
  if (val === undefined || val === null) return ''
  if (Array.isArray(val)) {
    return val.map(v => {
      if (v && typeof v === 'object') {
        if ('label' in v) return `${v.label}: ${(v as any).value}`
        return String(v.name ?? v.id ?? v.src ?? '')
      }
      return String(v)
    }).filter(Boolean).join(', ')
  }
  if (typeof val === 'object') return Object.values(val).map(String).filter(Boolean).join(' × ')
  if (typeof val === 'boolean') return val ? 'ja' : 'nee'
  return String(val)
}

// Prijs- en getalvelden vergelijken we numeriek: WooCommerce geeft "5.00"
// terug waar wij "5" sturen — dat is geen verschil.
const _NUMERIEK = new Set(['regular_price', 'sale_price', 'weight', 'low_stock_amount', 'menu_order', 'stock_quantity'])

// Datumvelden komen uit WooCommerce als volledige tijdstempel
// ("2026-09-01T00:00:00") terwijl wij een kale datum sturen — vergelijk op de
// dag, anders staat er bij elke pull een schijnverschil.
const _DATUM = new Set(['date_on_sale_from', 'date_on_sale_to'])

/**
 * Vergelijk de payload die we zouden sturen met het product zoals het nu in
 * WooCommerce staat. Alleen velden die écht anders zijn komen terug — de basis
 * voor "wat verandert er als ik nu push?".
 */
export function wcVerschillen(payload: Record<string, any>, wcProduct: any): WcVerschil[] {
  const p = wcProduct || {}
  const uit: WcVerschil[] = []
  for (const [veld, waarde] of Object.entries(payload || {})) {
    if (veld === 'type' || veld === 'manage_stock') continue
    const extern = p[veld]
    if (_NUMERIEK.has(veld)) {
      const a = _num(waarde), b = _num(extern)
      if ((a ?? 0) !== (b ?? 0)) uit.push({veld, lokaal: _toonWaarde(waarde), extern: _toonWaarde(extern)})
      continue
    }
    if (_DATUM.has(veld)) {
      const a = String(waarde ?? '').slice(0, 10)
      const b = String(extern ?? '').slice(0, 10)
      if (a !== b) uit.push({veld, lokaal: a, extern: b})
      continue
    }
    if (veld === 'categories') {
      const a = (waarde as any[]).map(c => c.id).sort().join(',')
      const b = (Array.isArray(extern) ? extern.map((c: any) => c?.id) : []).sort().join(',')
      if (a !== b) uit.push({veld, lokaal: _toonWaarde(waarde), extern: _toonWaarde(extern)})
      continue
    }
    if (veld === 'tags') {
      const a = (waarde as any[]).map(c => String(c.name).toLowerCase()).sort().join(',')
      const b = (Array.isArray(extern) ? extern.map((c: any) => String(c?.name || '').toLowerCase()) : []).sort().join(',')
      if (a !== b) uit.push({veld, lokaal: _toonWaarde(waarde), extern: _toonWaarde(extern)})
      continue
    }
    if (veld === 'images') {
      const a = (waarde as any[]).map(i => String(i.id ?? i.src)).join(',')
      const b = (Array.isArray(extern) ? extern.map((i: any) => String(i?.id ?? i?.src ?? '')) : []).join(',')
      if (a !== b) uit.push({veld, lokaal: `${(waarde as any[]).length}`, extern: `${Array.isArray(extern) ? extern.length : 0}`})
      continue
    }
    if (veld === 'meta_data') {
      // Per meta-sleutel vergelijken; de winkel levert álle meta terug, wij
      // sturen alleen de onze — een sleutel die wij niet sturen is geen verschil.
      const extraMeta: Record<string, any> = {}
      for (const m of (Array.isArray(p.meta_data) ? p.meta_data : [])) extraMeta[String(m?.key || '')] = m?.value
      for (const regel of (waarde as any[])) {
        const eigen = _toonWaarde(regel.value)
        const winkel = _toonWaarde(extraMeta[regel.key])
        if (eigen !== winkel) uit.push({veld: `meta:${regel.key}`, lokaal: eigen, extern: winkel})
      }
      continue
    }
    if (veld === 'dimensions') {
      const w = waarde as Record<string, string>
      const e = (extern || {}) as Record<string, string>
      const anders = ['length', 'width', 'height'].some(k => (_num(w[k]) ?? 0) !== (_num(e[k]) ?? 0))
      if (anders) uit.push({veld, lokaal: _toonWaarde(waarde), extern: _toonWaarde(extern)})
      continue
    }
    if (_toonWaarde(waarde) !== _toonWaarde(extern)) {
      uit.push({veld, lokaal: _toonWaarde(waarde), extern: _toonWaarde(extern)})
    }
  }
  return uit
}

/** i18n-sleutel per WooCommerce-veld, voor de verschillenlijst in de UI. */
export const WC_VELD_LABEL: Record<string, string> = {
  name:               'wc_veld_naam',
  slug:               'wc_veld_slug',
  status:             'wc_veld_status',
  catalog_visibility: 'wc_veld_zichtbaarheid',
  featured:           'wc_veld_uitgelicht',
  description:        'wc_veld_omschrijving',
  short_description:  'wc_veld_korte_omschrijving',
  regular_price:      'wc_veld_prijs',
  sale_price:         'wc_veld_actieprijs',
  date_on_sale_from:  'wc_veld_actie_van',
  date_on_sale_to:    'wc_veld_actie_tot',
  stock_quantity:     'wc_veld_voorraad',
  backorders:         'wc_veld_backorders',
  low_stock_amount:   'wc_veld_lage_voorraad',
  sold_individually:  'wc_veld_apart_verkopen',
  weight:             'wc_veld_gewicht',
  dimensions:         'wc_veld_afmetingen',
  shipping_class:     'wc_veld_verzendklasse',
  tax_status:         'wc_veld_btw_status',
  tax_class:          'wc_veld_btw_klasse',
  categories:         'wc_veld_categorieen',
  tags:               'wc_veld_tags',
  images:             'wc_veld_afbeeldingen',
  menu_order:         'wc_veld_menu_volgorde',
  sku:                'wc_veld_sku',
}

/**
 * Splits een WooCommerce-categorielijst uit in een vlakke, ingesprongen lijst
 * (ouder → kind), zodat een keuzelijst de hiërarchie toont.
 */
export function ordenCategorieen(cats: WcCategorie[]): {cat: WcCategorie, diepte: number}[] {
  const perParent = new Map<number, WcCategorie[]>()
  for (const c of cats || []) {
    const p = Number(c.parent || 0)
    if (!perParent.has(p)) perParent.set(p, [])
    perParent.get(p)!.push(c)
  }
  for (const lijst of perParent.values()) lijst.sort((a, b) => (a.naam || '').localeCompare(b.naam || ''))
  const uit: {cat: WcCategorie, diepte: number}[] = []
  const gezien = new Set<number>()
  const loop = (parent: number, diepte: number) => {
    for (const c of perParent.get(parent) || []) {
      // Een kringetje in de boom (data-fout) mag nooit oneindig doorlopen.
      if (gezien.has(c.id)) continue
      gezien.add(c.id)
      uit.push({cat: c, diepte})
      loop(c.id, diepte + 1)
    }
  }
  loop(0, 0)
  // Categorieën waarvan de ouder ontbreekt (bijv. niet meegeleverd) alsnog tonen.
  for (const c of cats || []) if (!gezien.has(c.id)) { gezien.add(c.id); uit.push({cat: c, diepte: 0}) }
  return uit
}
