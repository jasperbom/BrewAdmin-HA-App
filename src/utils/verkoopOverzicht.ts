// Eén voorraadtelling voor Verkoop: per product en per verpakking wat er vrij
// ligt, wat nog in de AGP ligt, wat besteld is, wat eraan komt en hoe lang de
// voorraad nog meegaat.
//
// Tot nu toe telden het Verkoop-dashboard (vaste drempel 12, flessen en fusten
// opgeteld, AGP mee, picks en reserveringen niet), de productlijst en de kassa
// elk anders. Deze module is de telling die ze delen. Hij rekent niets zelf
// uit wat er al is:
//  - per afvulling de beschikbaarheid na open picks (`beschikbaarVoorAfvulling`,
//    `beschikbaarPerLocatieNaPicks` uit utils/beschikbaarheid.ts) — de fysieke
//    voorraad per locatie komt daar uit `voorraadPerLocatie`;
//  - een geblokkeerde afvulling (afgekeurde sluitcontrole, CCP 2) telt niet
//    (`afvullingVerkoopbaar`);
//  - de zachte reservering van open bestellingen (`openBestellingReserveringen`
//    + `gereserveerdVoorArtikel`) en de verdeling over vrij/AGP daarna
//    (`kassaVoorraadNaReservering`) zijn die van de kassa;
//  - een orderregel vindt zijn afvullingen met de matcher van de pickmodal
//    (`matchAfvullingenVoorRegel`).
//
// Twee getallen per verpakking, met elk een eigen naam:
//  - `vrij` / `agp` — wat er ligt na de open picks (die leggen voorraad vast),
//    vóór de zachte reservering. Dat is "46 vrij · 48 besteld · tekort 2" op het
//    product, het overzicht en de orderregel, en precies wat de kassa als
//    bruto buiten-AGP-voorraad optelt.
//  - `verkoopbaar` / `agpNaReservering` — wat er daarna nog over is als de open
//    bestellingen hun deel hebben: wat de kassa nu als verkoopbaar toont.
//
// Flessen en fusten worden nooit opgeteld: alles staat per verpakking. Waar
// één getal per product nodig is (de dekking), rekent de module in liters.
//
// Puur: geen React, geen opslag, geen vertaalfunctie. `vandaag` en de
// conditioneertijd komen binnen via de context, zodat alles testbaar is.

import type { Afboeking, Afvulling, Batch, Locatie, Uitlevering, Verplaatsing } from '../types'
import { getAgpLocatie, openBestellingReserveringen, gereserveerdVoorArtikel } from './calculations'
import type { OpenReservering } from './calculations'
import { beschikbaarVoorAfvulling, beschikbaarPerLocatieNaPicks, openPicks } from './beschikbaarheid'
import type { BeschikbaarPerLocatieData, PickBestelling, PickRegel } from './beschikbaarheid'
import { kassaVoorraadNaReservering } from './kassa'
import { afvullingVerkoopbaar } from './haccp'
import { batchesVanProduct } from './productKeten'
import { verpakProjectie } from './vergisting'
import { gemiddeldVerlies } from './receptKostprijs'
import type { VerliesCijfer } from './receptKostprijs'
import { verpakkingVerdeling } from './verpakkingKosten'
import type { VerpakkingMix } from './verpakkingKosten'
import { normaliseerStatus } from './volgendeStap'
import { productVoorRegel } from './sku'
import type { SkuRefData } from './sku'
import { matchAfvullingenVoorRegel } from './picking'
import { ymd } from './format'

// ── Vormen van de invoer ────────────────────────────────────────────────────
// Bewust ruim: de pagina's geven hun `useStore`-arrays rechtstreeks door.

export interface VerkoopProduct {
  id: number
  naam: string
  status?: string
  uit_roulatie?: boolean
}

export interface VerkoopArtikel {
  id?: number | string | null
  key?: string | null
  product_id?: number | null
  /** Legacy artikel (`artikelen`): hoort bij een bier op naam. */
  biernaam?: string | null
  verpakking_id?: number | null
  verpakking_naam?: string | null
  verpakking_type?: string | null
  inhoud_liter?: number | string | null
  artikelnummer?: string | null
  verkoopprijs?: number | string | null
  b2b_prijs?: number | string | null
  btw_pct?: number | string | null
}

export interface VerkoopVerpakking {
  id: number
  naam?: string | null
  type?: string | null
  inhoud_liter?: number | string | null
}

export interface VerkoopOrderRegel {
  id?: number
  type?: string | null
  merch?: boolean
  sku?: string | null
  artikel_key?: string | null
  bier_naam?: string | null
  verpakking_type?: string | null
  aantal?: number | string | null
}

export interface VerkoopBestelling extends PickBestelling {
  regels?: VerkoopOrderRegel[] | null
}

export interface VerkoopPick extends PickRegel {
  regel_id?: number | null
}

type VerkoopBatch = Pick<Batch, 'id'> & Partial<Batch>

/**
 * Alles wat de telling nodig heeft — dezelfde data die de pagina's al als
 * props krijgen (App.tsx), alleen met de namen van de data-keys:
 * `{producten, productArtikelen, artikelen, merchArtikelen, verpakkingen,
 * batches: bat, afvullingen: av, uitleveringen: uit, verplaatsingen,
 * afboekingen, locaties, bestellingen, bestellingPicks, verliesRegistraties,
 * conditionerenDagen: planningInst?.conditioneren_dagen}`.
 *
 * Maak per render één context (bijv. in een `useMemo`) en muteer hem niet: de
 * module onthoudt per context-object wat hij al uitrekende.
 */
export interface VerkoopCtx {
  producten?: VerkoopProduct[] | null
  /** `product_artikelen`: SKU en prijs per product en verpakking. */
  productArtikelen?: VerkoopArtikel[] | null
  /** Legacy `artikelen` (op biernaam), alleen voor producten zonder productartikel. */
  artikelen?: VerkoopArtikel[] | null
  merchArtikelen?: Array<{ sku?: string | null; naam?: string | null }> | null
  verpakkingen?: VerkoopVerpakking[] | null
  batches?: VerkoopBatch[] | null
  afvullingen?: Afvulling[] | null
  uitleveringen?: Uitlevering[] | null
  verplaatsingen?: Verplaatsing[] | null
  afboekingen?: Afboeking[] | null
  locaties?: Locatie[] | null
  bestellingen?: VerkoopBestelling[] | null
  bestellingPicks?: VerkoopPick[] | null
  verliesRegistraties?: Array<{ batch_id?: number | null; liter?: number | string | null; bron?: string | null }> | null
  /** `planningInst.conditioneren_dagen` — standaard 14, net als de planning. */
  conditionerenDagen?: number | null
  /** Vandaag als `YYYY-MM-DD`; standaard de lokale datum. */
  vandaag?: string | null
}

// ── Grenzen ─────────────────────────────────────────────────────────────────

/** Dekking: gemiddelde uitlevering per week over zoveel weken. */
export const DEKKING_WEKEN = 8
/** Pas met verkoop in minstens zoveel van die weken zegt de dekking iets. */
export const DEKKING_MIN_WEKEN_MET_VERKOOP = 3
/** Onder zoveel weken dekking is de voorraad laag (tenzij er op tijd iets komt). */
export const DEKKING_LAAG_WEKEN = 3
/** Bier-THT binnen zoveel dagen vraagt om aandacht (zelfde grens als de productpagina). */
export const BIER_THT_WAARSCHUWING_DAGEN = 60
/** Batches in deze fasen "komen eraan". */
export const KOMT_ERAAN_STATUSSEN: readonly string[] = ['Gepland', 'Brouwen', 'Vergisten', 'Conditioneren']

