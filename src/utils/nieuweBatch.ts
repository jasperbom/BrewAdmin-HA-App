// Het blad "Wat brouw je?" — een nieuwe batch plannen (docs/OPZET-PRODUCTIE-
// VERKOOP.md hoofdstuk 3, 6 en 7; SPEC scherm C en D).
//
// Eén blad met vijf ingangen: Brouwzaal en Batches (*+ Nieuwe batch*), een
// vrije tank (tank ingevuld), *Brouwen* op een recept (recept en product
// ingevuld) en *Nieuwe batch* op een product (product en huidig recept
// ingevuld). Stap 1 "Wat brouw je?" begint bij je producten — per product het
// huidige recept — met de subgroep Seizoen / uit roulatie, dan de andere
// recepten in gebruik; het archief alleen via zoeken. Stap 2 "Wanneer en
// waar": brouwdatum, de tank met zijn status óp die datum, liters, het product
// en een vooruitblik op het etiket.
//
// Inplannen maakt dezelfde batch als het planformulier dat dit blad vervangt
// (`receptNaarBatch` + de productkoppeling van utils/batchKeten.ts), met de
// bewuste verschillen uit het opzet (hoofdstuk 7, "Tankstatus op
// brouwdatum"): een tank telt op de brouwdatum (`tankBeschikbaarOp`) in plaats
// van vandaag, en een lagertank is geen gisttank. Een gekozen Brewfather-versie
// gaat in `recept_versie_id`; andere liters dan het recept in `liter_vergist`.
//
// Puur: geen React, geen opslag, geen klok en geen vertaalfunctie. Id's,
// batchnummer en tijdstempel geeft de aanroeper uit; het scherm
// (components/batch/NieuweBatchBlad.tsx) maakt de teksten uit de sleutels hier.

import type { Allergeen, Batch, BatchIngredient, Ingredient, Product, Recept, Tank } from '../types'
import {
  hoofdIdResolver, huidigReceptVoorProduct, nieuwProductUitBatch, receptVoorBatch, tankBeschikbaarOp,
} from './productKeten'
import type { NieuwProductVelden, TankBeschikbaarheid, TankBeschikbaarOpties } from './productKeten'
import { besluitProduct, productBijPlannen } from './batchKeten'
import type { PlanProduct, ProductBesluit, ProductBesluitFout, ProductKeuzeWaarde } from './batchKeten'
import { receptNaarBatch, sg3 } from './receptNaarBatch'
import type { BatchRegelUitRecept, BatchUitRecept, NieuweBatchBasis } from './receptNaarBatch'
import { receptenVoorKiezer } from './receptGebruik'
import type { ProductReceptGroep, ReceptGebruik } from './receptGebruik'
import {
  etiketStatus, productEtiketWaarden, receptEtiketWaarden, sorteerAllergenen, vergelijkEtiket,
} from './etiket'
import type { EtiketStatus, EtiketWaarden, ProductEtiketCtx } from './etiket'
import { ingredientVoorReceptRegel, receptRegelVoorraad, receptVoorraadOordeel } from './ingredientVoorraad'
import type { ReceptVoorraadStatus } from './ingredientVoorraad'

type ReceptLike = Pick<Recept, 'id'> & Partial<Recept>
type ProductLike = Pick<Product, 'id' | 'naam'> & Partial<Product>
type BatchLike = Pick<Batch, 'id'> & Partial<Batch>
type TankLike = Pick<Tank, 'id'> & Partial<Tank>
type IngredientLike = Pick<Ingredient, 'id'> & Partial<Pick<Ingredient, 'naam' | 'bf_props'>>
type RegelLike = Pick<BatchIngredient, 'id' | 'batch_id'> & Partial<BatchIngredient>

const IS_DATUM = /^\d{4}-\d{2}-\d{2}$/

const idTekst = (v: unknown): string => (v == null ? '' : String(v).trim())

/** Een product-id als getal, of null bij leeg/0/ongeldig. */
const productIdGetal = (v: unknown): number | null => {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) && n !== 0 ? n : null
}

// ── De ingang ───────────────────────────────────────────────────────────────

/** Wat een ingang al invult. Alles is optioneel: *+ Nieuwe batch* geeft niets mee. */
export interface NieuweBatchVerzoek {
  /** *Brouwen* op een recept: het hoofdrecept, of een versie-id (dan die versie). */
  receptId?: string | number | null
  /** De gekozen versie van dat recept. */
  versieId?: string | number | null
  /** *Nieuwe batch* op een product: het product, met zijn huidige recept. */
  productId?: number | string | null
  /** Een vrije tank op de brouwzaal. */
  tank?: string | null
  /** Brouwdatum (JJJJ-MM-DD); standaard vandaag. */
  datum?: string | null
}

