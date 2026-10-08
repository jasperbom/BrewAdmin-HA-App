// De keten in de batch: welk product een nieuwe batch krijgt, hoe de
// productkeuze van CCP 3 en het afvulformulier begint, en wat de ketenregel in
// de batchkop toont ("Recept · Kadeblond v4 ›", "Product · Kadeblond ›",
// "Tank · GV1", "gebrouwen di 15-9-2026 · dag 8 in conditionering").
//
// Opzet hoofdstuk 4: de app legt de keten zelf. Hangt het recept van een
// nieuwe batch aan precies één niet-gearchiveerd product, dan krijgt de batch
// dat product — met een terugweg (UndoBar). Bij meer kandidaten kies je, bij
// geen kies je *Nieuw product* of *Later*. Uit roulatie telt mee (een
// seizoensbier wordt juist dan gebrouwen); gearchiveerd niet. Een batch die al
// een product heeft, houdt dat — ook bij *Recept opnieuw toepassen*.
//
// Puur: geen React, geen opslag, geen vertaalfunctie. Teksten en datums maakt
// het scherm (components/batch/KetenRegel.tsx). Bouwt op utils/productKeten.ts.

import type { Batch, Product, Recept, Tank } from '../types'
import {
  hoofdIdResolver, productenVanRecept, productenVoorKeuze, productVoorBatch,
  productVoorstelVoorRecept, receptVoorBatch,
} from './productKeten'
import type { AfvullingLike, ProductKeuze } from './productKeten'
import { bouwBatchTijdlijn } from './vergisting'
import type { StatusLogRegel } from './vergisting'
import { normaliseerStatus } from './volgendeStap'
import { receptTitel } from './detailTitel'

type ReceptLike = Pick<Recept, 'id'> & Partial<Pick<Recept, 'naam' | 'parent_id' | 'is_huidige' | 'stijl' | 'versie'>>
type ProductLike = Pick<Product, 'id' | 'naam'> & Partial<Product>
type BatchLike = Pick<Batch, 'id'> & Partial<Batch>

/** Een product-id als getal, of null bij leeg/0/ongeldig (`product_id: ''`
 *  komt voor: de batchgegevens zetten dat bij ontkoppelen). */
const productIdGetal = (v: unknown): number | null => {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) && n !== 0 ? n : null
}

// ── Het product bij plannen en bij recept opnieuw toepassen ─────────────────

/**
 * Wat er met het product van een batch gebeurt als hij uit een recept ontstaat
 * (plannen) of een ander recept krijgt (*Recept opnieuw toepassen*):
 * - `behouden` — de batch heeft al een (bestaand) product en houdt dat;
 * - `een` — het recept hoort bij precies één product: de app koppelt zelf;
 * - `meer` — meer kandidaten: de gebruiker kiest (of later);
 * - `geen` — geen kandidaat: *Nieuw product* of *Later*.
 */
export type PlanProduct<P> =
  | { soort: 'behouden'; product: P }
  | { soort: 'een'; product: P }
  | { soort: 'meer'; kandidaten: P[] }
  | { soort: 'geen' }

/**
 * Het voorstel voor het product van een batch van dit recept
 * (`productVoorstelVoorRecept`), behalve als de batch (`ctx.batch`) al een
 * product heeft: dan blijft dat. De batch zelf telt niet mee als batch van een
 * product — bij opnieuw toepassen verdwijnt zijn oude recept juist. Zonder
 * recept (en zonder eigen product) is er niets voor te stellen: `null`.
 */
export function productBijPlannen<P extends ProductLike>(
  recept: ReceptLike | string | null | undefined,
  ctx: {
    producten?: P[] | null
    batches?: BatchLike[] | null
    recepten?: ReceptLike[] | null
    batch?: BatchLike | null
  } = {},
): PlanProduct<P> | null {
  const producten = ctx.producten || []
  const eigen = productIdGetal(ctx.batch?.product_id)
  if (eigen != null) {
    const p = producten.find(x => !!x && Number(x.id) === eigen)
    if (p) return { soort: 'behouden', product: p }
  }
  const leeg = recept == null || (typeof recept === 'string' ? recept === '' : recept.id == null || recept.id === '')
  if (leeg) return null
  const zelf = ctx.batch?.id
  const batches = zelf == null ? ctx.batches : (ctx.batches || []).filter(b => !b || b.id !== zelf)
  return productVoorstelVoorRecept(recept, producten, batches, ctx.recepten)
}

