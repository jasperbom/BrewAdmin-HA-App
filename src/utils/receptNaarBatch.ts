// Recept → batch: de enige vertaling van een recept naar een batch en zijn
// ingrediëntregels.
//
// Twee ingangen gebruiken hem: een nieuwe batch plannen (`nieuw`) en "Recept
// opnieuw toepassen" op een geplande batch (`batch`). Vóór deze module stond
// dezelfde vertaling twee keer in BatchFlowPage (maakNieuweBatch en
// applyReceptToBatch); het gedrag is daar letterlijk uit overgenomen:
//
// - doelen gaan in `verwacht_og/fg/abv` (afgerond: SG op 3, ABV op 2
//   decimalen — Brewfather levert soms 1.0479999…), nooit in de meetvelden;
//   OG/FG/ABV staan leeg tot er gemeten is;
// - liters (`batch_size`), kleur, kooktijd, kookvolume, vergistings- en
//   maischprofiel komen uit het recept;
// - `recept_id` is altijd het hoofdrecept; een gekozen Brewfather-versie gaat
//   in `recept_versie_id` (zo blijven alle lezers van `recept_id` werken);
// - elke receptregel wordt een batchregel: mout (of suiker in de moutsectie)
//   met `extract_pct`, hop met `alpha_pct`, tijdstip, gebruik en whirlpool-
//   temperatuur; ontbreekt een waarde in het recept, dan die uit de
//   `bf_props` van het gekoppelde ingrediënt. Koppeling aan de catalogus op
//   `ingredient_id`, anders op naam (hoofdletterongevoelig). Nieuwe regels
//   zijn nooit afgeboekt (`lot_id`/`kosten` leeg, `afgeboekt: false`);
// - regel-id's lopen door vanaf het hoogste bestaande id.
//
// Afgeboekte regels (het lot is al verlaagd) worden nooit weggegooid: bij
// opnieuw toepassen blijven ze staan en vervangt alleen de rest. BatchFlowPage
// weigert opnieuw toepassen zolang zulke regels er zijn; deze module laat ze
// hoe dan ook nooit stil verdwijnen (traceergat).
//
// Optioneel krijgt de batch een product mee (`product`): dan `product_id`,
// `biernaam` en — zonder eigen naam — de naam van het product. Nog niet in
// gebruik bij het plannen (fase F2 zet het aan in de aanroeper).
//
// Puur: geen React, geen opslag, geen klok (id's en tijdstempels geeft de
// aanroeper uit).

import type { Batch, BatchIngredient, Ingredient, Product, Recept, ReceptIngredient } from '../types'
import { receptHoofdId } from './productKeten'

type ReceptBron = Pick<Recept, 'id'> & Partial<Recept>
type IngredientLike = Pick<Ingredient, 'id'> & Partial<Pick<Ingredient, 'naam' | 'bf_props'>>
type RegelLike = Pick<BatchIngredient, 'id' | 'batch_id'> & Partial<BatchIngredient>
type BatchLike = Pick<Batch, 'id'> & Partial<Batch>
type ProductBron = Pick<Product, 'id'> & Partial<Pick<Product, 'naam'>>

/** Een leeg-of-getal-veld zoals de batch het opslaat (`''` = niet ingevuld). */
type GetalOfLeeg = number | ''

/** SG op 3 decimalen; leeg of geen getal = `''`. */
export const sg3 = (x: unknown): GetalOfLeeg =>
  (x === '' || x == null || isNaN(Number(x))) ? '' : Math.round(Number(x) * 1000) / 1000

/** ABV op 2 decimalen; leeg of geen getal = `''`. */
export const abv2 = (x: unknown): GetalOfLeeg =>
  (x === '' || x == null || isNaN(Number(x))) ? '' : Math.round(Number(x) * 100) / 100

/** De batchvelden die uit het recept komen (zonder naam/stijl). */
export interface ReceptDoelVelden {
  recept_id: string
  recept_versie_id?: string
  verwacht_og: GetalOfLeeg
  verwacht_fg: GetalOfLeeg
  verwacht_abv: GetalOfLeeg
  liter_vergist: number | string
  kleur: number | string
  kooktijd: number | string
  kook_volume: number | string
  vergistingsprofiel: NonNullable<Batch['vergistingsprofiel']>
  maischprofiel: NonNullable<Batch['maischprofiel']>
}

