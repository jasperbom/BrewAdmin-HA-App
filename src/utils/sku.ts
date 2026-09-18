// SKU-identiteit van een artikel.
//
// De SKU is de enige harde verwijzing van een orderregel — en van de webshop —
// naar wát er verkocht is: de afvulling bevriest hem, de picking zoekt erop,
// de voorraadpush stuurt hem mee. Twee artikelen met dezelfde SKU maken die
// verwijzing dubbelzinnig: een bestelling op het ene bier reserveert dan ook
// voorraad van het andere, de picking kan het verkeerde product kiezen en een
// push overschrijft de productkaart van de ander (WooCommerce laat één product
// per SKU toe). Daarom: één SKU, één artikel.
//
// Deze module doet twee dingen:
//   1. dubbele SKU's opsporen, zodat het artikelformulier ze kan weigeren en
//      de lijst bestaande dubbelen laat zien;
//   2. zolang ze er tóch zijn (bestaande data), een orderregel bij het juiste
//      product brengen: bij een dubbelzinnige SKU beslist de biernaam van de
//      regel, zodat de reservering maar bij één bier terechtkomt.

export interface SkuRefData {
  producten?: any[]
  productArtikelen?: any[]
  artikelen?: any[]
  merchArtikelen?: any[]
}

/** Waar een SKU aan hangt: een productartikel, een legacy artikel of merch. */
export interface SkuEigenaar {
  soort: 'artikel' | 'legacy' | 'merch'
  id: any
  /** Naam zoals de gebruiker hem kent: het product, het bier of het merch-artikel. */
  naam: string
  product_id: number | null
}

const lower = (x: any): string => String(x ?? '').trim().toLowerCase()

/** Vergelijkingsvorm van een SKU: spaties eraf, hoofdletterverschil telt niet. */
export const normSku = (sku: any): string => lower(sku)

const productNaam = (id: any, producten: any[]): string =>
  String((producten || []).find((p: any) => p?.id === id)?.naam ?? '')

const productVoorNaam = (naam: any, producten: any[]): any =>
  (producten || []).find((p: any) => lower(p?.naam) === lower(naam) && lower(naam) !== '')

/** Het product waar een artikel bij hoort: direct (productartikel) of via de biernaam (legacy). */
export const artikelProductId = (art: any, data: SkuRefData): number | null => {
  if (art?.product_id != null) return Number(art.product_id)
  const prod = productVoorNaam(art?.biernaam, data.producten || [])
  return prod?.id ?? null
}

/**
 * Alle artikelen die deze SKU dragen, in de volgorde waarin ze tellen:
 * productartikelen eerst, dan de legacy artikelen, dan merch.
 */
export const skuEigenaren = (sku: any, data: SkuRefData): SkuEigenaar[] => {
  const s = normSku(sku)
  if (!s) return []
  const { producten = [], productArtikelen = [], artikelen = [], merchArtikelen = [] } = data
  const out: SkuEigenaar[] = []
  for (const pa of productArtikelen) {
    if (normSku(pa?.artikelnummer) !== s) continue
    out.push({
      soort: 'artikel',
      id: pa?.id ?? null,
      product_id: pa?.product_id ?? null,
      naam: productNaam(pa?.product_id, producten) || String(pa?.verpakking_naam ?? ''),
    })
  }
  for (const a of artikelen) {
    if (normSku(a?.artikelnummer) !== s) continue
    out.push({
      soort: 'legacy',
      id: a?.id ?? a?.key ?? null,
      product_id: productVoorNaam(a?.biernaam, producten)?.id ?? null,
      naam: String(a?.biernaam ?? ''),
    })
  }
  for (const m of merchArtikelen) {
    if (normSku(m?.sku) !== s) continue
    out.push({ soort: 'merch', id: m?.id ?? null, product_id: null, naam: String(m?.naam ?? m?.sku ?? '') })
  }
  return out
}

/**
 * De verschillende producten achter één SKU. Meer dan één = dubbelzinnig: de
 * SKU zegt dan niet meer welk bier een orderregel bedoelt.
 */
export const skuProductIds = (sku: any, data: SkuRefData): number[] => {
  const ids: number[] = []
  for (const e of skuEigenaren(sku, data)) {
    if (e.product_id == null) continue
    const id = Number(e.product_id)
    if (!ids.includes(id)) ids.push(id)
  }
  return ids
}