/** Wat er gekozen is om te brouwen. */
export interface BladKeuze {
  /** Het hoofdrecept; null = zonder recept plannen. */
  receptId: string | null
  /** De gekozen Brewfather-versie; null = het recept zelf. */
  versieId: string | null
  /** Het product van de regel waaruit gekozen is (Jouw producten, Seizoen), anders null. */
  productId: number | null
}

export interface BladBegin {
  /** null = nog niets gekozen: het blad begint bij stap 1. */
  keuze: BladKeuze | null
  /** De keuze voor het product (`besluitProduct`); null = het voorstel volgen. */
  productKeuze: ProductKeuzeWaarde | null
  tank: string
  datum: string
  /** Het product van de ingang (*Nieuwe batch* op een product), ook zonder recept. */
  ingangProductId: number | null
}

/** Bestaat er een record van dit hoofdrecept (het recept zelf of een versie)? */
const receptBekend = (hoofd: string, recepten: ReadonlyArray<ReceptLike> | null | undefined): boolean => {
  if (!hoofd) return false
  const naarHoofd = hoofdIdResolver(recepten)
  return (recepten || []).some(r => !!r && naarHoofd(r) === hoofd)
}

/**
 * Wat het blad bij het openen al weet. *Brouwen* op een recept: dat recept
 * (een versie-id wordt het hoofdrecept met die versie); het product volgt het
 * voorstel. *Nieuwe batch* op een product: dat product (bewust gekozen) met
 * zijn huidige recept (`huidigReceptVoorProduct`) — heeft het geen recept,
 * dan begint het blad bij stap 1 met het product al gekozen. Een recept dat
 * niet (meer) bestaat telt niet.
 */
export const bladBegin = (
  verzoek: NieuweBatchVerzoek | null | undefined,
  ctx: {
    recepten: ReadonlyArray<ReceptLike> | null | undefined
    producten: ReadonlyArray<ProductLike> | null | undefined
    batches: BatchLike[] | null | undefined
    vandaag: string
  },
): BladBegin => {
  const v = verzoek || {}
  const recepten = ctx.recepten || []
  const naarHoofd = hoofdIdResolver(recepten)
  const pid = productIdGetal(v.productId)
  const product = pid == null ? null : (ctx.producten || []).find(p => !!p && Number(p.id) === pid) || null
  // Een gearchiveerd product krijgt geen nieuwe batch (dat kan `besluitProduct`
  // ook niet); zijn huidige recept staat wel klaar.
  const ingangProductId = product && product.status !== 'gearchiveerd' ? Number(product.id) : null

  let keuze: BladKeuze | null = null
  const gegeven = idTekst(v.receptId)
  if (gegeven) {
    const hoofd = naarHoofd(gegeven)
    if (receptBekend(hoofd, recepten)) {
      const isVersie = (id: string) => !!id && id !== hoofd && recepten.some(r => !!r && String(r.id) === id && naarHoofd(r) === hoofd)
      const versie = idTekst(v.versieId)
      keuze = {
        receptId: hoofd,
        versieId: isVersie(versie) ? versie : isVersie(gegeven) ? gegeven : null,
        productId: null,
      }
    }
  } else if (product) {
    const h = huidigReceptVoorProduct(product, ctx.batches, [...recepten])
    if (h.receptId && receptBekend(naarHoofd(h.receptId), recepten)) {
      keuze = { receptId: naarHoofd(h.receptId), versieId: null, productId: ingangProductId }
    }
  }
  const datum = idTekst(v.datum)
  return {
    keuze,
    productKeuze: ingangProductId != null ? { soort: 'product', productId: ingangProductId } : null,
    tank: idTekst(v.tank),
    datum: IS_DATUM.test(datum) ? datum : ctx.vandaag,
    ingangProductId,
  }
}

/**
 * Het receptrecord dat gebrouwen wordt: de gekozen versie als die bestaat,
 * anders het hoofdrecept — dezelfde afleiding als bij een batch
 * (`receptVoorBatch`). Ontbreekt het record van het hoofdrecept (alleen
 * versies over), dan de eerste versie ervan, zoals `receptGebruik` het recept
 * van zo'n regel kiest. Null zonder recept.
 */