// ── Kleine helpers ──────────────────────────────────────────────────────────

const lower = (x: unknown): string => String(x ?? '').trim().toLowerCase()

const HALVE_DAG_MS = 12 * 3_600_000

const getal = (x: unknown): number | null => {
  if (x === null || x === undefined || String(x).trim() === '') return null
  const n = Number(String(x).replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

const positief = (x: unknown): number => {
  const n = getal(x)
  return n != null && n > 0 ? n : 0
}

const rond = (n: number, d = 1): number => {
  const f = 10 ** d
  return Math.round(n * f) / f
}

/** Dagnummer van een `YYYY-MM-DD` (of ISO-timestamp), los van de tijdzone. */
const dagNr = (s: unknown): number | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s ?? ''))
  if (!m) return null
  return Math.floor(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86_400_000)
}

const vandaagVan = (ctx: Pick<VerkoopCtx, 'vandaag'>): string =>
  (ctx.vandaag && dagNr(ctx.vandaag) != null ? String(ctx.vandaag).slice(0, 10) : ymd(new Date()))

/** Dagen van `vandaag` tot `datum` (negatief = voorbij); null zonder datum. */
export const dagenTot = (datum: string | null | undefined, vandaag: string): number | null => {
  const a = dagNr(vandaag), b = dagNr(datum)
  return a == null || b == null ? null : b - a
}

/** Inhoud van één stuk van een afvulling (twee schrijfwijzen; nul = niet ingevuld). */
const afvInhoud = (a: Partial<Afvulling> | null | undefined): number =>
  positief(a?.inhoud_per_eenheid) || positief(a?.inhoud_liter)

// ── Verpakking: één sleutel voor afvulling, artikel en orderregel ───────────

export interface VerpakkingHerkenning {
  /** `vp:<id>` als de verpakking bekend is, anders `tekst:<naam>`. */
  sleutel: string
  verpakking: VerkoopVerpakking | null
  naam: string
}

/**
 * Bij welke verpakking hoort een afvulling, artikel of orderregel? Op id, dan
 * op naam (`verpakking_naam`, daarna `verpakking_type` — dat veld bevat vaak de
 * naam), dan op type als er precies één verpakking van dat type is. Lukt dat
 * niet, dan telt de tekst zelf als sleutel.
 */
export const verpakkingSleutel = (
  rec: { verpakking_id?: number | null; verpakking_naam?: string | null; verpakking_type?: string | null } | null | undefined,
  verpakkingen?: VerkoopVerpakking[] | null,
): VerpakkingHerkenning => {
  const lijst = verpakkingen || []
  let vp: VerkoopVerpakking | null = null
  if (rec?.verpakking_id != null && Number(rec.verpakking_id) !== 0) {
    vp = lijst.find(v => Number(v?.id) === Number(rec.verpakking_id)) || null
  }
  if (!vp) {
    for (const tekst of [rec?.verpakking_naam, rec?.verpakking_type]) {
      const t = lower(tekst)
      if (!t) continue
      vp = lijst.find(v => lower(v?.naam) === t) || null
      if (vp) break
    }
  }
  if (!vp) {
    const t = lower(rec?.verpakking_type || rec?.verpakking_naam)
    const vanType = t ? lijst.filter(v => lower(v?.type) === t) : []
    if (vanType.length === 1) vp = vanType[0]
  }
  if (vp) return { sleutel: `vp:${vp.id}`, verpakking: vp, naam: String(vp.naam || rec?.verpakking_naam || rec?.verpakking_type || '') }
  const naam = String(rec?.verpakking_naam || rec?.verpakking_type || '').trim()
  return { sleutel: `tekst:${lower(naam)}`, verpakking: null, naam }
}

// ── Welk product hoort bij een afvulling ────────────────────────────────────

/**
 * Het product van een afvulling — precies één, zodat geen fles bij twee
 * producten meetelt:
 *  1. het eigen `product_id` (gezet bij het afvullen of een rebrand);
 *  2. anders het primaire product van de batch (`batch.product_id`; extra
 *     `product_ids` niet — dan zou dezelfde afvulling bij twee bieren tellen);
 *  3. anders het enige product waar de andere afvullingen van die batch aan
 *     hangen — behalve ge-rebrande rijen (`rebrand_van_afvulling_id`): die
 *     zijn juist van dit bier weggehaald. Telde zo'n rij mee, dan verhuisde bij
 *     een deelrebrand van een oude afvulling ook het origineel naar het nieuwe
 *     product en verloor het oude bier zijn voorraad (de kassa houdt hem op
 *     naam bij het oude bier);
 *  4. anders het product met de naam van de batch (`biernaam`, dan `naam`).
 */
export const productVanAfvulling = (
  a: Pick<Afvulling, 'batch_id'> & Partial<Afvulling> | null | undefined,
  ctx: Pick<VerkoopCtx, 'batches' | 'producten' | 'afvullingen'>,
): number | null => {
  if (!a) return null
  if (a.product_id != null && Number(a.product_id) !== 0) return Number(a.product_id)
  const batch = (ctx.batches || []).find(b => b?.id === a.batch_id)
  if (batch?.product_id != null && Number(batch.product_id) !== 0) return Number(batch.product_id)
  const andere = new Set<number>()
  for (const x of ctx.afvullingen || []) {
    if (!x || x.batch_id !== a.batch_id || x.rebrand_van_afvulling_id != null) continue
    if (x.product_id != null && Number(x.product_id) !== 0) andere.add(Number(x.product_id))
  }
  if (andere.size === 1) return [...andere][0]
  if (batch) {
    for (const naam of [batch.biernaam, batch.naam]) {
      const n = lower(naam)
      if (!n) continue
      const p = (ctx.producten || []).find(x => lower(x?.naam) === n)
      if (p) return p.id
    }
  }
  return null
}

// ── Index (eenmaal per context) ─────────────────────────────────────────────

interface AfvullingStand {
  /** Totaal nog beschikbaar na open picks (`beschikbaarVoorAfvulling`). */
  totaal: number
  /** Daarvan buiten de AGP — zoals de kassa het telt (nooit meer dan `totaal`). */
  vrij: number
  /** Daarvan in de AGP. */
  agp: number
  perLocatie: Record<number, number>
}

interface Index {
  skuData: SkuRefData
  productVan: Map<number, number | null>
  reserveringen: OpenReservering[]
  picksPerAfvulling: Map<number, number>
  /** Stand na alle open picks. */
  stand: (a: Afvulling) => AfvullingStand
  /** Stand na de open picks van alle bestellingen behalve `bestellingId` (de pickmodal-blik). */
  standZonder: (a: Afvulling, bestellingId: number | null) => AfvullingStand
  voorraad: Map<number, VoorraadVerpakking[]>
  komtEraan: Map<number, KomtEraanBatch[]>
  /** Verlies en verpakkingsverdeling over álle batches (terugval van "komt eraan"), lui en één keer. */
  brouwerijVerlies: () => VerliesCijfer
  brouwerijVerdeling: () => VerpakkingMix
}

// De index hangt aan het context-object: `verkoopOverzicht` vraagt voor elk
// product hetzelfde op, en dat hoeft maar één keer. Muteer een context dus niet
// tussen twee aanroepen — maak een nieuwe.
const INDEXEN = new WeakMap<VerkoopCtx, Index>()