/** Hangt deze SKU aan meer dan één product? */
export const skuDubbelzinnig = (sku: any, data: SkuRefData): boolean =>
  skuProductIds(sku, data).length > 1

/** Het artikel dat op dit moment bewerkt wordt (of merch), zodat het zichzelf niet blokkeert. */
export interface SkuEigen {
  soort?: 'artikel' | 'legacy' | 'merch'
  id?: any
  product_id?: number | null
}

/**
 * Andere artikelen die deze SKU al gebruiken. Het artikel zelf telt niet mee,
 * en een legacy artikel dat hetzelfde product spiegelt evenmin — dat is de
 * oude mapping van dít artikel, geen tweede gebruiker.
 */
export const skuConflicten = (sku: any, eigen: SkuEigen, data: SkuRefData): SkuEigenaar[] => {
  const anderen = skuEigenaren(sku, data).filter(e => {
    const zelfdeRecord = e.soort === (eigen.soort ?? 'artikel')
      && eigen.id != null && e.id != null && String(e.id) === String(eigen.id)
    if (zelfdeRecord) return false
    if (e.soort === 'legacy' && eigen.product_id != null && e.product_id != null
      && Number(e.product_id) === Number(eigen.product_id)) return false
    return true
  })
  // Eén regel per bier: een legacy artikel naast het productartikel van
  // hetzelfde product is dezelfde botsing, niet twee.
  const uniek: SkuEigenaar[] = []
  for (const e of anderen) {
    const al = uniek.some(u => u.product_id != null && e.product_id != null
      && Number(u.product_id) === Number(e.product_id))
    if (!al) uniek.push(e)
  }
  return uniek
}

/**
 * Een vrije variant van een SKU: `WSFL033` → `WSFL033-1`, `-2`, … Zo houdt een
 * tweede bier met dezelfde afkorting toch een herkenbaar artikelnummer.
 */
export const vrijeSku = (basis: any, eigen: SkuEigen, data: SkuRefData): string => {
  const kaal = String(basis ?? '').trim().replace(/-\d+$/, '')
  if (!kaal) return ''
  if (!skuConflicten(kaal, eigen, data).length) return kaal
  for (let n = 1; n <= 99; n++) {
    const kandidaat = `${kaal}-${n}`
    if (!skuConflicten(kandidaat, eigen, data).length) return kandidaat
  }
  return `${kaal}-${Date.now()}`
}

/** Alle SKU's die door meer dan één artikel gebruikt worden. */
export const dubbeleSkus = (data: SkuRefData): { sku: string, eigenaren: SkuEigenaar[] }[] => {
  const gezien = new Set<string>()
  const out: { sku: string, eigenaren: SkuEigenaar[] }[] = []
  const alle = [
    ...(data.productArtikelen || []).map((a: any) => a?.artikelnummer),
    ...(data.artikelen || []).map((a: any) => a?.artikelnummer),
    ...(data.merchArtikelen || []).map((m: any) => m?.sku),
  ]
  for (const sku of alle) {
    const s = normSku(sku)
    if (!s || gezien.has(s)) continue
    gezien.add(s)
    const eigenaren = skuEigenaren(sku, data)
    // Een legacy spiegel van hetzelfde product is geen tweede gebruiker.
    const uniek: SkuEigenaar[] = []
    for (const e of eigenaren) {
      const dubbel = uniek.some(u => u.product_id != null && e.product_id != null
        && Number(u.product_id) === Number(e.product_id))
      if (!dubbel) uniek.push(e)
    }
    if (uniek.length > 1) out.push({ sku: String(sku).trim(), eigenaren: uniek })
  }
  return out
}

/**
 * Het product waar een orderregel bij hoort: primair de SKU, en bij een
 * dubbelzinnige SKU de biernaam van de regel. Zonder bruikbare SKU valt hij
 * terug op de biernaam zelf.
 */
export const productVoorRegel = (sku: any, bierNaam: any, data: SkuRefData): number | null => {
  const ids = skuProductIds(sku, data)
  if (ids.length === 1) return ids[0]
  if (ids.length > 1) {
    const producten = data.producten || []
    const opNaam = ids.filter(id => lower(productNaam(id, producten)) === lower(bierNaam))
    if (opNaam.length === 1) return opNaam[0]
    // Geen uitsluitsel — houd het oude gedrag: de eerste mapping wint.
    return ids[0]
  }
  return productVoorNaam(bierNaam, data.producten || [])?.id ?? null
}