/**
 * Batchvelden zoals ze uit deze vertaling komen. Ruimer dan `Batch` waar de
 * opslag dat ook is: meetvelden staan leeg (`''`) tot er gemeten is en
 * `liter_vergist` komt als `batch_size` uit het recept (getal of tekst).
 */
export type BatchUitRecept =
  Omit<Partial<Batch>, 'OG' | 'FG' | 'ABV' | 'liter_vergist' | 'product_id'> & {
    OG?: GetalOfLeeg
    FG?: GetalOfLeeg
    ABV?: GetalOfLeeg
    liter_vergist?: number | string
    product_id?: number
  }

/** Een batchregel zoals deze vertaling hem maakt: nooit afgeboekt. */
export interface BatchRegelUitRecept {
  id: number
  batch_id: number
  ingredient_id: number | null
  ingredient_naam: string
  ingredient_type: string
  hoeveelheid: number
  extract_pct?: number | ''
  alpha_pct?: number | ''
  tijdstip_min?: number | ''
  gebruik?: string
  temp_c?: number | ''
  eenheid: string
  lot_id: null
  kosten: null
  afgeboekt: false
}

/** Wat de aanroeper uitgeeft voor een nieuwe batch. */
export interface NieuweBatchBasis {
  /** Uitgegeven met `newId(batches)`. */
  id: number
  /** Uitgegeven met `nextBatchNummer(batches)`. */
  batch_nummer: string
  /** De naam uit het formulier; leeg = van het product, anders van het recept. */
  naam?: string | null
  datum: string
  tank?: string | null
  /** ISO-tijdstempel van aanmaken. */
  created_at: string
}

export interface ReceptNaarBatchOpties {
  /** Opnieuw toepassen: de bestaande batch. Leeg = een nieuwe batch (`nieuw`). */
  batch?: BatchLike | null
  /** Een nieuwe batch: wat de aanroeper uitgeeft en wat er in het formulier staat. */
  nieuw?: NieuweBatchBasis | null
  /** De ingrediëntencatalogus (koppeling + `bf_props`-terugval). */
  ingredienten?: IngredientLike[] | null
  /** Alle batchregels (van alle batches): voor de id-uitgifte en, bij opnieuw
   *  toepassen, de regels die vervangen worden. */
  regels?: RegelLike[] | null
  /** Optioneel het product van de batch (F2): zet `product_id` en `biernaam`. */
  product?: ProductBron | null
}

export interface ReceptNaarBatchResultaat<R extends RegelLike = RegelLike> {
  modus: 'nieuw' | 'opnieuw'
  /** Nieuw: het complete batchrecord. Opnieuw: de patch op de batch. */
  batch: BatchUitRecept
  /** De nieuwe regels van deze batch. */
  regels: BatchRegelUitRecept[]
  /** Opnieuw: de (niet-afgeboekte) regels van deze batch die vervallen. */
  verwijderdeRegelIds: number[]
  /** Opnieuw: de afgeboekte regels van deze batch, die blijven staan. */
  behoudenRegelIds: number[]
  /** De complete nieuwe lijst batchregels (uit `regels` van de opties). */
  alleRegels: Array<R | BatchRegelUitRecept>
}

interface ReceptRegelItem {
  ingredient_naam: string
  ingredient_type: string
  hoeveelheid: unknown
  eenheid: string
  ingredient_id: number | null
  extract_pct?: unknown
  gebruik?: unknown
  tijdstip_min?: unknown
  alpha_pct?: unknown
  temp_c?: unknown
}