const indexVoor = (ctx: VerkoopCtx): Index => {
  const al = INDEXEN.get(ctx)
  if (al) return al
  const locaties = ctx.locaties || []
  const data: BeschikbaarPerLocatieData = {
    bestellingPicks: ctx.bestellingPicks || [],
    bestellingen: ctx.bestellingen || [],
    uit: ctx.uitleveringen || [],
    afboekingen: ctx.afboekingen || [],
    verplaatsingen: ctx.verplaatsingen || [],
    locaties,
  }
  const agpId = getAgpLocatie(locaties).id
  const productVan = new Map<number, number | null>()
  for (const a of ctx.afvullingen || []) if (a) productVan.set(a.id, productVanAfvulling(a, ctx))
  const picksPerAfvulling = new Map<number, number>()
  // Per bestelling: op welke afvullingen liggen haar open picks.
  const picksPerBestelling = new Map<number, Set<number>>()
  for (const p of openPicks(ctx.bestellingPicks, ctx.bestellingen)) {
    picksPerAfvulling.set(p.afvulling_id, (picksPerAfvulling.get(p.afvulling_id) || 0) + (Number(p.aantal) || 0))
    let set = picksPerBestelling.get(p.bestelling_id)
    if (!set) picksPerBestelling.set(p.bestelling_id, set = new Set())
    set.add(p.afvulling_id)
  }
  const berekenStand = (a: Afvulling, excl?: number): AfvullingStand => {
    const totaal = beschikbaarVoorAfvulling(a, data, excl)
    const perLoc = beschikbaarPerLocatieNaPicks(a, data, excl)
    let buiten = 0
    const perLocatie: Record<number, number> = {}
    for (const k of Object.keys(perLoc)) {
      const n = Number(perLoc[Number(k)] || 0)
      if (n > 0) perLocatie[Number(k)] = n
      if (Number(k) !== agpId) buiten += n
    }
    // Zoals de kassa: buiten de AGP nooit meer dan er in totaal beschikbaar is.
    const vrij = Math.min(totaal, buiten)
    return { totaal, vrij, agp: Math.max(0, totaal - vrij), perLocatie }
  }
  const standen = new Map<string, AfvullingStand>()
  const stand = (a: Afvulling): AfvullingStand => {
    const sleutel = `${a.id}|`
    let s = standen.get(sleutel)
    if (!s) standen.set(sleutel, s = berekenStand(a))
    return s
  }
  const standZonder = (a: Afvulling, bestellingId: number | null): AfvullingStand => {
    // Liggen er geen open picks van die bestelling op, dan is het dezelfde stand.
    if (bestellingId == null || !picksPerBestelling.get(bestellingId)?.has(a.id)) return stand(a)
    const sleutel = `${a.id}|${bestellingId}`
    let s = standen.get(sleutel)
    if (!s) standen.set(sleutel, s = berekenStand(a, bestellingId))
    return s
  }
  let verliesBreed: VerliesCijfer | null = null
  let verdelingBreed: VerpakkingMix | null = null
  const idx: Index = {
    skuData: {
      producten: ctx.producten || [],
      productArtikelen: ctx.productArtikelen || [],
      artikelen: ctx.artikelen || [],
      merchArtikelen: ctx.merchArtikelen || [],
    },
    productVan,
    reserveringen: openBestellingReserveringen(ctx.bestellingen || [], ctx.bestellingPicks || []),
    picksPerAfvulling,
    stand,
    standZonder,
    voorraad: new Map(),
    komtEraan: new Map(),
    brouwerijVerlies: () => verliesBreed || (verliesBreed = gemiddeldVerlies({
      batches: ctx.batches || [], afvullingen: ctx.afvullingen || [], verliesRegistraties: ctx.verliesRegistraties || [],
    })),
    brouwerijVerdeling: () => verdelingBreed || (verdelingBreed = verpakkingVerdeling(null, ctx.batches || [], {
      afvullingen: ctx.afvullingen || [], verpakkingen: ctx.verpakkingen || [],
    })),
  }
  INDEXEN.set(ctx, idx)
  return idx
}

const productUitCtx = (productId: number, ctx: VerkoopCtx): VerkoopProduct | null =>
  (ctx.producten || []).find(p => p?.id === productId) || null

/**
 * De batches van een product: `batchesVanProduct` (product_id/product_ids),
 * plus — voor batches van vóór de keten, die nog geen product hebben — de
 * batches die naar het product heten (`biernaam`, anders `naam`). Een batch
 * mét product hoort nooit op naam bij een ander.
 */
const batchesVoorProduct = (product: VerkoopProduct, alle: VerkoopBatch[]): VerkoopBatch[] => {
  const eigen = batchesVanProduct(product, alle)
  const ids = new Set(eigen.map(b => b.id))
  const naam = lower(product.naam)
  if (!naam) return eigen
  const opNaam = alle.filter(b => b && !ids.has(b.id)
    && (b.product_id == null || Number(b.product_id) === 0)
    && !(Array.isArray(b.product_ids) && b.product_ids.length)
    && (lower(b.biernaam) === naam || (!lower(b.biernaam) && lower(b.naam) === naam)))
  return [...eigen, ...opNaam]
}

// ── Voorraad per product, per verpakking ────────────────────────────────────

export interface VoorraadLot {
  afvullingId: number
  /** Lotcode van de afvulsessie (`L2607-B1`); leeg bij afvullingen van vóór de sessies. */
  lotcode: string | null
  tht: string | null
  batchId: number
  batchNummer: string | null
  /** Beschikbaar per locatie na open picks (alleen locaties met voorraad). */
  perLocatie: Record<number, number>
  /** Buiten de AGP, na open picks (vóór reserveringen van open bestellingen). */
  vrij: number
  /** In de AGP, na open picks. */
  agp: number
  totaal: number
  /** Afgekeurde sluitcontrole (CCP 2): telt niet mee in de groep. */
  geblokkeerd: boolean
}

export interface VoorraadVerpakking {
  sleutel: string
  verpakkingId: number | null
  naam: string
  type: string | null
  inhoudLiter: number | null
  /** Het artikel (SKU, prijs) van dit product in deze verpakking, als dat er is. */
  artikel: VerkoopArtikel | null
  /**
   * Buiten de AGP, na open picks, vóór de zachte reservering van open
   * bestellingen: "46 vrij". Gelijk aan de bruto buiten-AGP-voorraad van de
   * kassa (en wat de pickmodal als vrije voorraad aanbiedt).
   */
  vrij: number
  /** In de AGP, na open picks: "240 AGP" — eerst uitslaan om te verkopen. */
  agp: number
  /** Al gepickt voor open bestellingen, nog niet uitgeleverd (zit niet meer in `vrij`/`agp`). */
  gepickt: number
  /** Besteld in open bestellingen (nieuw/bevestigd), nog niet gepickt — de zachte reservering. */
  gereserveerd: number
  /** Open besteld in totaal: `gepickt + gereserveerd` — "48 besteld". */
  besteld: number
  /** Wat de open bestellingen niet uit de vrije voorraad kunnen halen: `gereserveerd − vrij`, ≥ 0. */
  tekort: number
  /** Deel van het tekort dat in de AGP ligt (op te lossen door uit te slaan). */
  uitTeSlaan: number
  /** Na de reservering nog verkoopbaar buiten de AGP — exact wat de kassa als verkoopbaar toont. */
  verkoopbaar: number
  /** Na de reservering nog in de AGP (kassa: `agp`). */
  agpNaReservering: number
  /** Stuks in afvullingen die door CCP 2 geblokkeerd zijn (niet in `vrij`/`agp`). */
  geblokkeerd: number
  /** Lots met voorraad, oudste THT eerst (ook geblokkeerde, gemarkeerd). */
  lots: VoorraadLot[]
  /** Eerste THT van de niet-geblokkeerde voorraad. */
  eersteTht: string | null
  /** Alle afvullingen van dit product in deze verpakking (ook uitverkochte). */
  afvullingIds: number[]
}

const fefo = (a: { tht: string | null }, b: { tht: string | null }): number => {
  if (!a.tht && !b.tht) return 0
  if (!a.tht) return 1
  if (!b.tht) return -1
  return a.tht.localeCompare(b.tht)
}

