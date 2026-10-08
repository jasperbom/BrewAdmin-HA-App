// De productpagina als knooppunt van de keten (opzet hoofdstuk 4 en 10, SPEC
// M en N): Recept › Brouwsels › Etiket › Voorraad › Verkoop van één bier, en de
// productlijst ernaast.
//
// Deze module rekent zelf niets uit wat er al is:
//  - voorraad per verpakking, "komt eraan" en dekking komen uit
//    utils/verkoopOverzicht.ts — dezelfde telling als het Overzicht, de kassa
//    en de bestellingen (nooit flessen en fusten opgeteld);
//  - het etiketoordeel is dat van de etiketkaart: `productVergelijking`
//    (utils/etiketKaart.ts) met `productEtiketWaarden`, `vergelijkEtiket` en
//    `etiketStatus` (utils/etiket.ts);
//  - het huidige recept en de batches van een product komen uit
//    utils/productKeten.ts, de fase van een batch uit utils/batchKeten.ts;
//  - de kostprijs is die van `berekenProductKostprijs`; de kostprijs van één
//    verpakte eenheid is `kostprijs_per_liter_excl_verpakking × inhoud +
//    verpakkingKostenPerStuk` — nooit prijs-per-liter × inhoud.
//
// Puur: geen React, geen opslag; zinnen via de vertaalfunctie van de aanroeper.

import type { Afvulling, AfvulSessie, Batch, Product, Recept } from '../types'
import {
  allergeenNamen, batchRegelsAlsRecept, etiketStatus, etiketStatusTekst, etiketWaarden, fmtAbv, productEtiketWaarden,
  vergelijkEtiket,
} from './etiket'
import type { AbvBron, EtiketCtx, EtiketStatus, Vertaal } from './etiket'
import { productVergelijking } from './etiketKaart'
import type { EtiketKaartData } from './etiketKaart'
import type { BierAfleiding } from './bierinfo'
import {
  batchHoortBijProduct, batchNummer, hoofdIdResolver, huidigReceptVoorProduct, receptVoorBatch, receptenVanProduct,
} from './productKeten'
import type { HuidigReceptBron } from './productKeten'
import { batchKeten } from './batchKeten'
import type { StatusLogRegel } from './vergisting'
import { normaliseerStatus } from './volgendeStap'
import { lotcodeVanAfvulling } from './afvulsessie'
import { bestellingenOmTePicken, orderNummer } from './picking'
import { productVoorRegel } from './sku'
import { stuksTekst, verpakkingLabel } from './verkoopDashboard'
import type { ChipTekst } from './verkoopDashboard'
import { batchOpNaamVanProduct, verpakkingSleutel, voorraadPerProduct } from './verkoopOverzicht'
import type { KomtEraanBatch, VerkoopCtx, VoorraadVerpakking } from './verkoopOverzicht'
import { verpakkingKostenPerStuk, vindVerpakking } from './verpakkingKosten'
import type { ProductKostprijsResult } from './calculations'
import { vulIn } from './attentieTekst'
import { fmtQty } from './format'

type ProductLike = Pick<Product, 'id'> & Partial<Product>
type BatchLike = Pick<Batch, 'id'> & Partial<Batch>
type ReceptLike = Pick<Recept, 'id'> & Partial<Recept>

const tekst = (v: unknown): string => String(v ?? '').trim()