export const receptVoorKeuze = <R extends ReceptLike>(
  keuze: Pick<BladKeuze, 'receptId' | 'versieId'> | null | undefined,
  recepten: R[] | null | undefined,
): R | null => {
  if (!keuze?.receptId) return null
  const r = receptVoorBatch<R>({ id: -1, recept_id: keuze.receptId, ...(keuze.versieId ? { recept_versie_id: keuze.versieId } : {}) }, recepten)
  if (r) return r
  const naarHoofd = hoofdIdResolver(recepten)
  return (recepten || []).find(x => !!x && naarHoofd(x) === keuze.receptId) || null
}

// ── Stap 1: de lijst ────────────────────────────────────────────────────────

export interface WatProductRegel<P extends ProductLike, R extends ReceptLike> {
  product: P
  /** Het recept van deze regel: het huidige, anders (verborgen, of bij zoeken weggefilterd) het eerste andere. */
  recept: ReceptGebruik<R>
  /** De andere recepten van dit product ("1 eerder recept ▾"). */
  eerder: ReceptGebruik<R>[]
  uitRoulatie: boolean
}

export interface WatLijst<P extends ProductLike, R extends ReceptLike> {
  /** Jouw producten: één regel per product, met zijn huidige recept. */
  jouw: WatProductRegel<P, R>[]
  /** Subgroep Seizoen / uit roulatie. */
  seizoen: WatProductRegel<P, R>[]
  /** Andere recepten in gebruik (aan geen actief product). */
  andere: ReceptGebruik<R>[]
  /** Archieftreffers — alleen bij een zoekterm. */
  archief: ReceptGebruik<R>[]
  /** "Typ om ook het Brewfather-archief te doorzoeken (128)". */
  archiefTotaal: number
  zoekt: boolean
  /** Niets om te kiezen (bij zoeken: geen treffer). */
  leeg: boolean
}

const productRegel = <P extends ProductLike, R extends ReceptLike>(g: ProductReceptGroep<P, R>): WatProductRegel<P, R> | null => {
  const recept = g.huidig ?? g.eerder[0] ?? null
  if (!recept) return null
  return { product: g.product, recept, eerder: g.huidig ? g.eerder : g.eerder.slice(1), uitRoulatie: g.uitRoulatie }
}

/**
 * De lijst van stap 1 (`receptenVoorKiezer`, de regel van hoofdstuk 6): per
 * product één regel met zijn huidige recept, de producten uit roulatie in een
 * eigen subgroep, dan de recepten in gebruik zonder product; het archief alleen
 * bij zoeken. Verborgen recepten staan er nooit in. Versies zijn nooit een
 * eigen regel (ze zijn een keuze bij het recept, in stap 2).
 */
export const watLijst = <P extends ProductLike, R extends ReceptLike>(
  gebruik: ReadonlyArray<ReceptGebruik<R>>,
  opties: { producten: ReadonlyArray<P> | null | undefined; zoek?: string | null },
): WatLijst<P, R> => {
  const k = receptenVoorKiezer(gebruik, { producten: opties.producten, zoek: opties.zoek })
  const regels = (groepen: ProductReceptGroep<P, R>[]) =>
    groepen.map(g => productRegel(g)).filter((r): r is WatProductRegel<P, R> => !!r)
  const jouw = regels(k.jouwProducten)
  const seizoen = regels(k.uitRoulatie)
  return {
    jouw, seizoen,
    andere: k.andereInGebruik,
    archief: k.archief,
    archiefTotaal: k.archiefTotaal,
    zoekt: k.zoekt,
    leeg: !jouw.length && !seizoen.length && !k.andereInGebruik.length && !k.archief.length,
  }
}

/**
 * Het voorstel voor het product: `productBijPlannen` (één kandidaat =
 * automatisch, meer = kiezen, geen = *Nieuw product* of *Later*). Zonder
 * recept is er niets voor te stellen: null.
 */
export const productPlanVoor = <P extends ProductLike>(
  recept: ReceptLike | null | undefined,
  ctx: { producten?: P[] | null; batches?: BatchLike[] | null; recepten?: ReceptLike[] | null },
): PlanProduct<P> | null => (recept ? productBijPlannen(recept, ctx) : null)

/**
 * De productkeuze na een tik op een regel. Een regel onder Jouw producten of
 * Seizoen kiest dat product — behalve als het recept toch alleen bij dat ene
 * product hoort: dan koppelt de app zelf, met een terugweg, zoals bij
 * *Brouwen* ("automatisch: dit recept hoort bij één product"). Kwam het blad
 * van dat product (*Nieuwe batch* op het product), dan blijft het een keuze.
 * Een recept zonder product (Andere recepten, het archief) houdt het product
 * van de ingang, anders het voorstel.
 */