/** Past een verpakkingstekst (van een orderregel) bij deze groep? */
const verpakkingPast = (tekst: unknown, g: VoorraadVerpakking, verpakkingen: VerkoopVerpakking[]): boolean => {
  const t = lower(tekst)
  if (!t) return false
  if (t === lower(g.naam)) return true
  if (verpakkingSleutel({ verpakking_type: String(tekst) }, verpakkingen).sleutel === g.sleutel) return true
  return !!g.type && lower(g.type) === t
}

/**
 * De voorraad van één product per verpakking — flessen en fusten nooit
 * opgeteld. Elke verpakking waar het product een artikel of een afvulling in
 * heeft staat erin, ook als hij op is (dan zie je wat er besteld is). Volgorde:
 * kleinste inhoud eerst (fles vóór fust).
 *
 * `vrij`/`agp`/`besteld`/`tekort` zijn de cijfers voor het scherm ("46 vrij ·
 * 48 besteld · tekort 2"); `verkoopbaar` is wat de kassa nog mag verkopen.
 */
export const voorraadPerProduct = (productId: number, ctx: VerkoopCtx): VoorraadVerpakking[] => {
  const idx = indexVoor(ctx)
  const bekend = idx.voorraad.get(productId)
  if (bekend) return bekend
  const product = productUitCtx(productId, ctx)
  const verpakkingen = ctx.verpakkingen || []
  const groepen = new Map<string, VoorraadVerpakking>()
  const groep = (h: VerpakkingHerkenning): VoorraadVerpakking => {
    let g = groepen.get(h.sleutel)
    if (!g) {
      g = {
        sleutel: h.sleutel,
        verpakkingId: h.verpakking ? Number(h.verpakking.id) : null,
        naam: h.naam,
        type: h.verpakking?.type ? String(h.verpakking.type) : null,
        inhoudLiter: positief(h.verpakking?.inhoud_liter) || null,
        artikel: null,
        vrij: 0, agp: 0, gepickt: 0, gereserveerd: 0, besteld: 0, tekort: 0, uitTeSlaan: 0,
        verkoopbaar: 0, agpNaReservering: 0,
        geblokkeerd: 0, lots: [], eersteTht: null, afvullingIds: [],
      }
      groepen.set(h.sleutel, g)
    }
    return g
  }

  // 1. Artikelen: productartikelen; zonder productartikel de legacy artikelen
  //    op biernaam (zoals de kassa).
  const eigenArtikelen = (ctx.productArtikelen || []).filter(a => a && Number(a.product_id) === productId)
  const artikelen = eigenArtikelen.length
    ? eigenArtikelen
    : product ? (ctx.artikelen || []).filter(a => a && lower(a.biernaam) && lower(a.biernaam) === lower(product.naam)) : []
  for (const art of artikelen) {
    const g = groep(verpakkingSleutel(art, verpakkingen))
    if (!g.artikel) g.artikel = art
    if (g.inhoudLiter == null && positief(art.inhoud_liter)) g.inhoudLiter = positief(art.inhoud_liter)
  }

  // 2. Afvullingen van dit product.
  const batchNr = new Map<number, string | null>()
  for (const b of ctx.batches || []) if (b) batchNr.set(b.id, b.batch_nummer ? String(b.batch_nummer).replace(/^#/, '') : null)
  for (const a of ctx.afvullingen || []) {
    if (!a || idx.productVan.get(a.id) !== productId) continue
    const g = groep(verpakkingSleutel(a, verpakkingen))
    g.afvullingIds.push(a.id)
    if (g.inhoudLiter == null && afvInhoud(a) > 0) g.inhoudLiter = afvInhoud(a)
    g.gepickt += idx.picksPerAfvulling.get(a.id) || 0
    const s = idx.stand(a)
    if (s.totaal <= 0) continue
    const geblokkeerd = !afvullingVerkoopbaar(a)
    g.lots.push({
      afvullingId: a.id,
      lotcode: a.lotcode ? String(a.lotcode) : null,
      tht: a.tht ? String(a.tht).slice(0, 10) : null,
      batchId: a.batch_id,
      batchNummer: batchNr.get(a.batch_id) ?? null,
      perLocatie: s.perLocatie,
      vrij: s.vrij,
      agp: s.agp,
      totaal: s.totaal,
      geblokkeerd,
    })
    if (geblokkeerd) { g.geblokkeerd += s.totaal; continue }
    g.vrij += s.vrij
    g.agp += s.agp
  }

  const lijst = [...groepen.values()].sort((a, b) =>
    (a.inhoudLiter ?? Infinity) - (b.inhoudLiter ?? Infinity) || a.naam.localeCompare(b.naam))

  // 3. Zachte reserveringen van open bestellingen: elk precies bij één
  //    verpakking. Eerst zoals de kassa per artikel telt (SKU, anders biernaam +
  //    verpakking), daarna — voor een verpakking zonder artikel — op biernaam
  //    en verpakking.
  if (product) {
    for (const r of idx.reserveringen) {
      let g = lijst.find(x => x.artikel && gereserveerdVoorArtikel([r], {
        artikelnummer: x.artikel.artikelnummer || null,
        biernaam: product.naam,
        verpakking_type: x.artikel.verpakking_type || '',
      }, idx.skuData) > 0)
      if (!g && lower(r.bier_naam) === lower(product.naam)) {
        g = lijst.find(x => !x.artikel && verpakkingPast(r.verpakking_type, x, verpakkingen))
      }
      if (g) g.gereserveerd += r.aantal
    }
  }

  // 4. Afleiden: de kassa-verdeling, het tekort en de eerste THT.
  for (const g of lijst) {
    const k = kassaVoorraadNaReservering(g.vrij + g.agp, g.vrij, g.gereserveerd)
    g.verkoopbaar = k.buitenAgp
    g.agpNaReservering = k.agp
    g.besteld = g.gepickt + g.gereserveerd
    g.tekort = Math.max(0, g.gereserveerd - g.vrij)
    g.uitTeSlaan = Math.min(g.agp, g.tekort)
    g.lots.sort(fefo)
    g.eersteTht = g.lots.find(l => !l.geblokkeerd && l.tht)?.tht ?? null
  }

  idx.voorraad.set(productId, lijst)
  return lijst
}

/** Zoek de verpakking van een product op verpakkings-id (getal) of sleutel (`vp:3`, `tekst:fles`). */
export const zoekVoorraadVerpakking = (
  lijst: VoorraadVerpakking[],
  verpakking: number | string | null | undefined,
): VoorraadVerpakking | null => {
  if (verpakking == null || verpakking === '') return null
  if (typeof verpakking === 'number') return lijst.find(g => g.verpakkingId === verpakking) || null
  return lijst.find(g => g.sleutel === verpakking) || null
}

// ── Komt eraan ──────────────────────────────────────────────────────────────

export interface KomtEraanVerpakking {
  sleutel: string
  verpakkingId: number | null
  naam: string
  inhoudLiter: number
  /** Aandeel van de liters in deze verpakking (0–1). */
  aandeel: number
  /** Geschat aantal stuks (naar beneden afgerond). */
  stuks: number
}

export interface KomtEraanBatch {
  batchId: number
  batchNummer: string | null
  tank: string | null
  status: string
  /** Verwachte afvuldatum (`verpakProjectie`), `YYYY-MM-DD` — "verwacht". */
  afvulDatum: string | null
  /** De afvuldatum is berekend uit het schema (geen handmatige tankduur). */
  afvulDatumGeschat: boolean
  /** Alleen bij een geplande batch: de brouwdatum. */
  geplandeBrouwdatum: string | null
  /** Liters in de gistkuip (`liter_vergist`). */
  liters: number
  /** Liters na het gemiddelde verlies. */
  verkoopbareLiters: number
  verliesPct: number
  verliesBron: VerliesCijfer['bron']
  /**
   * Waar de verdeling over de verpakkingen vandaan komt: `recept` = de eigen
   * afvullingen van dit bier; `brouwerij` = die van de hele brouwerij, beperkt
   * tot de verpakkingen waarin dit bier een artikel heeft; `artikel` = het
   * enige artikel van het bier; `geen` = onbekend (dan geen stuks).
   */
  mixBron: 'recept' | 'brouwerij' | 'artikel' | 'geen'
  /** Geschat aantal stuks per verpakking ("geschat"); leeg als de verdeling of de liters onbekend zijn. */
  stuksPerVerpakking: KomtEraanVerpakking[]
  /** De batch hoort ook bij een ander product (`product_ids`): de stuks gelden voor de hele batch. */
  gedeeld: boolean
}

/** Eén verpakking in de verdeling van "komt eraan", met de liters waarop het aandeel berust. */
interface VerdelingRegel { sleutel: string; verpakkingId: number | null; naam: string; inhoudLiter: number; liters: number }

/**
 * De verdeling als exacte aandelen. `aandeel` op een mixregel is op vier
 * decimalen afgerond; daarmee rekenen en dan naar beneden afronden kost een
 * heel fust (271,2 L × 0,2212 ÷ 20 = 2,9995 → 2, terwijl dezelfde liters vorige
 * keer precies 3 fusten werden). Daarom delen we de liters zelf.
 */
const exacteAandelen = (regels: VerdelingRegel[]): Array<VerdelingRegel & { aandeel: number }> => {
  const totaal = regels.reduce((s, r) => s + r.liters, 0)
  return totaal > 0 ? regels.map(r => ({ ...r, aandeel: r.liters / totaal })) : []
}

/**
 * De batches van dit product in Gepland t/m Conditioneren: wat er in de tanks
 * ligt (of gepland is) en wanneer het naar verwachting afgevuld wordt. Het
 * aantal stuks is altijd een schatting: liters × (1 − gemiddeld verlies) ×
 * verpakkingsverdeling. Verlies en verdeling komen uit de eigen afvullingen van
 * dit bier; is het nooit afgevuld, dan uit die van de hele brouwerij — de
 * verdeling dan alleen over de verpakkingen waarin dit bier een artikel heeft
 * (een flessenbier krijgt geen blikken van een ander bier toegerekend); valt
 * daar niets van over, dan het enige artikel van het bier. Eerstvolgende
 * afvuldatum eerst.
 */
export const komtEraan = (productId: number, ctx: VerkoopCtx): KomtEraanBatch[] => {
  const idx = indexVoor(ctx)
  const bekend = idx.komtEraan.get(productId)
  if (bekend) return bekend
  const product = productUitCtx(productId, ctx)
  if (!product) { idx.komtEraan.set(productId, []); return [] }
  const alleBatches = ctx.batches || []
  const eigen = batchesVoorProduct(product, alleBatches)
  // Oude statusnamen (Vergisting, Lagering) tellen als hun huidige fase.
  const lopend = eigen.filter(b => KOMT_ERAAN_STATUSSEN.includes(normaliseerStatus(b.status)))
  if (!lopend.length) { idx.komtEraan.set(productId, []); return [] }

  let verlies = gemiddeldVerlies({
    batches: eigen, afvullingen: ctx.afvullingen || [], verliesRegistraties: ctx.verliesRegistraties || [],
  })
  if (verlies.bron === 'aanname') {
    const breed = idx.brouwerijVerlies()
    if (breed.bron !== 'aanname') verlies = breed
  }

  const verpakkingen = ctx.verpakkingen || []
  const naarRegels = (mix: VerpakkingMix): VerdelingRegel[] => mix.regels.map(r => {
    const h = verpakkingSleutel({ verpakking_id: r.verpakkingId, verpakking_naam: r.naam }, verpakkingen)
    return { sleutel: h.sleutel, verpakkingId: r.verpakkingId, naam: h.naam || r.naam, inhoudLiter: r.inhoud, liters: r.liters }
  })
  let mixBron: KomtEraanBatch['mixBron'] = 'geen'
  let regels = naarRegels(verpakkingVerdeling(eigen, null, { afvullingen: ctx.afvullingen || [], verpakkingen }))
  if (regels.length) mixBron = 'recept'
  else {
    const metArtikel = voorraadPerProduct(productId, ctx).filter(g => g.artikel)
    const artikelSleutels = new Set(metArtikel.map(g => g.sleutel))
    const breed = naarRegels(idx.brouwerijVerdeling())
      .filter(r => !artikelSleutels.size || artikelSleutels.has(r.sleutel))
    if (breed.length) {
      regels = breed
      mixBron = 'brouwerij'
    } else {
      const metInhoud = metArtikel.filter(g => (g.inhoudLiter || 0) > 0)
      if (metInhoud.length === 1) {
        const g = metInhoud[0]
        regels = [{ sleutel: g.sleutel, verpakkingId: g.verpakkingId, naam: g.naam, inhoudLiter: g.inhoudLiter || 0, liters: 1 }]
        mixBron = 'artikel'
      }
    }
  }
  const verdeling = exacteAandelen(regels.filter(r => r.inhoudLiter > 0))

  const condDagen = ctx.conditionerenDagen != null && Number.isFinite(Number(ctx.conditionerenDagen))
    ? Number(ctx.conditionerenDagen) : 14
  const uit: KomtEraanBatch[] = lopend.map(b => {
    const proj = verpakProjectie(b, condDagen)
    const liters = positief(b.liter_vergist)
    const verkoopbaar = liters * Math.max(0, 1 - verlies.pct / 100)
    const anderen = [b.product_id, ...(Array.isArray(b.product_ids) ? b.product_ids : [])]
      .filter(x => x != null && Number(x) !== 0 && Number(x) !== productId)
    const status = normaliseerStatus(b.status)
    return {
      batchId: b.id,
      batchNummer: b.batch_nummer ? String(b.batch_nummer).replace(/^#/, '') : null,
      tank: b.tank ? String(b.tank) : null,
      status,
      // `verpakkenMs` is lokale middernacht plus hele dagen in milliseconden: over
      // een zomer-/wintertijdwissel heen valt dat een uur verschoven. Een halve
      // dag erbij houdt de datum op de bedoelde dag.
      afvulDatum: proj.verpakkenMs != null ? ymd(new Date(proj.verpakkenMs + HALVE_DAG_MS)) : null,
      afvulDatumGeschat: proj.geschat,
      geplandeBrouwdatum: status === 'Gepland' && b.datum ? String(b.datum).slice(0, 10) : null,
      liters: rond(liters, 1),
      verkoopbareLiters: rond(verkoopbaar, 1),
      verliesPct: verlies.pct,
      verliesBron: verlies.bron,
      mixBron: verdeling.length ? mixBron : 'geen',
      // Naar beneden: een half fust vul je niet. De marge vangt alleen de
      // drijvende komma op (3 fusten mogen geen 2,9999… worden). Een verpakking
      // waar naar schatting niets in gaat, staat er niet als "± 0 fust" bij.
      stuksPerVerpakking: verdeling
        .map(r => ({
          sleutel: r.sleutel, verpakkingId: r.verpakkingId, naam: r.naam, inhoudLiter: r.inhoudLiter,
          aandeel: rond(r.aandeel, 4),
          stuks: Math.floor((verkoopbaar * r.aandeel) / r.inhoudLiter + 1e-6),
        }))
        .filter(r => r.stuks > 0),
      gedeeld: anderen.length > 0,
    }
  })
  uit.sort((a, b) => {
    if (a.afvulDatum && b.afvulDatum) return a.afvulDatum.localeCompare(b.afvulDatum) || a.batchId - b.batchId
    if (a.afvulDatum) return -1
    if (b.afvulDatum) return 1
    return a.batchId - b.batchId
  })
  idx.komtEraan.set(productId, uit)
  return uit
}

// ── Dekking ─────────────────────────────────────────────────────────────────

export interface VerkoopTempo {
  /** Gemiddelde uitlevering per week over `DEKKING_WEKEN` weken. */
  perWeek: number
  /** In hoeveel van die weken er iets uitgeleverd is. */
  wekenMetVerkoop: number
  totaal: number
  /** `stuks` voor één verpakking, `liter` voor het hele product. */
  eenheid: 'stuks' | 'liter'
}

/**
 * Hoeveel er de afgelopen `DEKKING_WEKEN` weken per week uitgeleverd is — voor
 * één verpakking in stuks, voor het hele product in liters (flessen en fusten
 * tellen nooit als stuks bij elkaar). Week 0 = de laatste zeven dagen t/m
 * vandaag.
 */
export const verkoopTempo = (
  productId: number,
  verpakking: number | string | null | undefined,
  ctx: VerkoopCtx,
): VerkoopTempo => {
  const lijst = voorraadPerProduct(productId, ctx)
  const g = zoekVoorraadVerpakking(lijst, verpakking)
  const eenheid: VerkoopTempo['eenheid'] = g ? 'stuks' : 'liter'
  const groepen = g ? [g] : (verpakking == null || verpakking === '' ? lijst : [])
  const afvById = new Map<number, Afvulling>()
  for (const a of ctx.afvullingen || []) if (a) afvById.set(a.id, a)
  const afvIds = new Set<number>()
  for (const x of groepen) for (const id of x.afvullingIds) afvIds.add(id)
  const vandaag = dagNr(vandaagVan(ctx)) ?? 0
  const perWeek = new Array<number>(DEKKING_WEKEN).fill(0)
  for (const u of ctx.uitleveringen || []) {
    if (!u || u.afvulling_id == null || !afvIds.has(u.afvulling_id)) continue
    const d = dagNr(u.datum)
    if (d == null) continue
    const verschil = vandaag - d
    if (verschil < 0) continue
    const week = Math.floor(verschil / 7)
    if (week >= DEKKING_WEKEN) continue
    const aantal = Number(u.aantal) || 0
    // Op een uitlevering is `inhoud_liter` het regeltotaal — nooit gebruiken.
    if (eenheid === 'stuks') perWeek[week] += aantal
    else perWeek[week] += aantal * (positief(u.inhoud_per_eenheid) || afvInhoud(afvById.get(u.afvulling_id)))
  }
  const totaal = perWeek.reduce((s, n) => s + n, 0)
  return {
    perWeek: rond(totaal / DEKKING_WEKEN, 3),
    wekenMetVerkoop: perWeek.filter(n => n > 0).length,
    totaal: rond(totaal, 3),
    eenheid,
  }
}

/**
 * Hoeveel weken de voorraad (vrij + AGP, na de reservering van open
 * bestellingen — wat nog te verkopen is) meegaat bij het tempo van de
 * afgelopen `DEKKING_WEKEN` weken. `null` als er in minder dan
 * `DEKKING_MIN_WEKEN_MET_VERKOOP` weken iets verkocht is — dan zegt een
 * gemiddelde niets. Met een verpakking (id of sleutel) in stuks, zonder (null)
 * voor het hele product in liters.
 */
export const dekkingWeken = (
  productId: number,
  verpakking: number | string | null | undefined,
  ctx: VerkoopCtx,
): number | null => {
  const tempo = verkoopTempo(productId, verpakking, ctx)
  if (tempo.wekenMetVerkoop < DEKKING_MIN_WEKEN_MET_VERKOOP || tempo.perWeek <= 0) return null
  const lijst = voorraadPerProduct(productId, ctx)
  const g = zoekVoorraadVerpakking(lijst, verpakking)
  if (verpakking != null && verpakking !== '' && !g) return null
  const voorraad = g
    ? g.verkoopbaar + g.agpNaReservering
    : lijst.reduce((s, x) => s + (x.verkoopbaar + x.agpNaReservering) * (x.inhoudLiter || 0), 0)
  return rond(voorraad / tempo.perWeek, 1)
}

/**
 * Is de dekking laag? Nooit voor een product dat uit roulatie is, nooit zonder
 * dekkingsgetal, en niet als er een batch op tijd afgevuld wordt (vóór de
 * voorraad op is).
 */
export const dekkingLaag = (
  weken: number | null,
  product: Pick<VerkoopProduct, 'uit_roulatie'> | null | undefined,
  komt: Array<Pick<KomtEraanBatch, 'afvulDatum'>> = [],
  vandaag?: string | null,
): boolean => {
  if (product?.uit_roulatie) return false
  if (weken == null || weken >= DEKKING_LAAG_WEKEN) return false
  const nu = vandaagVan({ vandaag })
  const opTijd = komt.some(k => {
    const d = dagenTot(k.afvulDatum, nu)
    return d != null && d <= weken * 7
  })
  return !opTijd
}

// ── Het overzicht ───────────────────────────────────────────────────────────

/** Van urgent naar rustig. */
export type VerkoopUrgentie = 'tekort' | 'uitslaan' | 'geen_vrij' | 'tht' | 'laag' | 'ok'
export const VERKOOP_URGENTIES: readonly VerkoopUrgentie[] = ['tekort', 'uitslaan', 'geen_vrij', 'tht', 'laag', 'ok']

export interface VerkoopOverzichtRegel {
  productId: number
  naam: string
  product: VerkoopProduct
  uitRoulatie: boolean
  /** Per verpakking (`voorraadPerProduct`). */
  voorraad: VoorraadVerpakking[]
  komtEraan: KomtEraanBatch[]
  /** De eerste batch die eraan komt ("tekort tot ± vr 16-10"), of null. */
  eersteKomtEraan: KomtEraanBatch | null
  /** Dekking van het hele product in weken (in liters gerekend), of null. */
  dekkingWeken: number | null
  /** Dekking per verpakking in weken (in stuks), op `sleutel`; null = te weinig verkoop. */
  dekkingPerVerpakking: Record<string, number | null>
  urgentie: VerkoopUrgentie
  /** Eerste THT van de verkoopbare voorraad. */
  eersteTht: string | null
  /** De verpakking (`sleutel`) met die eerste THT. */
  eersteThtVerpakking: string | null
  /** Dagen tot die THT (negatief = verlopen). */
  thtDagen: number | null
  /** Tekort in liters over alle verpakkingen — alleen voor de volgorde. */
  tekortLiter: number
  /** Niets op voorraad, niets besteld, niets onderweg (een scherm kan zo'n product inklappen). */
  leeg: boolean
}

/**
 * Alle actieve producten (niet gearchiveerd; uit roulatie telt mee) met hun
 * voorraad per verpakking, wat eraan komt, de dekking en een urgentie,
 * gesorteerd van urgent naar rustig:
 *  1. `tekort` — open bestellingen kunnen niet uit de vrije voorraad, en ook
 *     niet door uit te slaan: er ligt echt te weinig ("tekort tot ± 16-10");
 *  2. `uitslaan` — open bestellingen kunnen niet uit de vrije voorraad, maar
 *     wat ontbreekt ligt in de AGP (eerst uitslaan; dezelfde uitkomst als
 *     `orderRegelLevering`, geen "tekort" met een afvuldatum erachter);
 *  3. `geen_vrij` — niets meer vrij te verkopen, terwijl er wel iets in de AGP
 *     ligt of eraan komt;
 *  4. `tht` — verkoopbare voorraad met een THT binnen 60 dagen (of verlopen);
 *  5. `laag` — dekking onder `DEKKING_LAAG_WEKEN` weken en niets op tijd
 *     onderweg (nooit voor een product uit roulatie);
 *  6. `ok`.
 * Binnen een urgentie: grootste tekort (liters), dan kortste dekking, dan naam.
 */
export const verkoopOverzicht = (ctx: VerkoopCtx): VerkoopOverzichtRegel[] => {
  const vandaag = vandaagVan(ctx)
  const regels: VerkoopOverzichtRegel[] = []
  for (const p of ctx.producten || []) {
    if (!p || p.status === 'gearchiveerd') continue
    const voorraad = voorraadPerProduct(p.id, ctx)
    const komt = komtEraan(p.id, ctx)
    const dekking = dekkingWeken(p.id, null, ctx)
    const dekkingPerVerpakking: Record<string, number | null> = {}
    for (const g of voorraad) dekkingPerVerpakking[g.sleutel] = dekkingWeken(p.id, g.sleutel, ctx)
    const uitRoulatie = !!p.uit_roulatie
    const verkoopbaar = voorraad.reduce((s, g) => s + g.verkoopbaar, 0)
    const agpNa = voorraad.reduce((s, g) => s + g.agpNaReservering, 0)
    const opVoorraad = voorraad.some(g => g.vrij + g.agp > 0)
    const besteld = voorraad.some(g => g.besteld > 0)
    const metTekort = voorraad.filter(g => g.tekort > 0)
    const tekortLiter = rond(metTekort.reduce((s, g) => s + g.tekort * (g.inhoudLiter || 0), 0), 3)
    let eersteTht: string | null = null
    let eersteThtVerpakking: string | null = null
    for (const g of voorraad) {
      if (g.eersteTht && g.vrij + g.agp > 0 && (!eersteTht || g.eersteTht < eersteTht)) {
        eersteTht = g.eersteTht
        eersteThtVerpakking = g.sleutel
      }
    }
    const thtDagen = dagenTot(eersteTht, vandaag)
    const leeg = !opVoorraad && !besteld && komt.length === 0

    let urgentie: VerkoopUrgentie = 'ok'
    if (metTekort.some(g => g.tekort > g.uitTeSlaan)) urgentie = 'tekort'
    else if (metTekort.length) urgentie = 'uitslaan'
    else if (verkoopbaar === 0 && (agpNa > 0 || komt.length > 0)) urgentie = 'geen_vrij'
    else if (thtDagen != null && thtDagen <= BIER_THT_WAARSCHUWING_DAGEN) urgentie = 'tht'
    else if (dekkingLaag(dekking, p, komt, vandaag)) urgentie = 'laag'

    regels.push({
      productId: p.id, naam: String(p.naam || ''), product: p, uitRoulatie,
      voorraad, komtEraan: komt, eersteKomtEraan: komt[0] ?? null,
      dekkingWeken: dekking, dekkingPerVerpakking, urgentie,
      eersteTht, eersteThtVerpakking, thtDagen, tekortLiter, leeg,
    })
  }
  const rang = (u: VerkoopUrgentie) => VERKOOP_URGENTIES.indexOf(u)
  return regels.sort((a, b) =>
    rang(a.urgentie) - rang(b.urgentie)
    || b.tekortLiter - a.tekortLiter
    || (a.dekkingWeken ?? Infinity) - (b.dekkingWeken ?? Infinity)
    || a.naam.localeCompare(b.naam, 'nl'))
}

// ── Orderregel: kan hij geleverd worden? ────────────────────────────────────

/**
 * `kan_geleverd` — alles uit vrije voorraad;
 * `uitslaan` — wat ontbreekt ligt in de AGP (eerst uitslaan);
 * `tekort` — er is te weinig (zie `komtEraan`);
 * `geen_bier` — geen bierregel, of een regel die bij geen enkel bier hoort.
 */
export type LeverStatus = 'kan_geleverd' | 'uitslaan' | 'tekort' | 'geen_bier'

export interface OrderRegelLevering {
  status: LeverStatus
  productId: number | null
  verpakkingSleutel: string | null
  /** Besteld aantal van de regel. */
  nodig: number
  /** Al voor deze regel gepickt (alleen met `bestellingId`). */
  gepickt: number
  /**
   * Wat de pickmodal voor deze regel kan aanbieden — de vrije voorraad,
   * inclusief de eigen picks van de bestelling ("46 vrij"). Bij export/intra-EU
   * ook de AGP.
   */
  beschikbaar: number
  /** min(nodig, beschikbaar) — "Picken (46 van 48)". */
  kan: number
  /** nodig − kan. */
  tekort: number
  /** Deel van het tekort dat in de AGP ligt: eerst uitslaan. */
  uitTeSlaan: number
  /** Batches van dit product die eraan komen (Gepland t/m Conditioneren). */
  komtEraan: KomtEraanBatch[]
  /** Er ligt bier van dit product in een tank (of het staat gepland). */
  bierInTank: boolean
  /**
   * Alleen `true` als de regel bij géén bier hoort, er niets te picken is én
   * er nog niets voor gepickt is — de enige situatie waarin "Markeer als
   * merch" een zinnig voorstel is.
   */
  merchVoorstel: boolean
}

export interface OrderRegelLeveringOpties {
  /** De bestelling van de regel: haar eigen picks tellen dan als beschikbaar (zoals in de pickmodal). */
  bestellingId?: number | null
  /** Export/intra-EU: mag onder schorsing uit de AGP (`verkoopUitAgpToegestaan`). */
  agpToegestaan?: boolean
}

interface Verbruik { vrij: Map<number, number>; agp: Map<number, number> }

const leverRegel = (
  regel: VerkoopOrderRegel,
  ctx: VerkoopCtx,
  opties: OrderRegelLeveringOpties,
  verbruik: Verbruik,
): OrderRegelLevering => {
  const idx = indexVoor(ctx)
  const nodig = Math.max(0, Number(regel?.aantal) || 0)
  const bestellingId = opties.bestellingId ?? null
  const gepickt = bestellingId != null && regel?.id != null
    ? (ctx.bestellingPicks || [])
      .filter(p => p && p.bestelling_id === bestellingId && p.regel_id === regel.id)
      .reduce((s, p) => s + (Number(p.aantal) || 0), 0)
    : 0
  const geenBier: OrderRegelLevering = {
    status: 'geen_bier', productId: null, verpakkingSleutel: null, nodig, gepickt,
    beschikbaar: 0, kan: 0, tekort: 0, uitTeSlaan: 0, komtEraan: [], bierInTank: false, merchVoorstel: false,
  }
  if (!regel || (regel.type || 'bier') !== 'bier' || regel.merch) return geenBier

  // Dezelfde SKU-bepaling als de pickmodal: de regel zelf, anders via het
  // legacy artikel (artikel_key).
  const sku = regel.sku
    || (regel.artikel_key ? (ctx.artikelen || []).find(a => a?.key === regel.artikel_key)?.artikelnummer : null)
    || null
  const bierNaam = String(regel.bier_naam || '')
  const verpakkingTekst = String(regel.verpakking_type || '')
  const kandidaten = (ctx.afvullingen || []).filter(a => a && afvullingVerkoopbaar(a)
    && idx.standZonder(a, bestellingId).totaal > 0)
  const gematcht: Afvulling[] = matchAfvullingenVoorRegel(kandidaten, bierNaam, verpakkingTekst, sku, {
    bat: ctx.batches || [], artikelen: ctx.artikelen || [], producten: ctx.producten || [],
    productArtikelen: ctx.productArtikelen || [], verpakkingen: ctx.verpakkingen || [],
  })

  // FEFO verdelen: eerst vrije voorraad, dan (export/intra-EU) of als
  // "eerst uitslaan" de AGP. Wat een vorige regel van dezelfde order al nam,
  // telt niet nog eens.
  let rest = nodig
  let beschikbaar = 0
  let kan = 0
  const agpRuimte: Array<{ id: number; n: number }> = []
  for (const a of gematcht) {
    const st = idx.standZonder(a, bestellingId)
    const vrijA = Math.max(0, st.vrij - (verbruik.vrij.get(a.id) || 0))
    const agpA = Math.max(0, st.agp - (verbruik.agp.get(a.id) || 0))
    beschikbaar += vrijA
    const neem = Math.min(rest, vrijA)
    if (neem > 0) {
      verbruik.vrij.set(a.id, (verbruik.vrij.get(a.id) || 0) + neem)
      rest -= neem
      kan += neem
    }
    if (agpA > 0) agpRuimte.push({ id: a.id, n: agpA })
  }
  let uitTeSlaan = 0
  for (const r of agpRuimte) {
    if (opties.agpToegestaan) beschikbaar += r.n
    const neem = Math.min(rest, r.n)
    if (neem <= 0) continue
    verbruik.agp.set(r.id, (verbruik.agp.get(r.id) || 0) + neem)
    rest -= neem
    if (opties.agpToegestaan) kan += neem
    else uitTeSlaan += neem
  }

  let productId = productVoorRegel(sku, bierNaam, idx.skuData)
  if (productId == null && gematcht.length) productId = idx.productVan.get(gematcht[0].id) ?? null
  const artikel = sku ? (ctx.productArtikelen || []).find(a => a && a.artikelnummer && lower(a.artikelnummer) === lower(sku)) : null
  const verpakking = artikel
    ? verpakkingSleutel(artikel, ctx.verpakkingen)
    : gematcht.length ? verpakkingSleutel(gematcht[0], ctx.verpakkingen)
      : verpakkingTekst ? verpakkingSleutel({ verpakking_type: verpakkingTekst }, ctx.verpakkingen) : null
  const komt = productId != null ? komtEraan(productId, ctx) : []
  const tekort = Math.max(0, nodig - kan)
  const status: LeverStatus = productId == null && !gematcht.length
    ? 'geen_bier'
    : tekort === 0 ? 'kan_geleverd'
      : uitTeSlaan >= tekort ? 'uitslaan'
        : 'tekort'
  return {
    status, productId, verpakkingSleutel: verpakking?.sleutel ?? null,
    nodig, gepickt, beschikbaar, kan,
    tekort: status === 'geen_bier' ? nodig : tekort,
    uitTeSlaan,
    komtEraan: komt,
    bierInTank: komt.length > 0,
    // Is er voor de regel al iets gepickt, dan is het bier (zelfde regel als
    // de vastloper-melding van de bestellingenpagina).
    merchVoorstel: status === 'geen_bier' && nodig > 0 && gepickt === 0,
  }
}

/**
 * Kan deze orderregel geleverd worden? `kan_geleverd`, `uitslaan` (het
 * ontbrekende deel ligt in de AGP) of `tekort` — met wat er eraan komt. Een
 * regel waarvan het product bekend is, is altijd bier: dan nooit een
 * merchvoorstel, ook niet als er (nog) niets op voorraad is en het bier alleen
 * in de tank ligt.
 */
export const orderRegelLevering = (
  regel: VerkoopOrderRegel,
  ctx: VerkoopCtx,
  opties: OrderRegelLeveringOpties = {},
): OrderRegelLevering => leverRegel(regel, ctx, opties, { vrij: new Map(), agp: new Map() })

export interface BestellingLevering {
  regels: Array<{ regelId: number | null; levering: OrderRegelLevering }>
  /** Alleen bierregels. */
  nodig: number
  kan: number
  tekort: number
  /** De zwaarste status van de regels; `leeg` zonder bierregels. */
  status: LeverStatus | 'leeg'
  /** De eerste batch die eraan komt voor een regel met tekort ("komt ± 16-10"). */
  eersteKomtEraan: KomtEraanBatch | null
}

/**
 * De levering van een hele bestelling: per bierregel `orderRegelLevering`,
 * waarbij regels die uit dezelfde afvullingen putten elkaar niet dubbel tellen.
 * `kan`/`nodig` is de "Picken (46 van 48)" van de ActieBalk.
 */
export const bestellingLevering = (
  bestelling: VerkoopBestelling,
  ctx: VerkoopCtx,
  opties: Omit<OrderRegelLeveringOpties, 'bestellingId'> = {},
): BestellingLevering => {
  const verbruik: Verbruik = { vrij: new Map(), agp: new Map() }
  const regels = (bestelling?.regels || [])
    .filter(r => r && (r.type || 'bier') === 'bier' && !r.merch)
    .map(r => ({
      regelId: r.id ?? null,
      levering: leverRegel(r, ctx, { ...opties, bestellingId: bestelling.id }, verbruik),
    }))
  const nodig = regels.reduce((s, r) => s + r.levering.nodig, 0)
  const kan = regels.reduce((s, r) => s + r.levering.kan, 0)
  const tekort = regels.reduce((s, r) => s + r.levering.tekort, 0)
  const statussen = regels.map(r => r.levering.status)
  const status: BestellingLevering['status'] = !regels.length ? 'leeg'
    : statussen.includes('tekort') ? 'tekort'
      : statussen.includes('geen_bier') ? 'geen_bier'
        : statussen.includes('uitslaan') ? 'uitslaan'
          : 'kan_geleverd'
  const eersteKomtEraan = regels
    .filter(r => r.levering.tekort > 0)
    .map(r => r.levering.komtEraan[0])
    .find(Boolean) ?? null
  return { regels, nodig, kan, tekort, status, eersteKomtEraan }
}

/** i18n-sleutel + parameters voor de leverstatus, overal dezelfde tekst. */
export interface LeverLabel {
  sleutel: string
  params: Record<string, number>
  /** Semantische kleur van de chip. */
  kleur: 'groen' | 'oranje' | 'rood' | 'grijs'
}

/**
 * De korte tekst bij een orderregel of bestelling: "kan geleverd" (groen),
 * "eerst uitslaan (n)" (oranje), "tekort n" (oranje; met `komtEraan` zet het
 * scherm er "komt ± 16-10" achter), of "niet herkend" (grijs) voor een regel
 * die bij geen bier hoort. Een bestelling zonder bierregels (`leeg`) geeft een
 * lege sleutel: toon dan niets.
 */
export const leverLabel = (
  l: Pick<OrderRegelLevering, 'status' | 'tekort' | 'uitTeSlaan'> | Pick<BestellingLevering, 'status' | 'tekort'>,
): LeverLabel => {
  switch (l.status) {
    case 'kan_geleverd': return { sleutel: 'verkoop_lever_kan_geleverd', params: {}, kleur: 'groen' }
    case 'uitslaan': return {
      sleutel: 'verkoop_lever_uitslaan',
      params: { n: 'uitTeSlaan' in l ? l.uitTeSlaan : l.tekort },
      kleur: 'oranje',
    }
    case 'tekort': return { sleutel: 'verkoop_lever_tekort', params: { n: l.tekort }, kleur: 'oranje' }
    case 'geen_bier': return { sleutel: 'verkoop_lever_geen_bier', params: {}, kleur: 'grijs' }
    // Een bestelling zonder bierregels: niets te leveren uit de biervoorraad.
    default: return { sleutel: '', params: {}, kleur: 'grijs' }
  }
}