/** Wat de gebruiker koos. Geen keuze (null) = het voorstel volgen. */
export type ProductKeuzeWaarde =
  | { soort: 'product'; productId: number }
  | { soort: 'nieuw'; naam: string }
  | { soort: 'later' }

export type ProductBesluitFout = 'naam_leeg' | 'naam_bestaat'

export interface ProductBesluit<P> {
  /** Het bestaande product dat de batch krijgt; null = geen (of een nieuw). */
  product: P | null
  /** Maak een nieuw product met deze naam (`nieuwProductUitBatch`). */
  nieuwNaam: string | null
  /** De app koppelde zelf (precies één kandidaat, niets gekozen): meld het met
   *  een terugweg ("Gekoppeld aan Kadeblond — Ongedaan maken"). */
  automatisch: boolean
  /** Waarom het (nog) niet kan; het scherm vertaalt. */
  fout: ProductBesluitFout | null
}

/**
 * Het voorstel plus de keuze → wat er gebeurt. Een batch die zijn product
 * houdt, houdt het ook als er iets gekozen is. Zonder keuze volgt het
 * voorstel: één kandidaat = automatisch, meer of geen = later. *Nieuw product*
 * krijgt de getypte naam, anders `standaardNaam` (de naam van het recept); een
 * naam die al bestaat (hoofdletterongevoelig, ook gearchiveerd — zoals de
 * productenpagina bij opslaan) kan niet.
 */
export function besluitProduct<P extends ProductLike>(
  plan: PlanProduct<P> | null,
  keuze: ProductKeuzeWaarde | null | undefined,
  ctx: { producten?: ReadonlyArray<P | null | undefined> | null; standaardNaam?: string | null } = {},
): ProductBesluit<P> {
  const geen: ProductBesluit<P> = { product: null, nieuwNaam: null, automatisch: false, fout: null }
  if (!plan) return geen
  if (plan.soort === 'behouden') return { ...geen, product: plan.product }
  if (!keuze) return plan.soort === 'een' ? { ...geen, product: plan.product, automatisch: true } : geen
  if (keuze.soort === 'later') return geen
  if (keuze.soort === 'product') {
    const kandidaten: P[] = plan.soort === 'een' ? [plan.product] : plan.soort === 'meer' ? plan.kandidaten : []
    const id = Number(keuze.productId)
    const p = kandidaten.find(x => Number(x.id) === id)
      || (ctx.producten || []).find((x): x is P => !!x && Number(x.id) === id && x.status !== 'gearchiveerd')
    return p ? { ...geen, product: p } : geen
  }
  const naam = String(keuze.naam ?? '').trim() || String(ctx.standaardNaam ?? '').trim()
  if (!naam) return { ...geen, fout: 'naam_leeg' }
  if (productNaamBezet(naam, ctx.producten)) return { ...geen, fout: 'naam_bestaat' }
  return { ...geen, nieuwNaam: naam }
}

/** Bestaat er al een product met deze naam (hoofdletterongevoelig, getrimd,
 *  ook gearchiveerd)? `behalveId` telt niet mee (het product zelf). */
export const productNaamBezet = (
  naam: string | null | undefined,
  producten: ReadonlyArray<Pick<Product, 'id'> & Partial<Pick<Product, 'naam'>> | null | undefined> | null | undefined,
  behalveId?: number | null,
): boolean => {
  const n = String(naam ?? '').trim().toLowerCase()
  if (!n) return false
  return (producten || []).some(p => !!p &&
    String(p.naam ?? '').trim().toLowerCase() === n &&
    (behalveId == null || Number(p.id) !== Number(behalveId)))
}

/** Wat de app bij een automatische koppeling deed — genoeg om hem terug te draaien. */
export interface AutomatischeKoppeling {
  productId: number
  productNaam: string
  /** De naam die de batch zonder product had gekregen (`receptNaarBatch` zonder product). */
  naamZonder: string
  /** De biernaam van vóór de koppeling; leeg = weghalen. */
  biernaamZonder?: string | null
}

/**
 * De terugweg van een automatische koppeling ("Ongedaan maken"): het product
 * eraf, en naam en biernaam terug naar wat ze zonder product waren — maar
 * alleen wat sindsdien niet veranderd is. Heeft de batch intussen een ander
 * product (of geen), dan is er niets terug te draaien: `null`.
 */