export const productKeuzeNaKies = <P extends ProductLike>(
  plan: PlanProduct<P> | null,
  groepProductId: number | null,
  ingangProductId: number | null,
): ProductKeuzeWaarde | null => {
  if (groepProductId != null) {
    const alleen = plan?.soort === 'een' && Number(plan.product.id) === groepProductId
    if (alleen && ingangProductId !== groepProductId) return null
    return { soort: 'product', productId: groepProductId }
  }
  return ingangProductId != null ? { soort: 'product', productId: ingangProductId } : null
}

/**
 * Het besluit over het product (`besluitProduct`). Zonder recept is er geen
 * voorstel; dan telt alleen een bewust gekozen product (de ingang *Nieuwe
 * batch* op een product) — dat wordt het product van de batch.
 */
export const besluitVoorBlad = <P extends ProductLike>(
  plan: PlanProduct<P> | null,
  keuze: ProductKeuzeWaarde | null | undefined,
  ctx: { producten?: ReadonlyArray<P | null | undefined> | null; standaardNaam?: string | null },
): ProductBesluit<P> => {
  if (plan) return besluitProduct(plan, keuze, ctx)
  const geen: ProductBesluit<P> = { product: null, nieuwNaam: null, automatisch: false, fout: null }
  if (keuze?.soort !== 'product') return geen
  const p = (ctx.producten || []).find((x): x is P => !!x && Number(x.id) === Number(keuze.productId) && x.status !== 'gearchiveerd')
  return p ? { ...geen, product: p } : geen
}

// ── Stap 2: de tank op de brouwdatum ────────────────────────────────────────

export interface TankOpDatum<B> {
  id: string
  naam: string
  tank: TankLike
  beschikbaar: TankBeschikbaarheid<B>
}

/** De opties voor `tankBeschikbaarOp` bij het plannen, met het schema van het recept. */
export const tankOpties = (
  recept: ReceptLike | null | undefined,
  opties: Omit<TankBeschikbaarOpties, 'nieuweBatch' | 'voorVergisting'>,
): TankBeschikbaarOpties => ({
  ...opties,
  nieuweBatch: recept ? { vergistingsprofiel: recept.vergistingsprofiel || [] } : null,
  voorVergisting: true,
})

/**
 * Elke tank met zijn status op de brouwdatum: schoon/vuil (vrij),
 * gereserveerd (waarschuwing, wel te kiezen), bezet tot ± datum of een
 * lagertank (niet te kiezen). Zie `tankBeschikbaarOp`.
 */
export const tanksOpDatum = <B extends BatchLike>(
  tanks: ReadonlyArray<TankLike | null | undefined> | null | undefined,
  datum: string | null | undefined,
  batches: B[] | null | undefined,
  recept: ReceptLike | null | undefined,
  opties: Omit<TankBeschikbaarOpties, 'nieuweBatch' | 'voorVergisting'>,
): TankOpDatum<B>[] => (tanks || [])
  .filter((tk): tk is TankLike => !!tk && !!tk.id)
  .map(tk => ({
    id: String(tk.id),
    naam: String(tk.naam || tk.id),
    tank: tk,
    beschikbaar: tankBeschikbaarOp(tk, datum, batches, tankOpties(recept, opties)),
  }))

export type VooruitKleur = 'rood' | 'oranje' | 'groen' | 'grijs'

export interface TankStatusTekst {
  /** i18n-sleutel; plaatshouders {batch}, {vanaf}, {tot}. */
  sleutel: string
  kleur: VooruitKleur
  /** Erachter: "reinigen op de brouwdag", "krap". */
  extra: Array<'reinigen' | 'krap'>
}

/**
 * Wat er bij een tank staat (SPEC C): "Vrij vanaf ± vr 16-10 (Kadeblond #2609
 * afvullen) · reinigen op de brouwdag", "… · krap", "Vergist Havenbok #2611
 * van 14-10 tot ± 25-11", "Lagertank, niet voor vergisting". De sleutel kiest
 * de vorm; datums en de batch vult het scherm in.
 */
