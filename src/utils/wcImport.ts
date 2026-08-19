// WooCommerce-order → BrewAdmin-orderregels (pure logica).
//
// Drie dingen die de import eerder liet liggen:
//
//  1. **Verzendkosten en toeslagen.** WooCommerce zet die niet in
//     `line_items` maar in `shipping_lines` en `fee_lines`. Ze werden dus
//     nooit geïmporteerd: de order in de app was structureel goedkoper dan de
//     order in de winkel (en de factuur klopte niet met wat de klant betaalde).
//  2. **Merch.** Elke regel werd `type: 'bier'` en moest dus uit de
//     biervoorraad gepickt worden. Een T-shirt of glas kan dat nooit, waardoor
//     zo'n order nooit compleet te krijgen was. Regels die niet aan een eigen
//     artikel/product/batch te koppelen zijn komen daarom binnen als vrije
//     regel (`type: 'vrij'`) — wél op de factuur, geen picking.
//     Merch die de brouwerij als dropshipping verkoopt (leverancier verstuurt
//     rechtstreeks) staat in de dropship-lijst (`utils/dropship`): die regels
//     zijn geen gok maar een expliciete keuze van de gebruiker en komen dus
//     zonder "onbekend"-waarschuwing binnen.
//  3. **Artikelherkenning.** Er werd alleen in de legacy-`artikelen` gezocht,
//     niet in de `productArtikelen` van de productpagina — precies waar de
//     SKU's tegenwoordig staan.
//
// Bedragen: WooCommerce is leidend (`wc_netto`/`wc_btw`, zie utils/orderRegel).

import { DropshipArtikel, isDropship } from './dropship'

export interface WcRefs {
  artikelen?: any[]
  productArtikelen?: any[]
  producten?: any[]
  bat?: any[]
  standaardBtw?: number
  /** Actieve BTW-tarieven; het afgeleide tarief wordt hier naartoe afgerond. */
  btwTarieven?: Array<number | string>
  /** Artikelen die als dropshipping verkocht worden (geen eigen voorraad). */
  dropship?: DropshipArtikel[]
}

export type WcRegelType = 'bier' | 'vrij' | 'verzending'

export interface WcOrderRegel {
  id: number
  type: WcRegelType
  sku: string | null
  artikel_key: string | null
  artikel_id: number | null
  bier_naam: string
  verpakking_type: string
  aantal: number
  prijs_per_stuk: number
  btw_pct: number
  omschrijving: string
  wc_netto?: number
  wc_btw?: number
  /** Productregel die niet aan een eigen artikel/product/batch te koppelen was. */
  wc_onbekend?: boolean
  /** Bekend dropship-artikel: bewust geen picking, geen waarschuwing. */
  dropship?: boolean
}

// Statussen die WooCommerce voor een order kan hebben en die zinvol zijn om te
// importeren. `completed` staat er bewust bij: merch (en andere orders die
// direct als afgerond worden gemarkeerd) kwam anders nooit binnen.
export const WC_STATUS_OPTIES = ['pending', 'processing', 'on-hold', 'completed'] as const
export const WC_IMPORT_STATUSSEN_DEFAULT: string[] = ['pending', 'processing', 'on-hold', 'completed']

const norm = (x: any): string => String(x ?? '').trim().toLowerCase()

const getal = (x: any): number | null => {
  if (x === null || x === undefined || x === '') return null
  const n = Number(x)
  return Number.isFinite(n) ? n : null
}

// Pad voor de orders-endpoint van de WooCommerce REST API. Statussen worden
// gevalideerd (het pad gaat door de server-proxy die alleen veilige tekens
// toestaat) en `vanaf` beperkt de historie bij het aanzetten van `completed`.
export function wcOrdersPad(opts: {
  statussen?: string[]
  vanaf?: string
  page?: number
  perPage?: number
} = {}): string {
  const gevraagd = (opts.statussen && opts.statussen.length ? opts.statussen : WC_IMPORT_STATUSSEN_DEFAULT)
    .map(s => norm(s))
    .filter(s => /^[a-z-]+$/.test(s))
  const uniek = Array.from(new Set(gevraagd))
  const statussen = uniek.length ? uniek : WC_IMPORT_STATUSSEN_DEFAULT
  const perPage = Math.min(100, Math.max(1, Math.round(Number(opts.perPage) || 100)))
  const params = [`status=${statussen.join(',')}`, `per_page=${perPage}`]
  const page = Math.round(Number(opts.page) || 1)
  if (page > 1) params.push(`page=${page}`)
  const vanaf = String(opts.vanaf || '').trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(vanaf)) params.push(`after=${vanaf}T00:00:00`)
  return `orders?${params.join('&')}`
}