export function ontkoppelProduct<B extends BatchLike>(
  batch: B | null | undefined,
  k: AutomatischeKoppeling,
): B | null {
  if (!batch || productIdGetal(batch.product_id) !== Number(k.productId)) return null
  const { product_id: _weg, ...rest } = batch
  const uit: Record<string, unknown> = { ...rest }
  if (String(batch.biernaam ?? '') === k.productNaam) {
    const vorige = String(k.biernaamZonder ?? '').trim()
    if (vorige) uit.biernaam = vorige
    else delete uit.biernaam
  }
  if (String(batch.naam ?? '') === k.productNaam && String(k.naamZonder ?? '').trim()) uit.naam = k.naamZonder
  return uit as B
}

// ── De productkeuze in CCP 3, het afvulformulier en de batchgegevens ────────

export interface BatchProductKeuze<P> extends ProductKeuze<P> {
  /** Hoort bij het recept van de batch (`productenVanRecept`): staat bovenaan. */
  vanRecept: boolean
}

/**
 * De producten voor een keuzelijst bij een batch: eerst de producten van zijn
 * recept (in roulatie eerst, dan op naam — het product van de batch zelf hoort
 * daar via zijn batches altijd bij, tenzij het gearchiveerd is), dan de andere
 * niet-gearchiveerde op naam, en als laatste een gearchiveerd product dat al
 * gekozen is (`gekozenId`, gemarkeerd) — zie `productenVoorKeuze`.
 */
export function productenVoorBatchKeuze<P extends ProductLike>(
  batch: BatchLike | null | undefined,
  producten: ReadonlyArray<P | null | undefined> | null | undefined,
  ctx: { batches?: BatchLike[] | null; recepten?: ReceptLike[] | null; gekozenId?: number | string | null } = {},
): BatchProductKeuze<P>[] {
  const lijst = (producten || []).filter((p): p is P => !!p && p.id != null)
  const receptId = batch?.recept_id || batch?.recept_versie_id || null
  const vanRecept = receptId ? productenVanRecept(receptId, lijst, ctx.batches, ctx.recepten) : []
  const bovenaan = new Set(vanRecept.map(p => Number(p.id)))
  return [
    ...vanRecept.map(product => ({ product, gearchiveerd: false, vanRecept: true })),
    ...productenVoorKeuze(lijst, ctx.gekozenId)
      .filter(k => !bovenaan.has(Number(k.product.id)))
      .map(k => ({ ...k, vanRecept: false })),
  ]
}

// ── De ketenregel in de batchkop ────────────────────────────────────────────

export interface KetenRecept {
  /** Het hoofdrecept — waar de chip naartoe gaat (`#/productie/recepten/<id>`). */
  id: string
  /** De naam zoals de kopbalk hem toont (een gekozen versie met haar versie erbij); leeg = onbekend. */
  naam: string
  /** Bestaat het hoofdrecept nog? Anders is de chip geen link. */
  bestaat: boolean
}

export interface KetenProduct {
  id: number
  naam: string
  gearchiveerd: boolean
  /** `batch` = `product_id`, `afvullingen` = een oude batch zonder koppeling
   *  (het product van zijn afvullingen), `extra` = `product_ids`. */
  bron: 'batch' | 'afvullingen' | 'extra'
}

/**
 * Het moment van de batch in de grijze tekst achter de chips:
 * - `brouwdag` — Gepland/Brouwen: "brouwdag wo 14-10-2026";
 * - `in_fase` — Vergisten/Conditioneren: "gebrouwen … · dag 8 in conditionering"
 *   (dag 1 = de dag dat de fase begon; null als dat niet bekend is);
 * - `afgevuld` — Afgevuld/Gesloten: "gebrouwen … · afgevuld …".
 */
export type KetenMoment =
  | { soort: 'brouwdag'; datum: string }
  | { soort: 'in_fase'; gebrouwen: string | null; fase: 'vergisting' | 'conditionering'; dag: number | null }
  | { soort: 'afgevuld'; gebrouwen: string | null; afgevuld: string | null }

export interface BatchKeten {
  recept: KetenRecept | null
  /** Het product van de batch, dan de extra producten (`product_ids`). */
  producten: KetenProduct[]
  /** Geen product te vinden: de chip *Product kiezen*. */
  productKiezen: boolean
  /** De tank zolang er (nog) bier in of op komt — niet meer na het afvullen. */
  tank: { id: string; naam: string } | null
  moment: KetenMoment | null
}

const IS_DATUM = /^\d{4}-\d{2}-\d{2}/

const datumVan = (v: unknown): string | null => {
  const s = String(v ?? '')
  return IS_DATUM.test(s) ? s.slice(0, 10) : null
}

