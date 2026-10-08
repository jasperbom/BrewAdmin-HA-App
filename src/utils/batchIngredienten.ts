// Batch-ingrediëntregels — welk catalogusingrediënt hoort bij een regel, en
// wat er al van de voorraad is afgeboekt.
//
// Een batchregel is expliciet aan een ingrediënt gekoppeld (`ingredient_id`)
// of, zolang dat niet zo is, op naam. Dat laatste is gewoon: een batch die
// gepland wordt vóórdat het ingrediënt in de catalogus staat, of een regel die
// bewust terug is gezet op "automatisch (op naam)". De batchpagina kiest en
// boekt de lots via die naam-match af; de HACCP-regels (allergenen voor CCP 3,
// de risicoklasse voor CCP 1) keken eerst alleen naar het id. Een lactoseregel
// zonder id liet het etiket zonder melk dan gewoon door. Eén regel hier houdt
// die kanten gelijk.

import type { Ingredient } from '../types'

export interface BatchRegelKoppeling {
  ingredient_id?: number | string | null
  ingredient_naam?: string | null
  lot_id?: number | string | null
}

/** Het deel van een lot dat zegt bij welk ingrediënt het hoort. */
export interface LotKoppeling {
  id: number | string
  ingredient_id?: number | string | null
}

const naamSleutel = (v: unknown): string => String(v ?? '').trim().toLowerCase()

const gezetId = (v: unknown): boolean =>
  v != null && v !== '' && Number(v) !== 0

/** Het catalogusingrediënt achter een batchregel, in deze volgorde:
 *
 *  1. `ingredient_id` als die gezet is en in de catalogus staat;
 *  2. het lot van de regel (`lot_id` → `lot.ingredient_id`), als je `lots`
 *     meegeeft — dat is het ingrediënt dat écht in de ketel ging. Een regel
 *     "Pilsner Malt" uit Brewfather zonder id, afgeboekt van een lot
 *     "Pilsmout", hoort zo bij Pilsmout (en draagt diens allergenen);
 *  3. de naam (hoofdletterongevoelig, spaties aan de randen tellen niet),
 *     alleen als er géén id gezet is.
 *
 *  Een id dat niet (meer) in de catalogus staat valt dus nooit stil terug op
 *  een ander ingrediënt met toevallig dezelfde naam; alleen het lot mag dan
 *  nog spreken. Zonder `lots` is het gedrag precies als vroeger. */
export const ingredientVoorBatchRegel = <I extends Pick<Ingredient, 'id' | 'naam'>>(
  regel: BatchRegelKoppeling | null | undefined,
  ingredienten: I[] | null | undefined,
  lots?: LotKoppeling[] | null,
): I | undefined => {
  if (!regel) return undefined
  const lijst = ingredienten || []
  const heeftId = gezetId(regel.ingredient_id)
  if (heeftId) {
    const opId = lijst.find(i => Number(i?.id) === Number(regel.ingredient_id))
    if (opId) return opId
  }
  if (lots && gezetId(regel.lot_id)) {
    const lot = lots.find(l => !!l && String(l.id) === String(regel.lot_id))
    if (lot && gezetId(lot.ingredient_id)) {
      const viaLot = lijst.find(i => Number(i?.id) === Number(lot.ingredient_id))
      if (viaLot) return viaLot
    }
  }
  if (heeftId) return undefined
  const naam = naamSleutel(regel.ingredient_naam)
  if (!naam) return undefined
  return lijst.find(i => naamSleutel(i?.naam) === naam)
}

/** De regels van een batch die al van een lot zijn afgeboekt. Zulke regels
 *  mogen niet stil verdwijnen: het lot is dan al verlaagd, en zonder de regel
 *  is het lot ook niet meer aan de batch te koppelen (traceergat). */
export const afgeboekteRegels = <R extends {batch_id: number; afgeboekt?: boolean | null}>(
  regels: R[] | null | undefined,
  batchId: number,
): R[] => (regels || []).filter(r => !!r && r.batch_id === batchId && !!r.afgeboekt)
