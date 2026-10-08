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

// Een regel met een lot hoort bij het ingrediënt van dat lot: "Pilsner Malt"
// uit Brewfather, afgeboekt van een lot Pilsmout.
describe('ingredientVoorBatchRegel — via het lot', () => {
  const lots = [{id: 10, ingredient_id: 1}, {id: '11', ingredient_id: 5}, {id: 12, ingredient_id: 99}]

  it('vindt het ingrediënt van het lot als de naam niet matcht', () => {
    expect(ingredientVoorBatchRegel({ingredient_naam: 'Pilsner Malt', lot_id: 10}, ingredienten, lots)?.id).toBe(1)
    expect(ingredientVoorBatchRegel({ingredient_naam: 'Milk sugar', lot_id: '11'}, ingredienten, lots)?.id).toBe(5)
  })

  it('het lot wint van een toevallige naam-match', () => {
    expect(ingredientVoorBatchRegel({ingredient_naam: 'Lactose', lot_id: 10}, ingredienten, lots)?.id).toBe(1)
  })

  it('een gezet en bestaand id wint van het lot', () => {
    expect(ingredientVoorBatchRegel({ingredient_id: 7, ingredient_naam: 'x', lot_id: 10}, ingredienten, lots)?.id).toBe(7)
  })

  it('een verdwenen id: het lot mag nog spreken, de naam niet', () => {
    expect(ingredientVoorBatchRegel({ingredient_id: 99, ingredient_naam: 'Lactose', lot_id: 10}, ingredienten, lots)?.id).toBe(1)
    expect(ingredientVoorBatchRegel({ingredient_id: 99, ingredient_naam: 'Lactose', lot_id: 77}, ingredienten, lots)).toBeUndefined()
  })

  it('een onbekend lot of een lot met een verdwenen ingrediënt valt terug op de naam', () => {
    expect(ingredientVoorBatchRegel({ingredient_naam: 'Lactose', lot_id: 77}, ingredienten, lots)?.id).toBe(5)
    expect(ingredientVoorBatchRegel({ingredient_naam: 'Lactose', lot_id: 12}, ingredienten, lots)?.id).toBe(5)
    expect(ingredientVoorBatchRegel({ingredient_naam: 'Lactose', lot_id: ''}, ingredienten, lots)?.id).toBe(5)
  })

  it('zonder lots precies als vroeger', () => {
    expect(ingredientVoorBatchRegel({ingredient_naam: 'Pilsner Malt', lot_id: 10}, ingredienten)).toBeUndefined()
    expect(ingredientVoorBatchRegel({ingredient_naam: 'Pilsner Malt', lot_id: 10}, ingredienten, null)).toBeUndefined()
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
