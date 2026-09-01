// Herkenning tussen receptregel en voorraadingredient. Aanleiding: kandijsuiker
// staat in Brewfather in de fermentables-lijst (de moutlijst van de app) maar
// ligt in de voorraad als 'Suiker' — die twee moeten elkaar vinden.
import { describe, it, expect } from 'vitest'
import { bfFermType, canoniekIngType, verwanteIngTypes, ingTypeMatcht, ingredientenVoorType } from '../ingTypes'
import { bfMapRecipe, bfMapBis } from '../api'
import { scaleRecipeNeeds, aggregateBatchNeeds } from '../calculations'

describe('bfFermType', () => {
  it('mapt de Brewfather-fermentabletypes', () => {
    expect(bfFermType('Grain')).toBe('Mout')
    expect(bfFermType('Dry Extract')).toBe('Mout')
    expect(bfFermType('Sugar')).toBe('Suiker')
    expect(bfFermType('Honey')).toBe('Suiker')
    expect(bfFermType('Adjunct')).toBe('Overig')
  })
  it('is ongevoelig voor schrijfwijze en valt terug op Mout', () => {
    expect(bfFermType('sugar')).toBe('Suiker')
    expect(bfFermType('')).toBe('Mout')
    expect(bfFermType(undefined)).toBe('Mout')
    expect(bfFermType('Iets Nieuws')).toBe('Mout')
  })
})

describe('canoniekIngType', () => {
  it('normaliseert naar het ingebouwde type', () => {
    expect(canoniekIngType('suiker')).toBe('Suiker')
    expect(canoniekIngType('MOUT')).toBe('Mout')
  })
  it('laat een eigen type ongemoeid', () => {
    expect(canoniekIngType('Kruiden')).toBe('Kruiden')
    expect(canoniekIngType('')).toBe('')
  })
})

describe('verwanteIngTypes / ingTypeMatcht', () => {
  it('mout en suiker zijn uitwisselbaar', () => {
    expect(verwanteIngTypes('Mout')).toEqual(['Mout', 'Suiker'])
    expect(ingTypeMatcht('Mout', 'Suiker')).toBe(true)
    expect(ingTypeMatcht('Suiker', 'Mout')).toBe(true)
  })
  it('suiker hoort ook bij de toevoegingen', () => {
    expect(ingTypeMatcht('Overig', 'Suiker')).toBe(true)
    expect(ingTypeMatcht('Suiker', 'Overig')).toBe(true)
  })
  it('houdt hop en gist strikt gescheiden', () => {
    expect(ingTypeMatcht('Mout', 'Hop')).toBe(false)
    expect(ingTypeMatcht('Hop', 'Mout')).toBe(false)
    expect(ingTypeMatcht('Gist', 'Suiker')).toBe(false)
  })
  it('eigen typen matchen alleen zichzelf', () => {
    expect(ingTypeMatcht('Kruiden', 'Kruiden')).toBe(true)
    expect(ingTypeMatcht('Kruiden', 'Mout')).toBe(false)
  })
  it('een regel zonder type valt terug op de toevoegingen', () => {
    expect(ingTypeMatcht('', 'Overig')).toBe(true)
    expect(ingTypeMatcht('', 'Suiker')).toBe(true)
    expect(ingTypeMatcht('', 'Hop')).toBe(false)
  })
})

describe('ingredientenVoorType', () => {
  const ing = [
    {id: 1, naam: 'Pilsmout', type: 'Mout'},
    {id: 2, naam: 'Kandijsuiker donker', type: 'Suiker'},
    {id: 3, naam: 'Saaz', type: 'Hop'},
    {id: 4, naam: 'Amber mout', type: 'Mout'},
    {id: 5, naam: 'Koriander', type: 'Overig'},
  ]
  it('toont bij een moutregel ook de suikers, maar geen hop', () => {
    const namen = ingredientenVoorType(ing, 'Mout').map(i => i.naam)
    expect(namen).toEqual(['Amber mout', 'Pilsmout', 'Kandijsuiker donker'])
  })
  it('zet het eigen type vooraan en sorteert daarbinnen op naam', () => {
    const namen = ingredientenVoorType(ing, 'Suiker').map(i => i.naam)
    expect(namen).toEqual(['Kandijsuiker donker', 'Amber mout', 'Pilsmout', 'Koriander'])
  })
  it('gaat om met een lege lijst', () => {
    expect(ingredientenVoorType(null, 'Mout')).toEqual([])
  })
})

const BF_RECEPT = {
  _id: 'r1',
  name: 'Dubbel',
  fermentables: [
    {name: 'Pilsmout', type: 'Grain', amount: 40, yield: 80},
    {name: 'Kandijsuiker donker', type: 'Sugar', amount: 2, yield: 100},
  ],
}

describe('Brewfather-import behoudt het suikertype', () => {
  it('recept: de suikerregel in de moutlijst blijft Suiker', () => {
    const r = bfMapRecipe(BF_RECEPT)
    expect(r.mout.map((m: any) => m.ingredient_type)).toEqual(['Mout', 'Suiker'])
  })
  it('batchregels: idem, met behoud van het extract%', () => {
    const rows = bfMapBis({recipe: BF_RECEPT}, 7, 1)
    expect(rows.map((x: any) => [x.ingredient_naam, x.ingredient_type])).toEqual([
      ['Pilsmout', 'Mout'],
      ['Kandijsuiker donker', 'Suiker'],
    ])
    expect(rows[1].extract_pct).toBe(100)
  })
})

describe('planning: suiker uit de moutlijst telt in dezelfde categorie', () => {
  const recept: any = {
    id: 'r1', naam: 'Dubbel', batch_size: 100,
    mout: [
      {naam: 'Pilsmout', hoeveelheid: 40, eenheid: 'kg', ingredient_type: 'Mout'},
      {naam: 'Kandijsuiker donker', hoeveelheid: 2, eenheid: 'kg', ingredient_type: 'Suiker'},
    ],
  }
  it('scaleRecipeNeeds volgt het type van de regel', () => {
    const needs = scaleRecipeNeeds(recept, 200)
    expect(needs).toEqual([
      {naam: 'Pilsmout', hoeveelheid: 80, eenheid: 'kg', categorie: 'mout'},
      {naam: 'Kandijsuiker donker', hoeveelheid: 4, eenheid: 'kg', categorie: 'overig'},
    ])
  })
  it('recept- en batchbron landen in dezelfde regel van de bestellijst', () => {
    const batches = [{id: 1, recept_id: 'r1', liter_vergist: 100}, {id: 2, recept_id: 'r1', liter_vergist: 100}]
    const bi = [
      {batch_id: 1, ingredient_naam: 'Kandijsuiker donker', ingredient_type: 'Suiker', hoeveelheid: 2, eenheid: 'kg'},
    ]
    const agg = aggregateBatchNeeds(batches, bi, [recept], (b: any) => b.recept_id)
    const suiker = agg.filter(a => a.naam === 'Kandijsuiker donker')
    expect(suiker).toHaveLength(1)
    expect(suiker[0]).toMatchObject({categorie: 'overig', totaal: 4})
  })
})