const getal = (x: unknown): number | null => {
  if (x === null || x === undefined || String(x).trim() === '') return null
  const n = Number(String(x).replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

/** Nieuwste eerst: brouwdatum, dan aanmaakmoment, dan id (zoals productKeten.ts). */
const nieuwsteEerst = (a: BatchLike, b: BatchLike): number =>
  String(b.datum || '').localeCompare(String(a.datum || '')) ||
  String(b.created_at || '').localeCompare(String(a.created_at || '')) ||
  (Number(b.id) || 0) - (Number(a.id) || 0)

// ── Het etiket ──────────────────────────────────────────────────────────────

export interface ProductEtiketOordeel {
  status: EtiketStatus
  /** De statuschip, overal dezelfde tekst: "Etiket: tarwe ontbreekt". */
  tekst: string
  /** Kort, voor een vak van de ketenstrook: "tarwe ontbreekt". */
  kort: string
}

/** "tarwe ontbreekt", "klopt", "nog niet vastgelegd" — de chip zonder "Etiket". */
export const etiketKortTekst = (s: EtiketStatus, t: Vertaal): string =>
  vulIn(t(s.sleutel.replace(/^etiket_status_/, 'product_etiket_kort_'), etiketStatusTekst(s, t)),
    { allergenen: allergeenNamen(s.allergenen, t).join(', ') })

/**
 * Het oordeel over het gedrukte etiket van een product — precies de chip van
 * de etiketkaart in stand `product`: getoetst aan de referentiebatch, anders
 * aan het huidige recept. Null als er niets is om tegen te toetsen.
 */
export const productEtiketOordeel = (
  product: ProductLike | null | undefined,
  data: EtiketKaartData,
  t: Vertaal,
  opties?: { websiteAchter?: boolean | null } | null,
): ProductEtiketOordeel | null => {
  if (!product) return null
  const v = productVergelijking(product, data)
  if (!v) return null
  const status = etiketStatus(vergelijkEtiket(v.waarden, productEtiketWaarden(product, data)),
    { websiteAchter: opties?.websiteAchter })
  return { status, tekst: etiketStatusTekst(status, t), kort: etiketKortTekst(status, t) }
}

/**
 * Regel 2 van de kop: wat het gedrukte etiket vastlegt — "Etiket v3:" en
 * "6,2 % vol · Bevat: gerst". Zonder alcohol en allergenen: "nog niet
 * vastgelegd".
 */
export const etiketKopRegel = (
  product: ProductLike | null | undefined,
  t: Vertaal,
  taal?: string | null,
): { label: string; waarde: string } => {
  const versie = tekst(product?.etiket_versie)
  const label = versie ? vulIn(t('product_kop_etiket_versie'), { versie }) : t('product_kop_etiket')
  const delen: string[] = []
  const abv = fmtAbv(product?.abv, taal)
  if (abv) delen.push(abv)
  if (Array.isArray(product?.allergenen)) {
    const namen = allergeenNamen(product?.allergenen, t)
    delen.push(namen.length ? vulIn(t('recept_bevat'), { allergenen: namen.join(', ') }) : t('etiket_allergenen_geen'))
  } else if (abv) {
    delen.push(t('product_kop_allergenen_open'))
  }
  return { label, waarde: delen.length ? delen.join(' · ') : t('product_etiket_kort_niet_vastgelegd') }
}

// ── Voorraad ────────────────────────────────────────────────────────────────

/** De verpakkingen met iets op voorraad (vrij of AGP), in de volgorde van de telling. */
const metVoorraad = (voorraad: VoorraadVerpakking[]): VoorraadVerpakking[] =>
  voorraad.filter(g => g.vrij + g.agp > 0)

/**
 * De voorraad in één korte regel, per verpakking (nooit opgeteld): "46 fles ·
 * 1 fust", "120 fles (+480 AGP) · 3 fust AGP". Niets: "niets op voorraad".
 * `kort` (de segmentstrook op de telefoon): per verpakking alleen wat er ligt,
 * vrij en AGP samen — "600 fles · 3 fust"; de splitsing staat eronder.
 */
export const voorraadKort = (voorraad: VoorraadVerpakking[], t: Vertaal, opties?: { kort?: boolean } | null): string => {
  const delen = metVoorraad(voorraad).map(g => {
    const vp = { naam: g.naam, type: g.type }
    if (opties?.kort) return stuksTekst(g.vrij + g.agp, vp, t)
    if (g.vrij > 0 && g.agp > 0) return vulIn(t('product_voorraad_plus_agp'), { stuks: stuksTekst(g.vrij, vp, t), n: g.agp })
    if (g.vrij > 0) return stuksTekst(g.vrij, vp, t)
    return vulIn(t('product_voorraad_alleen_agp'), { stuks: stuksTekst(g.agp, vp, t) })
  })
  return delen.length ? delen.join(' · ') : t('verkoop_niets_op_voorraad')
}

/**
 * Wat een open bestelling met een verpakking doet, als chip: rood "tekort 2"
 * als er echt te weinig ligt, oranje "eerst uitslaan" als wat ontbreekt in de
 * AGP ligt (dezelfde grens als het Overzicht: `tekort` tegenover `uitTeSlaan`).
 * Null zonder tekort.
 */
export const tekortChip = (g: VoorraadVerpakking, t: Vertaal): ChipTekst | null => {
  if (g.tekort <= 0) return null
  if (g.tekort <= g.uitTeSlaan) return { tekst: t('verkoop_eerst_uitslaan'), kleur: 'oranje' }
  // Wat er na uitslaan écht ontbreekt; ligt een deel in de AGP, dan staat dat
  // erbij ("tekort 98 · 630 eerst uitslaan") — anders lijkt het hele bestelde
  // aantal te ontbreken terwijl het grootste deel klaarligt.
  const n = g.tekort - g.uitTeSlaan
  return g.uitTeSlaan > 0
    ? { tekst: vulIn(t('product_lijst_tekort_na_agp'), { n, m: g.uitTeSlaan }), kleur: 'rood' }
    : { tekst: vulIn(t('product_lijst_tekort'), { n }), kleur: 'rood' }
}

/**
 * De chips van een product in de lijst (SPEC M): per verpakking "Fles 46",
 * "Fles 120 · AGP 480", "Fust AGP 3"; daarachter het tekort (`tekortChip`:
 * rood "tekort 2" of oranje "eerst uitslaan"; bij meer verpakkingen met een
 * tekort met de verpakking ervoor: "Fles: tekort 2"). Een verpakking die
 * alleen besteld is (niets op voorraad) staat er als "Fles 0".
 */
export const lijstChips = (voorraad: VoorraadVerpakking[], t: Vertaal): ChipTekst[] => {
  const getoond = voorraad.filter(g => g.vrij + g.agp > 0 || g.besteld > 0)
  const chips: ChipTekst[] = getoond.map(g => {
    const label = verpakkingLabel(g, voorraad, t)
    const agp = vulIn(t('product_lijst_agp'), { n: g.agp })
    const t1 = g.vrij > 0 && g.agp > 0 ? `${label} ${g.vrij} · ${agp}`
      : g.agp > 0 ? `${label} ${agp}`
      : `${label} ${g.vrij}`
    return { tekst: t1, kleur: 'grijs' }
  })
  const tekort = voorraad.filter(g => g.tekort > 0)
  for (const g of tekort) {
    const chip = tekortChip(g, t)
    if (!chip) continue
    chips.push(tekort.length > 1 ? { ...chip, tekst: `${verpakkingLabel(g, voorraad, t)}: ${chip.tekst}` } : chip)
  }
  return chips
}

export interface ProductLijstGroepen<P> {
  /** Iets vrij of in de AGP (ook een bier dat uit roulatie gaat maar nog ligt). */
  opVoorraad: P[]
  /** In roulatie, niets op voorraad. */
  zonderVoorraad: P[]
  /** Uit roulatie en niets meer op voorraad — ingeklapt. */
  uitRoulatie: P[]
  /** Gearchiveerd — ingeklapt. */
  gearchiveerd: P[]
}

/** Past het product bij de zoektekst (naam, stijl, categorie)? */
export const productPastBijZoek = (p: ProductLike, zoek?: string | null): boolean => {
  const q = tekst(zoek).toLowerCase()
  if (!q) return true
  return [p.naam, p.stijl, p.categorie].some(v => tekst(v).toLowerCase().includes(q))
}

/**
 * De productlijst in groepen, elk op naam. De voorraad is die van
 * `voorraadPerProduct`. `zonder` = een product dat net verwijderd wordt (het
 * staat nog in de opslag tot de vijf seconden van de UndoBar om zijn).
 */
export const productLijstGroepen = <P extends ProductLike>(
  producten: ReadonlyArray<P | null | undefined> | null | undefined,
  ctx: VerkoopCtx,
  opties?: { zoek?: string | null; zonder?: number | null } | null,
): ProductLijstGroepen<P> => {
  const uit: ProductLijstGroepen<P> = { opVoorraad: [], zonderVoorraad: [], uitRoulatie: [], gearchiveerd: [] }
  const lijst = (producten || [])
    .filter((p): p is P => !!p && p.id != null && p.id !== opties?.zonder && productPastBijZoek(p, opties?.zoek))
    .sort((a, b) => tekst(a.naam).localeCompare(tekst(b.naam), 'nl'))
  for (const p of lijst) {
    if (p.status === 'gearchiveerd') { uit.gearchiveerd.push(p); continue }
    const ligt = voorraadPerProduct(Number(p.id), ctx).some(g => g.vrij + g.agp > 0)
    if (ligt) uit.opVoorraad.push(p)
    else if (p.uit_roulatie) uit.uitRoulatie.push(p)
    else uit.zonderVoorraad.push(p)
  }
  return uit
}

// ── Het recept ──────────────────────────────────────────────────────────────

export interface ProductRecepten<R> {
  /** Het huidige (hoofd)recept, als het bestaat. */
  huidig: R | null
  /** Het id van het huidige recept, ook als het record er niet (meer) is. */
  huidigId: string | null
  bron: HuidigReceptBron
  /** De andere recepten van dit product (gekoppeld of gebrouwen). */
  eerder: R[]
}

/**
 * Het huidige recept van een product (vastgezet → laatst gebrouwen → het
 * enige → het eerste) en de andere: `product.recept_ids` ∪ de recepten van
 * zijn batches, altijd als hoofdrecept.
 */
export const productRecepten = <R extends ReceptLike>(
  product: ProductLike | null | undefined,
  batches: BatchLike[] | null | undefined,
  recepten: R[] | null | undefined,
): ProductRecepten<R> => {
  const lijst = recepten || []
  if (!product) return { huidig: null, huidigId: null, bron: 'geen', eerder: [] }
  const naarHoofd = hoofdIdResolver(lijst)
  const h = huidigReceptVoorProduct(product, batches, lijst)
  const huidigId = h.receptId ? naarHoofd(h.receptId) : null
  const vind = (id: string): R | null => lijst.find(r => String(r.id) === id) || null
  const ids: string[] = []
  for (const id of receptenVanProduct(product, batches)) {
    const hoofd = naarHoofd(id)
    if (hoofd && hoofd !== huidigId && !ids.includes(hoofd)) ids.push(hoofd)
  }
  return {
    huidig: huidigId ? vind(huidigId) : null, huidigId, bron: h.bron,
    eerder: ids.map(vind).filter((r): r is R => !!r),
  }
}

/** "v4" bij recept "Kadeblond v4" en product "Kadeblond"; anders de naam voluit. */
export const receptKort = (recept: string | null | undefined, product: string | null | undefined): string | null => {
  const r = tekst(recept)
  const p = tekst(product)
  if (!r) return null
  if (p && r.toLowerCase().startsWith(p.toLowerCase() + ' ')) {
    const rest = r.slice(p.length).trim()
    if (rest) return rest
  }
  return r
}

// ── Brouwsels ───────────────────────────────────────────────────────────────

export interface BrouwselRegel {
  batchId: number
  /** Het batchnummer zonder "#"; leeg als de batch er geen heeft. */
  nummer: string
  /** De eigen naam van de batch (als er geen nummer is). */
  naam: string
  /** Brouwdatum `JJJJ-MM-DD`, of null. */
  datum: string | null
  /** De status in de huidige naamgeving (Vergisting → Vergisten). */
  status: string
  /** Het (hoofd)recept, voor de link. */
  receptId: string | null
  /** De naam van het gebrouwen recept (ook een versie). */
  recept: string | null
  /** Korter, zonder de productnaam ervoor ("v4"). */
  receptKort: string | null
  /** Liters in de gistkuip (`liter_vergist`). */
  liters: number | null
  /** De alcohol van deze batch en waar hij vandaan komt (`etiketWaarden`). */
  abv: { waarde: number | null; bron: AbvBron }
  /** De lotcodes van zijn afvullingen en sessies, op volgorde. */
  lotcodes: string[]
  /** Hangt via `product_id`/`product_ids` aan dit product (dan los te koppelen). */
  direct: boolean
}

export interface BrouwselCtx extends EtiketCtx {
  batches?: BatchLike[] | null
  afvullingen?: Afvulling[] | null
  afvulSessies?: AfvulSessie[] | null
}

/**
 * Elke batch van dit product, nieuwste eerst: die op het product staan
 * (`product_id`, `product_ids`), die via een afvulling bij het product horen
 * (een oude batch, een rebrand) en een batch zonder product die naar het bier
 * heet (`batchOpNaamVanProduct` — dezelfde regel als "komt eraan", zodat een
 * geplande batch in de tegel ook in de lijst staat). Met de alcohol en zijn
 * bron zoals de etiketkaart hem noemt, en de lotcodes.
 */
export const brouwselsVanProduct = (
  product: ProductLike | null | undefined,
  ctx: BrouwselCtx,
): BrouwselRegel[] => {
  if (!product) return []
  const id = Number(product.id)
  const afvullingen = (ctx.afvullingen || []).filter(Boolean)
  const viaAfvulling = new Set(afvullingen.filter(a => Number(a.product_id) === id).map(a => Number(a.batch_id)))
  const eigen = (ctx.batches || [])
    .filter((b): b is BatchLike => !!b && (batchHoortBijProduct(b, id) || viaAfvulling.has(Number(b.id))
      || batchOpNaamVanProduct(b, product.naam)))
    .sort(nieuwsteEerst)
  const sessies = (ctx.afvulSessies || []).filter(Boolean)
  const recepten = ctx.recepten || []
  const naarHoofd = hoofdIdResolver(recepten)
  return eigen.map(b => {
    const codes = new Set<string>()
    for (const a of afvullingen) {
      if (Number(a.batch_id) !== Number(b.id)) continue
      const c = lotcodeVanAfvulling(a, sessies)
      if (c) codes.add(c)
    }
    for (const s of sessies) {
      if (Number(s.batch_id) === Number(b.id) && s.status !== 'afgebroken' && tekst(s.lotcode)) codes.add(tekst(s.lotcode))
    }
    const r = receptVoorBatch(b, recepten)
    const receptNaam = r?.naam ? String(r.naam) : null
    const abv = etiketWaarden(b, ctx).abv
    return {
      batchId: Number(b.id),
      nummer: batchNummer(b),
      naam: tekst(b.naam),
      datum: tekst(b.datum).slice(0, 10) || null,
      status: normaliseerStatus(b.status),
      receptId: naarHoofd(b.recept_id || b.recept_versie_id || null) || null,
      recept: receptNaam,
      receptKort: receptKort(receptNaam, product.naam),
      liters: getal(b.liter_vergist),
      abv: { waarde: abv.waarde, bron: abv.bron },
      lotcodes: [...codes].sort((x, y) => x.localeCompare(y, 'nl', { numeric: true })),
      direct: batchHoortBijProduct(b, id),
    }
  })
}

/**
 * De dag van de fase waarin een batch zit ("Conditioneren dag 8"), zoals de
 * ketenregel in de batchkop hem telt (`batchKeten`). Null buiten Vergisten en
 * Conditioneren.
 */
export const faseDag = (
  batch: BatchLike | null | undefined,
  ctx: { afvullingen?: Afvulling[] | null; statusLog?: StatusLogRegel[] | null; vandaag?: string | null },
): number | null => {
  const k = batchKeten(batch, { afvullingen: ctx.afvullingen || [], statusLog: ctx.statusLog || [], vandaag: ctx.vandaag })
  return k?.moment?.soort === 'in_fase' ? k.moment.dag : null
}

// ── Open bestellingen ───────────────────────────────────────────────────────

export interface OpenBestelling {
  id: number
  /** "WC-4321", "M-14". */
  nummer: string
  klant: string
  datum: string | null
  /** Wat er van dit bier in zit, per verpakking. */
  regels: Array<{ aantal: number; naam: string; type: string | null }>
}

/**
 * De open bestellingen met dit bier: nieuw of bevestigd en nog te picken
 * (`bestellingenOmTePicken` — de chip "Te picken" op Bestellingen), met een
 * bierregel die bij dit product hoort (SKU, anders de biernaam:
 * `productVoorRegel`). Oudste eerst.
 */
export const openBestellingenVoorProduct = (productId: number, ctx: VerkoopCtx): OpenBestelling[] => {
  const sku = { producten: ctx.producten || [], productArtikelen: ctx.productArtikelen || [], artikelen: ctx.artikelen || [], merchArtikelen: ctx.merchArtikelen || [] }
  const uit: OpenBestelling[] = []
  for (const b of bestellingenOmTePicken(ctx.bestellingen || [], ctx.bestellingPicks || [])) {
    const per = new Map<string, { aantal: number; naam: string; type: string | null }>()
    for (const r of b.regels || []) {
      if (!r || (r.type || 'bier') !== 'bier' || r.merch) continue
      const n = Number(r.aantal) || 0
      if (n <= 0 || productVoorRegel(r.sku || null, r.bier_naam || '', sku) !== productId) continue
      const h = verpakkingSleutel(r, ctx.verpakkingen)
      const g = per.get(h.sleutel) || { aantal: 0, naam: h.naam, type: h.verpakking?.type ? String(h.verpakking.type) : null }
      g.aantal += n
      per.set(h.sleutel, g)
    }
    if (!per.size) continue
    uit.push({
      id: Number(b.id), nummer: orderNummer(b), klant: tekst(b.klant_naam),
      datum: tekst(b.datum).slice(0, 10) || null, regels: [...per.values()],
    })
  }
  return uit
}

/** "WC-4321 · Café De Kade · 48 fles". */
export const openBestellingTekst = (o: OpenBestelling, t: Vertaal): string =>
  [o.nummer, o.klant, o.regels.map(r => stuksTekst(r.aantal, { naam: r.naam, type: r.type }, t)).join(' · ')]
    .filter(Boolean).join(' · ')

// ── De ketenstrook ──────────────────────────────────────────────────────────

export interface KetenInvoer {
  /** Naam van het huidige recept en hoe hij huidig werd. */
  recept: string | null
  receptBron: HuidigReceptBron
  /** Het aantal brouwsels van het product. */
  brouwsels: number
  /** De eerste batch die eraan komt (`komtEraan`). */
  komt: Pick<KomtEraanBatch, 'batchNummer' | 'tank' | 'status'> | null
  etiket: ProductEtiketOordeel | null
  voorraad: VoorraadVerpakking[]
  artikelen: number
  openBestellingen: number
}

export interface KetenTeksten {
  /** "Kadeblond v4 · huidig". */
  recept: string
  /** "5× · #2609 in GV1". */
  brouwsels: string
  /** Telefoon: "#2609 in GV1", anders "5×". */
  brouwselsKort: string
  /** "tarwe ontbreekt" met de kleur van de chip; null zonder oordeel. */
  etiket: { tekst: string; kleur: EtiketStatus['kleur'] } | null
  /** "46 fles · 1 fust" — met de AGP apart: "120 fles (+480 AGP)". */
  voorraad: string
  /** Telefoon: vrij en AGP samen per verpakking, "600 fles · 3 fust". */
  voorraadKort: string
  /** "2 artikelen · 1 open bestelling". */
  verkoop: string
  /** Telefoon: het aantal artikelen. */
  artikelen: string
}

/** De twee regels van elk vak: Recept › Brouwsels › Etiket › Voorraad › Verkoop. */
export const ketenTeksten = (invoer: KetenInvoer, t: Vertaal): KetenTeksten => {
  const recept = invoer.recept
    ? `${invoer.recept} · ${t('recept_chip_huidig')}`
    : t('product_keten_geen_recept')
  const k = invoer.komt
  const nr = k?.batchNummer ? `#${k.batchNummer}` : t('verkoop_komt_batch')
  const waar = !k ? ''
    : k.status === 'Gepland' ? vulIn(t('product_keten_gepland'), { batch: nr })
    : k.tank ? vulIn(t('product_keten_in_tank'), { batch: nr, tank: k.tank })
    : vulIn(t('product_keten_onderweg'), { batch: nr })
  const aantal = vulIn(t('product_keten_aantal'), { n: invoer.brouwsels })
  const brouwsels = invoer.brouwsels === 0 && !waar ? t('product_keten_geen_brouwsels')
    : [invoer.brouwsels > 0 ? aantal : '', waar].filter(Boolean).join(' · ')
  const artikelen = invoer.artikelen === 1 ? t('product_keten_artikel') : vulIn(t('product_keten_artikelen'), { n: invoer.artikelen })
  const open = invoer.openBestellingen === 1 ? t('product_keten_open_bestelling')
    : invoer.openBestellingen > 1 ? vulIn(t('product_keten_open_bestellingen'), { n: invoer.openBestellingen }) : ''
  return {
    recept,
    brouwsels,
    brouwselsKort: waar || (invoer.brouwsels > 0 ? aantal : t('product_keten_geen_brouwsels')),
    etiket: invoer.etiket ? { tekst: invoer.etiket.kort, kleur: invoer.etiket.status.kleur } : null,
    voorraad: voorraadKort(invoer.voorraad, t),
    voorraadKort: voorraadKort(invoer.voorraad, t, { kort: true }),
    verkoop: [invoer.artikelen > 0 ? artikelen : t('product_keten_geen_artikel'), open].filter(Boolean).join(' · '),
    artikelen: String(invoer.artikelen),
  }
}

// ── Bierinformatie voor de weergave ─────────────────────────────────────────

/**
 * Wat de weergave van het bier (utils/bierinfo.ts `bierInfoWeergave`) uit de
 * administratie haalt: de energie van de referentiebatch (berekend uit OG/FG),
 * anders verwacht uit het huidige recept; de regels van de referentiebatch in
 * receptvorm; en het huidige recept als terugval voor de ingrediënten.
 */
export const bierAfleidingVoorProduct = (product: ProductLike | null | undefined, data: EtiketKaartData): BierAfleiding => {
  if (!product) return {}
  const v = productVergelijking(product, data)
  const h = huidigReceptVoorProduct(product, data.batches, data.recepten)
  const huidigRecept = h.receptId ? (data.recepten || []).find(r => r.id === h.receptId) || null : null
  const e = v?.waarden.energie
  return {
    energie: e && e.bron !== 'geen' ? { kcal: e.kcal, kj: e.kj, bron: e.bron } : null,
    referentieRegels: v?.ref
      ? batchRegelsAlsRecept(data.batchIngredienten, v.ref.id, { ingredienten: data.ingredienten, lots: data.lots })
      : null,
    huidigRecept,
  }
}

// ── Kostprijs ───────────────────────────────────────────────────────────────

export interface KostprijsStuk {
  /** Kostprijs van één verpakte eenheid. */
  kost: number
  /** Inhoud van die eenheid in liters. */
  inhoud: number
  /** Het bier erin: kostprijs per liter zonder verpakking × inhoud. */
  bier: number
  /** De verpakking van déze eenheid (onderdelen, anders de losse velden). */
  verpakking: number
}

/**
 * De kostprijs van één verpakte eenheid van een artikel: het bier
 * (`kostprijs_per_liter_excl_verpakking` × inhoud) plus de échte
 * verpakkingsprijs van díe verpakking (`verpakkingKostenPerStuk`). Nooit
 * prijs-per-liter × inhoud: daarin zit de verpakking van álle verpakkingen
 * van de batch, uitgesmeerd over de liters. Null zonder kostprijs, zonder
 * bekende verpakking of zonder inhoud.
 */
export const kostprijsPerStuk = (
  artikel: { verpakking_id?: unknown; verpakking_naam?: unknown; verpakking_type?: unknown; inhoud_liter?: unknown } | null | undefined,
  perLiterExclVerpakking: number | null | undefined,
  verpakkingen?: unknown[] | null,
  onderdelen?: unknown[] | null,
): KostprijsStuk | null => {
  const perLiter = Number(perLiterExclVerpakking) || 0
  if (!artikel || perLiter <= 0) return null
  const vp = vindVerpakking(artikel, verpakkingen as any[])
  if (!vp) return null
  const inhoud = getal(vp.inhoud_liter) || getal(artikel.inhoud_liter) || 0
  if (inhoud <= 0) return null
  const bier = perLiter * inhoud
  const verpakking = verpakkingKostenPerStuk(vp, onderdelen as any[])
  return { kost: bier + verpakking, inhoud, bier, verpakking }
}

/** Marge op een prijs excl. BTW tegenover de kostprijs van één eenheid. */
export const margeVoorPrijs = (kost: number, prijsExcl: number): { eur: number; pct: number } | null =>
  prijsExcl > 0 ? { eur: prijsExcl - kost, pct: ((prijsExcl - kost) / prijsExcl) * 100 } : null

/**
 * Waar de kostprijs van een product op rust: "uit 4 brouwsels · 1.140 L
 * afgevuld · vaste brouwkosten afgeleid". Zonder afgevuld brouwsel met
 * bekende kosten: "nog niets afgevuld met bekende kosten".
 */
export const kostprijsBronTekst = (r: Pick<ProductKostprijsResult, 'totaal_liter' | 'batch_ids' | 'vaste_kosten_afgeleid'> | null | undefined, t: Vertaal): string => {
  const liter = Number(r?.totaal_liter) || 0
  if (liter <= 0) return t('product_kostprijs_geen')
  const n = (r?.batch_ids || []).length
  const basis = vulIn(t(n === 1 ? 'product_kostprijs_bron_1' : 'product_kostprijs_bron'), { n, liter: fmtQty(liter, 0) })
  return r?.vaste_kosten_afgeleid ? `${basis} · ${t('product_kostprijs_vast_afgeleid')}` : basis
}