export interface WcArtikelMatch {
  bier_naam: string
  verpakking_type: string
  verkoopprijs: number | null
  btw_pct: number | null
  artikel_id: number | null
  artikel_key: string | null
}

// Zoek het eigen artikel/product bij een WooCommerce-regel. Volgorde: SKU in de
// productartikelen (de actuele SKU-administratie), dan de legacy-artikelen
// (SKU of biernaam), dan een exacte productnaam en tot slot een batchnaam.
// Geen match = geen eigen bier (merch, cadeaubon, statiegeld …).
export function vindWcArtikel(sku: any, naam: any, refs: WcRefs = {}): WcArtikelMatch | null {
  const { artikelen = [], productArtikelen = [], producten = [], bat = [] } = refs
  const s = norm(sku)
  const n = norm(naam)

  const pa = s ? (productArtikelen || []).find((p: any) => norm(p?.artikelnummer) === s) : null
  if (pa) {
    const prod = (producten || []).find((p: any) => p?.id === pa.product_id)
    return {
      bier_naam: prod?.naam || pa.verpakking_naam || String(naam || ''),
      verpakking_type: pa.verpakking_type || '',
      verkoopprijs: getal(pa.verkoopprijs),
      btw_pct: getal(pa.btw_pct),
      artikel_id: null,
      artikel_key: null,
    }
  }

  const art = (artikelen || []).find((a: any) =>
    (s && norm(a?.artikelnummer) === s) || (n && norm(a?.biernaam) === n))
  if (art) {
    return {
      bier_naam: art.biernaam || String(naam || ''),
      verpakking_type: art.verpakking_type || '',
      verkoopprijs: getal(art.verkoopprijs),
      btw_pct: getal(art.btw_pct ?? art.btw),
      artikel_id: art.id ?? null,
      artikel_key: art.key ?? null,
    }
  }

  const prod = n ? (producten || []).find((p: any) => norm(p?.naam) === n) : null
  if (prod) {
    return {bier_naam: prod.naam, verpakking_type: '', verkoopprijs: null, btw_pct: null, artikel_id: null, artikel_key: null}
  }

  const batch = n ? (bat || []).find((b: any) => norm(b?.naam) === n || norm(b?.biernaam) === n) : null
  if (batch) {
    return {bier_naam: batch.naam || batch.biernaam, verpakking_type: '', verkoopprijs: null, btw_pct: null, artikel_id: null, artikel_key: null}
  }

  return null
}

// BTW% afleiden uit de bedragen die WooCommerce zelf berekende. Op absolute
// waarden, zodat een negatieve regel (korting als fee) hetzelfde tarief krijgt.
//
// Kleine bedragen ronden scheef af (€0,07 op €0,35 = 20%), dus het resultaat
// wordt naar een bestaand tarief getrokken zolang dat hooguit 2 procentpunt
// scheelt. Een écht afwijkend tarief (bijv. 6% bij een buitenlandse levering)
// blijft staan.
const TARIEF_SNAP_MARGE = 2

const snapNaarTarief = (pct: number, tarieven?: Array<number | string>): number => {
  const lijst = (tarieven && tarieven.length ? tarieven : [0, 9, 21])
    .map(Number).filter(v => Number.isFinite(v))
  if (!lijst.length) return Math.round(pct)
  const dichtst = lijst.reduce((best, tarief) =>
    Math.abs(tarief - pct) < Math.abs(best - pct) ? tarief : best, lijst[0])
  return Math.abs(dichtst - pct) <= TARIEF_SNAP_MARGE ? dichtst : Math.round(pct)
}

const afgeleidBtwPct = (netto: number, btw: number, tarieven?: Array<number | string>): number | null =>
  Math.abs(netto) > 0 && Math.abs(btw) > 0
    ? snapNaarTarief((Math.abs(btw) / Math.abs(netto)) * 100, tarieven)
    : null