/** De regels van een recept in de volgorde mout · hop · gist · overig. */
const receptRegelItems = (r: ReceptBron): ReceptRegelItem[] => {
  const lijst = (x: ReceptIngredient[] | undefined) => x || []
  return [
    ...lijst(r.mout).map(i => ({ ingredient_naam: i.naam, ingredient_type: i.ingredient_type || 'Mout', hoeveelheid: i.hoeveelheid, eenheid: i.eenheid || 'kg', ingredient_id: i.ingredient_id ?? null, extract_pct: i.extract_pct })),
    ...lijst(r.hop).map(i => ({ ingredient_naam: i.naam, ingredient_type: 'Hop', hoeveelheid: i.hoeveelheid, eenheid: i.eenheid || 'g', ingredient_id: i.ingredient_id ?? null, gebruik: i.gebruik, tijdstip_min: i.tijd, alpha_pct: i.alpha_pct, temp_c: i.temp_c })),
    ...lijst(r.gist).map(i => ({ ingredient_naam: i.naam, ingredient_type: 'Gist', hoeveelheid: i.hoeveelheid, eenheid: i.eenheid || 'pkg', ingredient_id: i.ingredient_id ?? null })),
    ...lijst(r.overig).map(i => ({ ingredient_naam: i.naam, ingredient_type: 'Overig', hoeveelheid: i.hoeveelheid, eenheid: i.eenheid || 'g', ingredient_id: i.ingredient_id ?? null, gebruik: i.gebruik })),
  ]
}

const ingevuld = (v: unknown): boolean => v != null && v !== ''

/** Getal uit het recept, anders uit `bf_props`, anders `''`. */
const getalOf = (eigen: unknown, terugval: unknown): number | '' =>
  ingevuld(eigen) ? Number(eigen) : (terugval != null ? Number(terugval) : '')

/** Het catalogusingrediënt van een receptregel: op id als het recept er een
 *  geeft (een onbekend id koppelt niet), anders op naam. */
const zoekIngredient = (item: ReceptRegelItem, ingredienten: IngredientLike[]): IngredientLike | undefined =>
  item.ingredient_id
    ? ingredienten.find(i => i.id === item.ingredient_id)
    : ingredienten.find(i => String(i.naam ?? '').toLowerCase() === String(item.ingredient_naam || '').toLowerCase())

/** De batchregels van een recept, met id's vanaf `startId`. */
export const regelsUitRecept = (
  recept: ReceptBron,
  batchId: number,
  startId: number,
  ingredienten: IngredientLike[] | null | undefined,
): BatchRegelUitRecept[] => {
  const catalogus = ingredienten || []
  return receptRegelItems(recept).map((item, idx) => {
    const ingMatch = zoekIngredient(item, catalogus)
    // Brouwkundige eigenschappen die het recept niet levert, komen uit het
    // gekoppelde ingrediënt.
    const bfp: Record<string, unknown> = ingMatch?.bf_props || {}
    const tType = String(item.ingredient_type || '').toLowerCase()
    const isHop = tType === 'hop'
    const isMout = tType === 'mout' || tType === 'suiker'
    return {
      id: startId + idx,
      batch_id: batchId,
      ingredient_id: ingMatch ? ingMatch.id : null,
      ingredient_naam: item.ingredient_naam,
      ingredient_type: item.ingredient_type,
      hoeveelheid: Number(item.hoeveelheid) || 0,
      ...(isMout && {
        extract_pct: getalOf(item.extract_pct, bfp.yield),
      }),
      ...(isHop && {
        alpha_pct: getalOf(item.alpha_pct, bfp.alpha),
        tijdstip_min: ingevuld(item.tijdstip_min) ? Number(item.tijdstip_min) : '',
        gebruik: String(item.gebruik || 'boil').toLowerCase(),
        temp_c: ingevuld(item.temp_c) ? Number(item.temp_c) : '',
      }),
      eenheid: item.eenheid,
      lot_id: null,
      kosten: null,
      afgeboekt: false,
    }
  })
}

/** Het eerstvolgende vrije regel-id: één hoger dan het hoogste, anders 1. */
export const volgendeRegelId = (regels: Array<{ id?: unknown } | null | undefined>): number =>
  regels.reduce<number>((max, r) => Math.max(max, Number(r?.id) || 0), 0) + 1

/** Recept-id's: altijd het hoofdrecept, de gekozen versie apart. */
const receptIds = (r: ReceptBron): { recept_id: string; recept_versie_id?: string } => {
  const hoofd = receptHoofdId(r)
  return hoofd && hoofd !== r.id ? { recept_id: hoofd, recept_versie_id: r.id } : { recept_id: r.id }
}