export const tankStatusTekst = (b: Pick<TankBeschikbaarheid<unknown>, 'soort' | 'batch' | 'bron' | 'vanaf' | 'tot' | 'krap' | 'reiniging'>): TankStatusTekst => {
  if (b.soort === 'ongeschikt') return { sleutel: 'nb_tank_ongeschikt', kleur: 'grijs', extra: [] }
  if (b.soort === 'bezet') {
    if (b.bron === 'gepland') {
      return { sleutel: b.tot ? 'nb_tank_vergist_tot' : 'nb_tank_vergist', kleur: 'grijs', extra: [] }
    }
    return { sleutel: b.tot ? 'nb_tank_bezet_tot' : 'nb_tank_bezet', kleur: 'grijs', extra: [] }
  }
  if (b.soort === 'gereserveerd') {
    return { sleutel: b.vanaf ? 'nb_tank_gereserveerd_op' : 'nb_tank_gereserveerd', kleur: 'oranje', extra: [] }
  }
  const extra: TankStatusTekst['extra'] = []
  if (b.reiniging === 'vuil') extra.push('reinigen')
  if (b.krap) extra.push('krap')
  if (b.batch) return { sleutel: b.tot ? 'nb_tank_vrij_vanaf' : 'nb_tank_vrij_na', kleur: 'grijs', extra }
  return { sleutel: b.reiniging === 'schoon' ? 'nb_tank_vrij_schoon' : 'nb_tank_vrij', kleur: 'grijs', extra }
}

// ── Stap 2: liters, doelen en ingrediënten ──────────────────────────────────