// Autoritatieve WooCommerce-bedragen — alleen als er écht BTW is berekend;
// anders blijft de klassieke reconstructie uit aantal × prijs gelden.
const wcBedragen = (netto: number, btw: number) => (Math.abs(btw) > 0 ? {wc_netto: netto, wc_btw: btw} : {})

// Alle regels van een WooCommerce-order: producten, verzendkosten en toeslagen.
export function mapWcOrderRegels(order: any, refs: WcRefs = {}): WcOrderRegel[] {
  const stdBtw = Number.isFinite(Number(refs.standaardBtw)) ? Number(refs.standaardBtw) : 21
  const regels: WcOrderRegel[] = []
  let id = 0

  for (const item of (order?.line_items || [])) {
    const sku = String(item?.sku || '').trim() || null
    const naam = String(item?.name || '').trim()
    // Expliciet als dropshipping gemarkeerd? Dan niet meer naar een eigen
    // artikel zoeken: de gebruiker heeft al gezegd dat dit niet uit de eigen
    // voorraad geleverd wordt.
    const isDrop = isDropship(sku, naam, refs.dropship)
    const match = isDrop ? null : vindWcArtikel(sku, naam, refs)
    const aantal = Number(item?.quantity || 1) || 1
    const netto = Number(parseFloat(item?.total ?? item?.subtotal ?? '0')) || 0
    const btw = Number(parseFloat(item?.total_tax ?? item?.subtotal_tax ?? '0')) || 0
    // Prijs per stuk: het eigen artikeltarief wint (consistente prijslijst),
    // anders het werkelijk gefactureerde bedrag ná korting.
    const prijs = match?.verkoopprijs != null ? match.verkoopprijs : (aantal > 0 ? netto / aantal : 0)
    const btwPct = match?.btw_pct != null ? match.btw_pct : (afgeleidBtwPct(netto, btw, refs.btwTarieven) ?? stdBtw)
    regels.push({
      id: ++id,
      // Zonder match is het geen eigen bier: als vrije regel importeren, zodat
      // de order niet blijft hangen op een pick die nooit kan slagen.
      type: match ? 'bier' : 'vrij',
      sku,
      artikel_key: match?.artikel_key ?? null,
      artikel_id: match?.artikel_id ?? null,
      bier_naam: match?.bier_naam || naam,
      verpakking_type: match?.verpakking_type || '',
      aantal,
      prijs_per_stuk: prijs,
      btw_pct: btwPct,
      omschrijving: naam,
      // `wc_onbekend` is een váág signaal ("controleer dit even"); een bekend
      // dropship-artikel is juist een bewuste keuze en krijgt die vlag niet.
      ...(isDrop ? {dropship: true} : match ? {} : {wc_onbekend: true}),
      ...wcBedragen(netto, btw),
    })
  }

  for (const ship of (order?.shipping_lines || [])) {
    const netto = Number(parseFloat(ship?.total ?? '0')) || 0
    const btw = Number(parseFloat(ship?.total_tax ?? '0')) || 0
    if (netto === 0 && btw === 0) continue  // gratis verzending: geen regel
    const naam = String(ship?.method_title || ship?.method_id || '').trim()
    regels.push({
      id: ++id,
      type: 'verzending',
      sku: null,
      artikel_key: null,
      artikel_id: null,
      bier_naam: naam,
      verpakking_type: '',
      aantal: 1,
      prijs_per_stuk: netto,
      btw_pct: afgeleidBtwPct(netto, btw, refs.btwTarieven) ?? stdBtw,
      omschrijving: naam,
      ...wcBedragen(netto, btw),
    })
  }

  for (const fee of (order?.fee_lines || [])) {
    const netto = Number(parseFloat(fee?.total ?? '0')) || 0
    const btw = Number(parseFloat(fee?.total_tax ?? '0')) || 0
    if (netto === 0 && btw === 0) continue
    const naam = String(fee?.name || '').trim()
    regels.push({
      id: ++id,
      type: 'vrij',
      sku: null,
      artikel_key: null,
      artikel_id: null,
      bier_naam: naam,
      verpakking_type: '',
      aantal: 1,
      prijs_per_stuk: netto,
      btw_pct: afgeleidBtwPct(netto, btw, refs.btwTarieven) ?? stdBtw,
      omschrijving: naam,
      ...wcBedragen(netto, btw),
    })
  }

  return regels
}