/** De doelen en het schema van het recept als batchvelden. */
export const receptDoelVelden = (r: ReceptBron): ReceptDoelVelden => ({
  ...receptIds(r),
  verwacht_og: sg3(r.OG),
  verwacht_fg: sg3(r.FG),
  verwacht_abv: abv2(r.ABV),
  liter_vergist: r.batch_size || '',
  kleur: r.kleur || '',
  kooktijd: r.kooktijd || '',
  kook_volume: r.kook_volume || '',
  vergistingsprofiel: r.vergistingsprofiel || [],
  maischprofiel: r.maischprofiel || [],
})

const productVelden = (p: ProductBron | null | undefined): { product_id?: number; biernaam?: string } =>
  p ? { product_id: p.id, ...(p.naam ? { biernaam: p.naam } : {}) } : {}

/**
 * Vertaal een recept naar een batch. Met `nieuw`: een complete nieuwe batch
 * (status Gepland) met zijn regels achter de bestaande. Met `batch`: de patch
 * voor "Recept opnieuw toepassen" — meetvelden leeg, doelen en schema uit het
 * recept — en de regels van die batch vervangen, behalve de afgeboekte.
 *
 * Zonder recept: een nieuwe batch zonder receptvelden en zonder regels, of
 * (opnieuw) niets.
 */
export function receptNaarBatch<R extends RegelLike = RegelLike>(
  recept: ReceptBron | null | undefined,
  opties: ReceptNaarBatchOpties & { regels?: R[] | null },
): ReceptNaarBatchResultaat<R> {
  const alle = (opties.regels || []) as R[]
  const product = opties.product || null

  if (opties.batch) {
    const b = opties.batch
    if (!recept) {
      return { modus: 'opnieuw', batch: {}, regels: [], verwijderdeRegelIds: [], behoudenRegelIds: [], alleRegels: [...alle] }
    }
    const doel = receptDoelVelden(recept)
    const { recept_id, recept_versie_id, ...rest } = doel
    const patch: BatchUitRecept = {
      recept_id,
      // Een eerder gekozen versie vervalt als nu het hoofdrecept wordt toegepast.
      ...(recept_versie_id ? { recept_versie_id } : b.recept_versie_id ? { recept_versie_id: '' } : {}),
      naam: product?.naam || recept.naam || b.naam,
      stijl: recept.stijl || '',
      OG: '', FG: '', ABV: '',
      ...rest,
      ...productVelden(product),
    }
    const vanBatch = (r: R | null | undefined): r is R => !!r && r.batch_id === b.id
    const behouden = alle.filter(r => vanBatch(r) && !!r.afgeboekt)
    const vervalt = alle.filter(r => vanBatch(r) && !r.afgeboekt)
    const blijft = alle.filter(r => !(vanBatch(r) && !r.afgeboekt))
    const regels = regelsUitRecept(recept, b.id, volgendeRegelId(blijft), opties.ingredienten)
    return {
      modus: 'opnieuw',
      batch: patch,
      regels,
      verwijderdeRegelIds: vervalt.map(r => r.id),
      behoudenRegelIds: behouden.map(r => r.id),
      alleRegels: [...blijft, ...regels],
    }
  }

  const n = opties.nieuw
  if (!n) throw new Error('receptNaarBatch: geef `batch` (opnieuw toepassen) of `nieuw` mee')
  const nb: BatchUitRecept = {
    id: n.id,
    batch_nummer: n.batch_nummer,
    naam: String(n.naam || '').trim() || product?.naam || recept?.naam || '',
    stijl: recept?.stijl || '',
    status: 'Gepland',
    datum: n.datum,
    tank: n.tank || '',
    OG: '', FG: '', ABV: '',
    created_at: n.created_at,
    ...(recept ? receptDoelVelden(recept) : {}),
    ...productVelden(product),
  }
  const regels = recept ? regelsUitRecept(recept, n.id, volgendeRegelId(alle), opties.ingredienten) : []
  return {
    modus: 'nieuw',
    batch: nb,
    regels,
    verwijderdeRegelIds: [],
    behoudenRegelIds: [],
    alleRegels: [...alle, ...regels],
  }
}