const getal = (v: unknown): number | null => {
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? v : Number(String(v).trim().replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

/**
 * De liters voor de batch als ze afwijken van het recept; null = die van het
 * recept (`liter_vergist` = `batch_size`, zoals `receptNaarBatch` hem zet).
 * Leeg, nul of geen getal telt niet. De ingrediënten blijven die van het recept.
 */
export const litersVoorBatch = (recept: ReceptLike | null | undefined, invoer: unknown): number | null => {
  const n = getal(invoer)
  if (n == null || n <= 0) return null
  const uitRecept = getal(recept?.batch_size)
  return uitRecept != null && uitRecept === n ? null : n
}

/** De doelen uit het recept (SPEC C: "OG 1.062 · FG 1.011 · 6,8 % · 22 IBU · 9 EBC · 58 kcal / 241 kJ"). */
export interface ReceptDoelen {
  og: number | null
  fg: number | null
  abv: number | null
  ibu: number | null
  ebc: number | null
  kcal: number | null
  kj: number | null
}

/** Uit het recept en wat het etiket ervan verwacht (`receptEtiketWaarden`). */
export const receptDoelen = (recept: ReceptLike, verwacht: EtiketWaarden): ReceptDoelen => {
  const og = sg3(recept.OG)
  const fg = sg3(recept.FG)
  return {
    og: og === '' ? null : og,
    fg: fg === '' ? null : fg,
    abv: verwacht.abv.waarde,
    ibu: verwacht.ibu.waarde,
    ebc: verwacht.ebc.waarde,
    kcal: verwacht.energie.kcal,
    kj: verwacht.energie.kj,
  }
}

export interface IngredientenOordeel {
  /** Zelfde oordeel als de stip in de receptenlijst (`receptVoorraadOordeel`). */
  status: ReceptVoorraadStatus
  /** Regels met een hoeveelheid. */
  regels: number
  /** Namen van de ingrediënten met te weinig voorraad (ook "bijna"). */
  tekort: string[]
  /** Namen zonder oordeel (niet gekoppeld, of eenheden niet om te rekenen). */
  onbekend: string[]
}

/** Kan het recept nu gebrouwen worden — met de namen erbij ("Tekort: Munich mout"). */
export const ingredientenOordeel = (
  recept: ReceptLike | null | undefined,
  lots: unknown[] | null | undefined,
  ingredienten: unknown[] | null | undefined,
): IngredientenOordeel => {
  const o = receptVoorraadOordeel(recept, lots as any[], ingredienten as any[])
  const tekort: string[] = []
  const onbekend: string[] = []
  const voeg = (lijst: string[], naam: string) => { if (naam && !lijst.includes(naam)) lijst.push(naam) }
  const match = (regel: unknown) => ingredientVoorReceptRegel(regel, ingredienten as any[])
  for (const sectie of ['mout', 'hop', 'gist', 'overig'] as const) {
    for (const regel of (recept?.[sectie] || [])) {
      if (!regel) continue
      const r = receptRegelVoorraad(regel, recept, lots as any[], match)
      const naam = String(regel.naam ?? '').trim()
      if (r.ok === false) voeg(tekort, naam)
      else if (r.ok === null) voeg(onbekend, naam)
    }
  }
  return { status: o.status, regels: o.regels, tekort, onbekend }
}

// ── Stap 2: vooruitblik op het etiket ───────────────────────────────────────

export interface VooruitblikRegel {
  /** i18n-sleutel; plaatshouders {recept}, {etiket}, {marge}, {allergenen}, {ingredienten}, {product}, {versie}. */
  sleutel: string
  kleur: VooruitKleur
  recept?: number | null
  etiket?: number | null
  marge?: number | null
  allergenen?: Allergeen[]
  ingredienten?: string[]
}

export interface EtiketVooruitblik {
  /** Wat het recept voor het etiket doet verwachten (label "verwacht"). */
  verwacht: EtiketWaarden
  /** De allergenen die het recept doet verwachten (`allergenenUitRecept`). */
  allergenenVerwacht: Allergeen[]
  alcohol: VooruitblikRegel
  allergenen: VooruitblikRegel
  /** Zonder (bestaand) product: waarom er niets te vergelijken is. */
  zonderEtiket: 'nieuw' | 'geen' | null
  /** Het oordeel over het etiket van het product (null zonder product). */
  status: EtiketStatus | null
  /** "Etiket bijwerken ›" aanbieden: het etiket mist iets of wijkt af. */
  bijwerken: boolean
  /** Er is iets dat niet klopt (oranje rand). Het blokkeert het plannen nooit. */
  aandacht: boolean
  /** De versie van het etiket ("Kadeblond (v3)"), of ''. */
  versie: string
}

export interface VooruitblikCtx extends ProductEtiketCtx {
  /** Hoe het product van de batch er komt: een bestaand product, *Nieuw product* of nog geen. */
  productSoort?: 'bestaand' | 'nieuw' | 'geen'
}

/**
 * Het etiket vóór de brouwdag (opzet hoofdstuk 5, SPEC C ④): de alcohol die
 * het recept verwacht tegen de ABV op het etiket, met de wettelijke marge
 * (`abvMarge`), en de allergenen van het recept (`allergenenUitRecept`, label
 * "verwacht") tegen de vastgelegde allergenen van het product — zo valt de
 * tarwe uit Kadeblond v4 al op bij het plannen. Zelfde vergelijking als de
 * etiketkaart (`vergelijkEtiket`, `etiketStatus`). Blokkeert nooit.
 */
export const etiketVooruitblik = (
  recept: ReceptLike,
  product: (Pick<Product, 'id'> & Partial<Product>) | null | undefined,
  ctx: VooruitblikCtx = {},
): EtiketVooruitblik => {
  const verwacht = receptEtiketWaarden(recept, { ingredienten: ctx.ingredienten, haccpInst: ctx.haccpInst })
  const allergenenVerwacht = sorteerAllergenen(verwacht.allergenen.lijst)
  const abv = verwacht.abv.waarde
  const onvolledig = [...verwacht.allergenen.nietBeoordeeld, ...verwacht.allergenen.nietInCatalogus]

  if (!product) {
    const alcohol: VooruitblikRegel = abv === null
      ? { sleutel: 'nb_etiket_alcohol_onbekend', kleur: 'grijs' }
      : { sleutel: 'nb_etiket_alcohol_verwacht', kleur: 'grijs', recept: abv }
    const allergenen: VooruitblikRegel = onvolledig.length
      ? { sleutel: 'recept_etiket_onvolledig', kleur: 'oranje', ingredienten: onvolledig }
      : allergenenVerwacht.length
        ? { sleutel: 'nb_etiket_allergenen_verwacht', kleur: 'grijs', allergenen: allergenenVerwacht }
        : { sleutel: 'nb_etiket_allergenen_verwacht_geen', kleur: 'grijs' }
    return {
      verwacht, allergenenVerwacht, alcohol, allergenen,
      zonderEtiket: ctx.productSoort === 'nieuw' ? 'nieuw' : 'geen',
      status: null, bijwerken: false, aandacht: allergenen.kleur !== 'grijs', versie: '',
    }
  }

  const pw = productEtiketWaarden(product, ctx)
  const v = vergelijkEtiket(verwacht, pw)
  const status = etiketStatus(v)
  const versie = pw.etiketVersie
  const metVersie = (sleutel: string) => (versie ? `${sleutel}_versie` : sleutel)

  let alcohol: VooruitblikRegel
  switch (v.abv.oordeel) {
    case 'leeg':
      alcohol = abv === null
        ? { sleutel: 'nb_etiket_alcohol_onbekend', kleur: 'grijs' }
        : { sleutel: 'nb_etiket_alcohol_leeg', kleur: 'oranje', recept: abv }
      break
    case 'onbekend':
      alcohol = { sleutel: 'nb_etiket_alcohol_onbekend_etiket', kleur: 'grijs', etiket: pw.abv.waarde }
      break
    case 'klopt':
      alcohol = { sleutel: 'nb_etiket_alcohol_klopt', kleur: 'grijs', recept: abv, etiket: pw.abv.waarde }
      break
    case 'binnen_marge':
      alcohol = { sleutel: 'nb_etiket_alcohol_binnen', kleur: 'grijs', recept: abv, etiket: pw.abv.waarde, marge: v.abv.marge ?? null }
      break
    default:
      alcohol = { sleutel: 'nb_etiket_alcohol_buiten', kleur: 'rood', recept: abv, etiket: pw.abv.waarde, marge: v.abv.marge ?? null }
  }

  let allergenen: VooruitblikRegel
  switch (v.allergenen.oordeel) {
    case 'leeg':
      allergenen = { sleutel: 'nb_etiket_allergenen_leeg', kleur: 'oranje', allergenen: allergenenVerwacht }
      break
    case 'ontbreekt':
      allergenen = { sleutel: metVersie('nb_etiket_allergenen_mist'), kleur: 'rood', allergenen: v.allergenen.ontbreekt }
      break
    case 'onvolledig':
      allergenen = v.allergenen.onvolledig.length
        ? { sleutel: 'recept_etiket_onvolledig', kleur: 'oranje', ingredienten: v.allergenen.onvolledig }
        : { sleutel: 'nb_etiket_allergenen_onvolledig_geen', kleur: 'oranje' }
      break
    case 'teveel':
      allergenen = { sleutel: metVersie('nb_etiket_allergenen_teveel'), kleur: 'oranje', allergenen: v.allergenen.teveel }
      break
    default:
      allergenen = allergenenVerwacht.length
        ? { sleutel: 'nb_etiket_allergenen_klopt', kleur: 'grijs', allergenen: allergenenVerwacht }
        : { sleutel: 'nb_etiket_allergenen_klopt_geen', kleur: 'grijs' }
  }

  return {
    verwacht, allergenenVerwacht, alcohol, allergenen,
    zonderEtiket: null,
    status,
    bijwerken: status.actie === 'etiket_bijwerken',
    aandacht: status.kleur !== 'groen' || alcohol.kleur !== 'grijs' || allergenen.kleur !== 'grijs',
    versie,
  }
}

// ── Inplannen ───────────────────────────────────────────────────────────────

export interface NieuweBatchInvoer {
  /** Het receptrecord (de gekozen versie, of het hoofdrecept); null = zonder recept. */
  recept: ReceptLike | null
  /** Eigen naam; leeg = van het product, anders van het recept. */
  naam?: string | null
  /** Brouwdatum; leeg = vandaag. */
  datum?: string | null
  /** Tank-id; leeg = nog geen tank. */
  tank?: string | null
  /** Zoals ingevuld; leeg of gelijk aan het recept = de liters van het recept. */
  liters?: unknown
  productKeuze?: ProductKeuzeWaarde | null
}

/** Wat de aanroeper uitgeeft: id's, het batchnummer en de klok. */
export interface NieuweBatchUitgifte {
  /** `newId(batches)`. */
  id: number
  /** `nextBatchNummer(batches)`. */
  batchNummer: string
  /** ISO-tijdstempel van aanmaken. */
  nu: string
  /** Vandaag (JJJJ-MM-DD): brouwdatum als er geen is, peildatum van de tank, aanmaakdatum van een nieuw product. */
  vandaag: string
  /** Het id voor een nieuw product (`newId(producten)`); alleen gebruikt bij *Nieuw product*. */
  productId: number
}

export interface NieuweBatchCtx<P extends ProductLike, B extends BatchLike> {
  batches: B[] | null | undefined
  ingredienten?: IngredientLike[] | null
  producten: P[] | null | undefined
  recepten?: ReceptLike[] | null
  tanks?: ReadonlyArray<TankLike | null | undefined> | null
  tankStatussen?: TankBeschikbaarOpties['tankStatussen']
  conditionerenDagen?: number | null
}

export type NieuweBatchFout<B> =
  | { soort: 'naam_of_recept' }
  | { soort: 'tank'; tank: string; beschikbaar: TankBeschikbaarheid<B> }
  | { soort: 'product'; fout: ProductBesluitFout }

export type NieuwProduct = NieuwProductVelden & { id: number }

export interface NieuweBatchPlan<P extends ProductLike> {
  /** Het batchrecord zoals het wordt opgeslagen (status Gepland). */
  batch: BatchUitRecept & { id: number }
  /** Wat `receptNaarBatch` nodig heeft voor de regels (`nieuweBatchRegels`). */
  nieuw: NieuweBatchBasis
  /** Maak dit product eerst aan (*Nieuw product*: naam, stijl en recept; geen ABV en geen allergenen). */
  nieuwProduct: NieuwProduct | null
  /** Het product van de batch (bestaand of nieuw), of null (*Later*). */
  product: P | NieuwProduct | null
  /** De app koppelde zelf (één kandidaat): meld het met een terugweg. */
  automatisch: boolean
  /** De naam die de batch zonder product had gekregen (voor die terugweg). */
  naamZonder: string
}

export type NieuweBatchUitkomst<P extends ProductLike, B> =
  | { ok: true; plan: NieuweBatchPlan<P> }
  | { ok: false; fout: NieuweBatchFout<B> }

/**
 * Een nieuwe batch plannen: dezelfde stappen als het planformulier dat dit
 * blad vervangt. Zonder naam én zonder recept kan het niet; een tank die op de
 * brouwdatum niet te kiezen is (bezet, lagertank) ook niet; dan het product
 * (`besluitProduct`: één kandidaat automatisch, *Nieuw product* met een naam
 * die nog niet bestaat). De batch krijgt het product — en zonder eigen naam
 * diens naam — via `receptNaarBatch`.
 */
export const planNieuweBatch = <P extends ProductLike, B extends BatchLike>(
  invoer: NieuweBatchInvoer,
  ctx: NieuweBatchCtx<P, B>,
  uitgifte: NieuweBatchUitgifte,
): NieuweBatchUitkomst<P, B> => {
  const recept = invoer.recept || null
  const nieuw: NieuweBatchBasis = {
    id: uitgifte.id,
    batch_nummer: uitgifte.batchNummer,
    naam: invoer.naam ?? '',
    datum: invoer.datum || uitgifte.vandaag,
    tank: invoer.tank || '',
    created_at: uitgifte.nu,
  }
  const opties = { nieuw, ingredienten: ctx.ingredienten || [] }
  const zonderProduct = receptNaarBatch(recept, opties).batch
  if (!zonderProduct.naam) return { ok: false, fout: { soort: 'naam_of_recept' } }

  if (nieuw.tank) {
    const tank = (ctx.tanks || []).find(tk => !!tk && String(tk.id) === nieuw.tank) || nieuw.tank
    const beschikbaar = tankBeschikbaarOp(tank, nieuw.datum, ctx.batches, tankOpties(recept, {
      tankStatussen: ctx.tankStatussen, conditionerenDagen: ctx.conditionerenDagen, vandaag: uitgifte.vandaag,
    }))
    if (!beschikbaar.kiesbaar) return { ok: false, fout: { soort: 'tank', tank: nieuw.tank, beschikbaar } }
  }

  const producten = ctx.producten || []
  const plan = productPlanVoor(recept, { producten, batches: ctx.batches, recepten: ctx.recepten })
  const besluit = besluitVoorBlad(plan, invoer.productKeuze, {
    producten, standaardNaam: recept?.naam || zonderProduct.naam,
  })
  if (besluit.fout) return { ok: false, fout: { soort: 'product', fout: besluit.fout } }

  // Het nieuwe product leest van de batch alleen naam, stijl en recept; de
  // lege meetvelden (`''`) doen er niet toe.
  const nieuwProduct: NieuwProduct | null = besluit.nieuwNaam
    ? {
      id: uitgifte.productId,
      ...nieuwProductUitBatch(zonderProduct as unknown as BatchLike, recept, {
        vandaag: uitgifte.vandaag, naam: besluit.nieuwNaam, recepten: ctx.recepten,
      }),
    }
    : null
  const product = nieuwProduct || besluit.product
  const batch = (product ? receptNaarBatch(recept, { ...opties, product }).batch : zonderProduct) as BatchUitRecept & { id: number }
  const liters = litersVoorBatch(recept, invoer.liters)
  if (liters !== null) batch.liter_vergist = liters

  return {
    ok: true,
    plan: {
      batch, nieuw, nieuwProduct, product,
      automatisch: besluit.automatisch && !!besluit.product,
      naamZonder: String(zonderProduct.naam || ''),
    },
  }
}

/**
 * De batchregels van de nieuwe batch tegen een (verse) lijst regels: de
 * regels van het recept erachter, met id's vanaf het hoogste bestaande.
 * Zonder recept: de lijst ongewijzigd.
 */
export const nieuweBatchRegels = <R extends RegelLike>(
  recept: ReceptLike | null | undefined,
  plan: Pick<NieuweBatchPlan<ProductLike>, 'nieuw'>,
  regels: R[] | null | undefined,
  ingredienten: IngredientLike[] | null | undefined,
): Array<R | BatchRegelUitRecept> => receptNaarBatch<R>(recept, { nieuw: plan.nieuw, ingredienten: ingredienten || [], regels: regels || [] }).alleRegels
