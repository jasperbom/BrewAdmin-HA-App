import { describe, it, expect } from 'vitest'
import { ingredientVoorBatchRegel, afgeboekteRegels } from '../batchIngredienten'

const ingredienten = [
  {id: 1, naam: 'Pilsmout', type: 'Mout'},
  {id: 5, naam: 'Lactose', type: 'Suiker'},
  {id: 7, naam: 'Frambozen ', type: 'Fruit'},
] as any[]

describe('ingredientVoorBatchRegel', () => {
  it('zoekt op id als die gezet is', () => {
    expect(ingredientVoorBatchRegel({ingredient_id: 5, ingredient_naam: 'Lactose'}, ingredienten)?.id).toBe(5)
  })

  it('laat een gezet id winnen van een afwijkende naam', () => {
    expect(ingredientVoorBatchRegel({ingredient_id: 1, ingredient_naam: 'Lactose'}, ingredienten)?.id).toBe(1)
  })

  // Het gat uit de audit: een batch gepland vóórdat Lactose in de catalogus
  // stond, heeft een regel zonder id. De batchpagina boekt die op naam af.
  it('valt zonder id terug op de naam, hoofdletterongevoelig en zonder randspaties', () => {
    expect(ingredientVoorBatchRegel({ingredient_id: null, ingredient_naam: 'lactose'}, ingredienten)?.id).toBe(5)
    expect(ingredientVoorBatchRegel({ingredient_naam: '  LACTOSE '}, ingredienten)?.id).toBe(5)
    expect(ingredientVoorBatchRegel({ingredient_naam: 'frambozen'}, ingredienten)?.id).toBe(7)
  })

  it('geeft niets bij een onbekende of lege naam', () => {
    expect(ingredientVoorBatchRegel({ingredient_naam: 'Honing'}, ingredienten)).toBeUndefined()
    expect(ingredientVoorBatchRegel({ingredient_naam: ''}, ingredienten)).toBeUndefined()
    expect(ingredientVoorBatchRegel(null, ingredienten)).toBeUndefined()
  })

  it('valt bij een verdwenen id niet stil terug op de naam', () => {
    expect(ingredientVoorBatchRegel({ingredient_id: 99, ingredient_naam: 'Lactose'}, ingredienten)).toBeUndefined()
  })
})

describe('afgeboekteRegels', () => {
  it('geeft niets bij een lege lijst of alleen open regels', () => {
    expect(afgeboekteRegels([], 1)).toEqual([])
    expect(afgeboekteRegels(null, 1)).toEqual([])
    expect(afgeboekteRegels([{id: 1, batch_id: 1, afgeboekt: false}, {id: 2, batch_id: 1}], 1)).toEqual([])
  })

  it('telt alleen afgeboekte regels van de eigen batch', () => {
    const regels = [
      {id: 1, batch_id: 1, afgeboekt: true},
      {id: 2, batch_id: 1, afgeboekt: false},
      {id: 3, batch_id: 2, afgeboekt: true},
    ]
    expect(afgeboekteRegels(regels, 1).map(r => r.id)).toEqual([1])
  })
})