/** Hele kalenderdagen van a naar b (beide JJJJ-MM-DD). */
const dagenTussen = (a: string, b: string): number => {
  const d = (s: string) => Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)))
  return Math.round((d(b) - d(a)) / 86_400_000)
}

/** Dag n van een fase: de begindag is dag 1. Null zonder begin, of als het begin na vandaag ligt. */
export const dagVanFase = (begin: string | null | undefined, vandaag: string | null | undefined): number | null => {
  const a = datumVan(begin), b = datumVan(vandaag)
  if (!a || !b) return null
  const n = dagenTussen(a, b)
  return n < 0 ? null : n + 1
}

const NA_HET_AFVULLEN = new Set(['Afgevuld', 'Gesloten'])

/**
 * Alles wat de ketenregel van een batch toont, afgeleid uit de batch en zijn
 * omgeving. `statusLog` = de logregels (`type: 'status'`) — van deze batch of
 * van allemaal, er wordt op `batch_id` gefilterd; `afvullingen` idem.
 */
export function batchKeten(
  batch: BatchLike | null | undefined,
  ctx: {
    producten?: ReadonlyArray<ProductLike | null | undefined> | null
    recepten?: ReceptLike[] | null
    afvullingen?: Array<AfvullingLike & { datum?: string | null }> | null
    tanks?: Array<Pick<Tank, 'id'> & Partial<Pick<Tank, 'naam'>>> | null
    statusLog?: StatusLogRegel[] | null
    /** JJJJ-MM-DD — voor "dag n in …". */
    vandaag?: string | null
  } = {},
): BatchKeten | null {
  if (!batch) return null
  const recepten = ctx.recepten || []
  const producten = (ctx.producten || []).filter((p): p is ProductLike => !!p && p.id != null)

  // Recept: de chip gaat naar het hoofdrecept; de naam is die van de gekozen versie.
  const naarHoofd = hoofdIdResolver(recepten)
  const hoofd = naarHoofd(batch.recept_id || batch.recept_versie_id || null)
  const r = receptVoorBatch(batch, recepten)
  const recept: KetenRecept | null = hoofd
    ? { id: hoofd, naam: receptTitel(r), bestaat: recepten.some(x => x.id === hoofd) }
    : null

  // Producten: het product van de batch (of van zijn afvullingen), dan de extra.
  const eigenAv = (ctx.afvullingen || []).filter(a => !!a && Number(a.batch_id) === Number(batch.id))
  const uit: KetenProduct[] = []
  const voeg = (id: number | null, bron: KetenProduct['bron']) => {
    if (id == null || uit.some(x => x.id === id)) return
    const p = producten.find(x => Number(x.id) === id)
    if (!p) return
    uit.push({ id, naam: String(p.naam ?? ''), gearchiveerd: p.status === 'gearchiveerd', bron })
  }
  const pv = productVoorBatch(batch, { afvullingen: eigenAv, producten })
  voeg(pv.productId, pv.bron === 'afvullingen' ? 'afvullingen' : 'batch')
  for (const id of Array.isArray(batch.product_ids) ? batch.product_ids : []) voeg(productIdGetal(id), 'extra')

  const status = normaliseerStatus(batch.status)

  const tankId = String(batch.tank ?? '').trim()
  const tank = tankId && !NA_HET_AFVULLEN.has(status)
    ? { id: tankId, naam: String((ctx.tanks || []).find(t => t && t.id === tankId)?.naam || tankId) }
    : null

  const datum = datumVan(batch.datum)
  let moment: KetenMoment | null = null
  if (status === 'Gepland' || status === 'Brouwen') {
    moment = datum ? { soort: 'brouwdag', datum } : null
  } else {
    const log = (ctx.statusLog || []).filter(l => !!l && Number(l.batch_id) === Number(batch.id) &&
      (l.type == null || l.type === 'status'))
    const tl = bouwBatchTijdlijn(batch, eigenAv, log)
    if (status === 'Vergisten') {
      moment = { soort: 'in_fase', gebrouwen: datum, fase: 'vergisting', dag: dagVanFase(tl.vergistStart, ctx.vandaag) }
    } else if (status === 'Conditioneren') {
      moment = { soort: 'in_fase', gebrouwen: datum, fase: 'conditionering', dag: dagVanFase(tl.conditioneerStart, ctx.vandaag) }
    } else if (datum || tl.verpaktDatum) {
      moment = { soort: 'afgevuld', gebrouwen: datum, afgevuld: NA_HET_AFVULLEN.has(status) ? tl.verpaktDatum : null }
    }
  }

  return { recept, producten: uit, productKiezen: uit.length === 0, tank, moment }
}
