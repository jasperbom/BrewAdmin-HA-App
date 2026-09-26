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
}

const naamSleutel = (v: unknown): string => String(v ?? '').trim().toLowerCase()

/** Het catalogusingrediënt achter een batchregel: op `ingredient_id` als die
 *  gezet is, anders op naam (hoofdletterongevoelig, spaties aan de randen
 *  tellen niet). Een id dat niet (meer) in de catalogus staat levert niets
 *  op — dan valt de regel niet stil terug op een ander ingrediënt met
 *  toevallig dezelfde naam. */
export const ingredientVoorBatchRegel = <I extends Pick<Ingredient, 'id' | 'naam'>>(
  regel: BatchRegelKoppeling | null | undefined,
  ingredienten: I[] | null | undefined,
): I | undefined => {
  if (!regel) return undefined
  const lijst = ingredienten || []
  if (regel.ingredient_id != null && regel.ingredient_id !== '' && Number(regel.ingredient_id) !== 0) {
    return lijst.find(i => Number(i?.id) === Number(regel.ingredient_id))
  }
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
